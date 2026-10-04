import { ArgumentsHost, ConflictException } from "@nestjs/common";
import { ScheduleInfeasibleException } from "../scheduler/schedule-infeasible.exception";
import { SchedulerDegradedException } from "../scheduler/schedule-degraded.exception";
import { AllExceptionsFilter } from "./all-exceptions.filter";

function run(exception: unknown) {
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
  new AllExceptionsFilter(logger as never).catch(exception, host);
  return {
    status: status.mock.calls[0][0],
    body: json.mock.calls[0][0],
  };
}

describe("AllExceptionsFilter machine-readable codes", () => {
  it("keeps `code` + `options` on the 409 SCHEDULE_INFEASIBLE body", () => {
    const { status, body } = run(new ScheduleInfeasibleException());
    expect(status).toBe(409);
    expect(body).toMatchObject({
      success: false,
      code: "SCHEDULE_INFEASIBLE",
      options: ["ACCEPT_CONFLICTS", "ACCEPT_LATE_DEADLINE"],
    });
  });

  it("keeps `code` on the 503 SCHEDULER_DEGRADED body", () => {
    const { status, body } = run(new SchedulerDegradedException());
    expect(status).toBe(503);
    expect(body).toMatchObject({ success: false, code: "SCHEDULER_DEGRADED" });
    expect(body.options).toBeUndefined();
  });

  it("leaves plain HttpExceptions on the bare envelope", () => {
    const { body } = run(new ConflictException("nope"));
    expect(body).toEqual({ success: false, message: "nope" });
  });
});

describe("AllExceptionsFilter body-parser errors", () => {
  it("maps entity.too.large to 413 with a clear message", () => {
    const err = Object.assign(new Error("request entity too large"), {
      status: 413,
      statusCode: 413,
      type: "entity.too.large",
    });
    const { status, body } = run(err);
    expect(status).toBe(413);
    expect(body).toEqual({
      success: false,
      message: "That content is too large to save.",
    });
  });

  it("maps malformed JSON to 400", () => {
    const err = Object.assign(new SyntaxError("bad"), {
      status: 400,
      type: "entity.parse.failed",
    });
    const { status, body } = run(err);
    expect(status).toBe(400);
    expect(body.message).toBe("Malformed request body.");
  });

  it("still maps unknown errors to 500", () => {
    expect(run(new Error("boom")).status).toBe(500);
  });
});
