# Frontend e2e (Playwright)

End-to-end specs that drive the real UI against a running stack. The browser
issues real HTTP to the backend API, which needs Postgres + Redis + MailHog up
(the local Docker stack — see [../../backend/README.md](../../backend/README.md)).
Logins read the OTP out of MailHog (`helpers/auth.ts`).

## Prerequisites

```bash
# from the repo root, once
pnpm install
pnpm --filter frontend exec playwright install chromium

# bring up the backend stack + MailHog (Docker), then run the API + dev server
# (the Playwright config starts the Vite dev server itself via `webServer`).
```

Env:

| Var | Default | Purpose |
|-----|---------|---------|
| `E2E_BASE_URL` | `http://localhost:5173` | Where the dev server serves the app. |
| `VITE_API_URL` | — | API base the app talks to. |
| `MAILHOG_URL` | `http://localhost:8025` | MailHog HTTP API for OTP retrieval. |
| `E2E_NO_SERVER` | — | Set to skip auto-starting the Vite dev server. |

## Run

```bash
pnpm --filter frontend test:e2e        # headless
pnpm --filter frontend test:e2e:ui     # Playwright UI mode
```

## Specs (Phase-2 transparency UI, issue #13)

- `settings-tabs.spec.ts` — the tabbed Settings dialog (Work · Insights ·
  Account); the Insights heatmap fetch-on-open / cold-start.

> These were authored alongside the Phase-2 frontend slice. They require the
> backend Phase-2 endpoints/metadata to be wired live (the new
> `GET /users/me/preference-matrix` and the reschedule `rationale`). Run them
> once the Docker test stack + MailHog are up.
