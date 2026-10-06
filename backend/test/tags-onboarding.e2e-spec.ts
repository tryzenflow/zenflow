import { ConfigModule } from "@nestjs/config";
import {
  INestApplication,
  ValidationPipe,
  type ExecutionContext,
} from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import type { App } from "supertest/types";
import { CookieAuthGuard } from "../src/auth/guards";
import { PrismaService } from "../src/prisma/prisma.service";
import { TagsModule } from "../src/tags/tags.module";
import { UsersModule } from "../src/users/users.module";

/** POST /tags/bulk and PATCH /users/update/basic-info { onboarded } over a stubbed Prisma. */

const tags: { id: string; userId: string; name: string }[] = [];
const user = {
  id: "u1",
  onboardedAt: null as Date | null,
  lang: "VI_VN",
  allowNotifications: true,
  seenTips: [] as string[],
};

const prismaStub = {
  tag: {
    createMany: ({ data }: { data: { userId: string; name: string }[] }) => {
      for (const d of data)
        if (!tags.some((t) => t.userId === d.userId && t.name === d.name))
          tags.push({ id: `t${tags.length}`, ...d });
      return {};
    },
    findMany: ({
      where,
    }: {
      where: { userId: string; name: { in: string[] } };
    }) =>
      tags
        .filter(
          (t) => t.userId === where.userId && where.name.in.includes(t.name),
        )
        .sort((a, b) => a.name.localeCompare(b.name))
        .map(({ id, name }) => ({ id, name })),
  },
  user: {
    updateMany: ({
      data,
    }: {
      data: { onboardedAt?: Date; seenTips?: { push: string } };
    }) => {
      if (data.onboardedAt && user.onboardedAt === null)
        user.onboardedAt = data.onboardedAt;
      const tip = data.seenTips?.push;
      if (tip && !user.seenTips.includes(tip)) user.seenTips.push(tip);
      return { count: 1 };
    },
    update: ({ data }: { data: { allowNotifications?: boolean } }) => {
      if (data.allowNotifications !== undefined)
        user.allowNotifications = data.allowNotifications;
      return { ...user };
    },
  },
};

interface Body {
  data: {
    tags: { name: string }[];
    onboardedAt: string | null;
    allowNotifications: boolean;
    seenTips: string[];
  };
}
const parse = (r: { body: unknown }) => r.body as Body;

describe("onboarding API (e2e)", () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        TagsModule,
        UsersModule,
      ],
    })
      .overrideProvider(PrismaService)
      .useValue(prismaStub)
      .overrideGuard(CookieAuthGuard)
      .useValue({
        canActivate: (ctx: ExecutionContext) => {
          ctx.switchToHttp().getRequest<{ user: unknown }>().user = user;
          return true;
        },
      })
      .compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
        transformOptions: { enableImplicitConversion: true },
      }),
    );
    await app.init();
  });
  afterAll(() => app.close());

  it("bulk-creates tags idempotently", async () => {
    const body = { names: [" Study ", "Exam", "Study"] };
    const a = await request(app.getHttpServer())
      .post("/tags/bulk")
      .send(body)
      .expect(200);
    const b = await request(app.getHttpServer())
      .post("/tags/bulk")
      .send(body)
      .expect(200);
    expect(parse(a).data.tags.map((t) => t.name)).toEqual(["Exam", "Study"]);
    expect(parse(b).data).toEqual(parse(a).data);
    expect(tags).toHaveLength(2);
  });

  it("rejects empty / oversized / non-string names", async () => {
    const http = request(app.getHttpServer());
    await http.post("/tags/bulk").send({ names: [] }).expect(400);
    await http
      .post("/tags/bulk")
      .send({ names: [1] })
      .expect(400);
    await http
      .post("/tags/bulk")
      .send({ names: ["x".repeat(51)] })
      .expect(400);
  });

  it("completes onboarding once; second call keeps the first timestamp", async () => {
    const http = request(app.getHttpServer());
    const first = await http
      .patch("/users/update/basic-info")
      .send({ onboarded: true })
      .expect(200);
    const stamp = parse(first).data.onboardedAt;
    expect(stamp).toBeTruthy();
    const second = await http
      .patch("/users/update/basic-info")
      .send({ onboarded: true })
      .expect(200);
    expect(parse(second).data.onboardedAt).toBe(stamp);
    await http
      .patch("/users/update/basic-info")
      .send({ onboarded: false })
      .expect(400);
  });

  it("defaults allowNotifications to true and lets the user toggle it", async () => {
    const http = request(app.getHttpServer());
    const off = await http
      .patch("/users/update/basic-info")
      .send({ allowNotifications: false })
      .expect(200);
    expect(parse(off).data.allowNotifications).toBe(false);
    const on = await http
      .patch("/users/update/basic-info")
      .send({ allowNotifications: true })
      .expect(200);
    expect(parse(on).data.allowNotifications).toBe(true);
    await http
      .patch("/users/update/basic-info")
      .send({ allowNotifications: "no" })
      .expect(400);
  });

  it("records a done checklist step once and rejects unknown ids", async () => {
    const http = request(app.getHttpServer());
    const patch = (body: object) =>
      http.patch("/users/update/basic-info").send(body);
    await patch({ seenTip: "create-task" }).expect(200);
    const again = await patch({ seenTip: "create-task" }).expect(200);
    const other = await patch({ seenTip: "checklist-hidden" }).expect(200);
    expect(parse(again).data.seenTips).toEqual(["create-task"]);
    expect(parse(other).data.seenTips).toEqual([
      "create-task",
      "checklist-hidden",
    ]);
    await patch({ seenTip: "nope" }).expect(400);
  });
});
