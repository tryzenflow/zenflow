import { LMSService } from "../lms/lms.service";
import { PortalAPIService } from "../portal/portal-api.service";
import { IntegrationAuthService } from "./integration-auth.service";

describe("IntegrationAuthService", () => {
  const login = jest.fn();
  const authenticate = jest.fn();
  let service: IntegrationAuthService;

  beforeEach(() => {
    login.mockReset();
    authenticate.mockReset();
    service = new IntegrationAuthService(
      { login } as unknown as LMSService,
      { authenticate } as unknown as PortalAPIService,
    );
  });

  it("accepts a good LMS login", async () => {
    login.mockResolvedValue({
      ok: true,
      session: { cookie: "MoodleSession=x", sesskey: "abc" },
    });

    await expect(service.verifyCredentials("LMS", "sv", "pw")).resolves.toBe(
      true,
    );
    expect(login).toHaveBeenCalledWith("sv", "pw");
  });

  it("returns false — not a throw — for a wrong LMS password", async () => {
    // The regression this guards: a rejected password used to throw, which
    // IntegrationsService turned into 503 "Couldn't reach DLU" instead of the
    // 400 "check your username and password" the student needs to see.
    login.mockResolvedValue({ ok: false, reason: "INVALID_CREDENTIALS" });

    await expect(service.verifyCredentials("LMS", "sv", "nope")).resolves.toBe(
      false,
    );
  });

  it("propagates a genuine LMS outage so it can surface as 503", async () => {
    login.mockRejectedValue(new Error("DLU LMS is unreachable"));

    await expect(service.verifyCredentials("LMS", "sv", "pw")).rejects.toThrow(
      "DLU LMS is unreachable",
    );
  });

  it("accepts a portal login that yields a token", async () => {
    authenticate.mockResolvedValue("TOKEN");

    await expect(service.verifyCredentials("PORTAL", "sv", "pw")).resolves.toBe(
      true,
    );
    expect(authenticate).toHaveBeenCalledWith("sv", "pw");
  });

  it("rejects a portal login that yields an empty token", async () => {
    authenticate.mockResolvedValue("");

    await expect(service.verifyCredentials("PORTAL", "sv", "pw")).resolves.toBe(
      false,
    );
  });
});
