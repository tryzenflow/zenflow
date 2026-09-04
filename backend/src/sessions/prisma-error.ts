import {
  InternalServerErrorException,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "../../generated/prisma";
import { PostgresErrorCode } from "../prisma/error-codes";

/**
 * Normalize an error thrown while updating/removing a session: a rethrown
 * `NotFoundException` and Prisma's "record not found" (P2025) both become a
 * 404; anything else is logged and re-thrown as a 500 in this app's envelope.
 * Always throws — declared `: never`.
 */
export function mapSessionPrismaError(
  error: unknown,
  id: string,
  method: "update" | "remove",
): never {
  if (error instanceof NotFoundException) throw error;
  if (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === (PostgresErrorCode.RecordNotFound as string)
  ) {
    throw new NotFoundException(`Cannot find session with id ${id}`);
  }
  const message = error instanceof Error ? error.message : String(error);
  console.error(
    `[ERROR] service=sessions, method=${method}, message="${message}"`,
  );
  throw new InternalServerErrorException({
    success: false,
    message:
      method === "update"
        ? "Something went wrong when updating a session"
        : "Something went wrong when deleting a session",
  });
}
