import { ConfigService } from "@nestjs/config";
import { Test } from "@nestjs/testing";
import { QueueWorkers } from "../queue/queue-workers.service";
import { LMS_FETCH_QUEUE, PORTAL_FETCH_QUEUE } from "../queue/queues";
import { IngestionFetchService } from "./ingestion-fetch.service";
import {
  defaultFetchLimiter,
  LmsFetchProcessor,
  PortalFetchProcessor,
} from "./fetch.processor";

async function build(env: Record<string, unknown> = {}) {
  const register = jest.fn<void, [unknown, unknown, Record<string, unknown>]>();
  const onFinalFailure = jest.fn().mockResolvedValue(undefined);
  const module = await Test.createTestingModule({
    providers: [
      PortalFetchProcessor,
      LmsFetchProcessor,
      { provide: QueueWorkers, useValue: { register } },
      { provide: IngestionFetchService, useValue: { onFinalFailure } },
      { provide: ConfigService, useValue: new ConfigService(env) },
    ],
  }).compile();
  return { module, register, onFinalFailure };
}

describe("fetch processors", () => {
  it("register each queue with the stalled-failure hook and a limiter", async () => {
    const { module, register, onFinalFailure } = await build({
      INGESTION_REQUEST_DELAY_MS: 750,
    });

    module.get(PortalFetchProcessor).onModuleInit();
    module.get(LmsFetchProcessor).onModuleInit();

    expect(register.mock.calls.map((c) => c[0])).toEqual([
      PORTAL_FETCH_QUEUE,
      LMS_FETCH_QUEUE,
    ]);
    const opts = register.mock.calls[0][2] as unknown as {
      limiter: unknown;
      onFinalFailure: (j: unknown, e: Error) => Promise<void>;
    };
    expect(opts.limiter).toEqual({ max: 1, duration: 750 });
    const job = {};
    const err = new Error("stalled");
    await opts.onFinalFailure(job, err);
    expect(onFinalFailure).toHaveBeenCalledWith(job, err);
  });

  it("leaves the limiter to QUEUE_<Q>_RATE_MAX when set, and off at zero delay", () => {
    const cfg = (env: Record<string, unknown>) => new ConfigService(env);
    expect(
      defaultFetchLimiter(
        cfg({ QUEUE_PORTAL_FETCH_RATE_MAX: 3 }),
        PORTAL_FETCH_QUEUE,
      ),
    ).toBeUndefined();
    expect(
      defaultFetchLimiter(
        cfg({ INGESTION_REQUEST_DELAY_MS: 0 }),
        PORTAL_FETCH_QUEUE,
      ),
    ).toBeUndefined();
  });
});
