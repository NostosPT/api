# Deploying Nostos API

The stack runs in Docker inside a Debian container (Proxmox CT) at home. An Oracle Cloud
VPS is the public entry point: Caddy there terminates HTTPS and forwards to the CT
through a WireGuard tunnel that the CT dials out to. Nothing is opened on the home router.

```
 visitor ──HTTPS──▶ Oracle VPS  (public IP, wg 10.8.0.1)
                    └─ Caddy: api.nostos.pt, media.nostos.pt
                         │
                         │  WireGuard (CT dials out, UDP 51820)
                         ▼
                    Debian CT at home  (wg 10.8.0.2)
                    └─ Docker: compose.prod.yml
                         ├─ api       10.8.0.2:4000
                         ├─ s3        10.8.0.2:8333   (presigned image URLs)
                         ├─ postgres  internal only
                         └─ migrate   one-shot, runs before each api start
```

Do the steps in order. `10.8.0.x` addresses match the example configs; keep them unless
they clash with a network you already use.

## 1. DNS

At the registrar for `nostos.pt`, add **A records** for `api` and `media` pointing to the
VPS public IP. In Oracle, make that IP a **reserved** public IP (Networking → IP
management → Reserved public IPs) so it survives re-creating the instance.

Caddy can only get HTTPS certificates once these resolve, so do this first.

## 2. Oracle VPS

Any small instance works (Always Free Ampere A1 or E2.1.Micro): it only proxies.
The steps assume Ubuntu 24.04.

**Open ports in both firewalls.** Oracle blocks them in two places:

1. **Cloud firewall**: Networking → Virtual cloud networks → *your VCN* → Security
   Lists → *Default Security List* (or the NSG on the instance) → Add Ingress Rules,
   source `0.0.0.0/0`:
   - TCP, destination port `80`
   - TCP, destination port `443`
   - UDP, destination port `51820`
2. **OS firewall**: Oracle's Ubuntu images ship iptables rules that reject everything
   except SSH. Add rules in front of them. Don't flush the existing rules or switch to
   ufw, because some of those rules keep the instance's boot volume reachable.
   ```bash
   sudo iptables -I INPUT -p tcp -m multiport --dports 80,443 -j ACCEPT
   sudo iptables -I INPUT -p udp --dport 51820 -j ACCEPT
   sudo netfilter-persistent save
   ```
   (Oracle Linux images use firewalld instead:
   `sudo firewall-cmd --permanent --add-service=http --add-service=https --add-port=51820/udp && sudo firewall-cmd --reload`)

**Install:**
- WireGuard: `sudo apt update && sudo apt install -y wireguard-tools`
- Caddy, from its apt repo: <https://caddyserver.com/docs/install#debian-ubuntu-raspbian>
  (configured in step 6).

## 3. Proxmox host and CT

On the **Proxmox host** (an unprivileged CT can't load kernel modules itself):

```bash
modprobe wireguard
echo wireguard > /etc/modules-load.d/wireguard.conf
```

Create the **CT**:
- Debian 12 or 13 template, **unprivileged**.
- Features: `nesting=1,keyctl=1` (Options → Features, or `pct set <CTID> --features nesting=1,keyctl=1`).
  Docker needs both.
- Enough disk for photo originals. Photos are stored in `/mnt/Nostos` inside the CT;
  the database lives in a Docker volume under `/var/lib/docker`.

Inside the CT:
- Docker Engine and the compose plugin: <https://docs.docker.com/engine/install/debian/>
- `apt install -y wireguard-tools git`
- `docker info | grep -i 'storage driver'` should say `overlay2`. If the CT disk is on
  ZFS and it says `vfs`, upgrade Proxmox (ZFS ≥ 2.2); otherwise images will be huge and slow.

## 4. WireGuard tunnel

**Keys**: on *each* machine, as root (private keys never leave their host):

```bash
umask 077
wg genkey | tee /etc/wireguard/private.key | wg pubkey > /etc/wireguard/public.key
cat /etc/wireguard/public.key    # give this one to the other side
```

**Configs**: create `/etc/wireguard/wg0.conf` from the templates and fill in the keys
(and, in the CT, the VPS public IP):
- VPS: [`wireguard/vps-wg0.conf.example`](wireguard/vps-wg0.conf.example)
- CT: [`wireguard/ct-wg0.conf.example`](wireguard/ct-wg0.conf.example)

Start it on both, **VPS first**:

```bash
systemctl enable --now wg-quick@wg0
```

**Docker after WireGuard** (CT only): the API and storage ports bind to `10.8.0.2`,
which only exists once `wg0` is up. Without this, the stack fails after a reboot with
`cannot assign requested address`:

```bash
mkdir -p /etc/systemd/system/docker.service.d
cat > /etc/systemd/system/docker.service.d/wireguard.conf <<'EOF'
[Unit]
After=wg-quick@wg0.service
Wants=wg-quick@wg0.service
EOF
systemctl daemon-reload
```

**Check** from the CT: `ping -c3 10.8.0.1` works, and `wg show` shows a recent
*latest handshake*.

## 5. Start the stack (CT)

```bash
git clone https://github.com/NostosPT/api.git && cd api
cp .env.prod.example .env.prod
```

Fill in `.env.prod`. For this setup:

| Variable | Value |
| --- | --- |
| `BIND_ADDRESS` | `10.8.0.2` |
| `TRUST_PROXY` | `10.8.0.1` |
| `CORS_ORIGINS` | the website origin(s), e.g. `https://nostos.pt,https://www.nostos.pt` |
| `S3_PUBLIC_ENDPOINT` | `https://media.nostos.pt` |
| `POSTGRES_PASSWORD`, `COOKIE_SECRET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | each `openssl rand -hex 32` |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD` | the first admin (clear them after the first start) |

```bash
docker compose -f compose.prod.yml --env-file .env.prod up -d --build
```

The first start creates the schema, the bucket and the admin. **Check from the VPS**.
This proves the tunnel and the port binding:

```bash
curl http://10.8.0.2:4000/health/ready    # {"status":"ok","checks":{"database":true,"storage":true}}
```

## 6. Caddy (VPS)

Copy [`Caddyfile.example`](Caddyfile.example) to `/etc/caddy/Caddyfile`, set your email,
then:

```bash
sudo systemctl reload caddy
curl https://api.nostos.pt/health/ready
```

The first request can take a few seconds while Caddy gets the certificates
(`journalctl -u caddy -f` shows progress).

What Caddy handles for you (and what any other proxy would have to handle):
- It keeps the `Host` header, so presigned URLs signed for `media.nostos.pt` stay valid.
- It sets no body-size limit and doesn't buffer uploads, so originals stream from the browser to storage.
- It replaces client-sent `X-Forwarded-For`, so visitors can't forge their IP.

([`nginx.example.conf`](nginx.example.conf) has the equivalent config if you ever
switch to nginx.)

## 7. Confirm visitors' IPs

Rate limits (e.g. 5 login attempts/minute) are per visitor IP. If the API sees every
request as coming from the VPS, that limit is shared by everyone. After a request
through `https://api.nostos.pt`:

```bash
docker compose -f compose.prod.yml --env-file .env.prod logs api | grep remoteAddress
```

It should show your public IP. If it shows `10.8.0.1` or a `172.x.0.1` Docker
gateway, add that address to `TRUST_PROXY` and run `up -d` again. Never set it to `true`.

## Operating

```bash
alias dcp='docker compose -f compose.prod.yml --env-file .env.prod'

dcp up -d --build           # deploy an update (after git pull); migrations run first
dcp logs -f api             # logs (rotated automatically)
dcp exec postgres psql -U nostos nostos
dcp run --rm migrate        # e.g. after setting ADMIN_* to add another admin
```

**Backups:**
- Database (consistent dump; schedule it with cron or a systemd timer):
  ```bash
  dcp exec -T postgres pg_dump -U nostos -Fc nostos > nostos-$(date +%F).dump
  ```
- Photos: `/mnt/Nostos` in the CT. Proxmox backups of the CT (vzdump) include it only if
  it is on the CT's root disk or a mount point with backup enabled (bind mounts never are).
  Keep the pg_dump as well, since a dump restores more reliably than live database files.

**Bandwidth:** every image travels home → VPS → visitor, so your home upload speed
limits how fast photos load. Once display/thumbnail renditions exist, caching them on
the VPS is the natural next step.

## Troubleshooting

| Symptom | Likely cause |
| --- | --- |
| `wg show` in the CT: no handshake | UDP 51820 not open in *both* Oracle firewalls (step 2), wrong `Endpoint` IP, or public keys swapped. |
| Tunnel pings, but `curl 10.8.0.2:4000` from the VPS fails | Stack not running (`dcp ps`), `BIND_ADDRESS` wrong, or Docker started before `wg0` (step 4 drop-in). |
| Caddy has no certificate / TLS errors | DNS doesn't point at the VPS yet, or 80/443 blocked in one of the Oracle firewalls. |
| Small requests work, large uploads or pages hang | MTU. Set `MTU = 1380` under `[Interface]` on both peers and restart `wg-quick@wg0`. |
| `SignatureDoesNotMatch` on image URLs | `S3_PUBLIC_ENDPOINT` doesn't match the URL the browser uses. |
| Uploads blocked by CORS in the browser | The site's origin is missing from `CORS_ORIGINS` (it's also passed to storage). |
| Login "too many requests" for everyone | `TRUST_PROXY` is wrong (step 7). |
| Containers fail to start with AppArmor / sysctl permission errors | A Docker-in-LXC compatibility issue. Update Proxmox and the CT's Docker packages first. |
| `api` never starts | `dcp logs migrate`. Migrations or bucket creation failed. |
