# Domains and mail

For operators. Public hosts, the DNS records behind them and the cutover to `usezenflow.com`. The zone is on Cloudflare nameservers.

## Hosts

| Host | Serves | Record | Certificate (`nginx/init-cert.sh`) |
| --- | --- | --- | --- |
| `usezenflow.com` | Landing, `/privacy`, `/terms` (Nest via nginx) | `A` to the VPS, DNS only | `DOMAIN=usezenflow.com,www.usezenflow.com` |
| `www.usezenflow.com` | 301 to the apex | `A` to the VPS, DNS only | same as apex |
| `api.usezenflow.com` | Nest API | `A` to the VPS, DNS only | default (`api.usezenflow.com`) |
| `app.usezenflow.com` | Web PWA (Netlify) | `CNAME` to the Netlify site, DNS only | Netlify |
| `grafana.usezenflow.com` | Grafana | `A` to the VPS, DNS only | `DOMAIN=grafana.usezenflow.com` |
| `minio.alphatrann.com` | MinIO console | unchanged | `DOMAIN=minio.alphatrann.com` |

Keep VPS records DNS only (grey cloud): certbot renews over the nginx webroot on port 80. Server blocks: `backend/nginx/nginx.prod.conf`.

## Mail

| Address | Role | Provider |
| --- | --- | --- |
| `no-reply@usezenflow.com` | Login codes (`MAIL_FROM`) | Mailgun, SMTP user `postmaster@usezenflow.com` |
| `alerts@usezenflow.com` | Grafana alerts (`GRAFANA_SMTP_FROM`) | Mailgun, same SMTP user |
| `privacy@usezenflow.com` | `LEGAL_CONTACT_EMAIL` | Cloudflare Email Routing ([inbox-email.md](inbox-email.md)) |

Records at `usezenflow.com`:

- **SPF:** one `TXT` at the apex: `v=spf1 include:_spf.mx.cloudflare.net include:mailgun.org ~all`.
- **DKIM:** the `TXT` Mailgun shows for the domain (for example `pic._domainkey`), DNS only.
- **DMARC:** `TXT` at `_dmarc`: `v=DMARC1; p=none; rua=mailto:privacy@usezenflow.com`. Move to `p=quarantine` once a week of reports passes.
- **MX:** Cloudflare Email Routing only. Skip the Mailgun MX records; sending does not need them.
- **Tracking:** turn click and open tracking off in Mailgun so no `email` CNAME is needed.

## Cutover

1. Lower the TTL on `zenflow.alphatrann.com` a day ahead.
2. Create the `A` records for the apex, `www`, `api` and `grafana`, and the `app` `CNAME`.
3. Add `app.usezenflow.com` as the Netlify custom domain and wait for its certificate.
4. On the VPS, with the current nginx running, issue the three new certificates (table above).
5. Mailgun: add domain `usezenflow.com`, publish SPF and DKIM, wait for verified. Create the SMTP password for `postmaster@usezenflow.com`.
6. Write it to Vault: `MAIL_PASSWORD` in `api` and `GF_SMTP_PASSWORD` in `grafana` ([vault.md](vault.md)).
7. Cloudflare Email Routing for `privacy@` ([inbox-email.md](inbox-email.md)), then publish DMARC.
8. Deploy the backend (nginx, `backend/env/prod.env`, Grafana). Check each host over HTTPS and send a login code to a `dlu.edu.vn` inbox.
9. Deploy the web app to Netlify, then cut a mobile release (it defaults to `api.usezenflow.com`).
10. Remove the `zenflow.alphatrann.com` record and its certificate (`certbot delete --cert-name zenflow.alphatrann.com` in the `certbot` service). APKs built before the move stop working.
11. Remove the `grafana.alphatrann.com` record and its certificate (`certbot delete --cert-name grafana.alphatrann.com` in the `certbot` service).
