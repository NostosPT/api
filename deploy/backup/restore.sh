#!/bin/sh
# Restore from the off-site backup. Run on the server:
#
#   C="docker compose -f compose.prod.yml --env-file <env file>"
#   $C run --rm backup restore.sh list
#   $C stop api
#   $C run --rm backup restore.sh postgres latest --yes
#   $C run --rm backup restore.sh postgres nostos-20261002T030000Z.dump --yes
#   $C run --rm backup restore.sh photos --yes
#   $C start api
#
# `postgres` replaces the current database contents with the dump.
# `photos` copies missing/changed objects back into the bucket (never deletes).
set -eu

. /usr/local/lib/backup/lib.sh

usage() {
	sed -n '2,13p' "$0" | sed 's/^# \{0,1\}//'
	exit 2
}

require_yes() {
	if [ "${1:-}" != "--yes" ]; then
		echo "Refusing to restore without --yes (this overwrites live data)." >&2
		exit 2
	fi
}

case "${1:-}" in
	list)
		echo "Database dumps:"
		rclone lsl "$(target postgres)" | sort -k4
		echo
		echo "Photo mirror:"
		rclone size "$(target photos)"
		;;

	postgres)
		name="${2:-}"
		[ -n "$name" ] || usage
		require_yes "${3:-}"

		if [ "$name" = "latest" ]; then
			name="$(rclone lsf --files-only "$(target postgres)" | sort | tail -n 1)"
			[ -n "$name" ] || { echo "No database dumps found." >&2; exit 1; }
		fi

		dump="/tmp/${name}"
		trap 'rm -f "$dump"' EXIT

		log "downloading postgres/${name}"
		rclone copyto "$(target "postgres/${name}")" "$dump"

		log "restoring into ${PGDATABASE} (single transaction)"
		pg_restore --clean --if-exists --no-owner --no-privileges \
			--single-transaction --exit-on-error \
			--dbname="$PGDATABASE" "$dump"
		log "database restore completed"
		;;

	photos)
		require_yes "${2:-}"
		log "copying photos back into ${S3_BUCKET}"
		rclone copy "$(target photos)" "$SOURCE" --fast-list --transfers 8
		log "photo restore completed"
		;;

	*)
		usage
		;;
esac
