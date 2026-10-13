import type { ExecutionContext } from "@nestjs/common";
import { UnauthorizedException } from "@nestjs/common";
import { CookieAuthGuard } from "./cookie-auth.guard";

function ctx(user: { email: string } | null): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ isAuthenticated: () => !!user, user }),
    }),
  } as unknown as ExecutionContext;
}

describe("CookieAuthGuard", () => {
  const original = process.env.ALLOWED_EMAIL_DOMAINS;
  afterEach(() => {
    if (original === undefined) delete process.env.ALLOWED_EMAIL_DOMAINS;
    else process.env.ALLOWED_EMAIL_DOMAINS = original;
  });

  const guard = new CookieAuthGuard();

  it("rejects an unauthenticated request", () => {
    expect(() => guard.canActivate(ctx(null))).toThrow(UnauthorizedException);
  });

  it("lets a signed-in user through when no domain list is set", () => {
    delete process.env.ALLOWED_EMAIL_DOMAINS;
    expect(guard.canActivate(ctx({ email: "a@gmail.com" }))).toBe(true);
  });

  it("drops a session whose email is outside the list, keeps one inside", () => {
    process.env.ALLOWED_EMAIL_DOMAINS = "dlu.edu.vn";
    expect(() => guard.canActivate(ctx({ email: "a@gmail.com" }))).toThrow(
      UnauthorizedException,
    );
    expect(guard.canActivate(ctx({ email: "a@dlu.edu.vn" }))).toBe(true);
  });
});
