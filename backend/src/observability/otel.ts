/**
 * Thin wrappers over `@opentelemetry/api` so app code never imports the tracer
 * SDK directly. When `tracing.ts` was not preloaded (dev, tests) the global
 * tracer is a no-op and every helper here degrades to "just run the function".
 */
import {
  context,
  SpanStatusCode,
  trace,
  type Attributes,
  type Span,
} from "@opentelemetry/api";

export const TRACER_NAME = "zenflow-backend";

export function getTracer() {
  return trace.getTracer(TRACER_NAME);
}

/** Trace + span id of the currently-active span, for log correlation. */
export function activeTraceIds(): { traceId?: string; spanId?: string } {
  const span = trace.getSpanContext(context.active());
  return span ? { traceId: span.traceId, spanId: span.spanId } : {};
}

/**
 * Run `fn` inside a new span that becomes the active context for its duration.
 * Records the exception + sets an ERROR status on throw, always ends the span.
 * Use for the deliberate seams (the scheduler A/B decision, a cron run, a
 * rerank pass) — never inside a hot pure loop.
 */
export async function withSpan<T>(
  name: string,
  fn: (span: Span) => Promise<T> | T,
  attributes?: Attributes,
): Promise<T> {
  const tracer = getTracer();
  return tracer.startActiveSpan(name, { attributes }, async (span) => {
    try {
      return await fn(span);
    } catch (err) {
      span.recordException(err as Error);
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: (err as Error).message,
      });
      throw err;
    } finally {
      span.end();
    }
  });
}

/** Set attributes on the current active span, if any. */
export function annotateSpan(attributes: Attributes): void {
  trace.getActiveSpan()?.setAttributes(attributes);
}
