import { Injectable, OnModuleInit, OnModuleDestroy } from "@nestjs/common";
import { PrismaClient } from "../../generated/prisma/client";

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  constructor() {
    // Prisma's defaults (2s maxWait / 5s timeout) are tuned for a fast local
    // DB. Production runs the API and Postgres on the same small VPS, where a
    // cascade-and-write transaction can legitimately take a few seconds — the
    // 5s default was aborting task creation with P2028. This is a safety belt,
    // NOT the fix: an interactive transaction holds its connection for its
    // whole life, so the work inside it still has to stay small.
    super({
      transactionOptions: { maxWait: 5_000, timeout: 20_000 },
    });
  }

  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
