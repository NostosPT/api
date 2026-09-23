# Nostos API

Fastify 5 + Prisma 7 (PostgreSQL) + S3 API for the Nostos photographic archive and studio.

## Quick start (everything in Docker)

```bash
ADMIN_EMAIL=you@nostos.pt ADMIN_PASSWORD='a-long-password' docker compose up --build
```

| Service    | What it does                                                        | Port |
| ---------- | ------------------------------------------------------------------- | ---- |
| `postgres` | PostgreSQL 18                                                       | 5432 |
| `s3`       | SeaweedFS, an S3-compatible store for local dev                     | 8333 |
| `migrate`  | One-shot: `prisma migrate deploy`, creates the bucket, seeds admin | –    |
| `api`      | The API (bundled, ~no dependencies, non-root)                       | 3000 |

`curl localhost:3000/health/ready` → `{"status":"ok", ...}`

## Local development (API on the host)

```bash
cp .env.example .env
docker compose up -d postgres s3
pnpm install
pnpm db:migrate        # apply/create migrations
pnpm storage:init      # create the bucket
pnpm db:seed           # first admin from ADMIN_EMAIL / ADMIN_PASSWORD
pnpm dev
```

Schema changes: edit `prisma/schema.prisma`, then `pnpm db:migrate --name <change>`.

## Layout

```
src/
  app.ts, server.ts   Fastify setup and entry point
  config/             Env validation (zod)
  db/                 Prisma client
  storage/            S3 client, presigned URLs
  auth/               Password hashing, sessions, auth plugin, /auth routes
  users/              Staff accounts (admin only)
  photos/             Staff photo management + uploads
  albums/             Staff album management
  archive/            Public read-only archive (photos, albums, categories)
  clients/            Studio clients
  services/           Studio services (public list, admin CRUD)
  galleries/          Private client galleries: staff routes + client access
  health/             Liveness/readiness
prisma/               Schema, migrations, seed
scripts/              storage-init
```

## Data model

- **Photo**: an archive photograph. `number` is the public Photo ID (`Nº 482`, see `/archive/photos/482`). Stores S3 **keys** (`originalKey`, `displayKey`, `thumbnailKey`), never URLs.
- **Album**: a public, curated collection of photos (ordered).
- **Client**: someone commissioning work through the Studio.
- **Service**: a Studio offering with an estimated price range.
- **Gallery**: a private delivery gallery for a client (optionally linked to a service), shared by link plus an optional access code. Clients can mark favourites (`selected`).
- **User / Session**: staff accounts (`ADMIN`, `PHOTOGRAPHER`).

## Images and S3

The bucket is **private**. The API never streams image bytes:

1. **Upload**: `POST /photos/uploads {contentType}` returns `{key, uploadUrl}`. The browser `PUT`s the file straight to S3, then calls `POST /photos {originalKey: key, ...}`.
2. **Read**: responses include short-lived presigned URLs (`S3_URL_TTL_SECONDS`, default 15 min).
   - Public archive: `display`/`thumbnail` renditions only. **Originals are never exposed.**
   - Client galleries: the original is included only when `allowDownload` is on.

Local dev uses SeaweedFS. For AWS, remove `S3_ENDPOINT`, `S3_PUBLIC_ENDPOINT` and `S3_FORCE_PATH_STYLE`, set real credentials, and add a CORS rule on the bucket that allows `PUT`/`GET` from the site origin.

> Not built yet: generating `display`/`thumbnail` renditions and the watermark (e.g. `sharp` in a worker or an S3-triggered Lambda). Until then, set `displayKey` manually. Public photos without one have no URLs.

## Authentication

Two audiences, two mechanisms:

**Staff (admins, photographers): email + password, server-side sessions**
- Passwords are hashed with argon2id (Node's built-in `crypto.argon2`, OWASP parameters, PHC string format).
- Login sets an `httpOnly`, `SameSite=Lax` cookie (`Secure` in production) containing a random 256-bit token. Only its SHA-256 is stored in `Session`, so a database leak doesn't expose usable sessions.
- Sessions slide (30 days by default) and can be revoked instantly: logout, a password change or a role change removes them. JWTs can't be revoked like this, and they add nothing for a first-party website.
- `/auth/login` is rate-limited, and unknown emails take the same time as wrong passwords.
- Guards: `app.requireAuth` and `app.requireRole("ADMIN")`.

**Clients: no accounts**
- A gallery has an unguessable slug (`/g/:slug`) and an optional access code (hashed like a password).
- A correct code sets a signed, gallery-scoped cookie for 7 days. Unlock attempts are rate-limited.
- An admin can rotate the link (`POST /galleries/:id/rotate-link`) or change or remove the code.

Deploy the website and API on the same site (e.g. `nostos.pt` and `api.nostos.pt`) so cookies work with `SameSite=Lax`. The frontend must send `credentials: "include"`.

## Endpoints

| Area            | Routes                                                                                                  | Access |
| --------------- | ------------------------------------------------------------------------------------------------------- | ------ |
| Auth            | `POST /auth/login`, `POST /auth/logout`, `GET /auth/me`                                                   | –      |
| Users           | `GET/POST /users`, `PATCH/DELETE /users/:id`                                                              | Admin  |
| Photos          | `POST /photos/uploads`, `GET/POST /photos`, `GET/PATCH/DELETE /photos/:id`                                | Staff  |
| Albums          | `GET/POST /albums`, `GET/PATCH/DELETE /albums/:id`, `PUT /albums/:id/photos`                              | Staff  |
| Clients         | `GET/POST /clients`, `GET/PATCH/DELETE /clients/:id`                                                      | Staff  |
| Services        | `GET /services` (public), `GET /services/all`, `POST /services`, `PATCH/DELETE /services/:id`             | Admin  |
| Galleries       | `GET/POST /galleries`, `GET/PATCH/DELETE /galleries/:id`, `PUT /galleries/:id/photos`, `POST /galleries/:id/rotate-link` | Staff |
| Archive         | `GET /archive/photos`, `GET /archive/photos/:number`, `GET /archive/categories`, `GET /archive/albums[/:slug]` | Public |
| Client gallery  | `GET /g/:slug`, `POST /g/:slug/unlock`, `GET /g/:slug/photos`, `PUT /g/:slug/photos/:photoId/selection`   | Link + code |
| Health          | `GET /health/live`, `GET /health/ready`                                                                   | Public |

## Production checklist

- `COOKIE_SECRET`: a long random value (`openssl rand -base64 48`); `COOKIE_SECURE=true`.
- `CORS_ORIGINS`: the real site origin(s).
- Run the `migrate` image (or `pnpm db:deploy`) before starting a new API version.
- Run behind a TLS-terminating proxy (`trustProxy` is on when `NODE_ENV=production`).
