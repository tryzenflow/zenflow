import { config } from "dotenv";

/**
 * Process role (ADR-0011). One image, picked by the `ROLE` env:
 *  - `api`    HTTP only; registers no cron, ticker or reminder timer.
 *  - `worker` scheduled work only; serves `/health` and nothing else.
 *  - `all`    both (default; local dev and the test stack).
 */
export type Role = "api" | "worker" | "all";

/** The env file `ConfigModule` loads; ROLE must be resolvable from it too. */
export const envFilePath = (env: NodeJS.ProcessEnv = process.env): string =>
  env.NODE_ENV === "production" ? ".env.prod" : ".env.dev";

/**
 * Resolved before Nest builds the module graph, i.e. before `ConfigModule`
 * reads the env file, so a `ROLE` set only in the file is read from it here.
 * Real environment variables win, as they do in `ConfigModule`.
 */
export function getRole(env: NodeJS.ProcessEnv = process.env): Role {
  if (env === process.env && env.ROLE === undefined) {
    config({ path: envFilePath(env), quiet: true });
  }
  const role = env.ROLE;
  return role === "api" || role === "worker" ? role : "all";
}

export const runsHttp = (role: Role): boolean => role !== "worker";
export const runsJobs = (role: Role): boolean => role !== "api";
