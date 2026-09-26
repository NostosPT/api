# Nostos API — Decision Log

Concise, append-only record of architecture decisions. Each entry states the
decision, the concrete reason, and what was rejected. Open items are marked
`DECISION REQUIRED` and mirrored in `docs/ROADMAP.md`.

## Decided

* **PostgreSQL (greenfield).** No MariaDB code, dump, or production data exists
  anywhere in the repository (verified: zero DB references in `src/`). The
  deploy example (`.env.prod.example`) already anticipated `POSTGRES_PASSWORD`.
  Chosen for enums, `citext`, `pg_trgm`, transactions for numbering, and Prisma
  maturity. Rejected: MariaDB compat layer (nothing to be compatible with).
* **Prisma v7 as the only ORM.** Stable (v7.7.0, April 2026), Rust-free client,
  requires Node `^20.19.0 || ^22.12.0 || ^24` — satisfied by pinned Node
  22.18.0. Rejected: Prisma 8 (release-candidate churn: `prisma.config.ts`,
  `.take/.skip` renames, platform CLI coupling) and Drizzle/Knex (no second
  abstraction without a documented reason, per `AGENTS.md`).
* **Node 22 coherent everywhere.** `package.json` pins 22.18.0; `Dockerfile`
  (node:20) and CI (node 24) must be aligned to 22 in the foundation step.
* **SeaweedFS self-hosted via S3-compatible interface.** Behind a `Storage`
  port interface so the implementation can be replaced without rewriting the
  photo domain. Originals private; controlled/presigned reads only; API never
  proxies large bytes.
* **API-owned opaque sessions, no JWT.** 256-bit `crypto.randomBytes` token,
  SHA-512 hash stored in `Session`, raw token only in HttpOnly cookie
  (`Secure` in prod, `SameSite=Lax`, `Path=/`). No PII in the cookie, unlike
  JWT claims. No iron-session, no second SvelteKit authority: the frontend
  consumes `POST /v1/auth/login`, `GET /v1/auth/me`, `POST /v1/auth/logout`
  with `credentials: 'include'` (already its coded expectation).
* **Argon2id** for passwords and gallery/album access secrets. Plaintext
  storage of passwords, session tokens, or access secrets is forbidden.
* **Roles: ADMIN, PHOTOGRAPHER, EDITOR, ASSISTANT, ACCOUNTANT.** Exactly these
  five; enforcement server-side (`requireRole` + ownership), dashboard matrix
  is hide-only.
* **Planned domains `nostos.photos` / `api.nostos.photos`.** Not registered;
  never hard-coded — all origins/cookies/URLs come from env.
* **Phase 1 / Phase 2 boundary.** Phase 1: Auth, Users, Clients, Services,
  Service Requests, Tags, Photos, Albums, Gallery, Uploads. Phase 2:
  Documents, Orders, Payments, Email/Resend, Watermark processing.
* **Validation: TypeBox.** Native Fastify integration (`@fastify/type-provider-typebox`
  + AJV) with route schemas feeding OpenAPI generation; single system, no
  Zod/second validator. (Confirmed at implementation time against installed
  Fastify 5.x.)
* **Health: liveness + readiness.** `GET /v1/health` stays (liveness, no
  details); demo `POST /v1/health` is removed; `GET /v1/ready` checks
  PostgreSQL (+ storage reachability) and returns 200/503 without internals.
* **Tests: Vitest + Fastify `inject()`.** No Supertest without a concrete
  requirement.

## Unresolved (`DECISION REQUIRED`)

See `docs/ROADMAP.md` § Unresolved decisions (11 items): public portfolio
scope, tag table shape, gallery/album overlap, public service catalogue,
cookie domain strategy, session expiry durations, concurrent session limit,
lockout thresholds, SeaweedFS topology/backups, invoice provider, Resend
inbound story.
