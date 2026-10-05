#!/usr/bin/env bash
# Runs one load-test profile end to end and builds its report.
#
#   loadtest/run.sh smoke
#   loadtest/run.sh stress                      # LT_STEPS=... to change the steps
#   LT_RATE=40 loadtest/run.sh soak             # LT_DURATION=2h by default
#   LT_RATE=40 loadtest/run.sh spike
#   loadtest/run.sh report <results/run-dir>    # rebuild a report
#   loadtest/run.sh down                        # stop the stack and delete its data
#
# Results land in loadtest/results/<timestamp>-<profile>/ (report.html).
# All settings are environment variables; see loadtest/README.md.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
API_DIR="$(dirname "$ROOT")"
PROFILE="${1:-}"
COMPOSE=(docker compose -f "$ROOT/compose.yml")
TSX=(pnpm --dir "$API_DIR" --silent exec tsx)

# Every component reads its endpoints from these, so overriding a port is enough.
export LT_BASE_URL="${LT_BASE_URL:-http://127.0.0.1:${LT_API_PORT:-3100}}"
export LT_DATABASE_URL="${LT_DATABASE_URL:-postgresql://nostos:nostos-loadtest@127.0.0.1:${LT_PG_PORT:-55432}/nostos_loadtest}"
export LT_PROBE_URL="${LT_PROBE_URL:-http://127.0.0.1:${LT_PROBE_PORT:-19464}/}"

compose_quiet() {
	# Compose prints progress on stderr; keep it in a log and show it only on failure.
	if ! "${COMPOSE[@]}" "$@" > "$ROOT/.data/compose.log" 2>&1; then
		cat "$ROOT/.data/compose.log" >&2
		die "docker compose $* failed"
	fi
}

log() { printf '\033[1m[loadtest]\033[0m %s\n' "$*"; }
die() { printf '\033[31m[loadtest]\033[0m %s\n' "$*" >&2; exit 1; }

case "$PROFILE" in
	smoke|stress|soak|spike) ;;
	report)
		[[ -n "${2:-}" ]] || die "usage: run.sh report <run-dir>"
		"${TSX[@]}" "$ROOT/report/build-report.ts" "$2"
		exit 0
		;;
	down)
		"${COMPOSE[@]}" down -v
		exit 0
		;;
	*) die "usage: run.sh smoke|stress|soak|spike|report|down" ;;
esac

command -v docker >/dev/null || die "docker is required"
command -v k6 >/dev/null || die "k6 is required (brew install k6)"
docker info >/dev/null 2>&1 || die "Docker is not running"

# --- Resources: mirror the 2 vCPU / 4 GB production server ----------------------
ENGINE_CPUS="$(docker info --format '{{.NCPU}}')"
ENGINE_MEM="$(docker info --format '{{.MemTotal}}')"
CAPS="${LT_CAPS:-auto}"

if [[ "$CAPS" == "auto" ]]; then
	if (( ENGINE_CPUS > 2 )); then CAPS=on; else CAPS=off; fi
fi

if [[ "$CAPS" == "on" ]]; then
	COMPOSE+=(-f "$ROOT/compose.caps.yml")
	CAPS_DESC="per-container caps (api ${LT_API_CPUS:-1.0} CPU / ${LT_API_MEM:-1280m}, postgres ${LT_PG_CPUS:-0.75} / ${LT_PG_MEM:-1792m}, seaweedfs ${LT_S3_CPUS:-0.25} / ${LT_S3_MEM:-768m}); Docker engine has ${ENGINE_CPUS} CPUs"
	log "Docker has ${ENGINE_CPUS} CPUs: applying per-container caps (set Docker Desktop to 2 CPUs / 4 GB and LT_CAPS=off for the shared-resource model)"
else
	CAPS_DESC="shared Docker engine: ${ENGINE_CPUS} CPUs / $(( ENGINE_MEM / 1024 / 1024 )) MB"
fi

# --- Stack ---------------------------------------------------------------------
log "starting stack"
mkdir -p "$ROOT/.data"
# LT_BUILD=0 reuses the existing images (no registry access) when src/ is unchanged.
if [[ "${LT_BUILD:-1}" == "1" ]]; then
	compose_quiet up -d --build --wait
else
	compose_quiet up -d --wait
fi

if [[ ! -f "$ROOT/.data/uploads/manifest.json" ]]; then
	log "generating upload files"
	"${TSX[@]}" "$ROOT/seed/make-uploads.ts"
fi

# Reseed by default so every run starts from the same data (~20 s at SCALE=1).
if [[ "${LT_RESEED:-1}" == "1" || ! -f "$ROOT/.data/fixtures.json" ]]; then
	log "seeding (scale ${LT_SCALE:-1})"
	"${TSX[@]}" "$ROOT/seed/seed.ts"
fi

# Fresh API process: clean heap and probe counters, nothing warmed by earlier runs.
log "restarting api"
compose_quiet restart api
compose_quiet up -d --wait api

# --- Run -----------------------------------------------------------------------
RUN_ID="$(date +%Y%m%d-%H%M%S)-$PROFILE"
RUN_DIR="$ROOT/results/$RUN_ID"
mkdir -p "$RUN_DIR"
STARTED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

export LT_PROFILE="$PROFILE"
export LT_FIXTURES="$ROOT/.data/fixtures.json"
export LT_UPLOADS_DIR="${LT_UPLOADS_DIR-$ROOT/.data/uploads}"

LT_RUN_ID="$RUN_ID" LT_STARTED_AT="$STARTED_AT" LT_CAPS_DESC="$CAPS_DESC" LT_GIT_SHA="$(git -C "$API_DIR" rev-parse --short HEAD)" \
node --input-type=module -e "
import { writeFileSync, readFileSync } from 'node:fs';
import { schedule } from '$ROOT/k6/lib/schedule.js';
const env = process.env;
const fixtures = JSON.parse(readFileSync(env.LT_FIXTURES, 'utf8'));
writeFileSync('$RUN_DIR/meta.json', JSON.stringify({
	runId: env.LT_RUN_ID, profile: env.LT_PROFILE, startedAt: env.LT_STARTED_AT, schedule: schedule(env),
	slo: { p95Ms: Number(env.LT_SLO_P95_MS ?? 500), p99Ms: Number(env.LT_SLO_P99_MS ?? 1000), errorRate: Number(env.LT_SLO_ERROR_RATE ?? 0.01) },
	visitorThinkSeconds: Number(env.LT_VISITOR_THINK_SECONDS ?? 20),
	staffVus: Number(env.LT_STAFF_VUS ?? 10), uploadVus: env.LT_UPLOADS_DIR ? Number(env.LT_UPLOAD_VUS ?? 1) : 0,
	caps: env.LT_CAPS_DESC, gitSha: env.LT_GIT_SHA, seedScale: fixtures.scale,
}, null, 2));
"

log "run $RUN_ID"
"${TSX[@]}" "$ROOT/collect/collector.ts" "$RUN_DIR" --reset > "$RUN_DIR/collector.log" 2>&1 &
COLLECTOR_PID=$!

stop_collector() {
	if kill -0 "$COLLECTOR_PID" 2>/dev/null; then
		pkill -INT -P "$COLLECTOR_PID" 2>/dev/null || true
		kill -INT "$COLLECTOR_PID" 2>/dev/null || true
		wait "$COLLECTOR_PID" 2>/dev/null || true
	fi
}
trap stop_collector EXIT

set +e
(cd "$ROOT/k6" && k6 run main.js \
	--out "csv=$RUN_DIR/k6.csv.gz" \
	--summary-export "$RUN_DIR/summary.json" \
	--summary-mode "${LT_SUMMARY_MODE:-compact}" \
	2>&1 | tee "$RUN_DIR/k6.log")
K6_EXIT=${PIPESTATUS[0]}
set -e

stop_collector
trap - EXIT

# Logs for the run window: PostgreSQL slow statements and plans, API errors.
"${COMPOSE[@]}" logs --no-color --no-log-prefix --since "$STARTED_AT" postgres > "$RUN_DIR/pg.log" 2>&1 || true
"${COMPOSE[@]}" logs --no-color --no-log-prefix --since "$STARTED_AT" api 2>&1 | grep -E '"level":(50|60)' > "$RUN_DIR/api-errors.log" || true

node --input-type=module -e "
import { readFileSync, writeFileSync } from 'node:fs';
const meta = JSON.parse(readFileSync('$RUN_DIR/meta.json', 'utf8'));
meta.endedAt = new Date().toISOString();
meta.k6ExitCode = $K6_EXIT;
writeFileSync('$RUN_DIR/meta.json', JSON.stringify(meta, null, 2));
"

log "building report"
"${TSX[@]}" "$ROOT/report/build-report.ts" "$RUN_DIR"

# k6 exits 99 when thresholds fail; that's the expected outcome at the top of
# a stress run and is reported per step, not treated as a script failure.
if [[ "$K6_EXIT" != "0" && "$K6_EXIT" != "99" ]]; then
	die "k6 exited with $K6_EXIT (see $RUN_DIR/k6.log)"
fi
