import { Injectable, Logger } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { PrismaService } from "../../prisma/prisma.service";
import { runCronJob } from "../../observability/cron";
import { sessionEventPartitionsAhead } from "../../observability/metrics";
import {
  countMonthsAhead,
  monthStart,
  partitionName,
  planPartitions,
} from "../core/session-event-partitions";

/**
 * Daily upkeep of the monthly `SessionEvent` partitions (ADR-0016): pre-create
 * the current and next two months, drop partitions older than 12 months, and
 * report how many future months exist so Prometheus can alert before an insert
 * would fail. Partition names are generated here, never user input, so they are
 * safe to interpolate as quoted identifiers.
 */
@Injectable()
export class SessionEventPartitionService {
  private readonly logger = new Logger(SessionEventPartitionService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** 02:10 UTC daily; catches up on the next run after a failure. */
  @Cron("10 2 * * *", { timeZone: "UTC" })
  async handleCron(): Promise<void> {
    await runCronJob("session-event-partitions", () => this.run(new Date()));
  }

  async run(now: Date): Promise<void> {
    const before = await this.listPartitions();
    const { create, drop } = planPartitions(now, before);

    for (const month of create) {
      const name = partitionName(month);
      const from = month.toISOString().slice(0, 10);
      const to = monthStart(month, 1).toISOString().slice(0, 10);
      await this.prisma.$executeRawUnsafe(
        `CREATE TABLE IF NOT EXISTS "${name}" PARTITION OF "SessionEvent" FOR VALUES FROM ('${from}') TO ('${to}')`,
      );
    }
    for (const name of drop) {
      await this.prisma.$executeRawUnsafe(`DROP TABLE IF EXISTS "${name}"`);
    }
    if (create.length || drop.length) {
      this.logger.log(
        `created [${create.map(partitionName).join(", ")}], dropped [${drop.join(", ")}]`,
      );
    }

    const after = await this.listPartitions();
    sessionEventPartitionsAhead.record(countMonthsAhead(now, after));
  }

  private async listPartitions(): Promise<string[]> {
    const rows = await this.prisma.$queryRaw<{ name: string }[]>`
      SELECT c.relname AS name
      FROM pg_inherits i
      JOIN pg_class c ON c.oid = i.inhrelid
      WHERE i.inhparent = '"SessionEvent"'::regclass
        AND c.relkind = 'r'`;
    return rows.map((r) => r.name);
  }
}
