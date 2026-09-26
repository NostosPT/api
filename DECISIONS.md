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
* **Session lifetime (Phase 1 defaults, env-configurable).** Absolute 30 days,
  idle 7 days, max 10 concurrent sessions per user. Idle expiry renews on
  active use, lazily (DB write only when approaching the threshold, not per
  request). Login creates a session; logout revokes the current one;
  "logout everywhere", password change, and role/privilege change revoke all
  sessions of the user; beyond-limit logins revoke the oldest active sessions;
  expired/revoked sessions are swept periodically.
* **Cookie belongs to the API host.** The auth cookie is scoped to
  `api.nostos.photos` — never a shared parent-domain cookie. Production uses
  the `__Host-` prefix, which requires `Secure`, `Path=/`, and no `Domain`
  attribute. `nostos.photos` and `api.nostos.photos` do not share cookie
  scope: the browser attaches the API cookie on frontend-to-API requests made
  with credentials, under CORS rules. CORS allows only the configured frontend
  origin — never `Access-Control-Allow-Origin: *` with credentials.
* **Argon2id** for passwords and gallery/album access secrets. Plaintext
  storage of passwords, session tokens, or access secrets is forbidden.
* **Gallery = public archive; Album = private client delivery.**
  Supersedes the earlier inverted semantics. Gallery is not a container entity:
  the public Nostos archive is a derived listing over `Photo`
  (`status=PUBLISHED AND visibility=PUBLIC`) with filters, search, and a
  detail view carrying the global copyright/credit text. An Album belongs to
  exactly one Client (`Album.clientId NOT NULL`), is the only client-delivery
  container, and is never a public portfolio. Albums are private by default; a
  published WATERMARK/PAID album requires an access code (**Proposed**; FREE
  code optional), Argon2id-hashed, never plaintext. Knowing the slug alone
  grants nothing: `GET /v1/public/a/:slug` requires the code whenever one is
  set, returns 404 (not 403) on failure, and code attempts are strictly
  rate-limited per album + IP.
* **Album types are explicit (`WATERMARK | PAID | FREE`), not booleans.**
  Type-owned behaviors (visibility scope, watermarking, favorites, purchase
  models) live on `Album` + `AlbumPhoto.isPreview`; purchase outcomes on
  minimal `Purchase`; downloadable/final state is derived entitlement. Full
  rules in `docs/REQUIREMENTS.md` §3–§5.
* **Photo access states are derived.** `Visible/Watermarked/Locked/Hidden`
  compute from (`Photo.status`, `visibility`, `Album.type`,
  `AlbumPhoto.isPreview`); `Purchased/Downloadable` compute from completed
  purchases. Nothing purchase-derived is stored on `Photo`.
* **Favorites are client-scoped rows.** `Favorite(clientId, albumId, photoId)`
  unique, `CASCADE` everywhere, creatable only for currently visible photos;
  reads re-check album access. Staff delivery roles may view per-album lists.
* **Minimal Phase 1 `Purchase` vs full Phase 2 finance.**
  `Purchase ≠ provider transaction ≠ invoice`. Phase 1 records scope
  (PHOTO|PACK|ALBUM), price snapshot, and staff-confirmed status — no payment
  provider (none invented). Provider transactions, webhooks, Documents
  (ATCUD), Orders fulfilment, and Email/Resend stay Phase 2.
* **Tags normalized with visibility; Categories are separate.**
  `Tag(status ACTIVE|INACTIVE, visibility PUBLIC|INTERNAL)` + `PhotoTag` /
  `AlbumTag` joins; `ClientTag` dropped (no normalized requirement — client
  labels stay free-form `string[]`). `Category` is a first-class curated
  taxonomy (`slug` unique, `position`), never a hard-coded enum; photos hold
  `categoryId`. **Proposed**, needs approval.
* **Publishing is a two-gate workflow.** `Photo.status DRAFT→APPROVED→
  PUBLISHED` (forward-only, audit-logged) plus `visibility`; public listing
  requires both `PUBLISHED` and `PUBLIC`. Copyright/credit text lives once in
  global configuration. **Proposed**, needs approval.
* **Client: code + lookup, no auth.** Auto `clientCode UNIQUE`, lookup by
  code/email/name; page aggregates derived, never counters. Only actors are
  public visitor / client record / staff user — no `CLIENT` role, clients use
  album access mechanisms.
* **Onboarding: relational core + `answers` JSONB.** Filterable fields stay
  columns; per-service shapes + contact live in validated JSONB (server-side
  schema registry). **Proposed**, needs approval.
* **Claim: boundary now, engine later.** No SQL-pretends-visual-search;
  reference uploads reuse upload intents, `ClaimSearch` reserved for Phase 2
  with the vector engine. **Decision Required:** pgvector vs external service.
* **Analytics: recommended deferral (Phase 2).** Minimal HMAC/salt-rotated
  schema documented in `REQUIREMENTS.md` §12; GDPR compliance stays a legal
  decision. **Proposed**, needs approval.
* **2FA: scope undecided — Decision Required** (optional per-user vs mandatory
  ADMIN). Reserved TOTP fields only; session system unchanged.
* **AuditLog is Phase 1, append-only.** No update/delete grants or endpoints;
  secrets never stored. Event list in `REQUIREMENTS.md` §13.
* **Iron references superseded.** Any older Iron-session mention in functional
  material is overridden by the opaque-session architecture above; Iron is
  not reintroduced.
* **Roles: ADMIN, PHOTOGRAPHER, EDITOR, ASSISTANT, ACCOUNTANT.** Exactly these
  five; enforcement server-side (`requireRole` + ownership), dashboard matrix
  (`src/lib/admin/team/roles.ts` in the frontend) is hide-only. Full matrix in
  § Permission matrix below.
* **Client email business rule.** One Client = one client account. `Client.email`
  is `NOT NULL UNIQUE`, normalized (trim + lowercase) before persistence and
  comparison. No multi-email, contact-email tables, or shared client emails.
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

## Permission matrix (Phase 1)

Codes: `R` read · `C` create · `U` update · `D` delete · `P` publish/share
(PUBLIC, PUBLISHED, link rotation) · `M` manage (all of the above) ·
`—` no access · `N/A` capability exists only in Phase 2.
Derived from the frontend matrix (`roles.ts`: ADMIN edit-all; PHOTOGRAPHER
archive edit / studio edit / crm view; EDITOR archive edit / website edit;
ASSISTANT studio+crm edit / archive+finance view; ACCOUNTANT finance edit /
crm view / everything else none). Rule applied uniformly: area `edit` ⇒
CUD+P on its Phase 1 domains, `view` ⇒ R, `none` ⇒ —.

| Domain | ADMIN | PHOTOGRAPHER | EDITOR | ASSISTANT | ACCOUNTANT |
|---|---|---|---|---|---|
| Users | M | R | R | R | — (own profile via `/auth/me` only) |
| Clients (+NIF/address) | M | R | — | CUD+R | R |
| Services catalogue | M | R | R | R | — |
| Service Requests | M | R | R | CUD+R | R |
| Tags | M | CUD+R | CUD+R | R | R (via clients) |
| Photos | M | CUD+P | CUD+P | R | — |
| Public gallery curation (publish/feature) | M | P | P | R | — |
| Albums (share/rotate) | M | CUD+P | R | CUD+P | — |
| Uploads (intent+finalize) | M | C | C | — | — |
| Financial data | N/A¹ | N/A¹ | N/A¹ | N/A¹ | N/A¹ |

¹ Financial domain (Documents, Orders, Payments) is Phase 2: no endpoints
exist in Phase 1, so all finance permissions are `NOT APPLICABLE IN PHASE 1`.
ACCOUNTANT's `finance: edit` activates then; in Phase 1 ACCOUNTANT is
effectively read-only (Clients, Requests, Users-via-nothing, Tags-via-clients)
because the frontend establishes no other Phase 1 write for the role.
ASSISTANT's `finance: view` likewise activates in Phase 2.
Note: PHOTOGRAPHER "own work" vs archive-wide edit scope is `DECISION
REQUIRED` (item 8 below) — the matrix above reflects area access, ownership
scoping to be fixed at implementation.

## Unresolved (`DECISION REQUIRED`)

See `docs/ROADMAP.md` § Unresolved decisions (12 items): public portfolio
scope, tag table shape (+ClientTag drop), public service catalogue, lockout
thresholds, SeaweedFS topology/backups, invoice provider, Resend inbound
story, PHOTOGRAPHER photo ownership scope, 2FA scope, Claim vector backend,
Analytics deferral approval, album access-code mandate for WATERMARK/PAID.
