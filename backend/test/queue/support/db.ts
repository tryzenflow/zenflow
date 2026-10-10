import { PrismaClient } from "../../../generated/prisma";
import { databaseUrl } from "../../../src/common/config/connections";
import type { Student } from "./stack";

/** A Prisma client on the test database, for asserting what the API persisted. */
export const connectDb = () =>
  new PrismaClient({ datasourceUrl: databaseUrl((key) => process.env[key]) });

export const noteRows = (prisma: PrismaClient, student: Student) =>
  prisma.notification.findMany({
    where: { userId: student.id },
    orderBy: { sentAt: "asc" },
  });

export const integrationOf = (
  prisma: PrismaClient,
  student: Student,
  provider: "PORTAL" | "LMS",
) =>
  prisma.integration.findFirstOrThrow({
    where: { userId: student.id, provider },
  });
