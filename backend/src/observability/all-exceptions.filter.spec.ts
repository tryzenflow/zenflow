import { Test, TestingModule } from "@nestjs/testing";
import { ArgumentsHost, ConflictException } from "@nestjs/common";
import { PinoLogger } from "nestjs-pino";
import { ScheduleInfeasibleException } from "../scheduler/schedule-infeasible.exception";
import { SchedulerDegradedException } from "../scheduler/schedule-degraded.exception";
import { AllExceptionsFilter } from "./all-exceptions.filter";

async function run(exception: unknown) {
  const json = jest.fn<void, [Record<string, unknown>]>();
  const status = jest.fn<{ json: typeof json }, [number]>().mockReturnValue({
    json,
  });
  const host = {
    getType: () => "http",
    switchToHttp: () => ({
      getResponse: () => ({ status }),
      getRequest: () => ({ method: "POST", path: "/x" }),
    }),
  } as unknown as ArgumentsHost;
  const logger = { setContext: jest.fn(), error: jest.fn() };
  const module: TestingModule = await Test.createTestingModule({
    providers: [AllExceptionsFilter, { provide: PinoLogger, useValue: logger }],
  }).compile();
  module.get<AllExceptionsFilter>(AllExceptionsFilter).catch(exception, host);
  return {
    status: status.mock.calls[0][0],
    body: json.mock.calls[0][0],
  };
}

describe("AllExceptionsFilter machine-readable codes", () => {
  it("keeps `code` + `options` on the 409 SCHEDULE_INFEASIBLE body", async () => {
    const { status, body } = await run(new ScheduleInfeasibleException());
    expect(status).toBe(409);
    expect(body).toMatchObject({
      success: false,
      code: "SCHEDULE_INFEASIBLE",
      options: ["ACCEPT_CONFLICTS", "ACCEPT_LATE_DEADLINE"],
    });
  });

  it("keeps `code` on the 503 SCHEDULER_DEGRADED body", async () => {
    const { status, body } = await run(new SchedulerDegradedException());
    expect(status).toBe(503);
    expect(body).toMatchObject({ success: false, code: "SCHEDULER_DEGRADED" });
    expect(body.options).toBeUndefined();
  });

  it("leaves plain HttpExceptions on the bare envelope", async () => {
    const { body } = await run(new ConflictException("nope"));
    expect(body).toEqual({ success: false, message: "nope" });
  });
});
