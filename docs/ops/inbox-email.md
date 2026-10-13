# Contact inbox for the legal pages

For operators. `/privacy` and `/terms` list `LEGAL_CONTACT_EMAIL` (`privacy@alphatrann.com`). Receive it free with Cloudflare Email Routing, forwarding to an inbox you read. App mail (login codes) is separate: Mailgun from `zenflow.alphatrann.com`.

## Receive

Needs the `alphatrann.com` zone on Cloudflare nameservers.

1. Cloudflare > the zone > **Email** > **Email Routing** > **Get started**.
2. **Destination addresses**: add your Gmail and confirm the verification mail.
3. **Routing rules**: create `privacy`, action **Send to an email**, your Gmail.
4. Accept the DNS records: three `MX` (`route*.mx.cloudflare.net`) and an SPF `TXT` at `alphatrann.com`.
5. Test from another account. Check spam once and mark it not spam.

### DNS conflict

Setup fails if the apex already has records. In **DNS**, check the root name only:

- Existing `MX` records: delete them if unused, otherwise mail splits between providers.
- More than one SPF `TXT`: allowed only once. Merge into one, for example `v=spf1 include:_spf.mx.cloudflare.net ~all`, keeping old `include:`s before `~all`.
- Records on `zenflow.alphatrann.com` (Mailgun) are unaffected.

## Reply

- **Simple:** reply from Gmail. The sender shows the Gmail address.
- **As `privacy@alphatrann.com`:** Gmail > Settings > **Accounts** > **Send mail as**. Use `smtp.gmail.com`, port 587, your address and a Google app password (needs 2-step verification). Add `include:_spf.google.com` to the apex SPF. Mailgun fails alignment for the apex.

## Go live

`backend/env/prod.env` already sets `LEGAL_CONTACT_EMAIL`. It goes live with the next prod deploy, so finish routing first. Then open `/privacy` and `/terms` and send a test mail from outside.
