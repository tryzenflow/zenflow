import {
  INestApplication,
  ValidationPipe,
  type ExecutionContext,
} from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { Test, TestingModule } from "@nestjs/testing";
import request from "supertest";
import type { App } from "supertest/types";
import { CookieAuthGuard } from "../src/auth/guards";
import { ApnsSender } from "../src/devices/apns.sender";
import { DevicesModule } from "../src/devices/devices.module";
import { FcmSender } from "../src/devices/fcm.sender";
import { PrismaService } from "../src/prisma/prisma.service";

/**
 * The real HTTP surface of `/devices` — controller, DTOs, global
 * `ValidationPipe`, response envelope — over a stubbed `PrismaService` and with
 * both push senders disabled (so nothing reaches a network).
 *
 * Like `notifications.e2e-spec.ts`, this does not boot `AppModule`. The stub
 * `CookieAuthGuard` pins the user from an `x-test-user` header (default `u1`),
 * so caller-scoping on `DELETE` is still exercised end to end.
 */

interface DeviceRow {
  id: string;
  platform: string;
  pushToken: string;
  userId: string;
  lastSeenAt: Date | null;
}

const store: DeviceRow[] = [];
let seq = 0;

const prismaStub = {
  userDevice: {
    upsert: (args: {
      where: { pushToken: string };
      create: Omit<DeviceRow, "id">;
      update: Partial<DeviceRow>;
    }) => {
      const existing = store.find((r) => r.pushToken === args.where.pushToken);
      if (existing) {
        Object.assign(existing, args.update);
        return Promise.resolve({ id: existing.id });
      }
      const row: DeviceRow = { id: `d${++seq}`, ...args.create };
      store.push(row);
      return Promise.resolve({ id: row.id });
    },
    count: (args: { where: { pushToken: string; userId: string } }) =>
      Promise.resolve(
        store.filter(
          (r) =>
            r.pushToken === args.where.pushToken &&
            r.userId === args.where.userId,
        ).length,
      ),
    deleteMany: (args: { where: { pushToken: string; userId: string } }) => {
      const before = store.length;
      for (let i = store.length - 1; i >= 0; i--) {
        if (
          store[i].pushToken === args.where.pushToken &&
          store[i].userId === args.where.userId
        ) {
          store.splice(i, 1);
        }
      }
      return Promise.resolve({ count: before - store.length });
    },
  },
};

const disabledSender = {
  enabled: false,
  send: () => Promise.resolve({ sent: 0, invalidTokens: [] }),
};

interface Envelope<T> {
  success: boolean;
  message: string;
  data: T;
}
const body = <T>(res: { body: unknown }): Envelope<T> =>
  res.body as Envelope<T>;

describe("Devices (e2e)", () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      // Global ConfigService, as AppModule provides it (BanditService needs it).
      imports: [
        ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }),
        DevicesModule,
      ],
    })
      .overrideProvider(PrismaService)
      .useValue(prismaStub)
      .overrideProvider(FcmSender)
      .useValue(disabledSender)
      .overrideProvider(ApnsSender)
      .useValue(disabledSender)
      .overrideGuard(CookieAuthGuard)
      .useValue({
        canActivate: (context: ExecutionContext) => {
          const req = context
            .switchToHttp()
            .getRequest<{ user: unknown; headers: Record<string, string> }>();
          req.user = { id: req.headers["x-test-user"] ?? "u1" };
          return true;
        },
      })
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
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    store.length = 0;
    seq = 0;
  });

  describe("POST /devices", () => {
    it("registers a device and returns { id } in the envelope", async () => {
      const res = await request(app.getHttpServer())
        .post("/devices")
        .send({ platform: "ANDROID", pushToken: "tok-a" });

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        success: true,
        message: "Device registered",
      });
      expect(body<{ id: string }>(res).data.id).toBeDefined();
      expect(store).toHaveLength(1);
    });

    it("is idempotent — the same token upserts one row", async () => {
      const server = app.getHttpServer();
      await request(server)
        .post("/devices")
        .send({ platform: "IOS", pushToken: "tok-b" });
      const res = await request(server)
        .post("/devices")
        .send({ platform: "ANDROID", pushToken: "tok-b" });

      expect(res.status).toBe(200);
      expect(store).toHaveLength(1);
      expect(store[0].platform).toBe("ANDROID");
    });

    it("rejects an unknown platform", async () => {
      const res = await request(app.getHttpServer())
        .post("/devices")
        .send({ platform: "WINDOWS", pushToken: "tok-a" });

      expect(res.status).toBe(400);
    });

    it("rejects a missing token", async () => {
      const res = await request(app.getHttpServer())
        .post("/devices")
        .send({ platform: "ANDROID" });

      expect(res.status).toBe(400);
    });

    it("rejects an unknown field (forbidNonWhitelisted)", async () => {
      const res = await request(app.getHttpServer())
        .post("/devices")
        .send({ platform: "ANDROID", pushToken: "tok-a", extra: 1 });

      expect(res.status).toBe(400);
    });
  });

  describe("DELETE /devices", () => {
    it("removes the caller's device and is idempotent", async () => {
      const server = app.getHttpServer();
      await request(server)
        .post("/devices")
        .send({ platform: "ANDROID", pushToken: "tok-a" });

      const first = await request(server)
        .delete("/devices")
        .send({ pushToken: "tok-a" });
      expect(first.status).toBe(200);
      expect(first.body).toMatchObject({
        success: true,
        message: "Device unregistered",
      });
      expect(store).toHaveLength(0);

      const second = await request(server)
        .delete("/devices")
        .send({ pushToken: "tok-a" });
      expect(second.status).toBe(200);
    });

    it("does not remove another user's device", async () => {
      const server = app.getHttpServer();
      await request(server)
        .post("/devices")
        .set("x-test-user", "owner")
        .send({ platform: "ANDROID", pushToken: "tok-shared" });

      const res = await request(server)
        .delete("/devices")
        .set("x-test-user", "intruder")
        .send({ pushToken: "tok-shared" });

      expect(res.status).toBe(200); // idempotent, not a 404
      expect(store).toHaveLength(1);
    });
  });

  describe("POST /devices/status", () => {
    it("reports registered for the caller's token, false after unregister", async () => {
      const server = app.getHttpServer();
      await request(server)
        .post("/devices")
        .send({ platform: "ANDROID", pushToken: "tok-a" });

      const yes = await request(server)
        .post("/devices/status")
        .send({ pushToken: "tok-a" });
      expect(yes.status).toBe(200);
      expect(yes.body).toMatchObject({ success: true });
      expect(body<{ registered: boolean }>(yes).data).toEqual({
        registered: true,
      });

      await request(server).delete("/devices").send({ pushToken: "tok-a" });
      const no = await request(server)
        .post("/devices/status")
        .send({ pushToken: "tok-a" });
      expect(body<{ registered: boolean }>(no).data.registered).toBe(false);
    });

    it("treats another user's token as not registered", async () => {
      const server = app.getHttpServer();
      await request(server)
        .post("/devices")
        .set("x-test-user", "owner")
        .send({ platform: "IOS", pushToken: "tok-x" });

      const res = await request(server)
        .post("/devices/status")
        .set("x-test-user", "intruder")
        .send({ pushToken: "tok-x" });
      expect(res.status).toBe(200);
      expect(body<{ registered: boolean }>(res).data.registered).toBe(false);
    });

    it("rejects a missing token and unknown fields", async () => {
      const server = app.getHttpServer();
      expect(
        (await request(server).post("/devices/status").send({})).status,
      ).toBe(400);
      expect(
        (
          await request(server)
            .post("/devices/status")
            .send({ pushToken: "t", extra: 1 })
        ).status,
      ).toBe(400);
    });
  });
});
