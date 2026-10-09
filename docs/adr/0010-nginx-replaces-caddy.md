# ADR-0010: nginx replaces Caddy as the reverse proxy

**Status:** accepted
**Date:** 2026-10-09
**Issue:** #131

## Context
- Caddy is a thin pass-through here (`backend/Caddyfile.{prod,staging}`: redirect to HTTPS and `reverse_proxy api:5000` with automatic certificates). The frontend is not served by it.
- We want finer, more familiar control over the proxy (upstream lists, timeouts, buffering, graceful reloads) and a switch point for [blue-green deploys](0013-blue-green-deploy.md) and several API replicas.

## Decision
Replace the `caddy` service with `nginx` in `backend/compose.prod.yml` and `compose.staging.yml`; add `backend/nginx/nginx.{prod,staging}.conf`.
- Keep `X-Forwarded-For/Proto/Host`: the app relies on `trust proxy 1` and Secure cookies.
- SSE on `/notifications/stream`: no proxy buffering, long read timeout, HTTP/1.1, empty `Connection`.
- HTTP/2, gzip, upstream `keepalive`; the upstream list comes from an included file that the deploy script rewrites, followed by `nginx -s reload` (graceful; `worker_shutdown_timeout` drains SSE).
- TLS: certbot (renew loop) or an origin certificate; issued outside the request path.
- Rate limiting stays in the app (Redis); HTTP/3 is dropped.

## Consequences
- Certificate issuance and renewal are now our job and need an alert on expiry.
- Docker DNS names resolve only at nginx start, so upstreams are fixed names per colour or use a resolver with a variable.
- `scripts/deploy/deploy.sh`, `backend/README.md`, `backend/observability/README.md` and `loadtest/staging/orchestrate.js` change.
