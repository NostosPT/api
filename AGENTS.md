# AI Agent Guidelines — Nostos API

These instructions apply to all AI models, coding agents, automated tools, and contributors working on the Nostos API.

The API is the backend for Nostos. It must be treated as an independent, production-oriented service with explicit contracts, server-side security, strong typing, and a clear database boundary.

---

## 1. Repository Safety

* Never work directly on `main`.
* Never commit directly to `main`.
* Always verify the current branch before modifying files:

```bash
git branch --show-current
```

* All work must happen on a dedicated `feat/`, `fix/`, `chore/`, or `refactor/` branch.
* Never force-push or rewrite shared history unless explicitly requested.
* Never discard existing uncommitted user changes.

---

## 2. Read Before Changing

Before implementation:

1. Read this `AGENTS.md`.
2. Inspect the complete repository structure.
3. Inspect `package.json` and configuration.
4. Inspect the current database layer and migrations.
5. Inspect existing routes, services, schemas, types, middleware, and tests.
6. Inspect environment configuration and examples.
7. Inspect the Nostos frontend contract when relevant.
8. Search for existing implementations before creating new ones.

Never assume that an endpoint, table, model, environment variable, service, or abstraction exists.

---

## 3. Plan Before Implementation

Non-trivial architectural work must begin in PLAN mode.

The plan must identify:

* current architecture;
* proposed architecture;
* affected files;
* new files;
* database changes;
* API contract changes;
* security implications;
* dependencies;
* migrations;
* tests;
* unresolved decisions.

Do not implement a major architectural change until the plan has been reviewed when explicit approval is requested.

Never invent missing requirements.

---

## 4. Scope

Only modify what is required for the current task.

Do not:

* perform unrelated refactors;
* upgrade unrelated dependencies;
* redesign frontend UI;
* invent API endpoints;
* invent database fields without justification;
* introduce duplicate abstractions;
* silently fix unrelated issues.

Discovered problems outside the current scope should be reported separately.

---

## 5. Architecture

The preferred backend stack is:

* Node.js
* TypeScript
* Fastify
* PostgreSQL
* Prisma

However, existing code must be audited before these technologies are introduced or migrated to.

Do not use Prisma and Drizzle simultaneously for the same database unless a specific, documented architectural requirement justifies it.

Prefer a clear separation:

```text
HTTP / Routes
      ↓
Validation
      ↓
Application / Services
      ↓
Repositories / Data Access
      ↓
Prisma
      ↓
PostgreSQL
```

Do not couple route handlers directly to database implementation when a service boundary is appropriate.

---

## 6. API Contracts

The API is a stable contract between Nostos and the backend.

Before creating or changing an endpoint:

* inspect existing consumers;
* inspect existing types;
* define request validation;
* define response shape;
* define authentication requirements;
* define authorization requirements;
* define expected errors.

Never expose database models directly as an accidental API contract.

Use explicit DTOs/schemas where appropriate.

Do not return sensitive fields merely because they exist in the database.

---

## 7. Database

PostgreSQL is the preferred database for the Nostos API.

Prisma should be the primary ORM/data-access layer unless the architecture review identifies a concrete reason otherwise.

Database schema must be designed deliberately.

Consider:

* primary keys;
* foreign keys;
* unique constraints;
* indexes;
* nullable fields;
* enums;
* timestamps;
* deletion behavior;
* ownership;
* ordering;
* visibility;
* state transitions;
* transaction boundaries.

Never make destructive schema changes without explicit approval.

Never delete or overwrite production data as part of development work.

Database migrations must be explicit, reviewable, and reversible where practical.

---

## 8. Domain Modeling

The conceptual model in `docs/database/initial-model.mmd` is not authoritative.

It is an initial proposal only.

Before converting it into Prisma models, critically review:

* Users and roles;
* Clients;
* Services;
* Service Requests;
* Albums;
* Photos;
* Gallery;
* Tags;
* Payments;
* Uploads/storage;
* ownership;
* visibility;
* publication state;
* relationships;
* ordering.

Do not preserve a flawed relationship merely because it exists in the initial model.

Do not add domain entities without a demonstrated requirement.

---

## 9. Authentication & Authorization

Authentication must be server-side.

Never trust:

* client-provided roles;
* client-provided permissions;
* client-side session state;
* hidden UI controls.

The browser must never receive server secrets.

The final authentication architecture must define a single clear session boundary between:

```text
Nostos SvelteKit
        ↓
Nostos API
        ↓
PostgreSQL
```

Do not introduce JWT, session storage, or another authentication mechanism without explicit architectural approval.

Passwords must never be stored in plaintext.

Do not log passwords, tokens, session secrets, or authentication credentials.

Authorization must be enforced server-side for every protected resource.

---

## 10. Security

Validate all untrusted input server-side.

Never trust:

* request bodies;
* query parameters;
* URL parameters;
* headers;
* cookies;
* filenames;
* MIME types;
* file extensions;
* IDs;
* prices;
* roles;
* permissions.

Use appropriate:

* input validation;
* authentication;
* authorization;
* rate limiting where appropriate;
* CORS;
* security headers;
* error handling;
* logging without sensitive data exposure.

Never return stack traces, secrets, database credentials, or internal implementation details to clients in production.

---

## 11. Uploads

Uploads must eventually support:

* JPEG;
* PNG;
* WebP;
* RAW.

Maximum file size:

```text
50 MB
```

Server-side validation must not rely exclusively on:

* filename extension;
* browser `accept`;
* client-provided MIME type.

Validate actual file content/magic bytes.

Reject unsupported active formats such as SVG unless explicitly required.

Filenames must be treated as untrusted input.

Storage must separate private originals from public derivatives where appropriate.

Do not expose private originals through predictable public URLs.

The storage provider is currently undecided. Do not hard-code a storage provider without approval.

---

## 12. Environment & Secrets

Never commit real secrets.

Server-only environment variables must remain server-side.

When adding an environment variable:

* document its purpose;
* identify whether it is public or server-only;
* provide a safe example where appropriate.

Never log environment secrets.

---

## 13. TypeScript

Use strict, explicit types.

Avoid `any`.

Prefer:

* explicit request/response types;
* typed errors;
* typed database access;
* schema validation;
* existing project conventions.

Do not suppress compiler or linter errors without understanding the cause.

---

## 14. Dependencies

Do not add dependencies without a reason.

Before adding a dependency:

1. Check whether the repository already provides the functionality.
2. Check whether an existing dependency can solve it.
3. Evaluate whether the dependency is appropriate for the architecture.
4. Keep dependency changes isolated.

Do not perform unrelated dependency upgrades.

Keep `package.json` and `pnpm-lock.yaml` synchronized.

---

## 15. Testing

After implementation, run relevant checks.

When available:

```bash
pnpm check
pnpm lint
pnpm test
pnpm build
```

Security-sensitive changes must include appropriate negative tests.

Examples:

* unauthenticated request;
* unauthorized role;
* invalid input;
* malformed ID;
* oversized upload;
* invalid file;
* missing required field;
* invalid session;
* forbidden resource access.

Never claim a test passed unless it was actually executed.

---

## 16. Git Commits

Commits must be atomic and logically scoped.

Do not impose an artificial file-count limit.

A single logical change may legitimately modify multiple files.

Commit messages must be exactly one line.

Examples:

```text
feat: add service request domain
fix: reject unsupported upload formats
chore: migrate database layer to prisma
```

Never add:

```text
Co-authored-by:
```

or AI attribution trailers.

---

## 17. Pull Requests

Before creating a PR:

* inspect the complete diff;
* verify the branch;
* run relevant checks;
* confirm no secrets are included;
* confirm no unrelated changes are included;
* verify migrations;
* verify API contracts;
* document breaking changes.

Do not merge automatically unless explicitly requested.

---

## 18. Stop Conditions

Stop and ask for clarification when:

* required API contracts are unknown;
* required database information is unavailable;
* a migration could cause data loss;
* authentication architecture is ambiguous;
* storage requirements cannot be determined safely;
* implementation would require significant out-of-scope changes;
* the existing code contradicts the requested architecture.

Do not guess when guessing could create security, data, or architectural problems.

---

## 19. Operating Principle

Follow:

```text
Inspect → Plan → Approve → Implement → Verify → Review → Commit
```

The objective is not to write the most code.

The objective is to build the smallest correct, secure, maintainable API that can serve the Nostos frontend reliably.
