// Resource sampler for a load-test run. Every LT_SAMPLE_MS it records, on one
// timeline:
//   - container CPU / memory / network for api, postgres, seaweedfs (Docker
//     Engine API over the local socket; the same cgroup numbers the caps act on)
//   - API process internals from the preloaded probe (event loop, heap, GC)
//   - PostgreSQL activity: transactions, cache hits, connections by state,
//     lock waits, temp files, deadlocks
// Appends one JSON object per line to <run>/samples.ndjson. On SIGINT/SIGTERM
// it writes <run>/db-final.json: top statements (pg_stat_statements) with
// generic plans, plus per-table scan and bloat statistics.
//
//   tsx loadtest/collect/collector.ts <runDir> [--reset]
import { appendFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import pg from "pg";

const RUN_DIR = process.argv[2];
const RESET = process.argv.includes("--reset");

if (!RUN_DIR) {
	console.error("usage: collector.ts <runDir> [--reset]");
	process.exit(1);
}

const SAMPLE_MS = Number.parseInt(process.env.LT_SAMPLE_MS ?? "2000", 10);
const PG_URL = process.env.LT_DATABASE_URL ?? "postgresql://nostos:nostos-loadtest@127.0.0.1:55432/nostos_loadtest";
const PROBE_URL = process.env.LT_PROBE_URL ?? "http://127.0.0.1:19464/";
const PROJECT = "nostos-loadtest";
const CONTAINERS = { api: `${PROJECT}-api-1`, postgres: `${PROJECT}-postgres-1`, seaweedfs: `${PROJECT}-seaweedfs-1` } as const;

const DOCKER_SOCKET = [
	process.env.DOCKER_HOST?.startsWith("unix://") ? process.env.DOCKER_HOST.slice(7) : undefined,
	path.join(os.homedir(), ".docker/run/docker.sock"),
	"/var/run/docker.sock",
].find((candidate) => candidate !== undefined && existsSync(candidate));

const SAMPLES = path.join(RUN_DIR, "samples.ndjson");

function getJson<T>(options: http.RequestOptions | string): Promise<T | null> {
	return new Promise((resolve) => {
		const request = http.get(options, (response) => {
			let body = "";
			response.setEncoding("utf8");
			response.on("data", (chunk: string) => { body += chunk; });
			response.on("end", () => {
				try {
					resolve(JSON.parse(body) as T);
				}
				catch {
					resolve(null);
				}
			});
		});
		request.setTimeout(3000, () => request.destroy());
		request.on("error", () => resolve(null));
	});
}

// --- Docker ------------------------------------------------------------------

interface DockerStats {
	read: string;
	cpu_stats: { cpu_usage: { total_usage: number }; online_cpus?: number };
	memory_stats: { usage?: number; limit?: number; stats?: Record<string, number> };
	networks?: Record<string, { rx_bytes: number; tx_bytes: number }>;
}

interface ContainerInfo { HostConfig: { NanoCpus: number; Memory: number } }

const previousCpu = new Map<string, { usage: number; at: number }>();
const containerLimits: Record<string, { cpus: number | null; memoryBytes: number | null }> = {};

async function containerSample(key: keyof typeof CONTAINERS) {
	if (!DOCKER_SOCKET) {
		return null;
	}

	const name = CONTAINERS[key];
	const stats = await getJson<DockerStats>({ socketPath: DOCKER_SOCKET, path: `/containers/${name}/stats?stream=false&one-shot=true` });

	if (!stats?.cpu_stats) {
		return null;
	}

	const at = Date.parse(stats.read) || Date.now();
	const usage = stats.cpu_stats.cpu_usage.total_usage;
	const previous = previousCpu.get(key);
	previousCpu.set(key, { usage, at });
	// Percent of one core (200 = two full cores).
	const cpuPercent = previous && at > previous.at ? ((usage - previous.usage) / ((at - previous.at) * 1e6)) * 100 : null;
	const mem = stats.memory_stats;
	// Same "used" figure as `docker stats`: usage minus reclaimable page cache.
	const memoryBytes = mem.usage === undefined ? null : mem.usage - (mem.stats?.inactive_file ?? 0);
	const net = Object.values(stats.networks ?? {}).reduce((sum, n) => ({ rx: sum.rx + n.rx_bytes, tx: sum.tx + n.tx_bytes }), { rx: 0, tx: 0 });

	return { cpuPercent, memoryBytes, memoryLimitBytes: mem.limit ?? null, netRxBytes: net.rx, netTxBytes: net.tx };
}

async function loadContainerLimits() {
	if (!DOCKER_SOCKET) {
		return;
	}

	for (const [key, name] of Object.entries(CONTAINERS)) {
		const info = await getJson<ContainerInfo>({ socketPath: DOCKER_SOCKET, path: `/containers/${name}/json` });
		containerLimits[key] = {
			cpus: info?.HostConfig.NanoCpus ? info.HostConfig.NanoCpus / 1e9 : null,
			memoryBytes: info?.HostConfig.Memory || null,
		};
	}

	const engine = await getJson<{ NCPU: number; MemTotal: number }>({ socketPath: DOCKER_SOCKET, path: "/info" });
	containerLimits.engine = { cpus: engine?.NCPU ?? null, memoryBytes: engine?.MemTotal ?? null };
}

// --- PostgreSQL --------------------------------------------------------------

const pool = new pg.Pool({ connectionString: PG_URL, max: 1, application_name: "loadtest-collector" });
let previousDb: Record<string, number> | null = null;
let previousDbAt = 0;

const DB_COUNTERS = ["xact_commit", "xact_rollback", "blks_read", "blks_hit", "tup_returned", "tup_fetched", "tup_inserted", "tup_updated", "tup_deleted", "temp_files", "temp_bytes", "deadlocks", "blk_read_time", "blk_write_time"];

async function dbSample() {
	try {
		const [database, activity, locks] = await Promise.all([
			pool.query(`SELECT ${DB_COUNTERS.join(", ")}, pg_database_size(datname) AS size FROM pg_stat_database WHERE datname = current_database()`),
			pool.query(`
				SELECT
					count(*) FILTER (WHERE state = 'active') AS active,
					count(*) FILTER (WHERE state = 'idle') AS idle,
					count(*) FILTER (WHERE state LIKE 'idle in transaction%') AS idle_in_tx,
					count(*) FILTER (WHERE wait_event_type = 'Lock') AS waiting_lock,
					count(*) AS total,
					coalesce(max(extract(epoch FROM now() - query_start)) FILTER (WHERE state = 'active'), 0) * 1000 AS longest_active_ms
				FROM pg_stat_activity
				WHERE datname = current_database() AND backend_type = 'client backend' AND pid <> pg_backend_pid()`),
			pool.query("SELECT count(*) AS waiting FROM pg_locks WHERE NOT granted"),
		]);
		const now = Date.now();
		const row = database.rows[0] as Record<string, string>;
		const current = Object.fromEntries(DB_COUNTERS.map((k) => [k, Number(row[k])]));
		let rates: Record<string, number> | null = null;

		if (previousDb !== null) {
			const seconds = (now - previousDbAt) / 1000;
			rates = Object.fromEntries(DB_COUNTERS.map((k) => [k, (current[k] - previousDb![k]) / seconds]));
		}

		const hits = rates ? rates.blks_hit : 0;
		const reads = rates ? rates.blks_read : 0;
		previousDb = current;
		previousDbAt = now;
		const a = activity.rows[0] as Record<string, string>;

		return {
			tps: rates ? rates.xact_commit + rates.xact_rollback : null,
			rollbacksPerSec: rates?.xact_rollback ?? null,
			cacheHitRatio: hits + reads > 0 ? hits / (hits + reads) : null,
			rowsReadPerSec: rates ? rates.tup_returned + rates.tup_fetched : null,
			rowsWrittenPerSec: rates ? rates.tup_inserted + rates.tup_updated + rates.tup_deleted : null,
			tempBytesPerSec: rates?.temp_bytes ?? null,
			deadlocks: current.deadlocks,
			sizeBytes: Number(row.size),
			connections: { active: Number(a.active), idle: Number(a.idle), idleInTx: Number(a.idle_in_tx), waitingLock: Number(a.waiting_lock), total: Number(a.total) },
			longestActiveMs: Number(a.longest_active_ms),
			ungrantedLocks: Number((locks.rows[0] as Record<string, string>).waiting),
		};
	}
	catch (error) {
		return { error: error instanceof Error ? error.message : String(error) };
	}
}

async function finalDbSnapshot() {
	const statements = await pool.query(`
		SELECT queryid::text, query, calls, total_exec_time, mean_exec_time, max_exec_time, stddev_exec_time, rows,
		       shared_blks_hit, shared_blks_read, temp_blks_written
		FROM pg_stat_statements
		WHERE dbid = (SELECT oid FROM pg_database WHERE datname = current_database())
		  AND query NOT ILIKE '%pg_stat%' AND query NOT ILIKE 'EXPLAIN%'
		ORDER BY total_exec_time DESC
		LIMIT 30`);

	const plans: Record<string, string> = {};

	for (const statement of statements.rows.slice(0, 10) as { queryid: string; query: string }[]) {
		if (!/^\s*(SELECT|WITH)/i.test(statement.query)) {
			continue;
		}

		try {
			// PostgreSQL 16+: plan a normalized ($n) statement without values.
			const plan = await pool.query(`EXPLAIN (GENERIC_PLAN) ${statement.query}`);
			plans[statement.queryid] = plan.rows.map((r: Record<string, string>) => r["QUERY PLAN"]).join("\n");
		}
		catch (error) {
			plans[statement.queryid] = `(no plan: ${error instanceof Error ? error.message : String(error)})`;
		}
	}

	const tables = await pool.query(`
		SELECT relname AS table, seq_scan, seq_tup_read, idx_scan, n_live_tup, n_dead_tup, n_tup_ins, n_tup_upd, n_tup_del,
		       last_autovacuum, last_autoanalyze, pg_total_relation_size(relid) AS total_bytes
		FROM pg_stat_user_tables ORDER BY seq_tup_read DESC`);
	const unusedIndexes = await pool.query(`
		SELECT relname AS table, indexrelname AS index, idx_scan, pg_relation_size(indexrelid) AS bytes
		FROM pg_stat_user_indexes WHERE idx_scan = 0 ORDER BY pg_relation_size(indexrelid) DESC LIMIT 20`);
	const settings = await pool.query(`
		SELECT name, setting, unit FROM pg_settings
		WHERE name IN ('max_connections', 'shared_buffers', 'work_mem', 'effective_cache_size', 'maintenance_work_mem', 'random_page_cost')`);

	return { statements: statements.rows, plans, tables: tables.rows, unusedIndexes: unusedIndexes.rows, settings: settings.rows };
}

// --- Loop --------------------------------------------------------------------

let running = true;

async function tick() {
	const [api, postgres, seaweedfs, probe, db] = await Promise.all([
		containerSample("api"),
		containerSample("postgres"),
		containerSample("seaweedfs"),
		getJson<Record<string, unknown>>(PROBE_URL),
		dbSample(),
	]);

	await appendFile(SAMPLES, `${JSON.stringify({ ts: Date.now(), containers: { api, postgres, seaweedfs }, probe, db })}\n`);
}

async function main() {
	// Preloaded by compose.yml; the SQL interface still has to exist in this database.
	await pool.query("CREATE EXTENSION IF NOT EXISTS pg_stat_statements");

	if (RESET) {
		await pool.query("SELECT pg_stat_statements_reset()");
		await pool.query("SELECT pg_stat_reset()");
	}

	await loadContainerLimits();
	await writeFile(path.join(RUN_DIR, "limits.json"), JSON.stringify(containerLimits, null, 2));

	if (!DOCKER_SOCKET) {
		console.warn("[collector] Docker socket not found: container CPU/RAM will be missing");
	}

	// Prime CPU deltas so the first real sample has a value.
	await Promise.all([containerSample("api"), containerSample("postgres"), containerSample("seaweedfs"), getJson(PROBE_URL)]);

	while (running) {
		const started = Date.now();
		await tick();
		await new Promise((resolve) => setTimeout(resolve, Math.max(0, SAMPLE_MS - (Date.now() - started))));
	}

	await writeFile(path.join(RUN_DIR, "db-final.json"), JSON.stringify(await finalDbSnapshot(), null, 2));
	await pool.end();
	console.log("[collector] stopped; database snapshot written");
}

function stop() {
	running = false;
}

process.on("SIGINT", stop);
process.on("SIGTERM", stop);

await main();
