# Load testing

> Step-by-step guide (running, reading the report, running on production hardware): [`docs/LOAD_TESTING.md`](../docs/LOAD_TESTING.md). This file is the reference.

Answers two questions for the Nostos API: **how many users can it support**, and **what are p95/p99 latencies** at that load. It also records API process CPU/RAM and PostgreSQL behaviour on the same timeline, so it's clear what runs out first.

Everything runs locally against an isolated copy of the production stack, filled with mock data. Nothing here touches the dev database or production.

## Quick start

```bash
brew install k6                 # once
loadtest/run.sh smoke           # every endpoint once + short journeys (~2 min)
loadtest/run.sh stress          # ramp until the SLO breaks (~35 min max)
open loadtest/results/<run>/report.html
```

`pnpm loadtest <profile>` is the same command. To skip reseeding (only after a read-only run), use `LT_RESEED=0`. To stop the stack and delete its data, run `loadtest/run.sh down`.

## What a run does

1. Starts `compose.yml`: the **production API image** (`NODE_ENV=production`, same hardening), PostgreSQL 18 and SeaweedFS. It uses its own project name, volumes and ports: API `:3100`, Postgres `:55432`, S3 `:18333`, probe `:19464`, all on 127.0.0.1.
2. Reseeds the database from scratch (`seed/seed.ts`, about 20 s) and restarts the API so every run starts the same way.
3. Starts the collector (`collect/collector.ts`). Every 2 s it samples:
   - container CPU/memory for api, postgres and seaweedfs,
   - API process internals: event-loop lag and utilization, heap, GC, sockets,
   - PostgreSQL activity: transactions/s, cache hits, connections by state, lock waits, temp files.
4. Runs k6 (`k6/main.js`) with the chosen profile.
5. Builds `report.html`. It contains:
   - the per-step SLO verdict and the max sustainable load,
   - per-endpoint p50/p95/p99,
   - timeline charts,
   - the top SQL statements with plans, per-table scan stats and the slow-query log.

## Traffic model

| Population | Model | Size |
|---|---|---|
| Public visitors | Open model (arrival rate): **page views/s** step up. Each page view makes the API calls that page needs (home, gallery, archive with filters/search, photo detail, atlas, services, rare service-request submit). | Steps in `LT_STEPS` |
| Staff | Closed model: log in once, then weighted back-office tasks with 2–6 s think time. Tasks include clients, requests, photos, album delivery (create → photos → access code → publish → purchase), galleries, atlas, taxonomy and admin. | `LT_STAFF_VUS` (default 10, fixed) |
| Uploader | Staff uploading 10–49 MB originals: presigned PUT straight to storage, then finalize (the API SHA-256s the whole object). | `LT_UPLOAD_VUS` (default 1) |

**Users.** Concurrent visitors = page views/s × `LT_VISITOR_THINK_SECONDS` (default 20 s between page views per visitor). The report shows both numbers, so the estimate can be redone with a different assumption.

**SLO.** p95 < 500 ms, p99 < 1 s, errors < 1%, for both public and staff traffic, measured on each step's hold period (ramps excluded). The step must also serve ≥ 97% of its target page views. **Max sustainable load** is the last step before the first failing one.

**Rate limiting.** The API runs with `TRUST_PROXY=true`, as behind Caddy, and every simulated visitor sends its own `X-Forwarded-For`. That keeps the limiter in the request path without throttling the test. Staff rotate their address per task, because one busy staff member exceeds the global 100 requests / 15 min on their own (see the findings below).

## Hardware

Production runs API, PostgreSQL and SeaweedFS on one **2 vCPU / 4 GB** server.

- **Default (`LT_CAPS=auto`):** when Docker has more than 2 CPUs, `compose.caps.yml` splits that budget per container: api 1.0 CPU / 1.25 GB, postgres 0.75 / 1.75 GB, seaweedfs 0.25 / 768 MB. This is conservative, because in production one container can burst into another's idle share.
- **Shared model (closer to production):** set Docker Desktop → Resources to 2 CPUs / 4 GB and run with `LT_CAPS=off`. k6 runs on the Mac outside the Docker VM either way.
- **CPU speed:** an Apple M4 core is considerably faster than one vCPU of the production host (a Proxmox container on an Intel i5/i9-9500-class CPU). Local numbers are therefore **optimistic**. Running the same profile on the production box (or a clone) gives the real figure.

## Profiles

| Command | What it does |
|---|---|
| `run.sh smoke` | Coverage pass over all ~100 endpoints with expected statuses, plus 1 min of each journey at low rate |
| `run.sh stress` | Steps through `LT_STEPS` (default `1,2,3,4,6,8,10,15,20,30,45,60,80,100` pv/s), with 20 s ramp + 120 s hold per step. Aborts once the run has clearly collapsed. |
| `LT_RATE=… run.sh soak` | Constant `LT_RATE` page views/s for `LT_DURATION` (default `2h`). Use ~70% of the stress result. Watch RSS/heap trend, dead tuples, connections. |
| `LT_RATE=… run.sh spike` | 5 min at 30% of `LT_RATE`, a 10 s jump to 2× `LT_RATE` held 2 min, then 5 min recovery |
| `run.sh report <dir>` | Rebuild a report |
| `run.sh down` | Stop the stack and delete its volumes |

## Settings

| Variable | Default | Meaning |
|---|---|---|
| `LT_STEPS` | see above | Stress steps, page views/s (fractions allowed) |
| `LT_STEP_SECONDS` / `LT_RAMP_SECONDS` | 120 / 20 | Hold and ramp per step |
| `LT_RATE`, `LT_DURATION` | – / `2h` | Soak and spike rate; soak length |
| `LT_STAFF_VUS`, `LT_UPLOAD_VUS` | 10 / 1 | Concurrent staff and uploaders |
| `LT_VISITOR_THINK_SECONDS` | 20 | Seconds between page views per visitor (users conversion) |
| `LT_SLO_P95_MS`, `LT_SLO_P99_MS`, `LT_SLO_ERROR_RATE` | 500 / 1000 / 0.01 | SLO |
| `LT_SCALE` | 1 | Seed size multiplier. At 1: 3k clients, 50k photos, 2k albums (~220k album photos), 300 galleries, 10k service requests, ~5k purchases, 200 atlas locations, 50k audit rows, 30 days of health checks |
| `LT_CAPS` | `auto` | `on`, `off` or `auto` (see Hardware) |
| `LT_API_CPUS`, `LT_PG_CPUS`, `LT_S3_CPUS`, `LT_*_MEM` | see `compose.caps.yml` | Per-container caps |
| `LT_RESEED` | 1 | Reseed before each run |
| `LT_BUILD` | 1 | Rebuild the API image from the current code. `0` reuses existing images (no registry access) |
| `LT_MAX_VUS` | 600 | Cap on in-flight page views; beyond it, page views are dropped and counted |
| `LT_DEBUG` | 0 | Log status and body of failed checks |
| `LT_LOG_LEVEL` | `info` | API log level (production uses info) |

## Files

```text
loadtest/
  run.sh               orchestration
  compose.yml          isolated stack (prod image + postgres + seaweedfs)
  compose.caps.yml     2 vCPU / 4 GB approximation
  probe/probe.mjs      preloaded into the API (NODE_OPTIONS=--import) for event-loop/heap/GC metrics
  seed/seed.ts         mock data generator (guarded to the nostos_loadtest database only)
  seed/make-uploads.ts 10-49 MB upload payloads
  k6/main.js           profiles and scenarios
  k6/journeys/*.js     public visitor, staff, uploader, endpoint coverage
  collect/collector.ts resource sampler
  report/build-report.ts
  results/<run>/       report.html, result.json, k6.csv.gz, samples.ndjson, db-final.json, pg.log (git-ignored)
```
