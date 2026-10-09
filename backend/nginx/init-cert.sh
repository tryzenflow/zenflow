#!/usr/bin/env bash
# One-time certificate issuance for production (ADR-0010). Run on the host from
# backend/ BEFORE the first `docker compose up`: nginx cannot start without a
# certificate, so certbot answers the challenge on :80 itself. Renewal then runs
# in the `certbot` service over the nginx webroot.
# Usage: LE_EMAIL=ops@example.com ./nginx/init-cert.sh
set -euo pipefail
: "${LE_EMAIL:?set LE_EMAIL}"
domain="${DOMAIN:-zenflow-api.alphatrann.com}"
docker compose -f compose.prod.yml run --rm -p 80:80 --entrypoint certbot certbot \
  certonly --standalone --non-interactive --agree-tos -m "$LE_EMAIL" -d "$domain"
