#!/bin/sh
# Off-site backup: PostgreSQL dump + photo bucket sync.
#
# Scheduled by entrypoint.sh; run manually on the server with:
#   docker compose -f compose.prod.yml --env-file <env file> exec backup backup.sh
#
# Layout under the off-site target:
#   postgres/<db>-<UTC stamp>.dump    pg_dump custom format, pruned after BACKUP_RETENTION_DAYS
#   photos/                           mirror of the photo bucket
#   photos-deleted/<UTC stamp>/       objects removed/replaced at the source, kept for BACKUP_RETENTION_DAYS
#
# Each run is also recorded in the "BackupRun" table, which the API's health
# monitor reads to judge backup freshness. Recording is best effort: it never
# fails or blocks the backup itself.
set -eu

. /usr/local/lib/backup/lib.sh

exec 9>/tmp/backup.lock

if ! flock -n 9; then
	log "another backup is still running; skipping"
	exit 0
fi

stamp="$(date -u +%Y%m%dT%H%M%SZ)"
dump="/tmp/${PGDATABASE}-${stamp}.dump"

ping_healthcheck() {
	if [ -n "${BACKUP_HEALTHCHECK_URL:-}" ]; then
		wget -qO /dev/null -T 10 "${BACKUP_HEALTHCHECK_URL}$1" || log "healthcheck ping failed"
	fi
}

run_id=""

# Timestamps are written in UTC to match the columns Prisma manages
# (timestamp without time zone, UTC).
record_start() {
	run_id="$(psql -qAtX -v ON_ERROR_STOP=1 \
		-c "INSERT INTO \"BackupRun\" (status, \"startedAt\") VALUES ('RUNNING', now() AT TIME ZONE 'UTC') RETURNING id" \
		2> /dev/null)" || {
		run_id=""
		log "could not record backup start in PostgreSQL"
	}
}

# Values reach SQL only as psql variables (:'name' quotes them), via stdin.
# record_finish SUCCEEDED|FAILED [error code]
record_finish() {
	[ -n "$run_id" ] || return 0

	psql -qAtX -v ON_ERROR_STOP=1 -v run_id="$run_id" -v status="$1" -v error_code="${2:-}" > /dev/null 2>&1 <<-'SQL' || log "could not record backup result in PostgreSQL"
		UPDATE "BackupRun"
		SET status = :'status', "finishedAt" = now() AT TIME ZONE 'UTC', "errorCode" = NULLIF(:'error_code', '')
		WHERE id = :'run_id';
	SQL
}

on_exit() {
	status=$?
	rm -f "$dump"

	if [ "$status" -ne 0 ]; then
		log "backup FAILED (exit ${status})"
		record_finish FAILED "exit_${status}"
		ping_healthcheck /fail
	else
		record_finish SUCCEEDED
	fi
}

trap on_exit EXIT

record_start
ping_healthcheck /start

log "dumping database ${PGDATABASE}"
pg_dump --format=custom --no-owner --no-privileges --file="$dump"
# Fails on a truncated or unreadable archive.
pg_restore --list "$dump" > /dev/null
rclone copyto "$dump" "$(target "postgres/${PGDATABASE}-${stamp}.dump")"
log "uploaded postgres/${PGDATABASE}-${stamp}.dump ($(du -h "$dump" | cut -f1))"

log "pruning database dumps older than ${BACKUP_RETENTION_DAYS} days"
rclone delete --min-age "${BACKUP_RETENTION_DAYS}d" "$(target postgres)"

log "syncing photo bucket ${S3_BUCKET}"
rclone sync "$SOURCE" "$(target photos)" \
	--backup-dir "$(target "photos-deleted/${stamp}")" \
	--fast-list \
	--transfers 8

# photos-deleted/ keeps original modification times, so prune by folder stamp.
cutoff="$(date -u -d "@$(( $(date +%s) - BACKUP_RETENTION_DAYS * 86400 ))" +%Y%m%d)"

for dir in $(rclone lsf --dirs-only "$(target photos-deleted)" 2> /dev/null || true); do
	name="${dir%/}"

	case "$name" in
		[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]T[0-9][0-9][0-9][0-9][0-9][0-9]Z) ;;
		*) continue ;;
	esac

	if [ "${name%%T*}" -lt "$cutoff" ]; then
		log "pruning photos-deleted/${name}"
		rclone purge "$(target "photos-deleted/${name}")"
	fi
done

log "backup completed"
ping_healthcheck ""
