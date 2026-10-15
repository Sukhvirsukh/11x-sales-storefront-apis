# 11xSales Storefront API

Low-latency, read-heavy API called from merchants' storefronts (and their servers). It reads the **same PostgreSQL database as [11xsales-be](../11xsales-be)** and keeps the same layered structure, conventions and response envelope, built so a cached read takes well under a millisecond inside the API.

> Schema ownership stays with 11xsales-be. This service never creates or alters tables (no migrations here); its only write is the batched `api_keys.last_used_at` update.

## Quick start

Requires **Node 20.11+** (22 recommended — the Dockerfile and CI use 22), PostgreSQL and (optionally) Redis.

```bash
npm install
cp .env.example .env   # copy DB_*, JWT_SECRET, INTERNAL_API_TOKEN from 11xsales-be/.env
npm run dev            # http://127.0.0.1:5100  (11xsales-be stays on :5000)
```

| Script | |
| --- | --- |
| `npm run dev` | watch mode (ts-node-dev) |
| `npm run build` / `npm start` | compile to `dist/` / run it |
| `npm run lint` / `typecheck` / `format` | same as 11xsales-be |
| `npm run smoke` | end-to-end checks against a running server (see the header of `scripts/smoke-test.mjs` for the seeded-data variables) |
| `npm run bench` | load test with autocannon (`BENCH_PATH`, `BENCH_WIDGET_KEY`, `BENCH_API_KEY`) |

## Structure

Same layout as 11xsales-be — one file per domain in each layer:

```
src/
  server.ts              boot, optional cluster mode, graceful shutdown
  app.ts                 Fastify instance, security plugins, route mounting
  config/                env (fail-fast), database (pg pools), redis, logger (pino)
  routes/                index.ts (/api/v1), service.routes.ts (/internal/v1), <domain>/<domain>.routes.ts
  controllers/<domain>/  HTTP in/out only
  services/<domain>/     business logic + caching (cache.wrap)
  repositories/<domain>/ SQL — named prepared statements
  models/                row types + mappers for the shared tables
  validations/<domain>/  zod schemas ({ body, params, query }, same as 11xsales-be)
  middlewares/           auth (JWT / API key / widget key / service), validate, errors, request log, rate limit
  utils/                 ApiError, ApiResponse, cache, cache-keys, jwt, token, crypto
```

Responses use 11xsales-be's envelope: `{ success, message, data }` on success, `{ success: false, message, details? }` on error.

## Why it's fast

| Choice | Effect |
| --- | --- |
| **Fastify** instead of Express | several times less framework overhead per request |
| **Raw `pg` + named prepared statements** instead of the ORM | no model hydration; Postgres parses/plans each query once per connection |
| **Two-tier cache** (`utils/cache.ts`): in-process LRU → Redis → Postgres | hot reads never touch the database |
| Single-flight + stale-while-revalidate + negative caching | no stampedes on a cold key, no waiting on refreshes, unknown keys can't hammer Postgres |
| **Compiled response schemas** (`envelopeSchema`) | fast serialization, and undeclared fields are never sent |
| Warm DB pool, keep-alive, statement timeout, optional **read replica** (`DB_READ_HOST`) | no handshake on first requests; slow queries fail fast |
| **pino** logging in a worker thread, one line per request | logging never blocks the event loop |
| Batched `last_used_at` writes, in-memory rate limiting | no extra round trip per request |
| `CLUSTER_WORKERS=auto` | one process per CPU core |

Every response carries `Server-Timing: app;dur=<ms>` (time inside the API) and `X-Request-Id`.

Measured locally (one process, cached reads, client on the same machine): **~56k req/s, p50 < 1 ms, p99 ≈ 2 ms** for `GET /api/v1/storefront/agent` and `GET /api/v1/me` with an API key.

## Authentication

| Credential | Header | For | Checked against |
| --- | --- | --- | --- |
| Widget key | `X-Widget-Key: <agents.widget_key>` | storefront browsers | agent must be `active`; browser `Origin` must be in `widget_allowed_origins` when that list is set |
| API key | `X-API-Key: <raw key>` | merchants' servers | `api_keys.key_hash` (sha256), not revoked — keys are created in 11xsales-be |
| Platform JWT | `Authorization: Bearer <access token>` | dashboard users | HS256 with the shared `JWT_SECRET`; tokens issued by 11xsales-be |
| Service token | `Authorization: Bearer <INTERNAL_API_TOKEN>` | 11xsales-be, sync service | `/internal/v1/*` only; off when unset |

Guards: `authenticate` (JWT) + `authorize('admin')`, `authenticateApiKey`, `authenticateWidget`, `authenticateService`, and `authenticateAny('widget', 'apiKey', 'jwt')` for routes several clients share. Widget keys are public by nature — anything private must require an API key or JWT.

Key and widget lookups are cached for `AUTH_CACHE_TTL_SECONDS` (60). To make a revocation or agent change take effect immediately, call:

```
POST /internal/v1/cache/invalidate        Authorization: Bearer <INTERNAL_API_TOKEN>
{ "keys": ["apikey:<sha256 of key>", "agent:wk:<widget key>"], "prefixes": ["agent:<agent id>:"] }
```

11xsales-be already does this when a chat design is saved or reset (set its `STOREFRONT_API_BASE_URL` to this API's address). Key formats are listed in `src/utils/cache-keys.ts`. Invalidations reach every instance and worker over Redis pub/sub.

Also: helmet, CORS (`*` by default; the per-agent origin check is what's enforced), per-IP rate limit, 1 MB body limit, constant-time secret comparison, credentials redacted from logs, and production refuses to start with a weak `JWT_SECRET`.

## Endpoints

| Method | Path | Auth | |
| --- | --- | --- | --- |
| GET | `/api/v1/health` | — | liveness |
| GET | `/api/v1/health/ready` | — | readiness (DB required, Redis reported) |
| GET | `/api/v1/me` | widget / API key / JWT | who the request authenticated as |
| GET | `/api/v1/storefront/agent` | widget key | the store's public agent profile |
| GET | `/api/v1/storefront/chat-design` | widget key | the chat widget's settings as saved from the dashboard, over the defaults |
| POST | `/internal/v1/cache/invalidate` | service token | drop cache keys/prefixes everywhere |
| GET | `/internal/v1/cache/stats` | service token | hit/miss counters |

## Adding an endpoint

1. **Model** — row type + mapper in `src/models/<table>.model.ts` (JSON-safe output: ISO strings, not `Date`).
2. **Repository** — a named query: `db.read({ name: 'product_by_handle', text: 'SELECT ... WHERE agent_id = $1 AND handle = $2', values })`. Select only the columns you return, and make sure an index covers the `WHERE`.
3. **Service** — wrap the read: `cache.wrap(cacheKeys.x(...), ttl, () => repo.find(...), { staleSeconds })`. Add the key to `cache-keys.ts`, scoped under `agent:<id>:` so one prefix invalidates a store.
4. **Validation** — zod `{ body, params, query }` schema.
5. **Controller** — call the service, return `ApiResponse.ok(...)`.
6. **Route** — register it with `preHandler: [validate(schema)]` and a `schema.response` built with `envelopeSchema(...)`, then mount it in `routes/index.ts`.

## Deployment

Same options as 11xsales-be: `Dockerfile` (port 5100, healthcheck on `/api/v1/health`), `.do/app.yaml` (DigitalOcean App Platform — attach 11xsales-be's database cluster), `deploy/deploy-xsales-storefront.sh` (Forge/Docker Compose with rollback, no migration step), and `.github/workflows/ci.yml` (lint, typecheck, build, boot, smoke test).

Connection budget: each process opens up to `DB_POOL_MAX` connections, so the total is `DB_POOL_MAX × CLUSTER_WORKERS × instances`. Keep that within the cluster's limit alongside 11xsales-be, or put PgBouncer in front.
