import { randomUUID } from "node:crypto";
import { Global, Module } from "@nestjs/common";
import { APP_FILTER, APP_INTERCEPTOR } from "@nestjs/core";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { ClsModule } from "nestjs-cls";
import { LoggerModule } from "nestjs-pino";
import type { IncomingMessage } from "node:http";
import { AllExceptionsFilter } from "./all-exceptions.filter";
import { HttpMetricsInterceptor } from "./http-metrics.interceptor";
import { buildPinoParams } from "./logging";
import { activeTraceIds } from "./otel";

/**
 * Cross-cutting observability wiring, imported once by `AppModule`:
 *  - `nestjs-cls` — an AsyncLocalStorage store carrying the correlation id
 *    (the OTel trace id when a request is traced, else `x-request-id` / a uuid)
 *    and `userId`, so every log line can include them without threading args;
 *  - `nestjs-pino` — JSON logging (see `logging.ts`), also wired as the Nest
 *    logger in `main.ts`;
 *  - the global {@link AllExceptionsFilter} + {@link HttpMetricsInterceptor}.
 *
 * Traces + the metric SDK are started separately by `tracing.ts` (preloaded via
 * `--require`); this module only consumes the API.
 */
@Global()
@Module({
  imports: [
    ClsModule.forRoot({
      global: true,
      middleware: {
        mount: true,
        generateId: true,
        idGenerator: (req: IncomingMessage) =>
          activeTraceIds().traceId ??
          (req.headers?.["x-request-id"] as string | undefined) ??
          randomUUID(),
      },
    }),
    LoggerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        buildPinoParams({
          logLevel: config.get<string>("LOG_LEVEL"),
          nodeEnv: config.get<string>("NODE_ENV"),
          serviceName: config.get<string>("OTEL_SERVICE_NAME"),
          serviceVersion: config.get<string>("SERVICE_VERSION"),
        }),
    }),
  ],
  providers: [
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    { provide: APP_INTERCEPTOR, useClass: HttpMetricsInterceptor },
  ],
  exports: [LoggerModule, ClsModule],
})
export class ObservabilityModule {}
