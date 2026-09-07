import { ConfigService } from "@nestjs/config";
import { LMSService } from "./lms.service";

const BASE = "https://lms.dlu.edu.vn";

const config = {
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

describe("LMSService.login", () => {
  let service: LMSService;
  let fetchMock: jest.Mock;

  beforeEach(() => {
    service = new LMSService(config);
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

  beforeEach(() => {
    service = new LMSService(config);
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
