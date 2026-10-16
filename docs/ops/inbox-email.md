# Contact inbox for the legal pages

For operators. `/privacy` and `/terms` (the [landing repo](https://github.com/usezenflow/landing), `CONTACT_EMAIL` in `src/config.ts`) list `privacy@usezenflow.com`. Receive it free with Cloudflare Email Routing, forwarding to an inbox you read. App mail (login codes) is separate: Mailgun from `no-reply@usezenflow.com` ([domains.md](domains.md#mail)).

## Receive

Needs the `usezenflow.com` zone on Cloudflare nameservers.

1. Cloudflare > the zone > **Email** > **Email Routing** > **Get started**.
2. **Destination addresses**: add your Gmail and confirm the verification mail.
3. **Routing rules**: create `privacy`, action **Send to an email**, your Gmail.
4. Accept the three `MX` records (`route*.mx.cloudflare.net`). Keep the single apex SPF from [domains.md](domains.md#mail), which already includes Cloudflare.
5. Test from another account. Check spam once and mark it not spam.

### DNS conflict

Setup fails if the apex already has conflicting records. In **DNS**, check the root name only:

- Existing `MX` records, including Mailgun's: delete them, otherwise mail splits between providers.
- More than one SPF `TXT`: allowed only once. Merge into the one in [domains.md](domains.md#mail).

## Reply

- **Simple:** reply from Gmail. The sender shows the Gmail address.
- **As `privacy@usezenflow.com`:** Gmail > Settings > **Accounts** > **Send mail as**. Use `smtp.gmail.com`, port 587, your address and a Google app password (needs 2-step verification). Add `include:_spf.google.com` to the apex SPF before `~all`.

## Go live

The landing site lists the address. It goes live with the next landing deploy, so finish routing first. Then open `https://usezenflow.com/privacy` and `/terms` and send a test mail from outside.
