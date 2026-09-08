import {
  INestApplication,
  ValidationPipe,
  type ExecutionContext,
} from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import request from "supertest";
import type { App } from "supertest/types";
import { Prisma } from "../generated/prisma";
import { CookieAuthGuard } from "../src/auth/guards";
import { NotificationsModule } from "../src/notifications/notifications.module";
import { PrismaService } from "../src/prisma/prisma.service";

/**
 * The real HTTP surface of `/notifications` — controller, DTO, global
 * `ValidationPipe` and response envelope — over a stubbed `PrismaService`.
 *
 * Deliberately does **not** boot `AppModule` (that needs live Postgres/Redis/
 * SMTP, per `backend/README.md`); the concern here is the wire contract these
 * three routes expose, not persistence, which the unit specs already cover
 * against an in-memory double.
 *
 * `CookieAuthGuard` is replaced with a stub that pins one user, so "this is not
 * your notification" is still exercised end to end: the service scopes every
 * write by `userId`, and the 404 that produces has to survive the controller.
 */

const USER = { id: "u1", email: "sv0001@example.test" };

interface Row {
  id: string;
  userId: string;
  sessionId: string | null;
  topic: string;
  title: string;
  content: string;
  sentAt: Date;
  readAt: Date | null;
  actionTakenAt: Date | null;
}

/** Deliberately fictional fixtures — never real DLU data. */
const rows: Row[] = [
  {
    id: "n1",
    userId: "u1",
    sessionId: "s1",
    topic: "ASSIGNMENT",
    title: "New assignment: Môn học Mẫu Một",
    content: "Added to your calendar from DLU.",
    sentAt: new Date("2026-09-01T00:00:00.000Z"),
    readAt: null,
    actionTakenAt: null,
  },
  {
    id: "n2",
    userId: "u1",
    sessionId: "s2",
    topic: "EXAM",
    title: "New exam: Môn học Mẫu Hai",
    content: "Added to your calendar from DLU.",
    sentAt: new Date("2026-09-02T00:00:00.000Z"),
    readAt: new Date("2026-09-03T00:00:00.000Z"),
    actionTakenAt: null,
  },
  {
    id: "n3",
    userId: "someone-else",
    sessionId: null,
    topic: "TIMETABLE",
    title: "Not yours",
    content: "Belongs to another student.",
    sentAt: new Date("2026-09-02T00:00:00.000Z"),
    readAt: null,
    actionTakenAt: null,
  },
];

/** `res.body` is `any` off supertest; narrow it once instead of at every use. */
interface Envelope<T> {
  success: boolean;
  message: string;
  data: T;
}
type ListData = {
  notifications: {
    id: string;
    sentAt: string;
    readAt: string | null;
    actionTakenAt: string | null;
  }[];
  unreadCount: number;
};
const body = <T>(res: { body: unknown }): Envelope<T> =>
  res.body as Envelope<T>;

function matches(row: Row, where: Record<string, unknown>): boolean {
  return Object.entries(where).every(([key, value]) => {
    const actual = (row as unknown as Record<string, unknown>)[key];
    return value === null ? actual === null : actual === value;
  });
}

const prismaStub = {
  notification: {
    findMany: (args: {
      where: Record<string, unknown>;
      take: number;
      skip: number;
    }) =>
      Promise.resolve(
        rows
          .filter((r) => matches(r, args.where))
          .sort((a, b) => b.sentAt.getTime() - a.sentAt.getTime())
          .slice(args.skip, args.skip + args.take),
      ),
    count: (args: { where: Record<string, unknown> }) =>
      Promise.resolve(rows.filter((r) => matches(r, args.where)).length),
    findFirst: (args: { where: Record<string, unknown> }) =>
      Promise.resolve(rows.find((r) => matches(r, args.where)) ?? null),
    update: (args: {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    }) => {
      const row = rows.find((r) => matches(r, args.where));
      if (!row) {
        return Promise.reject(
          new Prisma.PrismaClientKnownRequestError("not found", {
            code: "P2025",
            clientVersion: "6",
          }),
        );
      }
      Object.assign(row, args.data);
      return Promise.resolve(row);
    },
  },
};

describe("Notifications (e2e)", () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [NotificationsModule],
    })
      .overrideProvider(PrismaService)
      .useValue(prismaStub)
      .overrideGuard(CookieAuthGuard)
      .useValue({
        canActivate: (context: ExecutionContext) => {
          context.switchToHttp().getRequest<{ user: unknown }>().user = USER;
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

  describe("GET /notifications", () => {
    it("answers with the envelope, newest first, and the inbox-wide unread count", async () => {
      const res = await request(app.getHttpServer()).get("/notifications");

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        success: true,
        message: "Found 2 notifications",
      });
      const data = body<ListData>(res).data;
      expect(data.notifications.map((n) => n.id)).toEqual(["n2", "n1"]);
      expect(data.unreadCount).toBe(1);
      // Another student's row is never in the page or the count.
      expect(data.notifications.map((n) => n.id)).not.toContain("n3");
      expect(data.notifications[0].sentAt).toBe("2026-09-02T00:00:00.000Z");
    });

    it("coerces and honours limit/offset", async () => {
      const res = await request(app.getHttpServer()).get(
        "/notifications?limit=1&offset=1",
      );

      expect(res.status).toBe(200);
      expect(body<ListData>(res).data.notifications).toHaveLength(1);
    });

    it("rejects an out-of-range limit", async () => {
      const res = await request(app.getHttpServer()).get(
        "/notifications?limit=999",
      );

      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({ statusCode: 400 });
    });

    it("rejects an unknown query param (forbidNonWhitelisted)", async () => {
      const res = await request(app.getHttpServer()).get(
        "/notifications?topic=EXAM",
      );

      expect(res.status).toBe(400);
    });
  });

  describe("PATCH /notifications/:id/read", () => {
    it("stamps readAt and returns the updated notification", async () => {
      const res = await request(app.getHttpServer()).patch(
        "/notifications/n1/read",
      );

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        success: true,
        message: "Notification marked as read",
      });
      expect(
        body<ListData["notifications"][number]>(res).data.readAt,
      ).not.toBeNull();
    });

    it("404s on another student's notification", async () => {
      const res = await request(app.getHttpServer()).patch(
        "/notifications/n3/read",
      );

      expect(res.status).toBe(404);
      // The house 404 convention (see sessions/prisma-error.ts): a plain
      // NotFoundException whose message names the id, not the success envelope.
      expect(res.body).toMatchObject({
        statusCode: 404,
        message: "Cannot find notification with id n3",
      });
    });
  });

  describe("PATCH /notifications/:id/action-taken", () => {
    it("stamps actionTakenAt", async () => {
      const res = await request(app.getHttpServer()).patch(
        "/notifications/n2/action-taken",
      );

      expect(res.status).toBe(200);
      expect(
        body<ListData["notifications"][number]>(res).data.actionTakenAt,
      ).not.toBeNull();
    });

    it("404s on an unknown id", async () => {
      const res = await request(app.getHttpServer()).patch(
        "/notifications/nope/action-taken",
      );

      expect(res.status).toBe(404);
    });
  });
});
