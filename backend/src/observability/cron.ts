/**
 * Wrap a scheduled (`@Cron`) handler body so it runs under a root span and
 * emits `scheduler_cron_runs_total{cron_job,result}` + `scheduler_cron_duration`.
 *
 * `@nestjs/schedule` provides no ambient context, so without this every Prisma
 * / fetch child span a cron creates is orphaned and dropped. Wrap the `@Cron`
 * handler only — the shared `run()` a manual `POST /integrations/:provider/sync`
 * also calls stays under that request's HTTP span.
 *
 * The attribute is `cron_job`, not `job` — the collector's Prometheus exporter
 * already promotes the `service.name` resource attribute to a constant `job`
 * label on every metric, and a variable label of the same name makes the
 * exporter drop the metric entirely ("duplicate label names in constant and
 * variable labels").
 */
import { cronDuration, cronRuns } from "./metrics";
import { withSpan } from "./otel";

export async function runCronJob<T>(
  job: string,
  fn: () => Promise<T>,
): Promise<T> {
  const start = process.hrtime.bigint();
  let result = "ok";
  try {
    return await withSpan(`cron ${job}`, () => fn(), { "cron.job": job });
  } catch (err) {
    result = "error";
    throw err;
  } finally {
    cronDuration.record(Number(process.hrtime.bigint() - start) / 1e9, {
      cron_job: job,
    });
    cronRuns.add(1, { cron_job: job, result });
  }
}
