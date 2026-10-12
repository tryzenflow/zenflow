---
"backend": minor
"frontend": minor
"mobile": minor
"@zenflow/shared": minor
"@zenflow/core": minor
---

Files linked from a note are deleted when no session references them any more: after a session is
deleted, a series is removed or shrunk, or an edit drops them, while a file shared with another session
is kept. Mobile deletes files uploaded in a form that is cancelled or saved without them, saves every
upload as a link (images still render inline when viewing), and the description editor gains undo and
redo. Timetables sync every 12 hours in production.
