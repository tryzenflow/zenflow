/**
 * Raise a fake ingestion notification — for exercising the inbox
 * (`GET /notifications`), the SSE stream (`GET /notifications/stream`) and
 * native push, without a real DLU sync and without touching any cron code.
 *
 *   pnpm --filter backend exec ts-node -r tsconfig-paths/register \
 *     scripts/send-test-notification.ts <userId> [count]
 *
 * Goes through the real `NotificationsService`: writes a `Notification` row
 * (so it shows up in `GET /notifications`) **and** emits `NEW_SESSION` on the
 * emitter — which the SSE controller forwards to any connected client and
 * `PushService` fans out to the user's registered devices.
 *
 * Needs the dev Postgres + Redis up (same as the API). `<userId>` is a
 * `User.id` (uuid) — find yours with `pnpm --filter backend prisma:dev:studio`.
 */
import { NestFactory } from "@nestjs/core";
import type { NotificationKind, NotificationTopic } from "@zenflow/shared";
import { AppModule } from "../src/app.module";
import { NotificationsService } from "../src/notifications/notifications.service";
import { NotificationEvent } from "../src/notifications/types";

interface Sample {
  topic: NotificationTopic;
  kind: NotificationKind;
  title: string;
  content: string;
}

/** Cycled through when `count > 1`, so a run shows every row style at once. */
const SAMPLES: Sample[] = [
  {
    topic: "ASSIGNMENT",
    kind: "NEW",
    title: "New assignment: Sorting Algorithms",
    content: "Added from your LMS. Plan the work that leads up to it.",
  },
  {
    topic: "EXAM",
    kind: "NEW",
    title: "New exam: Midterm — Room A305",
    content: "Added from your portal. Plan revision sessions before it.",
  },
  {
    topic: "TIMETABLE",
    kind: "NEW",
    title: "Timetable for semester 1 is available",
    content: "12 classes were added to your calendar.",
  },
  {
    topic: "TIMETABLE",
    kind: "CHANGE",
    title: "Updated: Databases — Room B210",
    content: "The portal moved this class.",
  },
  {
    topic: "TIMETABLE",
    kind: "DROP",
    title: "Lectures removed: Data Structures Lab",
    content: "These classes were taken off your DLU timetable.",
  },
];

async function main(): Promise<void> {
  const [userId, countRaw] = process.argv.slice(2);
  if (!userId) {
    console.error(
      "usage: ts-node scripts/send-test-notification.ts <userId> [count]",
    );
    process.exit(1);
  }
  const count = Math.max(1, Math.min(20, Number(countRaw) || 1));

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ["log", "warn", "error"],
  });

  try {
    const notifications = app.get(NotificationsService);

    for (let i = 0; i < count; i++) {
      const s = SAMPLES[i % SAMPLES.length];
      const row = await notifications.create(userId, {
        topic: s.topic,
        kind: s.kind,
        title: count > 1 ? `${s.title} (#${i + 1})` : s.title,
        content: s.content,
        sessionId: null,
        eventEndsAt: null,
      });
      notifications.notify(NotificationEvent.NEW_SESSION, row);
      console.log(`raised ${row.id}  ${s.topic}/${s.kind}  "${row.title}"`);
      if (count > 1) await new Promise((r) => setTimeout(r, 800));
    }

    // Give the async SSE forward + push sends a moment before the context tears
    // down (the push handler is fire-and-forget).
    await new Promise((r) => setTimeout(r, 1500));
    console.log(
      `\ndone — ${count} notification(s) for user ${userId}. Check GET /notifications, an open SSE stream, and any registered devices.`,
    );
  } finally {
    await app.close();
  }
}

void main();
