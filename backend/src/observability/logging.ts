/**
 * Pino configuration for `nestjs-pino`. One JSON line per log, `message` as the
 * text key (not `msg`), OTel trace ids + a CLS correlation id mixed into every
 * record, and a redaction backstop for secrets that must never reach a log
 * sink. Request-completion lines are emitted by {@link HttpMetricsInterceptor}
 * with status-based sampling — pino-http `autoLogging` is off.
 */
import type { Params } from "nestjs-pino";
import { ClsServiceManager } from "nestjs-cls";
import { activeTraceIds } from "./otel";

/**
 * Redaction backstop. Real discipline is "don't pass secrets to the logger";
 * this only catches accidental `logger.info({ req })` / `{ err, config }` style
 * leaks. `remove: true` drops the key entirely rather than printing `[Redacted]`.
 */
export const REDACT_PATHS = [
  "req.headers.authorization",
  "req.headers.cookie",
  'req.headers["apikey"]',
  'req.headers["x-api-key"]',
  'res.headers["set-cookie"]',
  "*.password",
  "*.pass",
  "*.token",
  "*.accessToken",
  "*.refreshToken",
  "*.otp",
  "*.otpCode",
  "*.sesskey",
  "*.apikey",
  "*.Apikey",
  "*.cookie",
  "*.authorization",
  "password",
  "token",
  "sesskey",
];

function correlationMixin(): Record<string, unknown> {
  const ids = activeTraceIds();
  let clsId: string | undefined;
  let userId: string | undefined;
  try {
    const cls = ClsServiceManager.getClsService();
    clsId = cls.getId();
    userId = cls.get("userId");
  } catch {
    // no CLS context (startup, some cron paths) — fine
  }
  const correlationId = ids.traceId ?? clsId;
  return {
    ...(correlationId ? { correlationId } : {}),
    ...(ids.traceId ? { traceId: ids.traceId } : {}),
    ...(ids.spanId ? { spanId: ids.spanId } : {}),
    ...(userId ? { userId } : {}),
  };
}

export function buildPinoParams(env: {
  logLevel?: string;
  nodeEnv?: string;
  serviceName?: string;
  serviceVersion?: string;
}): Params {
  const isProd = env.nodeEnv === "production";
  return {
    pinoHttp: {
      level: env.logLevel ?? (isProd ? "info" : "debug"),
      messageKey: "message",
      // We own request logging (sampled, in the interceptor).
      autoLogging: false,
      quietReqLogger: true,
      base: {
        service: env.serviceName ?? "zenflow-api",
        version: env.serviceVersion ?? process.env.SERVICE_VERSION ?? "0.0.0",
        env: env.nodeEnv ?? "development",
      },
      formatters: {
        level: (label: string) => ({ level: label }),
      },
      mixin: correlationMixin,
      redact: { paths: REDACT_PATHS, remove: true },
      timestamp: () => `,"time":"${new Date().toISOString()}"`,
      transport: isProd
        ? undefined
        : { target: "pino-pretty", options: { singleLine: true } },
    },
  };
}
