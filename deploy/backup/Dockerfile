# Off-site backup runner: pg_dump/pg_restore + rclone + busybox crond.
# Keep the PostgreSQL tag in sync with the postgres service in compose.prod.yml
# (pg_dump must not be older than the server).
FROM rclone/rclone:1.75.1 AS rclone

FROM postgres:18.6-alpine

# Remotes are configured purely through RCLONE_CONFIG_* variables.
ENV RCLONE_CONFIG=/dev/null

COPY --from=rclone /usr/local/bin/rclone /usr/local/bin/rclone
COPY lib.sh /usr/local/lib/backup/lib.sh
COPY entrypoint.sh backup.sh restore.sh /usr/local/bin/

RUN chmod 755 /usr/local/bin/entrypoint.sh /usr/local/bin/backup.sh /usr/local/bin/restore.sh

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
