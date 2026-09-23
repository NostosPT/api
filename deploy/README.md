# Deploying Nostos API

Target: Docker inside a Debian container (Proxmox CT). The public entry point is a
reverse proxy on a VPS that reaches the CT over WireGuard.

```
 visitor ──HTTPS──▶ VPS: Caddy/nginx (TLS, public IP, wg 10.8.0.1)
                        │
                        │ WireGuard tunnel
                        ▼
                    Debian CT (wg 10.8.0.2) ── Docker (compose.prod.yml)
                        ├─ api       10.8.0.2:3000  ◀── api.nostos.pt
                        ├─ s3        10.8.0.2:8333  ◀── media.nostos.pt (presigned image URLs)
                        ├─ postgres  internal only
                        └─ migrate   one-shot, runs before each api start
```

The addresses and domains are examples. Replace them with your own everywhere below.
The website and API should share a registrable domain (`nostos.pt` / `api.nostos.pt`)
so the session cookie (`SameSite=Lax`) is sent.

## 1. The CT

- Debian 12/13, **unprivileged**, with **Options → Features: `nesting=1,keyctl=1`**
  (needed for Docker in LXC).
- Install Docker Engine and the compose plugin from Docker's Debian repo:
  <https://docs.docker.com/engine/install/debian/>
- Check the storage driver: `docker info | grep -i 'storage driver'` should say `overlay2`.
  If the CT disk is on ZFS and it says `vfs`, upgrade Proxmox (ZFS ≥ 2.2 supports
  overlay), or images will be huge and slow.
- Give the CT enough disk for photo originals. Everything lives in Docker volumes
  under `/var/lib/docker` inside the CT.

## 2. WireGuard

Either the CT is a WireGuard peer itself (`wg0` inside the CT), or WireGuard ends on
the Proxmox host/router and forwards to the CT's LAN IP. `BIND_ADDRESS` is whichever
IP the VPS actually connects to on the CT.

If `wg0` lives **inside the CT**, Docker must start after it. Otherwise binding the
ports to the WireGuard IP fails at boot (`cannot assign requested address`):

```bash
mkdir -p /etc/systemd/system/docker.service.d
cat > /etc/systemd/system/docker.service.d/wireguard.conf <<'EOF'
[Unit]
After=wg-quick@wg0.service
Wants=wg-quick@wg0.service
EOF
systemctl daemon-reload
```

On the VPS, the CT's address must be in the peer's `AllowedIPs`.

## 3. Configure and start

```bash
git clone https://github.com/NostosPT/api.git && cd api
cp .env.prod.example .env.prod
# fill it in; generate each secret with: openssl rand -hex 32
docker compose -f compose.prod.yml --env-file .env.prod up -d --build
```

The first start creates the database schema, the `nostos` bucket and the admin from
`ADMIN_EMAIL`/`ADMIN_PASSWORD`. Clear those two afterwards.

Check it from the CT:

```bash
curl http://10.8.0.2:3000/health/ready   # your BIND_ADDRESS; expect {"status":"ok",...}
```

## 4. Reverse proxy on the VPS

Point `api.nostos.pt` and `media.nostos.pt` at the VPS, then use
[`Caddyfile.example`](Caddyfile.example) (simplest) or
[`nginx.example.conf`](nginx.example.conf).

What matters for the media host:
- **Keep the `Host` header.** Presigned URLs are signed for `media.nostos.pt`.
  (`-s3.externalUrl` also covers proxies that rewrite it.)
- **No body-size limit and no request buffering.** Originals are uploaded straight
  from the browser to storage through the tunnel.

## 5. `TRUST_PROXY`: get the real visitor IP

Every request reaches the API from the proxy. Unless the API trusts the proxy's
`X-Forwarded-For`, all visitors share one IP. That means **one shared login rate
limit for everyone**, and useless IPs in logs and sessions.

Set `TRUST_PROXY` to the address the proxy connects from, as seen by the API. That's
usually the VPS's WireGuard IP (`10.8.0.1`). To confirm, make a request through the
proxy and look at the logs:

```bash
docker compose -f compose.prod.yml --env-file .env.prod logs api | grep remoteAddress
```

- You see visitors' public IPs: correct.
- You see `10.8.0.1` (or a `172.x.0.1` Docker gateway): add that address/CIDR to
  `TRUST_PROXY` and run `up -d` again.

Never use `TRUST_PROXY=true`. Anyone who can reach the port could then forge their IP.

## Operating

```bash
alias dcp='docker compose -f compose.prod.yml --env-file .env.prod'

dcp up -d --build           # deploy an update (after git pull); migrations run first
dcp logs -f api             # logs (rotated automatically)
dcp exec postgres psql -U nostos nostos
dcp run --rm migrate        # e.g. after setting ADMIN_* to add another admin
```

### Backups

- **Database** (consistent dump, schedule it with cron/systemd):
  ```bash
  dcp exec -T postgres pg_dump -U nostos -Fc nostos > nostos-$(date +%F).dump
  ```
- **Photos**: the `nostos-prod_s3-data` volume. Proxmox backups of the CT (vzdump)
  include it. Keep the pg_dump too, since a DB dump is safer to restore than live DB files.

### Troubleshooting

| Symptom | Likely cause |
| --- | --- |
| Small requests work, large uploads or pages hang | WireGuard MTU. Lower `MTU` on both peers (e.g. 1380), or clamp TCP MSS on the VPS. |
| `SignatureDoesNotMatch` on image URLs | `S3_PUBLIC_ENDPOINT` doesn't match the URL the browser uses (scheme/host/port). |
| Uploads blocked by CORS in the browser | The site's origin is missing from `CORS_ORIGINS` (it's also passed to storage). |
| Login says "too many requests" for everyone | `TRUST_PROXY` is wrong (see step 5). |
| Containers fail to start with AppArmor / sysctl permission errors | A Docker-in-LXC compatibility issue. Update Proxmox and the CT's Docker packages first. |
| `api` never starts | `dcp logs migrate`. Migrations or bucket creation failed. |
