---
"backend": minor
"frontend": minor
"mobile": minor
"@zenflow/shared": minor
"@zenflow/core": minor
---

Notes now store file ids and the API signs file URLs at read time; mobile resolves origin-relative file
refs in notes. Backend moves notifications and ingestion onto BullMQ queues with a runtime kill switch,
partitions `SessionEvent` monthly, re-cuts the six placement arms, serves the API behind nginx on port 8000
and disables Swagger in production.
