#!/usr/bin/env bash
# One-time certificate issuance for production (ADR-0010). Run on the host from
# backend/ BEFORE the first `docker compose up`: nginx cannot start without a
# certificate, so certbot answers the challenge on :80 itself. Renewal then runs
# in the `certbot` service over the nginx webroot.
# Usage: LE_EMAIL=ops@example.com ./nginx/init-cert.sh
#        LE_EMAIL=... DOMAIN=grafana.alphatrann.com ./nginx/init-cert.sh   # one cert per host
# If nginx is already running (adding a host to a live stack) the webroot method is used
# instead, so :80 stays up. Point the host's DNS A record here first. Issue the Grafana
# cert BEFORE deploying an nginx.prod.conf that references it, or nginx will not start.
set -euo pipefail
: "${LE_EMAIL:?set LE_EMAIL}"
domain="${DOMAIN:-zenflow-api.alphatrann.com}"
if [ -n "$(docker compose -f compose.prod.yml ps -q --status running nginx)" ]; then
  docker compose -f compose.prod.yml run --rm --entrypoint certbot certbot \
    certonly --webroot -w /var/www/certbot --non-interactive --agree-tos -m "$LE_EMAIL" -d "$domain"
else
  docker compose -f compose.prod.yml run --rm -p 80:80 --entrypoint certbot certbot \
    certonly --standalone --non-interactive --agree-tos -m "$LE_EMAIL" -d "$domain"
fi
