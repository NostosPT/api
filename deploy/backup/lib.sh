# shellcheck shell=sh disable=SC2034
# Shared by backup.sh and restore.sh (sourced, not executed).
#
# Remotes come from RCLONE_CONFIG_* variables set in compose.prod.yml:
#   seaweedfs: local photo storage    offsite: off-site S3 bucket
# When BACKUP_ENCRYPTION_PASSWORD is set, everything off-site goes through an
# rclone crypt remote (contents and file names encrypted client-side).

log() {
	printf '[backup] %s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"
}

SOURCE="seaweedfs:${S3_BUCKET}"

if [ -n "${BACKUP_ENCRYPTION_PASSWORD:-}" ]; then
	RCLONE_CONFIG_OFFSITECRYPT_PASSWORD="$(rclone obscure "$BACKUP_ENCRYPTION_PASSWORD")"
	export RCLONE_CONFIG_OFFSITECRYPT_TYPE=crypt
	export RCLONE_CONFIG_OFFSITECRYPT_REMOTE="offsite:${BACKUP_S3_BUCKET}/${BACKUP_PREFIX}"
	export RCLONE_CONFIG_OFFSITECRYPT_PASSWORD

	if [ -n "${BACKUP_ENCRYPTION_SALT:-}" ]; then
		RCLONE_CONFIG_OFFSITECRYPT_PASSWORD2="$(rclone obscure "$BACKUP_ENCRYPTION_SALT")"
		export RCLONE_CONFIG_OFFSITECRYPT_PASSWORD2
	fi

	TARGET_ROOT="offsitecrypt:"
else
	TARGET_ROOT="offsite:${BACKUP_S3_BUCKET}/${BACKUP_PREFIX}/"
fi

# Off-site path for a sub-path, e.g. `target postgres`.
target() {
	printf '%s%s' "$TARGET_ROOT" "$1"
}
