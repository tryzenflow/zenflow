import { ArgumentsHost, Catch, ExceptionFilter } from "@nestjs/common";
import { TooManyRequestsException } from "@limitkit/nest";
import type { Response } from "express";

/**
 * `@limitkit/nest`'s `LimitGuard` throws `TooManyRequestsException("Too many
 * requests")` — a plain string body, which Nest's default handling would
 * serialize as `{ statusCode, message, error }`, not this app's
 * `{ success, message }` envelope. This filter re-shapes it to match every
 * other error response, while leaving the `RateLimit-*` / `Retry-After`
 * headers the guard already set on the response untouched.
 */
@Catch(TooManyRequestsException)
export class TooManyRequestsFilter implements ExceptionFilter {
  catch(exception: TooManyRequestsException, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse<Response>();
    response.status(exception.getStatus()).json({
      success: false,
      message: "Too many requests. Please wait a moment and try again.",
    });
  }
}
