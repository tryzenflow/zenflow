---
"backend": patch
"mobile": patch
---

Uploaded videos play on iOS: `GET /files/:id` now answers byte-range requests (206) and sends `Content-Length` and `Accept-Ranges`. A file that fails to load says so instead of reading like an offline message.
