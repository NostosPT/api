# Deployment

Nostos API runs as one Docker Compose stack. Locally, Compose provides only
PostgreSQL and SeaweedFS and the API runs on the host; in production the whole
stack runs on the app server behind the Caddy proxy VPS, reached over
WireGuard.

```text
Browser ──HTTPS──▶ Caddy (proxy VPS) ──WireGuard──▶ app server (BIND_ADDRESS)
                    api.nostos.photos      ───▶ :3000  api ──▶ postgres (internal)
                                                         └──▶ seaweedfs (internal S3)
                    storage.nostos.photos  ───▶ :8333  seaweedfs S3 gateway
                                                  backup ──▶ off-site S3 (nightly)
```

| Service        | Image                       | Published               | Purpose |
|----------------|-----------------------------|-------------------------|---------|
| `postgres`     | `postgres:18.6-alpine`      | no                      | Database (`postgres-data` volume) |
| `seaweedfs`    | `chrislusf/seaweedfs:4.48`  | `BIND_ADDRESS:8333`     | S3-compatible photo storage (`seaweedfs-data` volume) |
| `storage-init` | `rclone/rclone:1.75.1`      | no                      | One-shot: creates the bucket if missing |
| `migrate`      | `Dockerfile` target `migrate` | no                    | One-shot: `prisma migrate deploy` |
| `api`          | `Dockerfile` target `runtime` | `BIND_ADDRESS:3000`   | The API; starts only after `migrate` and `storage-init` succeed |
| `backup`       | `deploy/backup`             | no                      | Scheduled off-site backup (PostgreSQL + photos) |

## Local development

```bash
cp .env.example .env          # defaults already match compose.yml
docker compose up -d          # PostgreSQL :5432 + SeaweedFS S3 :8333 (127.0.0.1 only)
pnpm install
pnpm exec prisma migrate deploy
pnpm dev
```

`docker compose down` stops it; add `-v` to also wipe the local database and
photos. Change `POSTGRES_PORT` / `S3_PORT` in `.env` if those ports are taken
(and update `DATABASE_URL` / `S3_ENDPOINT` to match).

## Production: one-time setup

### 1. App server

* Docker Engine with the Compose plugin; the self-hosted runner's user must
  be able to run `docker`.
* WireGuard must be up **before** Docker starts containers, or binding to the
  WireGuard IP fails after a reboot:

  ```bash
  sudo systemctl edit docker.service
  # [Unit]
  # After=wg-quick@wg0.service
  # Wants=wg-quick@wg0.service
  ```

* Ports are published on `BIND_ADDRESS` only. Never use `0.0.0.0`: Docker
  published ports bypass host firewalls such as `ufw`.

### 2. Environment file

From any checkout of this repository on the server:

```bash
sudo mkdir -p /opt/nostos/api && sudo chown "$USER" /opt/nostos/api
deploy/init-env.sh /opt/nostos/api/.env.prod
```

This copies `.env.prod.example` with every secret generated (mode `600`).
Then edit:

* `BIND_ADDRESS`: this server's WireGuard IP; `TRUST_PROXY`: the proxy's
  WireGuard IP.
* `CORS_ORIGINS` / `STORAGE_CORS_ORIGINS`: the frontend origin(s).
* `S3_PUBLIC_ENDPOINT`: the public storage URL, e.g. `https://storage.nostos.photos`.
* `BACKUP_S3_*`: the off-site bucket and its credentials.
* Save `BACKUP_ENCRYPTION_PASSWORD` and `BACKUP_ENCRYPTION_SALT` in a password
  manager. Without them the encrypted backups **cannot be restored**.

A different path is possible: set the repository variable `DEPLOY_ENV_FILE`
(Settings → Secrets and variables → Actions → Variables).

### 3. Proxy VPS (Caddy)

Add DNS records for `api.` and `storage.` pointing at the proxy, then the two
sites from [`deploy/Caddyfile.example`](../deploy/Caddyfile.example), with
upstreams set to `BIND_ADDRESS:API_PORT` and `BIND_ADDRESS:STORAGE_PORT`.
Storage needs its own hostname: presigned URLs are signed for that host, so
Caddy must pass `Host`, the path and the query string through unchanged
(the defaults).

### 4. Off-site backup bucket

Create a private bucket on the backup provider, with credentials limited to
that bucket. Set `BACKUP_S3_PROVIDER` to the matching rclone provider name if
the provider needs special handling (`Other` works for most).

### 5. Deploy

Push to `main`. When CI passes, `.github/workflows/deploy.yml` runs on the
self-hosted runner: it builds the images, then
`docker compose up -d --wait` brings up PostgreSQL and SeaweedFS, creates the
bucket, applies migrations, starts the API, and waits until it is healthy.
It can also be started manually (Actions → Deploy → Run workflow).

The job targets `runs-on: self-hosted` and the `production` GitHub
environment (add protection rules there if wanted).

Check from the proxy VPS:

```bash
curl https://api.nostos.photos/v1/health   # liveness
curl https://api.nostos.photos/v1/ready    # PostgreSQL + storage reachable
```

### 6. Alert emails (Resend)

1. Verify the sending domain (e.g. `nostos.photos`) in Resend.
2. Create two sending-only API keys restricted to that domain: one for the
   API, one for the proxy VPS watchdog, so either can be revoked alone.
3. In `/opt/nostos/api/.env.prod` set `RESEND_API_KEY`, `ALERT_EMAIL_FROM`,
   and optionally `ALERT_FALLBACK_RECIPIENTS`; check `MONITOR_PUBLIC_URL` and
   `MONITOR_PUBLIC_STORAGE`. Redeploy.

API alerts go to every ACTIVE ADMIN user. Without `RESEND_API_KEY` and
`ALERT_EMAIL_FROM` monitoring still runs and records history, but only logs
state changes (a warning at startup says so).

### 7. Proxy VPS watchdog

Watches the API from the proxy VPS, so a dead API, app server, or WireGuard
link still produces an email. Needs only `sh` and `curl` (no resident
process; one short run per minute).

```bash
# On the proxy VPS, from a checkout or copies of deploy/watchdog/:
sudo install -m 755 deploy/watchdog/watchdog.sh /usr/local/bin/nostos-watchdog
sudo install -m 600 deploy/watchdog/watchdog.env.example /etc/nostos-watchdog.env
sudoedit /etc/nostos-watchdog.env          # RESEND_API_KEY, ALERT_RECIPIENTS, ...
sudo install -m 644 deploy/watchdog/nostos-watchdog.service deploy/watchdog/nostos-watchdog.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now nostos-watchdog.timer

# Verify the email configuration, then watch a few runs:
sudo sh -c 'set -a; . /etc/nostos-watchdog.env; WATCHDOG_STATE_DIR=$(mktemp -d) /usr/local/bin/nostos-watchdog test-email'
journalctl -u nostos-watchdog -f
```

The watchdog uses its own static `ALERT_RECIPIENTS`: it cannot read the
API's ADMIN list, and it must work while the API is down.

## Operations

All commands run on the app server from the runner's checkout (or any
checkout) of the repository:

```bash
C="docker compose -f compose.prod.yml --env-file /opt/nostos/api/.env.prod"
$C ps
$C logs -f api
```

### Backups

Runs on `BACKUP_SCHEDULE` (default `0 3 * * *`, UTC). Off-site layout under
`BACKUP_S3_BUCKET/BACKUP_PREFIX`, encrypted with rclone crypt (file names
included) when `BACKUP_ENCRYPTION_PASSWORD` is set:

* `postgres/<db>-<stamp>.dump`: `pg_dump` custom format, checked with
  `pg_restore --list` before upload, kept `BACKUP_RETENTION_DAYS`.
* `photos/`: mirror of the photo bucket.
* `photos-deleted/<stamp>/`: objects deleted or replaced at the source,
  kept `BACKUP_RETENTION_DAYS`, so an accidental deletion is recoverable.

```bash
$C exec backup backup.sh                 # run a backup now
$C logs backup                           # scheduled run output
```

Set `BACKUP_HEALTHCHECK_URL` (e.g. healthchecks.io) to be alerted when a
nightly run fails or doesn't happen.

Each run is also recorded in the `BackupRun` table (started, succeeded or
failed with `exit_<code>`), which the health monitor's BACKUP check reads.
Recording is best effort and never fails a backup.

### Health monitoring

With `MONITOR_ENABLED` (default in production) the API checks, records
(`HealthCheck`, kept `HEALTH_RETENTION_DAYS`), and alerts on:

| Component | Check | Every | Degraded | Down |
|---|---|---|---|---|
| `DATABASE` | `SELECT 1` | 60 s | > 500 ms | error / 5 s timeout |
| `STORAGE` | HeadBucket | 60 s | > 1 s | error / 5 s timeout |
| `STORAGE_WRITE` | put/read/delete under `_health/` | 1 h | > 1 s | any step fails |
| `PUBLIC_API` | `GET MONITOR_PUBLIC_URL/v1/health` | 60 s | > 2 s | non-200 / 10 s timeout |
| `PUBLIC_API_TLS` | certificate of that host | 6 h | < 14 days left | < 3 days / invalid |
| `PUBLIC_STORAGE` | `GET S3_PUBLIC_ENDPOINT/healthz` | 60 s | > 2 s | non-200 / 10 s timeout |
| `PUBLIC_STORAGE_TLS` | certificate of that host | 6 h | < 14 days left | < 3 days / invalid |
| `BACKUP` | latest `BackupRun` | 15 min | last success > 26 h | last run failed / > 50 h / none |

The `PUBLIC_*` rows run only when `MONITOR_PUBLIC_URL` / `MONITOR_PUBLIC_STORAGE`
are set. Every value above is overridable (names in `.env.example`).

An email goes out after 3 consecutive worse results (DOWN or DEGRADED) and
after 2 consecutive better ones (RECOVERED); nothing in between. Current
state, sanitized error codes, and uptime over 24 h / 7 d / 30 d (DEGRADED
counts as available):

```bash
curl -b "__Host-nostos.sid=<admin session>" https://api.nostos.photos/v1/system/status
```

`_health/` in the photo bucket holds only probe objects; it is excluded from
the off-site backup.

### Restore

```bash
$C run --rm backup restore.sh list
$C stop api
$C run --rm backup restore.sh postgres latest --yes     # or a dump file name from `list`
$C run --rm backup restore.sh photos --yes              # copies missing objects back; never deletes
$C start api
```

A photo deleted within the retention window lives in `photos-deleted/`; copy
it back with rclone from inside the backup container (`. /usr/local/lib/backup/lib.sh`
gives `$TARGET_ROOT` and `$SOURCE`).

### Rotating secrets

* `COOKIE_SECRET`: edit, redeploy.
* `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY`: edit, redeploy (SeaweedFS
  reads them at start; outstanding presigned URLs stop working).
* `POSTGRES_PASSWORD`: the image only applies it on first init, so change it
  in the database first:
  `$C exec postgres psql -U nostos -c "ALTER USER nostos PASSWORD '<new>'"`,
  then edit the env file and redeploy.
* `BACKUP_ENCRYPTION_*`: changing them makes older backups unreadable with
  the new values; keep the old ones until those backups expire.

### Upgrading PostgreSQL (major version)

Data directories are not compatible across majors. Run a backup, bump the
tag in `compose.prod.yml` **and** `deploy/backup/Dockerfile`, remove the
`nostos-api_postgres-data` volume, deploy, then
`restore.sh postgres latest --yes`.

## Known limitations

* SeaweedFS runs as a single node: durability comes from the off-site backup,
  not replication (DECISIONS.md open item on SeaweedFS topology).
* There is no seed or bootstrap command for the first ADMIN user yet. Until
  one exists, API alerts reach only `ALERT_FALLBACK_RECIPIENTS`.
* Health monitoring assumes one API replica: several would each probe and
  send their own alerts.
* Monitoring state lives in memory: restarting the API during an outage sends
  the DOWN email again, and check results buffered while PostgreSQL was down
  are lost.
* If the app server and the proxy VPS are down at the same time, nothing
  alerts. An external dead-man's switch (e.g. healthchecks.io pinged by the
  watchdog) would close that gap.
