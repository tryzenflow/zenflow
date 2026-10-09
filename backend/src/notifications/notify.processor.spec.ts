/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access */
import { ConfigService } from "@nestjs/config";
import { Test } from "@nestjs/testing";
import { DelayedError, UnrecoverableError, type Job } from "bullmq";
import { OutboundBreakers } from "../common/outbound-breaker";
import { PushService } from "../devices/push.service";
import { QueueWorkers } from "../queue/queue-workers.service";
import { NOTIFY_QUEUE, type NotifyJobData } from "../queue/queues";
import { ReminderSchedulerService } from "../reminders/reminder-scheduler.service";
import { NotifyProcessor } from "./notify.processor";

async function setup() {
  const workers = { register: jest.fn() };
  const push = { deliver: jest.fn().mockResolvedValue(undefined) };
  const reminders = { fire: jest.fn().mockResolvedValue(undefined) };
  const moduleRef = await Test.createTestingModule({
    providers: [
      {
        provide: ConfigService,
        useValue: new ConfigService({ INGESTION_BREAKER_FAILURES: 1 }),
      },
      NotifyProcessor,
      OutboundBreakers,
      { provide: QueueWorkers, useValue: workers },
      { provide: PushService, useValue: push },
      { provide: ReminderSchedulerService, useValue: reminders },
    ],
  }).compile();
  const processor = moduleRef.get(NotifyProcessor);
  const breakers = moduleRef.get(OutboundBreakers);
  const job = (data: NotifyJobData) =>
    ({
      id: "j",
      queueName: "notify",
      data,
      attemptsStarted: 1,
      attemptsMade: 0,
      moveToDelayed: jest.fn().mockResolvedValue(undefined),
    }) as unknown as Job<NotifyJobData> & { moveToDelayed: jest.Mock };
  return { processor, workers, push, reminders, breakers, job };
}

describe("NotifyProcessor", () => {
  it("registers itself as the notify queue consumer", async () => {
    const { processor, workers } = await setup();
    processor.onModuleInit();
    expect(workers.register).toHaveBeenCalledWith(
      NOTIFY_QUEUE,
      expect.any(Function),
    );
  });

  it("push: delivers the notification for the job's provider", async () => {
    const { processor, push, job } = await setup();
    await processor.process(
      job({ type: "push", notificationId: "n1", provider: "fcm" }),
      "tok",
    );
    expect(push.deliver).toHaveBeenCalledWith("n1", {
      provider: "fcm",
      guard: expect.any(Function),
    });
  });

  it("push: the guard runs the provider under its named breaker and parks the job when it is open", async () => {
    const { processor, push, breakers, job } = await setup();
    // Trip the fcm breaker.
    await breakers
      .run("fcm", () => Promise.reject(new Error("down")))
      .catch(() => 0);
    const j = job({ type: "push", notificationId: "n1", provider: "fcm" });
    await processor.process(j, "tok");
    const { guard } = push.deliver.mock.calls[0][1] as {
      guard: (p: string, fn: () => Promise<unknown>) => Promise<unknown>;
    };
    const fn = jest.fn();
    await expect(guard("fcm", fn)).rejects.toBeInstanceOf(DelayedError);
    expect(fn).not.toHaveBeenCalled();
    expect(j.moveToDelayed).toHaveBeenCalledTimes(1);
    // apns is unaffected.
    await expect(guard("apns", () => Promise.resolve(1))).resolves.toBe(1);
  });

  it("push: a delivery failure propagates so BullMQ retries with backoff", async () => {
    const { processor, push, job } = await setup();
    push.deliver.mockRejectedValue(new Error("fcm down"));
    await expect(
      processor.process(
        job({ type: "push", notificationId: "n1", provider: "fcm" }),
      ),
    ).rejects.toThrow("fcm down");
  });

  it("push: a job without a provider is unrecoverable (it could re-send on a breaker park)", async () => {
    const { processor, push, job } = await setup();
    await expect(
      processor.process(
        job({ type: "push", notificationId: "n1" } as unknown as NotifyJobData),
      ),
    ).rejects.toBeInstanceOf(UnrecoverableError);
    expect(push.deliver).not.toHaveBeenCalled();
  });

  it("reminder: fires with the armed start as epoch ms", async () => {
    const { processor, reminders, job } = await setup();
    await processor.process(
      job({
        type: "reminder",
        reminderId: "r1",
        startsAt: "2026-09-20T10:00:00.000Z",
      }),
    );
    expect(reminders.fire).toHaveBeenCalledWith(
      "r1",
      Date.parse("2026-09-20T10:00:00.000Z"),
    );
  });
});
