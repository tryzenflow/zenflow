import type { ConfigService } from "@nestjs/config";
import type { IntegrationProvider } from "@zenflow/shared";
import { UpstreamUnavailableError } from "../common/outbound-breaker";
import type { PrismaService } from "../prisma/prisma.service";
import type { SkippedItem } from "./core/types";

/**
 * Plumbing the three DLU watchers share.
 *
 * Everything here is I/O-side by definition (it iterates Prisma rows and
 * waits on a clock), so it deliberately lives outside `ingestion/core/*` —
 * that half stays pure, per invariant #2.
 */

/** Integrations pulled per page so one sweep never loads the whole table. */
export const INTEGRATION_BATCH_SIZE = 50;

/**
 * A job item's `responseBody` is capped at this many characters. The raw
 * upstream payload is kept so a bad parse stays diagnosable, but a pathological
 * month should not be able to write an unbounded row on every cron tick.
 */
export const MAX_RESPONSE_BODY_CHARS = 200_000;

/**
 * One `Integration` a watcher has to visit.
 *
 * Deliberately carries no timezone: upstream wall-clock strings are parsed in
 * `DLU_TZ` (a property of the data), and the student's own zone is applied at
 * render time by the client (invariant #5).
 */
export interface IntegrationTarget {
  integrationId: string;
  userId: string;
  /**
   * Consecutive cache-served passes so far, from the claimed
   * `IngestionSchedule` row (issue #56).
   *
   * Optional because the manual `POST /integrations/:provider/sync` path builds
   * its targets from `eachIntegrationTarget`, which has no schedule row in hand.
   * Absent reads as `0`, i.e. "not on a cache streak" — and a manual sync
   * always walks anyway, since the student asked for fresh data.
   */
  cacheHitStreak?: number;
}

/**
 * What one student's sync pass did, as far as the rolling scheduler cares
 * (issue #56).
 *
 * Lives here rather than on either service because both the watchers (which
 * produce it) and `IngestionScheduleService` (which records it) need it, and
 * this file is already where the plumbing they share lives.
 */
export interface PassOutcome {
  /**
   * False if any upstream request failed. Note this is not "the job row says
   * COMPLETED": a pass finishes even when one week 503s, but a pass with a
   * failed fetch must not advance the freshness stamp other passes gate on.
   */
  ok: boolean;
  /**
   * True when the pass issued **no** upstream requests at all — served entirely
   * from the cross-student occurrence cache. Counted as a streak so a cohort
   * cannot sit on cached data indefinitely (`mustFullWalk`).
   */
  servedFromCache: boolean;
  /**
   * Set when the pass stopped because the upstream's circuit breaker is open.
   * Not a student failure: the ticker must not count it in
   * `consecutiveFailures` and releases the claim so the row stays due.
   */
  upstreamDown?: UpstreamUnavailableError;
}

/** A pass that never got off the ground — a rejected or unreachable login. */
export const FAILED_PASS: PassOutcome = { ok: false, servedFromCache: false };

/**
 * The `INGESTION_ENABLED` kill switch.
 *
 * Accepts the boolean Joi coerces it into and the raw string an unvalidated
 * config would hand back, so flipping the switch works whether or not the value
 * went through the schema. Anything else — including the key being absent — is
 * "enabled", matching the Joi default.
 */
export function isIngestionEnabled(config: ConfigService): boolean {
  const raw = config.get<boolean | string>("INGESTION_ENABLED");
  return raw !== false && raw !== "false";
}

/**
 * The `INGESTION_OCCURRENCE_CACHE_ENABLED` rollout gate (issue #56).
 *
 * Deliberately mirrors {@link isIngestionEnabled}'s boolean-or-string tolerance
 * but **inverts its default**. That one is a kill switch, so absent means on;
 * this one is a rollout gate for behaviour that can silently drop a class off a
 * student's calendar if the confirmed-set plumbing is wrong, so absent means
 * off. Only an explicit `true` enables it.
 *
 * It gates exactly two things:
 *  1. whether a walk may **skip** a live fetch, and
 *  2. whether fan-out may **write** another student's `Session` rows.
 *
 * Recording occurrences from a walk that happened anyway is deliberately NOT
 * gated: flipping this flag on should find a warm, already-validated cache
 * rather than a cold one doing full-cost walks. So with
 * the flag off, every upstream request and every student-visible write is what
 * it is today, plus some local rows nobody reads yet.
 */
export function isOccurrenceCacheEnabled(config: ConfigService): boolean {
  const raw = config.get<boolean | string>(
    "INGESTION_OCCURRENCE_CACHE_ENABLED",
  );
  return raw === true || raw === "true";
}

/** A positive number from config, tolerating the string a `.env` file gives. */
export function positiveConfig(
  config: ConfigService,
  name: string,
  fallback: number,
): number {
  const value = Number(config.get<number | string>(name));
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

/** Resolves after `ms`; a non-positive delay resolves on the next tick. */
export function sleep(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Visit every `Integration` for `provider`, oldest id first, **sequentially**.
 *
 * Sequential on purpose: this is the whole of the baseline's politeness policy
 * (no queue, no rate limiter, no circuit breaker — all deliberately deferred),
 * so fanning out here would be the one thing that turns a cron tick into a
 * burst against DLU.
 *
 * `userId` restricts the sweep to a single student — that is the manual
 * `POST /integrations/:provider/sync` path, which reuses the identical code the
 * cron runs rather than a parallel one-off.
 *
 * Returns the number of integrations visited.
 *
 * `handle`'s resolved value is ignored: since issue #56 the watchers' per-student
 * pass returns a {@link PassOutcome} for the rolling ticker to record, but this
 * sweep is the manual-sync path, which reports status through the job rows
 * (`IntegrationStatus.lastSyncStatus`) rather than through a return value. The
 * parameter is typed `unknown` rather than `void` purely so passing that
 * function here needs no throwaway wrapper.
 */
export async function eachIntegrationTarget(
  prisma: PrismaService,
  provider: IntegrationProvider,
  userId: string | undefined,
  handle: (target: IntegrationTarget) => Promise<unknown>,
): Promise<number> {
  let visited = 0;
  let cursor: string | undefined;

  for (;;) {
    const page = await prisma.integration.findMany({
      where: { provider, ...(userId ? { userId } : {}) },
      select: { id: true, userId: true },
      orderBy: { id: "asc" },
      take: INTEGRATION_BATCH_SIZE,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    });
    if (page.length === 0) break;
    cursor = page[page.length - 1].id;

    for (const row of page) {
      try {
        await handle({
          integrationId: row.id,
          userId: row.userId,
        });
      } catch (error) {
        // Upstream is down (breaker open): the rest of the sweep would only be
        // refused too, so stop it. Anything else is a real bug; surface it.
        if (error instanceof UpstreamUnavailableError) return visited;
        throw error;
      }
      visited += 1;
    }

    if (page.length < INTEGRATION_BATCH_SIZE) break;
  }

  return visited;
}

/** What {@link jobItemBody} serializes onto a job item's `responseBody`. */
export interface JobItemBody {
  /** The raw upstream payload, exactly as it was received. */
  body?: unknown;
  /** Records the parser deliberately dropped, and why. */
  skipped?: readonly SkippedItem[];
  /** Set instead of `body` when the request (or the write-back) failed. */
  error?: string;
}

/**
 * Serialize one job item's diagnostics.
 *
 * The raw response and the parser's `skipped` list travel together because
 * they only make sense together: "this payload produced nothing" is a bug
 * report, "this payload produced nothing *because periods 5–6 are
 * undocumented*" is an answer. The schema has one text column for both, so
 * this is the envelope that goes in it.
 */
export function jobItemBody(input: JobItemBody): string {
  const json = JSON.stringify({
    body: input.body ?? null,
    skipped: input.skipped ?? [],
    ...(input.error ? { error: input.error } : {}),
  });
  return json.length > MAX_RESPONSE_BODY_CHARS
    ? `${json.slice(0, MAX_RESPONSE_BODY_CHARS)}…[truncated]`
    : json;
}

/**
 * Best-effort HTTP status out of a client error.
 *
 * `LMSService` / `PortalAPIService` collapse a failed request into an `Error`
 * whose message carries the status (`"… failed (status 403)"`), so the job
 * item can still record the number without either client growing a bespoke
 * error class for the watchers' benefit.
 */
export function statusCodeOf(error: unknown): number | null {
  // A short-circuited call never reached the upstream; record it as a 503.
  if (error instanceof UpstreamUnavailableError) return 503;
  const message = error instanceof Error ? error.message : String(error);
  const match = /status (\d{3})/.exec(message);
  return match ? Number(match[1]) : null;
}

/** Message of an unknown thrown value, for a log line or a job item. */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
