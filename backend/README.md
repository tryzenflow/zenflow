# Zenflow API (backend)

For: developers. NestJS service that owns persistence, auth, file storage, task and session CRUD, DLU ingestion and the client to the Python placement service. Start at the [monorepo README](../README.md); system diagrams are in [ARCHITECTURE.md](../ARCHITECTURE.md).

## Tech stack

| Concern | Choice |
| --- | --- |
| Framework | NestJS 11 (Express), TypeScript 5.7 |
| DB | Prisma 6 + PostgreSQL |
| Sessions, cache | Redis via `ioredis` (custom session store, `@nestjs/cache-manager` for cache/OTP) |
| Auth | Passport `local` with email OTP (no passwords) |
| Rate limiting | [LimitKit](https://github.com/alphatrann/limitkit) on its own Redis |
| Validation, docs | `class-validator` global pipe, Swagger at `/api` |
| Mail | `@nestjs-modules/mailer` + Handlebars |
| Tests | Jest (unit `*.spec.ts`, e2e `test/jest-e2e.json`) |
| Shared types | `@zenflow/shared` (the FE/BE contract) |

## Run it

Prerequisites: Node 20+, pnpm 10.32.1, Docker with Compose.

```bash
pnpm install && pnpm shared:build            # repo root, once
docker compose -f compose.dev.yml up -d      # from backend/: Postgres, 2x Redis, bandit, S3 storage, Mailpit
pnpm prisma:dev:migrate
pnpm start:dev                               # http://localhost:8000, Swagger at /api
```

Env: copy `.env.example` to `.env.dev` (and `.env.test`, `.env.staging`, `.env.prod`). Vars: [config.md](../docs/backend/config.md).

```bash
pnpm typecheck           # tsc --noEmit
pnpm lint                # eslint --fix
pnpm test                # unit tests
pnpm test:e2e            # e2e (needs the .env.test DB)
pnpm test:e2e:queue      # BullMQ flow over real role processes; needs `docker compose --profile queue -f compose.test.yml up -d`
pnpm prisma:dev:studio   # browse the DB
pnpm prisma:gen:dev      # regenerate the client into generated/prisma
```

### Staging

`compose.staging.yml` is the fully containerized stack: `api`, one-shot `migrations`, `postgres`, `redis` (sessions/OTP), `redis-ratelimit` ([ADR-0005](../docs/adr/0005-rate-limit-store-lru-rdb.md)), `bandit`, `storage`, `mail` (Mailpit), `nginx` on `:80` and the Grafana stack. `compose.prod.yml` is the same shape without `mail`.

```bash
sh ../build_images.sh                                                  # build context is the repo root
docker compose --env-file .env.staging -f compose.staging.yml up -d    # API via nginx :80, Swagger :80/api
```

- `.env.staging` needs `GRAFANA_ADMIN_PASSWORD`; Grafana binds `127.0.0.1:3000`. Stack details: [observability/README.md](observability/README.md).
- Migrations run in the `migrations` service (`pnpm prisma:migrate:deploy`) before the API starts.
- CI/CD and rollback: [docs/ops/ci-cd.md](../docs/ops/ci-cd.md).

### Production TLS (nginx + certbot)

Config and rationale: [ADR-0010](../docs/adr/0010-nginx-replaces-caddy.md); files in [`nginx/`](nginx/).

- First issuance, once per host, before the first `up`: `LE_EMAIL=you@example.com ./nginx/init-cert.sh`.
- Renewal is the `certbot` service (twice daily, webroot); `nginx` reloads every 12 h to pick the new certificate up. Alert on certificate expiry.
- Upstreams live in `nginx/upstream.api.conf`; edit and `docker compose exec nginx nginx -s reload`.

## Layout

```
backend/
├── prisma/schema.prisma   # schema (client in generated/prisma)
├── src/
│   ├── main.ts            # /api/v1 prefix, CORS, ValidationPipe, Redis session, Swagger
│   ├── auth/  users/  tags/  devices/  mail/  crypto/
│   ├── sessions/          # session CRUD; a create or edit places one TASK (or series)
│   ├── reminders/         # per-session reminder timers
│   ├── scheduler/         # core/ (pure), io/ (Prisma + bandit HTTP), types/
│   ├── bandit/            # HTTP client for services/bandit + per-user (A,b) repo
│   ├── experiments/       # 50/50 policy assignment + SlotProposal
│   ├── ingestion/         # ticker, discovery, watchers, materializer, cache; core/ is pure
│   ├── lms/  portal/      # Moodle and portal/DKHP clients
│   ├── integrations/      # encrypted DLU credentials + login probe + manual sync
│   ├── notifications/     # ingestion inbox, SSE stream, push
│   ├── files/             # multipart upload/download, S3-compatible storage
│   ├── observability/     # metrics, tracing helpers (see tracing.ts)
│   ├── prisma/            # PrismaService + error-code map
│   └── common/            # constants, utils, dto, redis/, rate-limit/, circuit breakers
├── compose.{dev,staging,prod,test}.yml, nginx/, Dockerfile
├── observability/         # Grafana stack config and dashboards
└── scripts/               # golden export, backfill, fake DLU server (pnpm dlu:fake)
```

Layering rule: `scheduler/core/*` and `ingestion/core/*` are pure and deterministic (no Prisma, no clock, no randomness; `now` is passed in). Prisma and HTTP live in `io/*` or the service files. Why: [AGENTS.md](../AGENTS.md).

## Reference

| Doc | Covers |
| --- | --- |
| [docs/backend/api.md](../docs/backend/api.md) | Endpoints, response envelope, error codes, rate limits, fail-open store |
| [docs/backend/data-model.md](../docs/backend/data-model.md) | Tables, Session invariants, indexes |
| [docs/backend/ingestion.md](../docs/backend/ingestion.md) | Ticker, confirm/miss gate, cache, circuit breakers, manual sync |
| [docs/backend/scheduler.md](../docs/backend/scheduler.md) | Python-authoritative placement, degraded mode, reminders, file map |
| [docs/backend/config.md](../docs/backend/config.md) | Every env var with defaults |
| [observability/README.md](observability/README.md) | Traces, metrics, logs, Grafana |
| [docs/architecture/](../docs/architecture/scheduler-flows.md) | Diagrams and sequence flows |
| [docs/adr/](../docs/adr/0003-python-authoritative-placement.md) | Architecture decisions |

Commits follow Conventional Commits; formatting is ESLint + Prettier (2 spaces, double quotes). See [CONTRIBUTING.md](../CONTRIBUTING.md).
