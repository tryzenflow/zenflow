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
import { CourseColoursModule } from "../src/course-colours/course-colours.module";
import { PrismaService } from "../src/prisma/prisma.service";

/** GET / PUT / DELETE /course-colours over a stubbed Prisma (issue #238). */

interface Row {
  userId: string;
  courseKey: string;
  swatch: number;
}
const rows: Row[] = [];
const user = { id: "u1" };
const other = { id: "u2" };
let currentUser = user;

const prismaStub = {
  courseColour: {
    findMany: ({ where }: { where: { userId: string } }) =>
      rows
        .filter((r) => r.userId === where.userId)
        .map(({ courseKey, swatch }) => ({ courseKey, swatch })),
    upsert: ({
      where,
      create,
      update,
    }: {
      where: { userId_courseKey: { userId: string; courseKey: string } };
      create: Row;
      update: { swatch: number };
    }) => {
      const { userId, courseKey } = where.userId_courseKey;
      const existing = rows.find(
        (r) => r.userId === userId && r.courseKey === courseKey,
      );
      if (existing) existing.swatch = update.swatch;
      else rows.push({ ...create });
      const row = rows.find(
        (r) => r.userId === userId && r.courseKey === courseKey,
      ) as Row;
      return { courseKey: row.courseKey, swatch: row.swatch };
    },
    deleteMany: ({
      where,
    }: {
      where: { userId: string; courseKey: string };
    }) => {
      const before = rows.length;
      for (let i = rows.length - 1; i >= 0; i--) {
        const r = rows[i];
        if (r.userId === where.userId && r.courseKey === where.courseKey)
          rows.splice(i, 1);
      }
      return { count: before - rows.length };
    },
  },
};

interface ListBody {
  data: { colours: { courseKey: string; swatch: number }[] };
}
interface SetBody {
  data: { courseKey: string; swatch: number };
}

describe("course colours API (e2e)", () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true }), CourseColoursModule],
    })
      .overrideProvider(PrismaService)
      .useValue(prismaStub)
      .overrideGuard(CookieAuthGuard)
      .useValue({
        canActivate: (ctx: ExecutionContext) => {
          ctx.switchToHttp().getRequest<{ user: unknown }>().user = currentUser;
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
  beforeEach(() => {
    rows.length = 0;
    currentUser = user;
  });

  it("starts with no picks", async () => {
    const res = await request(app.getHttpServer())
      .get("/course-colours")
      .expect(200);
    expect((res.body as ListBody).data.colours).toEqual([]);
  });

  it("saves a pick and lists it", async () => {
    const http = request(app.getHttpServer());
    const put = await http
      .put(`/course-colours/${encodeURIComponent("lms:90001")}`)
      .send({ swatch: 5 })
      .expect(200);
    expect((put.body as SetBody).data).toEqual({
      courseKey: "lms:90001",
      swatch: 5,
    });
    const list = await http.get("/course-colours").expect(200);
    expect((list.body as ListBody).data.colours).toEqual([
      { courseKey: "lms:90001", swatch: 5 },
    ]);
  });

  it("overwrites an existing pick", async () => {
    const http = request(app.getHttpServer());
    const key = encodeURIComponent("portal:99910AB100101");
    await http.put(`/course-colours/${key}`).send({ swatch: 1 }).expect(200);
    await http.put(`/course-colours/${key}`).send({ swatch: 9 }).expect(200);
    const list = await http.get("/course-colours").expect(200);
    expect(
      (list.body as ListBody).data.colours.filter(
        (c) => c.courseKey === "portal:99910AB100101",
      ),
    ).toEqual([{ courseKey: "portal:99910AB100101", swatch: 9 }]);
  });

  it("rejects a swatch outside 0 to 11 or not an integer", async () => {
    const http = request(app.getHttpServer());
    const key = encodeURIComponent("lms:1");
    await http.put(`/course-colours/${key}`).send({ swatch: 12 }).expect(400);
    await http.put(`/course-colours/${key}`).send({ swatch: -1 }).expect(400);
    await http.put(`/course-colours/${key}`).send({ swatch: 1.5 }).expect(400);
    await http.put(`/course-colours/${key}`).send({}).expect(400);
  });

  it("rejects a malformed course key", async () => {
    await request(app.getHttpServer())
      .put(`/course-colours/${encodeURIComponent("bogus")}`)
      .send({ swatch: 0 })
      .expect(400);
  });

  it("resets a pick and keeps other users' picks", async () => {
    const http = request(app.getHttpServer());
    const key = encodeURIComponent("lms:90002");
    await http.put(`/course-colours/${key}`).send({ swatch: 3 }).expect(200);
    rows.push({ userId: other.id, courseKey: "lms:90002", swatch: 7 });

    const del = await http.delete(`/course-colours/${key}`).expect(200);
    expect((del.body as { data: unknown }).data).toEqual({
      courseKey: "lms:90002",
    });

    currentUser = user;
    const list = await http.get("/course-colours").expect(200);
    expect((list.body as ListBody).data.colours).toEqual([]);
    expect(rows).toEqual([
      { userId: other.id, courseKey: "lms:90002", swatch: 7 },
    ]);
  });
});
