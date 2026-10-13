# Contact inbox for the legal pages

For operators. `/privacy` and `/terms` list `LEGAL_CONTACT_EMAIL` (`privacy@alphatrann.com`) as the address for data requests and questions. This sets up receiving mail there for free with Cloudflare Email Routing, which forwards to an inbox you already read. Menu names change; the path below is as of writing.

Mail for the app itself (login codes) is a separate setup: it is sent through Mailgun from `zenflow.alphatrann.com`. Nothing here touches it.

## Receive: Cloudflare Email Routing

Needs the `alphatrann.com` zone on Cloudflare's nameservers.

1. Cloudflare dashboard > the `alphatrann.com` zone > **Email** > **Email Routing** > **Get started**.
2. **Destination addresses**: add the Gmail you read and confirm the verification mail Cloudflare sends it.
3. **Routing rules** > create address `privacy` > action **Send to an email** > that Gmail.
4. Accept the DNS records Cloudflare offers: three `MX` records (`route*.mx.cloudflare.net`) and an SPF `TXT` at `alphatrann.com`.
5. Test: mail `privacy@alphatrann.com` from another account; it arrives in the Gmail (check spam once, and mark it not spam).

### If setup reports a DNS conflict

Cloudflare refuses to add its records when the apex already has others. Open **DNS** for the zone and look at the `alphatrann.com` (root) name only:

- **Existing `MX` records** (from a previous host or a registrar default): delete them if you do not use that mailbox, otherwise mail is split between two providers. This is the usual conflict.
- **More than one SPF `TXT`** (`v=spf1 ...`): a domain may have exactly one. Merge into a single record, e.g. `v=spf1 include:_spf.mx.cloudflare.net ~all`; add other `include:`s from the old record before `~all`.
- Records on `zenflow.alphatrann.com` (Mailgun's SPF, DKIM and tracking `CNAME`s) are on a different name and are not affected; leave them alone.

## Reply

- **Simplest:** reply from the Gmail normally. The sender shows as the Gmail address, which is fine for a privacy contact.
- **As `privacy@alphatrann.com`:** Gmail > Settings > **Accounts** > **Send mail as** > add `privacy@alphatrann.com` using `smtp.gmail.com`, port 587, your Gmail address and a Google **app password** (needs 2-step verification). Then add `include:_spf.google.com` to the apex SPF record, so replies pass SPF. (Mailgun is not used here: it is set up for `zenflow.alphatrann.com`, so mail from the apex would fail its alignment checks.)

## Turn it on in the app

`backend/env/prod.env` already has `LEGAL_CONTACT_EMAIL=privacy@alphatrann.com`. It goes live with the next prod deploy, so finish the routing first or the pages will list an address that bounces. Afterwards open `https://zenflow.alphatrann.com/privacy` and `/terms`, and send one test mail to the address from outside.
