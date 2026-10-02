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

on_exit() {
	status=$?
	rm -f "$dump"

	if [ "$status" -ne 0 ]; then
		log "backup FAILED (exit ${status})"
		ping_healthcheck /fail
	fi
}

trap on_exit EXIT

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
