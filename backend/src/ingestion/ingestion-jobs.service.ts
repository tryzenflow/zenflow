import { Injectable } from "@nestjs/common";
import type { JobStatus } from "../../generated/prisma";
import { PrismaService } from "../prisma/prisma.service";

/**
 * Which pair of job tables a call targets. A provider only ever writes one
 * side: `LMS` → `LmsSyncJob`/`LmsSyncJobItem`, `PORTAL` →
 * `PortalAPIJob`/`PortalAPIJobItem`.
 */
export type JobKind = "LMS" | "PORTAL";

/** Terminal outcome of one job item. */
export interface JobItemResult {
  status: Extract<JobStatus, "COMPLETED" | "FAILED">;
  statusCode?: number | null;
  responseBody?: string | null;
}

/**
 * Per-run job tracking for the DLU watchers.
 *
 * One job per user per run, one item per outbound request. These rows are the
 * *only* record of what a run did — per-run counts are deliberately absent from
 * the API contract (a client sees exactly `IntegrationStatus.lastSyncedAt` /
 * `.lastSyncStatus`, which are derived from the newest job row here), so
 * writing them is not optional bookkeeping: skip a status transition and the
 * student's integrations screen silently stops reflecting reality.
 *
 * The two table pairs are shaped identically, so the branch lives here once
 * rather than in each of the three watchers.
 *
 * Every write is its own statement — never wrapped in an interactive
 * `$transaction` with the fetch/parse work, which would hold a connection open
 * across a network round trip (see the warning on `PrismaService`).
 */
@Injectable()
export class IngestionJobsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Open a run's job and immediately mark it `PROCESSING`.
   *
   * Two writes rather than one `PROCESSING` insert so the row passes through
   * the same `PENDING → PROCESSING → COMPLETED | FAILED` lifecycle the schema
   * defaults to, and so a process killed between the two leaves visible
   * evidence at the exact step it died.
   */
  async startJob(kind: JobKind, integrationId: string): Promise<string> {
    if (kind === "LMS") {
      const job = await this.prisma.lmsSyncJob.create({
        data: { integrationId },
        select: { id: true },
      });
      await this.prisma.lmsSyncJob.update({
        where: { id: job.id },
        data: { status: "PROCESSING" },
      });
      return job.id;
    }
    const job = await this.prisma.portalAPIJob.create({
      data: { integrationId },
      select: { id: true },
    });
    await this.prisma.portalAPIJob.update({
      where: { id: job.id },
      data: { status: "PROCESSING" },
    });
    return job.id;
  }

  /**
   * Close a run.
   *
   * `COMPLETED` means "the run finished", not "every request succeeded": a
   * failed item stays `FAILED` on its own row and the run carries on, because
   * one unreachable month should not hide the month that did come back. Only a
   * login failure — which makes every request in the run impossible — fails the
   * job itself.
   */
  async finishJob(
    kind: JobKind,
    jobId: string,
    status: Extract<JobStatus, "COMPLETED" | "FAILED">,
  ): Promise<void> {
    if (kind === "LMS") {
      await this.prisma.lmsSyncJob.update({
        where: { id: jobId },
        data: { status },
      });
      return;
    }
    await this.prisma.portalAPIJob.update({
      where: { id: jobId },
      data: { status },
    });
  }

  /**
   * Record an outbound request as in-flight, before it is made, so a request
   * that never returns is still visible as a `PENDING` item afterwards.
   *
   * `attempt` is always 1: the baseline does not retry.
   */
  async beginItem(kind: JobKind, jobId: string, url: string): Promise<string> {
    if (kind === "LMS") {
      const item = await this.prisma.lmsSyncJobItem.create({
        data: { lmsSyncJobId: jobId, url, attempt: 1, status: "PROCESSING" },
        select: { id: true },
      });
      return item.id;
    }
    const item = await this.prisma.portalAPIJobItem.create({
      data: { portalApiJobId: jobId, url, attempt: 1, status: "PROCESSING" },
      select: { id: true },
    });
    return item.id;
  }

  /** Stamp an item's terminal status, upstream status code and diagnostics. */
  async completeItem(
    kind: JobKind,
    itemId: string,
    result: JobItemResult,
  ): Promise<void> {
    const data = {
      status: result.status,
      statusCode: result.statusCode ?? null,
      responseBody: result.responseBody ?? null,
    };
    if (kind === "LMS") {
      await this.prisma.lmsSyncJobItem.update({ where: { id: itemId }, data });
      return;
    }
    await this.prisma.portalAPIJobItem.update({ where: { id: itemId }, data });
  }
}
