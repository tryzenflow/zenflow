import { spawn, type ChildProcess } from "child_process";
import * as http from "http";
import * as os from "os";
import * as path from "path";
import request from "supertest";
import { PrismaClient } from "../../../generated/prisma";

/**
 * Process harness for the queue flow e2e (see `queue-flow.e2e-spec.ts`).
 *
 * Boots the *built* app (`dist/main.js`) once per role, exactly as compose runs
 * it (`ROLE=api|watcher|worker-portal|worker-lms|worker-notify`), next to the
 * fake DLU server, all against the real Postgres / Redis / Mailpit of
 * `compose.test.yml --profile queue`. Children run from the OS temp dir so the
 * dev `.env.dev` is never read: the environment below is the whole config.
 */

const BACKEND = path.resolve(__dirname, "../../..");
const MAIN = path.join(BACKEND, "dist/main.js");
const FAKE_SCRIPT = path.join(BACKEND, "scripts/fake-dlu-server.ts");

export type Role =
  | "api"
  | "watcher"
  | "worker-portal"
  | "worker-lms"
  | "worker-notify";

export const PORTS: Record<Role | "fake", number> = {
  fake: 14100,
  api: 18101,
  watcher: 18102,
  "worker-portal": 18103,
  "worker-lms": 18104,
  "worker-notify": 18105,
};

export const API_URL = `http://127.0.0.1:${PORTS.api}`;
export const FAKE_URL = `http://127.0.0.1:${PORTS.fake}`;
const redisAt = (prefix: string, port: number) => ({
  host: process.env[`${prefix}_HOST`] ?? "127.0.0.1",
  port: Number(process.env[`${prefix}_PORT`] ?? port),
});
const CACHE_REDIS = redisAt("CACHE", 7379);
const RATE_LIMIT_REDIS = redisAt("RATE_LIMIT_CACHE", 7380);
const PUBSUB_REDIS = redisAt("REDIS_PUBSUB", 7382);
export const QUEUE_REDIS = redisAt("QUEUE_REDIS", 7381);
const MAIL_API_URL =
  process.env.MAILHOG_URL ??
  process.env.MAIL_API_URL ??
  "http://127.0.0.1:8025";
const MAIL_SMTP = {
  host: process.env.QUEUE_E2E_SMTP_HOST ?? "127.0.0.1",
  port: process.env.QUEUE_E2E_SMTP_PORT ?? "1025",
};

/** Tuning shared by every process: short, deterministic retry and breaker timings. */
export const TUNING = {
  attempts: 3,
  backoffMs: 1_000,
  breakerFailures: 3,
  breakerOpenMs: 4_000,
  manualWaitMs: 6_000,
  cooldownSec: 4,
};

export interface Proc {
  role: string;
  child: ChildProcess;
  /** Combined stdout/stderr lines (the app logs JSON via pino). */
  output: string[];
  exited: Promise<number | null>;
}

function childEnv(role: Role): NodeJS.ProcessEnv {
  return {
    ...process.env,
    // Not "test": there the pub/sub clients are lazy and never connect
    // (`NotificationPubSub.client`), which would hide the SSE fan-out.
    NODE_ENV: "development",
    ROLE: role,
    PORT: String(PORTS[role]),
    WORKER_PORT: String(PORTS[role]),
    // The compose queue profile publishes cache/rate-limit on 7379/7380; the
    // inherited .env.test values point at the main e2e stack's 6379/6380.
    CACHE_HOST: CACHE_REDIS.host,
    CACHE_PORT: String(CACHE_REDIS.port),
    RATE_LIMIT_CACHE_HOST: RATE_LIMIT_REDIS.host,
    RATE_LIMIT_CACHE_PORT: String(RATE_LIMIT_REDIS.port),
    QUEUE_REDIS_HOST: QUEUE_REDIS.host,
    QUEUE_REDIS_PORT: String(QUEUE_REDIS.port),
    REDIS_PUBSUB_HOST: PUBSUB_REDIS.host,
    REDIS_PUBSUB_PORT: String(PUBSUB_REDIS.port),
    MAIL_HOST: MAIL_SMTP.host,
    MAIL_PORT: MAIL_SMTP.port,
    LMS_URL: FAKE_URL,
    PORTAL_API_URL: FAKE_URL,
    DKHP_API_URL: FAKE_URL,
    DKHP_API_KEY: "fake-dkhp-api-key",
    PORTAL_API_KEY: "fake-api-key",
    INGESTION_ENABLED: "true",
    INGESTION_REQUEST_DELAY_MS: "0",
    INGESTION_BREAKER_FAILURES: String(TUNING.breakerFailures),
    INGESTION_BREAKER_OPEN_MS: String(TUNING.breakerOpenMs),
    INGESTION_BREAKER_MAX_OPEN_MS: String(TUNING.breakerOpenMs),
    QUEUE_JOB_ATTEMPTS: String(TUNING.attempts),
    QUEUE_BACKOFF_MS: String(TUNING.backoffMs),
    SYNC_MANUAL_WAIT_MS: String(TUNING.manualWaitMs),
    SYNC_MANUAL_COOLDOWN_SEC: String(TUNING.cooldownSec),
    OTP_REQUEST_IP_LIMIT: "1000",
    OTP_REQUEST_IP_HOURLY_LIMIT: "1000",
    OTP_VERIFY_IP_LIMIT: "1000",
    OTEL_SDK_DISABLED: "true",
    LOG_LEVEL: "info",
  };
}

export const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Poll `fn` until it returns a truthy value (returned) or the timeout hits. */
export async function until<T>(
  what: string,
  fn: () =>
    | Promise<T | false | null | undefined>
    | T
    | false
    | null
    | undefined,
  timeoutMs = 30_000,
  intervalMs = 250,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await fn();
    if (value) return value;
    if (Date.now() > deadline) {
      throw new Error(`timed out after ${timeoutMs}ms waiting for ${what}`);
    }
    await sleep(intervalMs);
  }
}

function ping(url: string): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.get(url, (res) => {
      res.resume();
      resolve(true);
    });
    req.on("error", () => resolve(false));
    req.setTimeout(1_000, () => {
      req.destroy();
      resolve(false);
    });
  });
}

function track(role: string, child: ChildProcess): Proc {
  const output: string[] = [];
  const onData = (buf: Buffer) => {
    for (const line of buf.toString("utf8").split("\n")) {
      if (line) output.push(line);
    }
  };
  child.stdout?.on("data", onData);
  child.stderr?.on("data", onData);
  const exited = new Promise<number | null>((resolve) =>
    child.once("exit", (code) => resolve(code)),
  );
  return { role, child, output, exited };
}

export async function startRole(role: Role): Promise<Proc> {
  const child = spawn(process.execPath, [MAIN], {
    cwd: os.tmpdir(),
    env: childEnv(role),
  });
  const proc = track(role, child);
  const live =
    role === "api"
      ? `http://127.0.0.1:${PORTS.api}/api/v1/health/live`
      : `http://127.0.0.1:${PORTS[role]}/health/live`;
  await until(`${role} to answer ${live}`, () => ping(live), 60_000);
  return proc;
}

export async function startFake(latencyMs = 0): Promise<Proc> {
  const child = spawn(
    process.execPath,
    [require.resolve("ts-node/dist/bin.js"), FAKE_SCRIPT],
    {
      cwd: BACKEND,
      env: {
        ...process.env,
        TS_NODE_TRANSPILE_ONLY: "true",
        FAKE_DLU_PORT: String(PORTS.fake),
        FAKE_DLU_LATENCY_MS: String(latencyMs),
      },
    },
  );
  const proc = track("fake-dlu", child);
  await until("fake DLU to listen", () => ping(`${FAKE_URL}/_/stats`), 60_000);
  return proc;
}

export async function stop(
  proc: Proc | undefined,
  signal: NodeJS.Signals = "SIGTERM",
): Promise<void> {
  if (!proc || proc.child.exitCode !== null || proc.child.signalCode) return;
  proc.child.kill(signal);
  await Promise.race([proc.exited, sleep(30_000)]);
  if (proc.child.exitCode === null && !proc.child.signalCode) {
    proc.child.kill("SIGKILL");
    await proc.exited;
  }
}

export const hasLine = (proc: Proc, needle: string): boolean =>
  proc.output.some((l) => l.includes(needle));

// ---------------------------------------------------------------------------
// auth + HTTP
// ---------------------------------------------------------------------------

export type Agent = ReturnType<typeof request.agent>;

export interface Student {
  email: string;
  id: string;
  agent: Agent;
  /** `name=value` of the session cookie, for clients that bypass the agent (SSE). */
  cookie: string;
}

async function latestOtp(email: string): Promise<string> {
  return until(
    `OTP mail for ${email}`,
    async () => {
      const res = await fetch(`${MAIL_API_URL}/api/v1/messages?limit=200`);
      const list = (await res.json()) as {
        messages: { ID: string; To: { Address: string }[] }[];
      };
      const msg = list.messages.find((m) =>
        m.To.some((t) => t.Address === email),
      );
      if (!msg) return false;
      const body = (await (
        await fetch(`${MAIL_API_URL}/api/v1/message/${msg.ID}`)
      ).json()) as { Text: string };
      return /\b(\d{6})\b/.exec(body.Text)?.[1] ?? false;
    },
    15_000,
  );
}

/** Real OTP login (mail read from Mailpit); the agent keeps the session cookie. */
export async function signUp(label: string): Promise<Student> {
  const email = `queue-e2e-${label}-${Date.now()}@example.test`;
  const agent = request.agent(API_URL);
  await agent.post("/api/v1/auth/otp/request").send({ email }).expect(200);
  const otp = await latestOtp(email);
  // The passport strategy reads the code from `otp`.
  const res = await agent
    .post("/api/v1/auth/otp/verify")
    .send({ email, otp })
    .expect(200);
  const setCookie = res.headers["set-cookie"] as unknown as string[];
  return {
    email,
    id: (res.body as { data: { id: string } }).data.id,
    agent,
    cookie: setCookie[0].split(";")[0],
  };
}

export async function connect(
  student: Student,
  provider: "PORTAL" | "LMS",
): Promise<void> {
  await student.agent
    .post("/api/v1/integrations")
    .send({ provider, username: "3120410999", password: "not-a-real-password" })
    .expect(201);
}

/** Park a student's schedule rows far in the future so the ticker leaves them alone. */
export async function parkSchedule(
  prisma: PrismaClient,
  student: Student,
): Promise<void> {
  await prisma.ingestionSchedule.updateMany({
    where: { integration: { userId: student.id } },
    data: { nextDueAt: new Date(Date.now() + 30 * 24 * 3_600_000) },
  });
}

/** Minimal SSE client: collects `data:` JSON payloads from `/notifications/stream`. */
export interface Sse {
  events: Record<string, unknown>[];
  ready: Promise<void>;
  close(): void;
}

export function openSse(student: Student): Sse {
  const events: Record<string, unknown>[] = [];
  let req!: http.ClientRequest;
  const ready = new Promise<void>((resolve, reject) => {
    req = http.get(
      `${API_URL}/api/v1/notifications/stream`,
      { headers: { cookie: student.cookie, accept: "text/event-stream" } },
      (res) => {
        if (res.statusCode !== 200) {
          reject(new Error(`SSE answered ${res.statusCode}`));
          return;
        }
        resolve();
        let buf = "";
        res.setEncoding("utf8");
        res.on("data", (chunk: string) => {
          buf += chunk;
          let at: number;
          while ((at = buf.indexOf("\n\n")) >= 0) {
            const frame = buf.slice(0, at);
            buf = buf.slice(at + 2);
            const data = frame
              .split("\n")
              .filter((l) => l.startsWith("data:"))
              .map((l) => l.slice(5).trim())
              .join("");
            if (data) events.push(JSON.parse(data) as Record<string, unknown>);
          }
        });
      },
    );
    req.on("error", reject);
  });
  return { events, ready, close: () => req.destroy() };
}
