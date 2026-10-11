---
"backend": patch
---

`GET /health` now also checks object storage (bucket), the SMTP relay, and the kill-switch and pub/sub Redis when they are configured. `/health/ready` is unchanged.
