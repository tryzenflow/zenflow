import {
  CallHandler,
  ExecutionContext,
  HttpException,
  Injectable,
  NestInterceptor,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PinoLogger } from "nestjs-pino";
import { ClsService } from "nestjs-cls";
import { Observable } from "rxjs";
import { tap } from "rxjs/operators";
import type { Request, Response } from "express";
import { httpServerDuration, statusClass } from "./metrics";
import { activeTraceIds } from "./otel";
import { shouldLogRequest } from "./request-sampling";
import { serverTimingHeader } from "./phase-timings";

/**
 * The one place inbound HTTP is measured + logged:
 *  - records `http_server_request_duration_seconds{method,route,status}` — one
 *    histogram that yields RED's rate (`_count`), errors (`status`) and latency;
 *  - emits a single sampled request-completion log line (see request-sampling);
 *  - seeds the CLS store with `userId` so downstream logs carry it.
 *
 * `route` is the express route template prefixed with the global prefix
 * (`/api/v1/sessions/:id`), never the raw path — occurrence ids like
 * `<seriesId>::<startISO>` collapse to `:id`. On a thrown error the status is
 * taken from the exception (the response status isn't set until the filter runs).
 */
@Injectable()
export class HttpMetricsInterceptor implements NestInterceptor {
  private readonly slowMs: number;
  private readonly benchTiming: boolean;

  constructor(
    private readonly logger: PinoLogger,
    private readonly cls: ClsService,
    config: ConfigService,
  ) {
    this.logger.setContext("http");
    this.slowMs = config.get<number>("HTTP_SLOW_REQUEST_MS") ?? 1000;
    this.benchTiming = String(config.get("BENCH_TIMING")) === "1";
  }

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (ctx.getType() !== "http") return next.handle();

    const http = ctx.switchToHttp();
    const req = http.getRequest<Request & { user?: { id?: string } }>();
    const res = http.getResponse<Response>();
    const start = process.hrtime.bigint();

    const userId = req.user?.id;
    if (userId) {
      try {
        this.cls.set("userId", userId);
      } catch {
        /* no CLS context */
      }
    }

    const method = req.method;
    const routeTemplate = (): string => {
      // `req.route.path` is already the full path Express registered the
      // handler under, global prefix included (Nest's `setGlobalPrefix`
      // prepends it at route-registration time) — prepending it again here
      // used to double it to `/api/v1/api/v1/...`.
      const routePath = (req as unknown as { route?: { path?: string } }).route
        ?.path;
      if (routePath) return routePath;
      return `${ctx.getClass().name}.${ctx.getHandler().name}`;
    };

    const finish = (status: number): void => {
      const durationMs = Number(process.hrtime.bigint() - start) / 1e6;
      const route = routeTemplate();
      httpServerDuration.record(durationMs / 1000, {
        "http.request.method": method,
        route,
        "http.response.status_code": status,
        status_class: statusClass(status),
      });

      const { traceId } = activeTraceIds();
      if (
        !shouldLogRequest({
          method,
          status,
          durationMs,
          traceId,
          slowMs: this.slowMs,
        })
      ) {
        return;
      }
      const payload = {
        event: "http.request",
        httpMethod: method,
        route,
        statusCode: status,
        durationMs: Math.round(durationMs),
      };
      if (status >= 500) this.logger.error(payload, "request failed");
      else if (status >= 400) this.logger.warn(payload, "request rejected");
      else this.logger.info(payload, "request completed");
    };

    return next.handle().pipe(
      tap({
        next: () => {
          if (this.benchTiming) {
            const h = serverTimingHeader(this.cls);
            if (h && !res.headersSent) res.setHeader("Server-Timing", h);
          }
          finish(res.statusCode);
        },
        error: (err: unknown) =>
          finish(err instanceof HttpException ? err.getStatus() : 500),
      }),
    );
  }
}
