#!/bin/sh
# Without arguments: run backup.sh on BACKUP_SCHEDULE (cron syntax, UTC).
# With arguments: run them instead, e.g. `restore.sh list`.
set -eu

if [ "$#" -gt 0 ]; then
	exec "$@"
fi

# busybox crond does not pass the container environment to jobs.
umask 077
export -p > /run/backup.env

echo "${BACKUP_SCHEDULE} . /run/backup.env && /usr/local/bin/backup.sh > /proc/1/fd/1 2>&1" > /etc/crontabs/root

echo "[backup] scheduled: ${BACKUP_SCHEDULE} (UTC)"

exec crond -f -l 8
