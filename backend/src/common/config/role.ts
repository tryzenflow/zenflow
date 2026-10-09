/**
 * Process role (ADR-0011). One image, picked by the `ROLE` env:
 *  - `api`    HTTP only; registers no cron, ticker or reminder timer.
 *  - `worker` scheduled work only; serves `/health` and nothing else.
 *  - `all`    both (default; local dev and the test stack).
 */
export type Role = "api" | "worker" | "all";

export function getRole(env: NodeJS.ProcessEnv = process.env): Role {
  const role = env.ROLE;
  return role === "api" || role === "worker" ? role : "all";
}

export const runsHttp = (role: Role): boolean => role !== "worker";
export const runsJobs = (role: Role): boolean => role !== "api";
