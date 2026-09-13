import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from "@nestjs/common";
import { PinoLogger } from "nestjs-pino";
import type { Request, Response } from "express";
import { Prisma } from "../../generated/prisma";

/**
 * Catch-all filter so every error response uses this app's
 * `{ success: false, message }` envelope instead of Nest's default
 * `{ statusCode, message, error }`. More specific filters still win — the
 * `TooManyRequestsFilter` (`@Catch(TooManyRequestsException)`) keeps its own
 * shaping. `HttpException`s keep their status + message; anything else is a 500
 * with a generic message and a full error log (stack + Prisma error code),
 * which is never sampled.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  constructor(private readonly logger: PinoLogger) {
    this.logger.setContext("exception");
  }

  catch(exception: unknown, host: ArgumentsHost): void {
    if (host.getType() !== "http") throw exception;

    const http = host.switchToHttp();
    const res = http.getResponse<Response>();
    const req = http.getRequest<Request>();

    const { status, message, errors } = this.normalize(exception);

    if (status >= HttpStatus.INTERNAL_SERVER_ERROR) {
      const err = exception as Error & { code?: string };
      this.logger.error(
        {
          event: "unhandled_exception",
          httpMethod: req.method,
          path: req.path,
          statusCode: status,
          err: {
            type: err?.name,
            message: err?.message,
            code:
              err instanceof Prisma.PrismaClientKnownRequestError
                ? err.code
                : err?.code,
            stack: err?.stack,
          },
        },
        "unhandled exception",
      );
    }

    res
      .status(status)
      .json({ success: false, message, ...(errors ? { errors } : {}) });
  }

  private normalize(exception: unknown): {
    status: number;
    message: string;
    errors?: string[];
  } {
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      if (typeof body === "string") return { status, message: body };
      const asObj = body as { message?: string | string[]; error?: string };
      if (Array.isArray(asObj.message)) {
        return {
          status,
          message: asObj.error ?? "Request validation failed",
          errors: asObj.message,
        };
      }
      return { status, message: asObj.message ?? exception.message };
    }

    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      // Unmapped Prisma errors shouldn't leak column names to the client.
      return {
        status: HttpStatus.INTERNAL_SERVER_ERROR,
        message: "A database error occurred",
      };
    }

    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      message: "Internal server error",
    };
  }
}
