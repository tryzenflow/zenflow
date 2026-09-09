/**
 * Raise fake ingestion notifications against a RUNNING API server — for
 * exercising the inbox (`GET /notifications`), the SSE stream
 * (`GET /notifications/stream`) and native push, without a real DLU sync and
 * without touching any cron code.
 *
 *   pnpm --filter backend exec ts-node scripts/send-test-notification.ts <userId> [count]
 *
 * This POSTs to the dev-only `POST /notifications/dev/raise`, which runs the
 * `NotificationsService.create` + emit **inside the API process**. That matters:
 * a standalone script boots its own Nest context whose in-memory event emitter
 * has no SSE subscribers, so emitting there writes the DB row but never reaches
 * a connected browser. Point `API_URL` at the server if it is not on :5000.
 *
 * Needs `pnpm --filter backend start:dev` up (with the dev Postgres + Redis).
 * `<userId>` is a `User.id` (uuid) — find yours with
 * `pnpm --filter backend prisma:dev:studio`. Refused when NODE_ENV=production.
 */
const API_URL = process.env.API_URL ?? "http://localhost:5000";

interface RaiseResponse {
  success: boolean;
  message: string;
  data?: { id: string; topic: string; kind: string; title: string }[];
}

async function main(): Promise<void> {
  const [userId, countRaw] = process.argv.slice(2);
  if (!userId) {
    console.error(
      "usage: ts-node scripts/send-test-notification.ts <userId> [count]",
    );
    process.exit(1);
  }
  const count = Math.max(1, Math.min(20, Number(countRaw) || 1));

  const url = `${API_URL}/api/v1/notifications/dev/raise`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId, count }),
    });
  } catch (err) {
    console.error(`could not reach ${url} — is \`start:dev\` running?`);
    console.error(err);
    process.exit(1);
  }

  const body = (await res.json().catch(() => ({}))) as Partial<RaiseResponse>;
  if (!res.ok || !body.success) {
    console.error(`failed (${res.status}): ${body.message ?? res.statusText}`);
    process.exit(1);
  }

  for (const row of body.data ?? []) {
    console.log(`raised ${row.id}  ${row.topic}/${row.kind}  "${row.title}"`);
  }
  console.log(
    `\ndone — ${body.data?.length ?? count} notification(s) for user ${userId}. ` +
      `Check GET /notifications, an open SSE stream, and any registered devices.`,
  );
}

void main();
