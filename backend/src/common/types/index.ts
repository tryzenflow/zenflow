import { PrismaClient, Prisma } from "generated/prisma";
import { DefaultArgs } from "generated/prisma/runtime/library";

export type Transaction = Omit<
  PrismaClient<Prisma.PrismaClientOptions, never, DefaultArgs>,
  "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends"
>;
