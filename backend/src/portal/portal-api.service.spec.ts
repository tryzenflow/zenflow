import { ConfigService } from "@nestjs/config";
import { PortalAPIService } from "./portal-api.service";

const BASE = "https://portal-api.dlu.edu.vn";
const API_KEY = "super-secret-apikey";

const config = {
  getOrThrow: (key: string) =>
    ({
      PORTAL_API_URL: BASE,
      PORTAL_API_TIMEOUT_MS: "10000",
      PORTAL_API_KEY: API_KEY,
    })[key],
} as unknown as ConfigService;

const reply = (init: { status?: number; json?: unknown } = {}): Response =>
  ({
    status: init.status ?? 200,
    ok: (init.status ?? 200) < 400,
    json: () => Promise.resolve(init.json),
  }) as unknown as Response;

/** One recorded `fetch(url, init)` call, typed so assertions stay checked. */
type FetchCall = [string, RequestInit & { headers: Record<string, string> }];

describe("PortalAPIService", () => {
  let service: PortalAPIService;
  let fetchMock: jest.Mock;

  beforeEach(() => {
    service = new PortalAPIService(config);
    fetchMock = jest.fn();
    global.fetch = fetchMock;
  });

  afterEach(() => jest.restoreAllMocks());

  describe("fetchTimetable", () => {
    it("requests one ISO week with the three required headers", async () => {
      const rows = [{ WeekScheduleID: 600001 }];
      fetchMock.mockResolvedValueOnce(reply({ json: rows }));

      await expect(
        service.fetchTimetable("TOKEN", "2026-2027", "HK01", 34),
      ).resolves.toEqual(rows);

      const [url, init] = fetchMock.mock.calls[0] as FetchCall;
      expect(url).toBe(
        `${BASE}/api/student/DrawingStudentSchedules?namhoc=2026-2027&hocky=HK01&tuan=34`,
      );
      expect(init.method).toBe("GET");
      expect(init.headers).toEqual({
        authorization: "Bearer TOKEN",
        clientid: "vhu",
        apikey: API_KEY,
      });
    });

    it("returns [] when the portal answers with something other than an array", async () => {
      fetchMock.mockResolvedValueOnce(reply({ json: { message: "no data" } }));

      await expect(
        service.fetchTimetable("TOKEN", "2026-2027", "HK01", 34),
      ).resolves.toEqual([]);
    });

    it("throws on a non-2xx status without leaking the query string", async () => {
      fetchMock.mockResolvedValueOnce(reply({ status: 401 }));

      await expect(
        service.fetchTimetable("TOKEN", "2026-2027", "HK01", 34),
      ).rejects.toThrow(
        "Portal request to /api/student/DrawingStudentSchedules failed (status 401)",
      );
    });
  });

  describe("fetchExams", () => {
    it("requests a whole term (no tuan)", async () => {
      const rows = [{ Examination: "500001" }];
      fetchMock.mockResolvedValueOnce(reply({ json: rows }));

      await expect(
        service.fetchExams("TOKEN", "2025-2026", "HK01"),
      ).resolves.toEqual(rows);

      const [url, init] = fetchMock.mock.calls[0] as FetchCall;
      expect(url).toBe(`${BASE}/api/student/exam?namhoc=2025-2026&hocky=HK01`);
      expect(init.headers.apikey).toBe(API_KEY);
    });
  });

  describe("authenticate", () => {
    it("returns the Token on a 200", async () => {
      fetchMock.mockResolvedValueOnce(reply({ json: { Token: "TOKEN" } }));

      await expect(service.authenticate("sv", "pw")).resolves.toEqual({
        ok: true,
        token: "TOKEN",
      });
    });

    it.each([400, 401, 403])(
      "reports a rejected login as a result, not a throw (status %i)",
      async (status) => {
        // The regression this guards: any 4xx used to throw, and
        // `IntegrationsService.storeCredentials` maps every throw to a 503
        // "Couldn't reach DLU" — so a wrong password told the student the
        // university was offline instead of 400 "check your password".
        fetchMock.mockResolvedValueOnce(
          reply({ status, json: { message: "sai mật khẩu" } }),
        );

        await expect(service.authenticate("sv", "nope")).resolves.toEqual({
          ok: false,
          reason: "INVALID_CREDENTIALS",
        });
      },
    );

    it("throws on a 200 that carries no token", async () => {
      fetchMock.mockResolvedValueOnce(reply({ json: { Token: "" } }));

      await expect(service.authenticate("sv", "pw")).rejects.toThrow(
        "Portal accepted the login but returned no token",
      );
    });

    it("throws on an unexpected status — that is the site, not the student", async () => {
      fetchMock.mockResolvedValueOnce(reply({ status: 500 }));

      await expect(service.authenticate("sv", "pw")).rejects.toThrow(
        "Unexpected portal login response (status 500)",
      );
    });

    it("collapses a transport failure into 'DLU is unreachable'", async () => {
      fetchMock.mockRejectedValueOnce(new Error("ECONNREFUSED"));

      await expect(service.authenticate("sv", "pw")).rejects.toThrow(
        "DLU is unreachable",
      );
    });
  });
});
