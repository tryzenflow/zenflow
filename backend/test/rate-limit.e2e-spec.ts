import { INestApplication, ValidationPipe } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { CacheModule } from "@nestjs/cache-manager";
import { ScheduleModule } from "@nestjs/schedule";
import { Test, TestingModule } from "@nestjs/testing";
import passport from "passport";
import request from "supertest";
import type { App } from "supertest/types";
import { AuthModule } from "../src/auth/auth.module";
import { RateLimitModule } from "../src/common/rate-limit";
import { MailService } from "../src/mail/mail.service";
import { PrismaService } from "../src/prisma/prisma.service";
import { UsersService } from "../src/users/users.service";

/**
 * Proves the LimitKit guard wired onto `POST /auth/otp/request` and
 * `POST /auth/otp/verify` (see `src/common/rate-limit/` and
 * `src/auth/auth.controller.ts`) actually returns 429 once the configured
 * limit is exceeded, in the app's `{ success, message }` envelope, and that
 * the endpoint is usable again once the sliding window rolls over.
 *
 * This deliberately does NOT boot the full `AppModule` (which needs a live
 * Postgres + Redis + SMTP, per `backend/README.md`'s "needs the test DB"
 * e2e note) — it's scoped to the concern this issue is actually about: the
 * rate limiter sitting in front of the real `AuthController` guard/decorator
 * wiring. `PrismaService`/`UsersService`/`MailService` are swapped for bare
 * mocks so this file has no external dependencies and always runs against
 * `@limitkit/memory`'s `InMemoryStore` (NODE_ENV=test, see
 * `RateLimitModule`) — never real Redis.
 */
describe("OTP rate limiting (e2e)", () => {
  let app: INestApplication<App>;

  const sleep = (ms: number) =>
    new Promise((resolve) => setTimeout(resolve, ms));

  beforeAll(async () => {
    process.env.MAIL_TRANSPORT ??= "smtp://localhost:1025";
    process.env.MAIL_FROM ??= "noreply@zenflow.test";
    process.env.CACHE_URL ??= "redis://localhost:6379";

    // Small, fast-expiring windows so the test doesn't have to sleep long.
    // The email rule is given a much higher limit than the IP rule in each
    // pair so the IP rule is unambiguously what trips first — same IP,
    // same email, on every request in this file.
    process.env.OTP_REQUEST_IP_WINDOW_SEC = "2";
    process.env.OTP_REQUEST_IP_LIMIT = "3";
    process.env.OTP_REQUEST_EMAIL_WINDOW_SEC = "2";
    process.env.OTP_REQUEST_EMAIL_LIMIT = "1000";
    process.env.OTP_VERIFY_IP_WINDOW_SEC = "2";
    process.env.OTP_VERIFY_IP_LIMIT = "3";
    process.env.OTP_VERIFY_EMAIL_WINDOW_SEC = "2";
    process.env.OTP_VERIFY_EMAIL_LIMIT = "1000";

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }),
        ScheduleModule.forRoot(),
        CacheModule.register({ isGlobal: true }),
        RateLimitModule,
        AuthModule,
      ],
    })
      .overrideProvider(PrismaService)
      .useValue({})
      .overrideProvider(UsersService)
      .useValue({ findByEmail: jest.fn(), create: jest.fn() })
      .overrideProvider(MailService)
      .useValue({ sendLoginEmail: jest.fn().mockResolvedValue(undefined) })
      .compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
        forbidNonWhitelisted: true,
        transformOptions: { enableImplicitConversion: true },
      }),
    );
    app.use(passport.initialize());
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it("rate-limits POST /auth/otp/request per-IP: allows the configured burst, 429s past it, then recovers after the window", async () => {
    const server = app.getHttpServer();

    for (let i = 0; i < 3; i++) {
      const res = await request(server)
        .post("/auth/otp/request")
        .send({ email: "victim@example.com" });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ success: true });
    }

    const limited = await request(server)
      .post("/auth/otp/request")
      .send({ email: "victim@example.com" });
    expect(limited.status).toBe(429);
    expect(limited.body).toEqual({
      success: false,
      message: "Too many requests. Please wait a moment and try again.",
    });
    expect(limited.headers["retry-after"]).toBeDefined();

    // Wait out the 2s sliding window, then confirm the endpoint is usable
    // again — the limit isn't a one-way trip.
    await sleep(2200);

    const recovered = await request(server)
      .post("/auth/otp/request")
      .send({ email: "victim@example.com" });
    expect(recovered.status).toBe(200);
    expect(recovered.body).toMatchObject({ success: true });
  }, 15_000);

  it("rate-limits POST /auth/otp/verify per-IP the same way, independent of whether the OTP itself is valid", async () => {
    const server = app.getHttpServer();

    for (let i = 0; i < 3; i++) {
      const res = await request(server)
        .post("/auth/otp/verify")
        .send({ email: "victim2@example.com", providedOtp: "000000" });
      // No OTP was ever cached for this email, so every under-limit
      // attempt is rejected by auth logic (not the limiter) — the point
      // here is only that they are NOT 429.
      expect(res.status).not.toBe(429);
    }

    const limited = await request(server)
      .post("/auth/otp/verify")
      .send({ email: "victim2@example.com", providedOtp: "000000" });
    expect(limited.status).toBe(429);
    expect(limited.body).toEqual({
      success: false,
      message: "Too many requests. Please wait a moment and try again.",
    });
  }, 15_000);
});
