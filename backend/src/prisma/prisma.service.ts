import {
  Injectable,
  OnModuleInit,
  OnApplicationShutdown,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PrismaClient } from "../../generated/prisma/client";
import { databaseUrl } from "../common/config/connections";

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnApplicationShutdown
{
  constructor(config: ConfigService) {
    // Prisma's defaults (2s maxWait / 5s timeout) are tuned for a fast local
    // DB. Production runs the API and Postgres on the same small VPS, where a
    // cascade-and-write transaction can legitimately take a few seconds — the
    // 5s default was aborting task creation with P2028. This is a safety belt,
    // NOT the fix: an interactive transaction holds its connection for its
    // whole life, so the work inside it still has to stay small.
    // The URL is composed from DB_HOST/POSTGRES_* here; only the Prisma CLI
    // reads DATABASE_URL (scripts/with-database-url.cjs).
    super({
      datasourceUrl: databaseUrl((key) => config.get(key)),
      transactionOptions: { maxWait: 5_000, timeout: 20_000 },
    });
  }

  async onModuleInit() {
    await this.$connect();
  }

  // Not onModuleDestroy: queue workers drain in beforeApplicationShutdown and
  // their in-flight jobs still need the database.
  async onApplicationShutdown() {
    await this.$disconnect();
  }
}
