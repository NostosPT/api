# Nostos API — Roadmap

This document is the single reference for what is built now, what is deferred,
what is intentionally excluded, and what is still undecided. Its purpose is to
prevent deferred requirements from being forgotten. Update it whenever a phase
ships or a `DECISION REQUIRED` item is resolved (see `DECISIONS.md`).

Planned production domains (not registered/configured yet, never hard-coded):
`nostos.photos` (site), `api.nostos.photos` (this API).

---

## Phase 1 — Core archive API

Scope: Auth, Users, Clients, Services, Service Requests, Tags, Categories,
Photos, Gallery collections, Albums, Public Gallery listing, Uploads,
Favorites, minimal Purchase, AuditLog.

1. **Foundation** — validated env (`DATABASE_URL`, `COOKIE_SECRET`, S3 vars,
   `ADMIN_*` bootstrap), pino JSON logging with redaction, TypeBox route
   schemas wired to Fastify + OpenAPI, `/docs` gated in production, `trustProxy`
   for Caddy, remove demo `POST /v1/health`, align Node 22 across
   `package.json` / `Dockerfile` / CI.
2. **Database** — Prisma v7 + PostgreSQL greenfield, initial migration, seed
   (admin user, 6 catalogue services, base tags/categories).
3. **Auth + Users + AuditLog** — API-owned opaque sessions (30d absolute,
   7d idle, max 10, SHA-512 hash in DB), Argon2id passwords, 5 roles +
   permission matrix enforcement, invites, append-only audit log.
4. **Clients + Services + Service Requests + Tags + Categories** — CRUD,
   client codes, timelines, lifecycle NEW→…→COMPLETED/LOST, notes, normalized
   tags with PUBLIC/INTERNAL visibility, curated categories (never enums),
   onboarding core + answers JSONB.
5. **Photos + Albums + Uploads + Favorites + minimal Purchase** — photo
   `status` publishing workflow (two-gate public visibility); client-owned
   albums (`WATERMARK|PAID|FREE`) with slug + access codes and favorites;
   staff-confirmed purchases (no provider); upload intent → direct PUT to
   SeaweedFS → verify/finalize; magic-byte + 50 MB; private originals,
   entitlement-derived presigned reads.
6. **Public Gallery collections + album access** — curated `Gallery` /
   `GalleryPhoto` (membership, order, featured) over two-gate published
   photos (filters, search, newest/oldest/featured, detail with global
   copyright); stateless capability album links + codes where required,
   strictly rate-limited.
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
* Global dashboard search across IDs (per-domain search is Phase 1).
* Claim visual-similarity engine (fully deferred — no Phase 1 tables,
  endpoints, or boundary scaffolding).
* Analytics event collection (minimal HMAC schema documented; approval needed).
* 2FA enforcement (TOTP fields reserved; scope undecided).

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
* No `CLIENT` staff role (actors: visitor / client record / staff user).
* No client-delivery `Gallery` (delivery is `Album`/`AlbumPhoto`; `Gallery` /
  `GalleryPhoto` are public curation only).
* No `ClientTag` normalized relation (client labels stay free-form).
* No single enum mixing persistent/derived access states on `Photo`.
* No stored aggregate counters or ephemeral storage URLs in the domain.

## Unresolved decisions (`DECISION REQUIRED`)

[B] 1. Public portfolio endpoints in Phase 1 or 2 (site launch dependency)?
[B] 2. `GET /v1/services/all` public without auth (site catalogue)?
[C] 3. SeaweedFS topology (single vs replicated) and backup story.
[C] 4. Invoice provider choice (invoicexpress/moloni/vendus/toconline).
[C] 5. Resend inbound domain + webhook secret rotation story.
[B] 6. PHOTOGRAPHER photo scope: own photos only (`photographerId` = self) or
   archive-wide edit (frontend says "own work" but grants archive edit)?
[C] 7. 2FA scope: optional per-user vs mandatory ADMIN?
[C] 8. Claim vector backend: pgvector vs external embeddings service?
[C] 9. Analytics deferral approval (Phase 2 with documented minimal schema)?

A = schema blocker, B = Phase 1 implementation, C = Phase 2. Zero A items —
nothing blocks Prisma schema creation.

Full format (options, recommended defaults, blockers) in `DECISIONS.md`.
Resolved into Proposed/Confirmed: tag model, cookie strategy, session
lifetimes, gallery/album semantics, album-code mandate (B for paid, A for
FREE), lockout default (5 fails → 15 min backoff), entitlement semantics,
client deletion.

## Future architecture considerations

* Read replicas if gallery traffic grows; rendition CDN in front of
  `S3_PUBLIC_ENDPOINT`.
* Scheduler for automations/digests (Phase 2 success features).
* Audit-log table if compliance requires immutable history beyond `updatedAt`.
* Rate-limit backing store (Redis) when more than one API replica runs.
* Prisma v8 upgrade only after ecosystem stabilizes (see `DECISIONS.md`).
