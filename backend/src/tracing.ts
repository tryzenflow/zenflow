import { diag, DiagConsoleLogger, DiagLogLevel } from "@opentelemetry/api";
import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-http";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { PeriodicExportingMetricReader } from "@opentelemetry/sdk-metrics";
import { NodeSDK } from "@opentelemetry/sdk-node";
import {
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
  ATTR_DEPLOYMENT_ENVIRONMENT_NAME,
} from "@opentelemetry/semantic-conventions";
import { PrismaInstrumentation } from "@prisma/instrumentation";

const DEFAULT_ENDPOINT = "http://localhost:4318";

function startTelemetry(): void {
  if (process.env.OTEL_SDK_DISABLED === "true") return;

  if (process.env.OTEL_LOG_LEVEL) {
    const level =
      DiagLogLevel[
        process.env.OTEL_LOG_LEVEL.toUpperCase() as keyof typeof DiagLogLevel
      ] ?? DiagLogLevel.ERROR;
    diag.setLogger(new DiagConsoleLogger(), level);
  }

  const endpoint = (
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? DEFAULT_ENDPOINT
  ).replace(/\/+$/, "");

  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const pkgVersion = (() => {
    try {
      return require("../package.json").version as string;
    } catch {
      return process.env.SERVICE_VERSION ?? "0.0.0";
    }
  })();

  const resource = resourceFromAttributes({
    [ATTR_SERVICE_NAME]: process.env.OTEL_SERVICE_NAME ?? "zenflow-api",
    [ATTR_SERVICE_VERSION]: process.env.SERVICE_VERSION ?? pkgVersion,
    [ATTR_DEPLOYMENT_ENVIRONMENT_NAME]: process.env.NODE_ENV ?? "development",
  });

  const sdk = new NodeSDK({
    resource,
    // Without this, NodeSDK's default detectors (env, process, host) add
    // process.pid / process.command_args / process.owner / host.id / … to the
    // resource. The collector's `resource_to_telemetry_conversion` then turns
    // *every one of those* into a Prometheus label (not just service.name /
    // service.version / deployment.environment.name, despite its comment), so
    // each restart forks every metric into a brand-new label set. A busy
    // counter (inbound HTTP) still looks fine because one process handles many
    // requests before it restarts, but a sparse one (an hourly ingestion cron,
    // a push send) rarely gets two samples in the same series before the next
    // restart forks a new one — `rate()` has nothing to diff against, so the
    // panel reads as a flat zero. It also put the OS username in every label
    // set (`process.owner`) for no reason. Explicit resource + no detectors
    // keeps every metric's label set stable across restarts.
    resourceDetectors: [],
    traceExporter: new OTLPTraceExporter({ url: `${endpoint}/v1/traces` }),
    metricReader: new PeriodicExportingMetricReader({
      exporter: new OTLPMetricExporter({ url: `${endpoint}/v1/metrics` }),
      exportIntervalMillis: Number(
        process.env.OTEL_METRIC_EXPORT_INTERVAL_MS ?? 60_000,
      ),
    }),
    instrumentations: [
      getNodeAutoInstrumentations({
        // Very noisy, near-zero value for this service.
        "@opentelemetry/instrumentation-fs": { enabled: false },
      }),
      // Not part of auto-instrumentations — Prisma ships its own.
      new PrismaInstrumentation(),
    ],
  });

  sdk.start();

  const shutdown = () => {
    sdk
      .shutdown()
      .catch((err) => console.error("OTel shutdown error", err))
      .finally(() => process.exit(0));
  };
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
}

startTelemetry();
