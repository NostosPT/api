# Nostos API — Roadmap

This document is the single reference for what is built now, what is deferred,
what is intentionally excluded, and what is still undecided. Its purpose is to
prevent deferred requirements from being forgotten. Update it whenever a phase
ships or a `DECISION REQUIRED` item is resolved (see `DECISIONS.md`).

Planned production domains (not registered/configured yet, never hard-coded):
`nostos.photos` (site), `api.nostos.photos` (this API).

---

## Phase 1 — Core archive API

Scope: Auth, Users, Clients, Services, Service Requests, Tags, Photos, Albums,
Gallery, Uploads.

1. **Foundation** — validated env (`DATABASE_URL`, `COOKIE_SECRET`, S3 vars,
   `ADMIN_*` bootstrap), pino JSON logging with redaction, TypeBox route
   schemas wired to Fastify + OpenAPI, `/docs` gated in production, `trustProxy`
   for Caddy, remove demo `POST /v1/health`, align Node 22 across
   `package.json` / `Dockerfile` / CI.
2. **Database** — Prisma v7 + PostgreSQL greenfield, initial migration, seed
   (admin user, 6 catalogue services, base tags/categories).
3. **Auth + Users** — API-owned opaque sessions (256-bit token, SHA-512 hash in
   DB), Argon2id passwords, 5 roles + permission matrix enforcement, invites.
4. **Clients + Services + Service Requests + Tags** — CRUD, lifecycle
   NEW→…→COMPLETED/LOST, notes, normalized tags.
5. **Photos + Albums + Uploads** — upload intent → direct PUT to SeaweedFS
   (S3-compatible) → verify/finalize → register metadata; magic-byte + 50 MB
   validation; private originals, presigned reads.
6. **Gallery** — client delivery galleries with slug + hashed access code,
   publish lifecycle, public `/v1/public/g/:slug`.
7. **Hardening** — negative/security tests per domain, rate limits, IDOR audit,
   OpenAPI docs.

## Phase 2 — Financial + communications (deferred, not forgotten)

* **Documents** — quotes/proformas/invoices/credit notes, certified provider
  integration (server-side issue, ATCUD, PDF). Depends on: Clients, Services.
* **Orders** — print/licence orders, fulfilment states, payment webhook.
  Depends on: Photos, Clients, Documents.
* **Payments / financial integrations** — provider webhooks, reconciliation.
* **Email / Resend** — send via API, inbound + delivery webhooks, thread
  matching. Depends on: Clients.
* **Watermark processing** — rendition worker (sharp) reading the same spec as
  the dashboard preview; originals never watermarked.

## Deferred functionality (explicitly not Phase 1)

* Public portfolio endpoints (`GET /v1/public/albums/:slug`, service catalogue
  listing) — needed by the site, designed in Phase 1, implemented Phase 2
  unless the site launch requires them earlier.
* Mail threads/labels/search, notifications (server-sent events), client
  success follow-ups/automations/feedback, team settings UI backing,
  weekly digest scheduler.
* Full-text search (PostgreSQL FTS / pg_trgm) beyond substring filters.

## Intentionally excluded functionality

* No MariaDB/MySQL compatibility layer (greenfield PostgreSQL, no legacy data).
* No second ORM (Prisma only; no Drizzle/Knex).
* No JWT, no iron-session, no second SvelteKit session authority.
* No plaintext passwords, session tokens, or gallery/album access secrets
  anywhere.
* No API proxying of large photo bytes (direct-to-storage uploads).
* No storage URLs as domain source of truth (keys only; URLs are ephemeral).
* No Prisma models exposed directly as API responses (explicit DTOs).
* No `ClientServices` N:N as the service relationship (replaced by
  ServiceRequest entity).
* No payments modelled as three nullable FKs (see financial phase).

## Unresolved decisions (`DECISION REQUIRED`)

1. Public portfolio endpoints in Phase 1 or 2 (site launch dependency)?
2. Tag model: single `Tag` table with scope vs separate photo/client tags?
3. Gallery vs Album overlap: can a gallery reference album-ordered photos, or
   only loose photos? Are galleries ever public-portfolio?
4. `GET /v1/services/all` public without auth (site catalogue)?
5. Cookie domain strategy for `api.nostos.photos` + `nostos.photos`
   (cross-subdomain `Domain=` vs same-site proxy)?
6. Session idle vs absolute expiry durations.
7. Concurrent session limit per user.
8. Failed-login lockout thresholds.
9. SeaweedFS topology (single vs replicated) and backup story.
10. Invoice provider choice (invoicexpress/moloni/vendus/toconline).
11. Resend inbound domain + webhook secret rotation story.

## Future architecture considerations

* Read replicas if gallery traffic grows; rendition CDN in front of
  `S3_PUBLIC_ENDPOINT`.
* Scheduler for automations/digests (Phase 2 success features).
* Audit-log table if compliance requires immutable history beyond `updatedAt`.
* Rate-limit backing store (Redis) when more than one API replica runs.
* Prisma v8 upgrade only after ecosystem stabilizes (see `DECISIONS.md`).
