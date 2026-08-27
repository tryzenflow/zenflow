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

## Specs

- `settings-tabs.spec.ts` — the tabbed Settings dialog (Insights · Account;
  there is no "Work" tab anymore — `workStart`/`workEnd`/`workDays` were
  dropped from `User` with no replacement); the Insights heatmap
  fetch-on-open / cold-start.
- `deadline-chips-and-create.spec.ts` — the deadline quick-action chip row and
  the direct (no confirm-toast) create flow. A freshly created session is
  always unscheduled — there's no auto-placement engine anymore.
- `edit-and-delete-confirm-toasts.spec.ts` — a deadline edit or a delete is a
  plain write with no cascade/confirm prompt (notes.md triggers 1–3 are
  explicitly deferred, not built).
- `optimize.spec.ts` — the minimal Optimize header button
  (`POST /scheduler/optimize` over a fixed "now → +14 days" window, applied
  immediately with an Undo toast) — no mode picker, no preview step.

> These require the backend stack (Postgres/Redis/MailHog) up, and — for
> `settings-tabs.spec.ts` / `optimize.spec.ts` — the
> `GET /users/me/preference-matrix` and `POST /scheduler/optimize*` endpoints
> wired live.
