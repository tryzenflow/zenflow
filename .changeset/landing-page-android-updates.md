---
"backend": patch
"mobile": patch
---

New landing page at zenflow.alphatrann.com with a download link, FAQ and share cards. Android builds are
now signed with a release key and offer new versions inside the app. Onboarding is shorter: name, campus
connect, notifications. Empty days offer "Import my timetable", and the second slot in the A/B pick reads
"thay thế" in Vietnamese.
The landing page shows the Linh thú spirits in place of the Blips, defaults to Vietnamese, and drops the
placeholder testimonials and counters. Connecting a DLU account prefills your student ID and accepts only your own.
Behind Cloudflare and nginx the API trusts two proxy hops, so rate limits key on the real client IP.
