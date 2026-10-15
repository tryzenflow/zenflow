# Daily push

Morning brief and evening check-in (issue #255). Settings are on `User`
(`morningBriefTime`, `eveningCheckinTime`; `null` = off, both off by default).

## Flow

- `DailyPushSweepService` (watcher, every minute) finds opted-in users and
  queues a `notify` job `type: "daily"` per due push and provider.
- Job id `daily_<kind>_<userId>_<localDate>_<provider>`: one push per user per
  local day, however often the sweep runs.
- A push is due from its fire time for 60 minutes, and today and yesterday are
  both checked, so a restart does not lose a push.
- `DailyPushService.deliver` builds the message when the job runs and sends it
  through `PushService.sendMessage` (devices, pruning, provider breakers).

## Time

- Times are wall-clock `HH:mm` in the account timezone (`User.timezone`).
- `zonedToUtc` resolves them per day: DST-safe. A time in a spring-forward gap
  fires at the first valid instant after it. A repeated fall-back time fires at
  its first occurrence.

## Content

- Morning: classes (`LECTURE`, `EXAM`) and study blocks (`TASK`,
  `ASSIGNMENT`) that are not skipped, with the first item. No push when the day
  is empty.
- Evening: today's items not yet done or skipped, as session ids in the
  `sessionIds` data key (at most 12). No push when none are left.
- A day with a DND block overlapping it sends neither push.

## Check-in actions

- Buttons `done` and `missed` (category `daily_checkin`) call
  `POST /sessions/:id/complete` and `POST /sessions/:id/skip`.
- Android: the buttons run `lib/daily-checkin-task.ts` in the background, using
  the stored session cookie.
- iOS: the buttons open the app, and the same handler applies them in the
  foreground (no background call on iOS for action buttons).
