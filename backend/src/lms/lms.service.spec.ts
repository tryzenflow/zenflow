import { Test, TestingModule } from "@nestjs/testing";
import { ConfigService } from "@nestjs/config";
import {
  OUTBOUND_CLOCK,
  OutboundBreakers,
  UpstreamUnavailableError,
} from "../common/outbound-breaker";
import { LMSService } from "./lms.service";

const BASE = "https://lms.dlu.edu.vn";

const config = {
  get: () => undefined,
  getOrThrow: (key: string) =>
    ({ LMS_URL: BASE, LMS_TIMEOUT_MS: "15000" })[key],
} as unknown as ConfigService;

/**
 * Minimal `Response` stand-in — `getSetCookie()` and `get("location")` are the
 * two header reads the client makes.
 */
const reply = (
  init: {
    status?: number;
    body?: string;
    json?: unknown;
    setCookie?: string[];
    location?: string;
  } = {},
): Response =>
  ({
    status: init.status ?? 200,
    ok: (init.status ?? 200) < 400,
    headers: {
      getSetCookie: () => init.setCookie ?? [],
      get: (name: string) =>
        name.toLowerCase() === "location" ? (init.location ?? null) : null,
    },
    text: () => Promise.resolve(init.body ?? ""),
    json: () => Promise.resolve(init.json),
  }) as unknown as Response;

/** One recorded `fetch(url, init)` call, typed so assertions stay checked. */
type FetchCall = [
  string,
  RequestInit & { headers: Record<string, string>; body: string },
];

const LOGIN_FORM = reply({
  body: '<form><input type="hidden" name="logintoken" value="TOKEN123" /></form>',
  setCookie: ["MoodleSession=anonymous; path=/; HttpOnly"],
});

/**
 * Moodle regenerates the session id on a successful login, and bounces through
 * `?testsession=<id>` — a query string, so it is not the bare login form a
 * rejection sends you back to.
 */
const LOGIN_REDIRECT = reply({
  status: 303,
  location: `${BASE}/login/index.php?testsession=42`,
  setCookie: ["MoodleSession=authenticated; path=/; HttpOnly"],
});

const DASHBOARD = reply({
  body: '<script>M.cfg = {"wwwroot":"https://lms.dlu.edu.vn","sesskey":"TESTSESSKEY"};</script>',
});

async function makeService(
  clock: () => number = Date.now,
): Promise<LMSService> {
  const module: TestingModule = await Test.createTestingModule({
    providers: [
      LMSService,
      OutboundBreakers,
      { provide: OUTBOUND_CLOCK, useValue: clock },
      { provide: ConfigService, useValue: config },
    ],
  }).compile();
  return module.get<LMSService>(LMSService);
}

describe("LMSService.login", () => {
  let service: LMSService;
  let fetchMock: jest.Mock;

  beforeEach(async () => {
    service = await makeService();
    fetchMock = jest.fn();
    global.fetch = fetchMock;
  });

  afterEach(() => jest.restoreAllMocks());

  it("walks the four-step flow and returns the regenerated cookie + sesskey", async () => {
    fetchMock
      .mockResolvedValueOnce(LOGIN_FORM)
      .mockResolvedValueOnce(LOGIN_REDIRECT)
      .mockResolvedValueOnce(DASHBOARD);

    await expect(service.login("sv", "pw")).resolves.toEqual({
      ok: true,
      session: {
        // The NEW cookie, not the anonymous one from step 1.
        cookie: "MoodleSession=authenticated",
        sesskey: "TESTSESSKEY",
      },
    });

    const [formUrl] = fetchMock.mock.calls[0] as FetchCall;
    expect(formUrl).toBe(`${BASE}/login/index.php`);

    const [, submitInit] = fetchMock.mock.calls[1] as FetchCall;
    expect(submitInit.method).toBe("POST");
    expect(submitInit.redirect).toBe("manual");
    expect(submitInit.headers["content-type"]).toBe(
      "application/x-www-form-urlencoded",
    );
    expect(submitInit.headers.cookie).toBe("MoodleSession=anonymous");
    // The scraped one-shot CSRF token has to travel with the credentials.
    expect(submitInit.body).toContain("logintoken=TOKEN123");
    expect(submitInit.body).toContain("username=sv");

    const [dashboardUrl, dashboardInit] = fetchMock.mock.calls[2] as FetchCall;
    expect(dashboardUrl).toBe(`${BASE}/my/`);
    expect(dashboardInit.headers.cookie).toBe("MoodleSession=authenticated");
  });

  it("reads a bounce back to the bare login form as a rejected password", async () => {
    fetchMock.mockResolvedValueOnce(LOGIN_FORM).mockResolvedValueOnce(
      reply({
        status: 303,
        location: `${BASE}/login/index.php`,
        setCookie: ["MoodleSession=anonymous; path=/; HttpOnly"],
      }),
    );

    await expect(service.login("sv", "wrong")).resolves.toEqual({
      ok: false,
      reason: "INVALID_CREDENTIALS",
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("reports a rejected password as a result, not an exception", async () => {
    fetchMock.mockResolvedValueOnce(LOGIN_FORM).mockResolvedValueOnce(
      reply({
        status: 200,
        body: '<div class="loginerrors"><a id="loginerrormessage">Invalid login, please try again</a></div>',
      }),
    );

    await expect(service.login("sv", "wrong")).resolves.toEqual({
      ok: false,
      reason: "INVALID_CREDENTIALS",
    });
    // It must not go on to /my/ with an unauthenticated session.
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("throws when DLU is unreachable, so the caller can answer 503", async () => {
    fetchMock.mockRejectedValueOnce(new Error("ETIMEDOUT"));

    await expect(service.login("sv", "pw")).rejects.toThrow(/unreachable/i);
  });

  it("accepts a 200 without a redirect — DLU answers the POST in place", async () => {
    fetchMock
      .mockResolvedValueOnce(LOGIN_FORM)
      .mockResolvedValueOnce(
        reply({
          status: 200,
          body: "<h1>Dashboard</h1>",
          setCookie: ["MoodleSession=authenticated; path=/; HttpOnly"],
        }),
      )
      .mockResolvedValueOnce(DASHBOARD);

    await expect(service.login("sv", "pw")).resolves.toEqual({
      ok: true,
      session: {
        cookie: "MoodleSession=authenticated",
        sesskey: "TESTSESSKEY",
      },
    });
  });

  it("lets the sesskey lookup, not the wording, judge an unrecognizable 200", async () => {
    fetchMock
      .mockResolvedValueOnce(LOGIN_FORM)
      .mockResolvedValueOnce(
        reply({ status: 200, body: "<h1>Maintenance</h1>" }),
      )
      .mockResolvedValueOnce(reply({ body: "<h1>Maintenance</h1>" }));

    await expect(service.login("sv", "pw")).rejects.toThrow(/no sesskey/);
  });

  it("throws when the dashboard carries no sesskey", async () => {
    fetchMock
      .mockResolvedValueOnce(LOGIN_FORM)
      .mockResolvedValueOnce(LOGIN_REDIRECT)
      .mockResolvedValueOnce(reply({ body: "<html>no M.cfg here</html>" }));

    await expect(service.login("sv", "pw")).rejects.toThrow(/no sesskey/);
  });
});

describe("LMSService.fetchMonthlyView", () => {
  let service: LMSService;
  let fetchMock: jest.Mock;
  const session = { cookie: "MoodleSession=abc", sesskey: "TESTSESSKEY" };

  beforeEach(async () => {
    service = await makeService();
    fetchMock = jest.fn();
    global.fetch = fetchMock;
  });

  it("posts the documented AJAX envelope and unwraps `data`", async () => {
    const data = { weeks: [{ days: [{ events: [] }] }] };
    fetchMock.mockResolvedValueOnce(reply({ json: [{ error: false, data }] }));

    await expect(service.fetchMonthlyView(session, 2026, 4)).resolves.toEqual(
      data,
    );

    const [url, init] = fetchMock.mock.calls[0] as FetchCall;
    expect(url).toBe(
      `${BASE}/lib/ajax/service.php?sesskey=TESTSESSKEY&info=core_calendar_get_calendar_monthly_view`,
    );
    expect(init.headers.cookie).toBe("MoodleSession=abc");
    expect(JSON.parse(init.body)).toEqual([
      {
        index: 0,
        methodname: "core_calendar_get_calendar_monthly_view",
        args: {
          year: 2026,
          month: 4,
          courseid: 1,
          includenavigation: false,
          mini: true,
          day: 1,
        },
      },
    ]);
  });

  it("throws on an envelope-level error, which Moodle reports inside a 200", async () => {
    fetchMock.mockResolvedValueOnce(
      reply({
        json: [{ error: true, exception: { errorcode: "invalidsesskey" } }],
      }),
    );

    await expect(service.fetchMonthlyView(session, 2026, 4)).rejects.toThrow(
      /invalidsesskey/,
    );
  });

  it("throws on a non-2xx status", async () => {
    fetchMock.mockResolvedValueOnce(reply({ status: 403 }));

    await expect(service.fetchMonthlyView(session, 2026, 4)).rejects.toThrow(
      /status 403/,
    );
  });
});

describe("LMSService.fetchEnrolledCourses (issue #56 discovery)", () => {
  let service: LMSService;
  let fetchMock: jest.Mock;
  const session = { cookie: "MoodleSession=abc", sesskey: "TESTSESSKEY" };

  /** One page of the enrolled-courses response. */
  const page = (ids: number[], nextoffset?: number | null) =>
    reply({
      json: [
        {
          error: false,
          data: {
            courses: ids.map((id) => ({
              id,
              fullname: `Môn học Mẫu ${id}`,
              shortname: `TESTCUR-${id}`,
              coursecategory: "Học kỳ 1",
              startdate: 1790737200,
              visible: true,
              hidden: false,
            })),
            ...(nextoffset === undefined ? {} : { nextoffset }),
          },
        },
      ],
    });

  beforeEach(async () => {
    service = await makeService();
    fetchMock = jest.fn();
    global.fetch = fetchMock;
  });

  afterEach(() => jest.restoreAllMocks());

  it("posts the documented args and unwraps the course list", async () => {
    fetchMock.mockResolvedValueOnce(page([20001, 20002], null));

    await expect(service.fetchEnrolledCourses(session)).resolves.toMatchObject([
      { id: 20001 },
      { id: 20002 },
    ]);

    const [url, init] = fetchMock.mock.calls[0] as FetchCall;
    expect(url).toBe(
      `${BASE}/lib/ajax/service.php?sesskey=TESTSESSKEY&info=core_course_get_enrolled_courses_by_timeline_classification`,
    );
    expect(init.headers.cookie).toBe("MoodleSession=abc");
    expect(JSON.parse(init.body)).toEqual([
      {
        index: 0,
        methodname:
          "core_course_get_enrolled_courses_by_timeline_classification",
        args: {
          offset: 0,
          // `limit: 0` asks Moodle for its own page size, which is exactly why
          // the `nextoffset` cursor has to be followed rather than assumed.
          limit: 0,
          // The whole enrolment history — the current-term filter is ours, not
          // Moodle's, which is why classifyCurrentTerm exists.
          classification: "allincludinghidden",
          sort: "fullname",
          customfieldname: "",
          customfieldvalue: "",
        },
      },
    ]);
  });

  it("follows nextoffset across pages and concatenates the result", async () => {
    fetchMock
      .mockResolvedValueOnce(page([20001, 20002], 2))
      .mockResolvedValueOnce(page([20003], 3))
      .mockResolvedValueOnce(page([], 4));

    await expect(
      service.fetchEnrolledCourses(session, { pageSize: 2 }),
    ).resolves.toHaveLength(3);

    expect(fetchMock).toHaveBeenCalledTimes(3);
    const offsets = fetchMock.mock.calls.map(
      (call) =>
        (
          JSON.parse((call as FetchCall)[1].body) as {
            args: { offset: number; limit: number };
          }[]
        )[0].args,
    );
    expect(offsets).toEqual([
      expect.objectContaining({ offset: 0, limit: 2 }),
      expect.objectContaining({ offset: 2, limit: 2 }),
      expect.objectContaining({ offset: 3, limit: 2 }),
    ]);
  });

  it("stops when a page carries no nextoffset at all", async () => {
    fetchMock.mockResolvedValueOnce(page([20001]));

    await expect(service.fetchEnrolledCourses(session)).resolves.toHaveLength(
      1,
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("stops rather than spinning when nextoffset does not advance", async () => {
    // A server that keeps echoing the same cursor would otherwise loop forever
    // inside one sync pass.
    fetchMock.mockResolvedValue(page([20001], 0));

    await expect(service.fetchEnrolledCourses(session)).resolves.toHaveLength(
      1,
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("stops on an empty page even with a cursor that advances", async () => {
    fetchMock
      .mockResolvedValueOnce(page([20001], 1))
      .mockResolvedValueOnce(page([], 2));

    await expect(service.fetchEnrolledCourses(session)).resolves.toHaveLength(
      1,
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("throws on an envelope-level error, which Moodle reports inside a 200", async () => {
    fetchMock.mockResolvedValueOnce(
      reply({
        json: [{ error: true, exception: { errorcode: "invalidsesskey" } }],
      }),
    );

    await expect(service.fetchEnrolledCourses(session)).rejects.toThrow(
      /invalidsesskey/,
    );
  });

  it("throws on a non-2xx status, naming the call", async () => {
    fetchMock.mockResolvedValueOnce(reply({ status: 403 }));

    await expect(service.fetchEnrolledCourses(session)).rejects.toThrow(
      /enrolled courses request failed \(status 403\)/,
    );
  });

  it("tolerates a data payload with no courses key", async () => {
    fetchMock.mockResolvedValueOnce(
      reply({ json: [{ error: false, data: {} }] }),
    );
    await expect(service.fetchEnrolledCourses(session)).resolves.toEqual([]);
  });
});

describe("LMSService circuit breaker", () => {
  let service: LMSService;
  let fetchMock: jest.Mock;
  let t: number;

  const timeout = () =>
    Object.assign(new Error("timed out"), { name: "TimeoutError" });

  beforeEach(async () => {
    t = 1_000_000;
    service = await makeService(() => t);
    fetchMock = jest.fn();
    global.fetch = fetchMock;
  });

  afterEach(() => jest.restoreAllMocks());

  async function trip() {
    fetchMock.mockRejectedValue(timeout());
    for (let i = 0; i < 5; i++) {
      await expect(service.login("sv", "pw")).rejects.toThrow(/unreachable/);
    }
  }

  it("opens after 5 consecutive timeouts, then short-circuits without calling fetch", async () => {
    await trip();
    expect(fetchMock).toHaveBeenCalledTimes(5);
    expect(service.unavailableFor()).toBeGreaterThan(0);

    const err = await service.login("sv", "pw").catch((e: unknown) => e);

    expect(err).toBeInstanceOf(UpstreamUnavailableError);
    expect((err as UpstreamUnavailableError).upstream).toBe("dlu-lms");
    expect((err as UpstreamUnavailableError).retryAfterMs).toBeGreaterThan(0);
    expect(fetchMock).toHaveBeenCalledTimes(5);
  });

  it("does not count a rejected login (student-specific) however many times", async () => {
    for (let i = 0; i < 10; i++) {
      fetchMock.mockReset();
      fetchMock.mockResolvedValueOnce(LOGIN_FORM).mockResolvedValueOnce(
        reply({
          status: 303,
          location: `${BASE}/login/index.php`,
          setCookie: ["MoodleSession=anonymous; path=/"],
        }),
      );
      await expect(service.login("sv", "wrong")).resolves.toMatchObject({
        ok: false,
      });
    }
    expect(service.unavailableFor()).toBeNull();
  });

  it("does not count 4xx statuses or parse errors", async () => {
    for (let i = 0; i < 10; i++) {
      fetchMock.mockResolvedValueOnce(reply({ status: 403 }));
      await expect(
        service.fetchMonthlyView({ cookie: "c", sesskey: "k" }, 2026, 9),
      ).rejects.toThrow(/status 403/);
    }
    expect(service.unavailableFor()).toBeNull();
  });

  it("counts 5xx and 429 as transport trouble", async () => {
    for (const status of [500, 502, 503, 504, 429]) {
      fetchMock.mockResolvedValueOnce(reply({ status }));
      await expect(
        service.fetchMonthlyView({ cookie: "c", sesskey: "k" }, 2026, 9),
      ).rejects.toThrow();
    }
    expect(service.unavailableFor()).not.toBeNull();
  });

  it("half-open admits one probe whose success closes the breaker", async () => {
    await trip();
    t += 60_001; // default open time

    expect(service.unavailableFor()).toBeNull(); // peek does not eat the probe
    fetchMock.mockReset();
    fetchMock
      .mockResolvedValueOnce(LOGIN_FORM)
      .mockResolvedValueOnce(LOGIN_REDIRECT)
      .mockResolvedValueOnce(DASHBOARD);
    await expect(service.login("sv", "pw")).resolves.toMatchObject({
      ok: true,
    });

    expect(service.unavailableFor()).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("a failed probe re-opens with the open time doubled", async () => {
    await trip();
    t += 60_001;
    fetchMock.mockRejectedValue(timeout());
    await expect(service.login("sv", "pw")).rejects.toThrow(/unreachable/);

    t += 60_001; // would have been enough before doubling
    expect(service.unavailableFor()).toBeGreaterThan(0);
  });

  it("honours Retry-After on 429 beyond the base open time", async () => {
    fetchMock.mockResolvedValue({
      ...reply({ status: 429 }),
      headers: {
        getSetCookie: () => [],
        get: (n: string) => (n === "retry-after" ? "120" : null),
      },
    });
    for (let i = 0; i < 5; i++) {
      await service.login("sv", "pw").catch(() => undefined);
    }
    t += 60_001; // half-open by the breaker's own clock, but held by Retry-After
    expect(service.unavailableFor()).toBeGreaterThan(0);
    t += 60_000;
    expect(service.unavailableFor()).toBeNull();
  });
});
