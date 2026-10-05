# Load testing: how to run it and read the report

This guide covers running the Nostos API load tests and getting the HTML report: how many users the API supports, p95/p99 latency, API CPU/RAM, and database performance. The settings reference is in [`loadtest/README.md`](../loadtest/README.md).

The tests never touch the dev database or production. Each run starts an **isolated copy of the production stack** (same API image, PostgreSQL 18, SeaweedFS), fills it with mock data, drives it with simulated users, and writes a self-contained `report.html`.

---

## 1. One-time setup

On the machine that will run the test:

| Tool | Check | Install |
|---|---|---|
| Docker (Desktop or Engine with Compose) | `docker compose version` | docker.com |
| k6 | `k6 version` | `brew install k6` (macOS) · [other platforms](https://grafana.com/docs/k6/latest/set-up/install-k6/) |
| Node 22+ and pnpm 10 | `node -v`, `pnpm -v` | `corepack enable` |

Then, from the `api/` folder:

```bash
pnpm install
```

The first run builds the API image and generates the upload files (about 115 MB under `loadtest/.data/`). That takes a few minutes; later runs start in about 30 s.

---

## 2. Run a test

Docker must be running. From `api/`:

```bash
pnpm loadtest smoke      # ~2 min: calls every endpoint once, checks the harness and the API work
pnpm loadtest stress     # up to ~35 min: raises traffic step by step until it breaks
```

Always run **smoke first** after code changes. If smoke shows failed checks, fix those before trusting a stress result.

At the end, the terminal prints one line per load step and the report path:

```text
step  1      1 pv/s  served    1.0  p95   877 ms  p99   1.08 s  err 0.00%  ...  FAIL (public p95 877 ms; ...)
...
Report: /…/api/loadtest/results/20261003-082347-stress/report.html
```

Open it with `open loadtest/results/<run>/report.html`, or send the file to someone. It's a single HTML file with no external dependencies.

### The four test types

| Command | Use it to answer | Duration |
|---|---|---|
| `pnpm loadtest smoke` | "Does everything still work?" | ~2 min |
| `pnpm loadtest stress` | "How many users can we take, and what are p95/p99?" | until it breaks (≤ ~35 min) |
| `LT_RATE=<n> pnpm loadtest soak` | "Does it stay healthy for hours?" (memory leaks, connection build-up, table bloat) | 2 h (`LT_DURATION=30m` to shorten) |
| `LT_RATE=<n> pnpm loadtest spike` | "What happens when a post goes viral?" (sudden 2× burst, then recovery) | ~13 min |

For soak and spike, set `LT_RATE` from the stress result. Use about 70% of the max sustainable page views/s for soak, and the max itself for spike.

### Common variations

```bash
# Finer steps around a known limit (page views per second, decimals allowed)
LT_STEPS=0.5,1,1.5,2,2.5,3 pnpm loadtest stress

# Bigger database (5 years of growth instead of 1)
LT_SCALE=5 pnpm loadtest stress

# More staff working at the same time (default 10), or no uploads
LT_STAFF_VUS=20 LT_UPLOAD_VUS=0 pnpm loadtest stress

# Different latency target
LT_SLO_P95_MS=300 LT_SLO_P99_MS=800 pnpm loadtest stress

# Rebuild a report (e.g. after changing the report code)
pnpm loadtest report loadtest/results/<run>

# Stop the test stack and delete its data
pnpm loadtest down
```

---

## 3. Read the report

**The headline** gives the answer: either "Sustains X page views/s ≈ Y concurrent visitors", or "Did not meet the SLO even at the first step".

- **Concurrent visitors** = page views/s × 20 s, the assumed average time a visitor spends between page views. Change the assumption with `LT_VISITOR_THINK_SECONDS`.
- **SLO (target):** p95 < 500 ms, p99 < 1 s, errors < 1%, for both public visitors and staff. At least 97% of the requested page views must be served.
- **Max sustainable load** is the last step before the first one that misses the SLO.

**Sections, top to bottom:**

1. **Summary cards.** Max load, p95/p99 at that load, where it breaks, and API and PostgreSQL usage at the max.
2. **What gave out first.** An automatic bottleneck call at the breaking step:
   - API CPU saturated,
   - event loop busy (requests queue behind JavaScript work),
   - PostgreSQL CPU saturated,
   - connection pool full (10 connections),
   - memory near its limit,
   - test VU pool exhausted.
3. **Failed checks.** Requests that returned an unexpected status. Bugs show up here.
4. **Load steps.** One row per step: target vs served page views, public p50/p95/p99, errors, staff p95/p99, API CPU / event-loop utilization / lag / RSS, PostgreSQL CPU / active connections / transactions. Green passed, red failed, bold green is the max.
5. **Timeline charts.** Throughput, latency, error rate, container CPU and memory, API heap, event loop, PostgreSQL connections, transactions and cache hit ratio, all on one time axis. Shaded bands mark load steps.
6. **Endpoints.** Every route with request count, p50/p95/p99/max, error rate and status codes, plus p95 at the max and breaking steps. Sorted slowest first.
7. **Database: top statements.** The SQL that used the most database time (from `pg_stat_statements`), its share of total time, mean/max duration, rows per call and cache hit rate. Expand a row to see the full query and its plan.
8. **Database: tables.** Sequential scans vs index scans per table. Lots of rows read by seq scans usually means a missing index. Dead rows matter in soak runs.
9. **Slow statement log.** Queries over 500 ms, as logged by PostgreSQL.
10. **Run settings.** Everything needed to reproduce the run.

**Comparing runs.** Each run folder also has `result.json` with the same numbers in machine-readable form. Keep the folders for before/after comparisons; they are git-ignored.

---

## 4. Get realistic numbers (hardware)

Production runs everything on **one 2 vCPU / 4 GB server**, and the test always enforces that budget:

- **On a laptop or a bigger machine (default):** Docker limits each container to its share (API 1 CPU, PostgreSQL 0.75, SeaweedFS 0.25). k6 runs outside those limits so it doesn't steal CPU from the API.
- **Closer to production (shared resources):** set Docker Desktop → Settings → Resources to **2 CPUs / 4 GB** and run with `LT_CAPS=off`.

**CPU speed matters.** An Apple M-series core is much faster than one vCPU of the production host (Intel i5/i9-9500-class under Proxmox). Laptop results are therefore **optimistic**. To get the production figure, run on production-class hardware.

### Running on the Proxmox host

Don't run it on the live production container: the test would compete with real users and skew both. Instead:

1. **Clone** the production LXC/VM in Proxmox, or create one on the same node. Give it **4 vCPUs / 6 GB**: the stack is capped to 2 vCPU / 4 GB and the extra cores go to k6. For Docker inside an LXC, enable *nesting* (Options → Features → nesting).
2. Install Docker, k6, Node 22 and pnpm (section 1), then clone the repo and check out the branch to test.
3. Run with the caps forced on, so the stack gets exactly the production budget:

   ```bash
   LT_CAPS=on pnpm loadtest smoke
   LT_CAPS=on pnpm loadtest stress
   ```

4. Copy the report back: `scp <host>:<path>/api/loadtest/results/<run>/report.html .`

Run the profile that matters on both machines: the ratio between the laptop result and the Proxmox result is a reusable conversion factor for future laptop runs.

---

## 5. Before and after a code change

1. On the current branch: `pnpm loadtest smoke && pnpm loadtest stress`. Keep the run folder.
2. Make the change (e.g. a query fix), then run smoke and stress again.
3. Compare the two reports: max sustainable load, p95/p99 per step, the endpoint table and the top statements.

The database is reseeded identically before every run, so differences come from the code, not the data.

---

## 6. Troubleshooting

| Symptom | Fix |
|---|---|
| `Docker is not running` | Start Docker Desktop and wait until it's ready |
| `k6 is required` | `brew install k6` |
| Port already in use (3100, 55432, 18333, 19464) | Something else is using it; set `LT_API_PORT`, `LT_PG_PORT`, `LT_S3_PORT` or `LT_PROBE_PORT`, or stop the other service |
| `docker compose up failed` | The compose output is printed above the error; `loadtest/.data/compose.log` has the full log |
| Run hangs at "starting stack" (build stuck on `load metadata for docker.io/...`) | Docker Hub is unreachable or slow. Retry later, or run with `LT_BUILD=0` to reuse the images from the previous run (only valid if `src/` hasn't changed since) |
| Smoke shows failed checks | Rerun the failing part with `LT_DEBUG=1` to print the status and response body of each failure. Known API bugs at the time of writing: service reorder (`POST /services/:id/move`) |
| Report says "Did not meet the SLO even at the first step" | The API is too slow even at the lowest load. Lower the steps (`LT_STEPS=0.25,0.5,1`) to find the real limit, and check the Endpoints and Database sections for the cause |
| Run stopped early ("stopping test prematurely") | Intentional: over 30% of requests failed, or k6 had to drop too many page views. The report covers the steps that ran |
| Disk filling up | `pnpm loadtest down` deletes the stack's volumes (uploaded files and database). Delete old `loadtest/results/*` folders by hand |

---

## 7. What the simulated users do

- **Public visitors** (scaled up step by step) open realistic pages: home, galleries, gallery detail, archive with filters/sort/pagination, search, photo detail, atlas map and location, services, and occasionally submit the service-request form. Each visitor has its own IP, so the API's per-IP rate limit applies as in production without throttling the test.
- **Staff** (fixed group, default 10) log in once, then work with think time between clicks:
  - dashboard, clients, service-request triage and notes, photo editing and tagging,
  - album delivery: create, add photos, access code, publish, purchase,
  - purchases, galleries, atlas, tags and categories, user admin, re-login.
- **Uploader** (default 1) uploads 10–49 MB originals straight to storage through presigned URLs, then finalizes them through the API (which checks and hashes the whole file).
- **Data:** about one year of studio activity per `LT_SCALE`. That's 3k clients, 50k photos, 2k albums with ~220k album photos, 300 galleries, 10k service requests, ~5k purchases, 200 atlas locations and 50k audit entries, plus 30 days of health checks.
