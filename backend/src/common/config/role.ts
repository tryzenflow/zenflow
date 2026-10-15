import { config } from "dotenv";

/**
 * Process role (ADR-0011, ADR-0007). One image, picked by the `ROLE` env:
 *  - `api`            HTTP only; produces jobs, consumes none, no cron.
 *  - `watcher`        the cron heartbeat (ingestion watcher, reminder sweep,
 *                     retained-sessions, matrix decay); enqueues, never consumes.
 *  - `worker-portal`  consumes every `portal-*` queue.
 *  - `worker-lms`     consumes every `lms-*` queue.
 *  - `worker-notify`  consumes `notify` (push, email, reminder).
 *  - `worker`         watcher + every consumer (the pre-queue single worker).
 *  - `all`            everything incl. HTTP (default; local dev and the test stack).
 * Everything except `api` and `all` serves `/health` and nothing else.
 */
export type Role =
  | "api"
  | "watcher"
  | "worker-portal"
  | "worker-lms"
  | "worker-notify"
  | "worker"
  | "all";

const ROLES: readonly Role[] = [
  "api",
  "watcher",
  "worker-portal",
  "worker-lms",
  "worker-notify",
  "worker",
  "all",
];

/** Every valid `ROLE` value (for the Joi schema). */
export const ROLE_VALUES = ROLES;

/** Local development loads `.env.dev`; production receives its values from Compose. */
export const envFilePath = (
  env: NodeJS.ProcessEnv = process.env,
): string | undefined =>
  env.NODE_ENV === "production" ? undefined : ".env.dev";

/**
 * Resolved before Nest builds the module graph, i.e. before `ConfigModule`
 * reads the env file, so a `ROLE` set only in the file is read from it here.
 * Real environment variables win, as they do in `ConfigModule`.
 */
export function getRole(env: NodeJS.ProcessEnv = process.env): Role {
  if (env === process.env && env.ROLE === undefined) {
    const path = envFilePath(env);
    if (path) config({ path, quiet: true });
  }
  return parseRole(env.ROLE);
}

/** `ROLE` string -> {@link Role}; anything unknown is `all`. */
export function parseRole(value: string | undefined): Role {
  return ROLES.includes(value as Role) ? (value as Role) : "all";
}

/** Names of the consumable queues (see `queue/queues.ts`). */
export type ConsumedQueue =
  | "portal-fetch"
  | "portal-profile"
  | "portal-marks"
  | "portal-discovery"
  | "portal-week"
  | "lms-fetch"
  | "lms-discovery"
  | "lms-month"
  | "notify";

/** Serves the API (controllers, sessions, CORS, Swagger). */
export const runsHttp = (role: Role): boolean =>
  role === "api" || role === "all";

/** Runs the cron heartbeat that enqueues work. */
export const runsWatcher = (role: Role): boolean =>
  role === "watcher" || role === "worker" || role === "all";

/** Whether this role processes jobs from `queue`. */
export function consumesQueue(role: Role, queue: ConsumedQueue): boolean {
  switch (role) {
    case "all":
    case "worker":
      return true;
    case "worker-portal":
      return queue.startsWith("portal-");
    case "worker-lms":
      return queue.startsWith("lms-");
    case "worker-notify":
      return queue === "notify";
    default:
      return false;
  }
}

/** Any background work at all (a watcher or at least one consumer). */
export const runsJobs = (role: Role): boolean => role !== "api";
