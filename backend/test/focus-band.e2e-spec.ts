import { ConfigModule } from "@nestjs/config";
import {
  INestApplication,
  ValidationPipe,
  type ExecutionContext,
} from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import type { App } from "supertest/types";
import type { PreferenceMatrixResponse } from "@zenflow/shared";
import { CookieAuthGuard } from "../src/auth/guards";
import { focusBandPrior } from "../src/scheduler/core/focus-band";
import {
  defaultPreferenceMatrix,
  matrixIndex,
} from "../src/scheduler/core/preference";
import { PrismaService } from "../src/prisma/prisma.service";
import { UsersModule } from "../src/users/users.module";
import type { User } from "../generated/prisma";

/**
 * PATCH /users/update/basic-info { focusBand } seeds the preference matrix
 * (issue #253) against a real database, which the row-locked write needs.
 * Needs the Postgres of the test stack (`DB_HOST`, `POSTGRES_*` in the env).
 */

const PREFIX = "focus-band-e2e";
const PATCH = "/api/v1/users/update/basic-info";
const ME = "/api/v1/users/me";
const MATRIX = "/api/v1/users/me/preference-matrix";

let prisma: PrismaService;
let app: INestApplication<App>;
let currentUserId = "";

const data = <T>(res: { body: unknown }) => (res.body as { data: T }).data;

async function newUser(tag: string, preferenceMatrix: number[] = []) {
  return prisma.user.create({
    data: {
      email: `${PREFIX}-${tag}-${Date.now()}@example.test`,
      name: tag,
      preferenceMatrix,
    },
  });
}

async function stored(id: string) {
  return prisma.user.findUniqueOrThrow({ where: { id } });
}

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({
    imports: [ConfigModule.forRoot({ isGlobal: true }), UsersModule],
  })
    .overrideGuard(CookieAuthGuard)
    .useValue({
      canActivate: async (ctx: ExecutionContext) => {
        const req = ctx.switchToHttp().getRequest<{ user: User }>();
        req.user = await prisma.user.findUniqueOrThrow({
          where: { id: currentUserId },
        });
        return true;
      },
    })
    .compile();
  app = moduleRef.createNestApplication();
  app.setGlobalPrefix("api/v1");
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );
  await app.init();
  prisma = app.get(PrismaService);
});

afterAll(async () => {
  await prisma.user.deleteMany({
    where: { email: { startsWith: PREFIX } },
  });
  await app.close();
});

describe("focus band onboarding (e2e)", () => {
  it("stores the band and seeds a new user's empty matrix", async () => {
    const user = await newUser("seed");
    currentUserId = user.id;

    const res = await request(app.getHttpServer())
      .patch(PATCH)
      .send({ focusBand: "EVENING" })
      .expect(200);
    expect(data<User>(res).focusBand).toBe("EVENING");

    const row = await stored(user.id);
    expect(row.focusBand).toBe("EVENING");
    expect(row.preferenceMatrix).toEqual(focusBandPrior("EVENING"));
  });

  it("serves the seeded matrix to the Insights endpoint", async () => {
    const user = await newUser("insights");
    currentUserId = user.id;
    await request(app.getHttpServer())
      .patch(PATCH)
      .send({ focusBand: "MORNING" })
      .expect(200);

    const res = await request(app.getHttpServer()).get(MATRIX).expect(200);
    const body = data<PreferenceMatrixResponse>(res);
    expect(body.matrix[matrixIndex(4, 9)]).toBeGreaterThan(
      body.matrix[matrixIndex(4, 20)],
    );
  });

  it("leaves a learned matrix as it is and still stores the band", async () => {
    const learned = defaultPreferenceMatrix();
    learned[matrixIndex(2, 10)] = 0.75;
    const user = await newUser("learned", learned);
    currentUserId = user.id;

    await request(app.getHttpServer())
      .patch(PATCH)
      .send({ focusBand: "LATE_NIGHT" })
      .expect(200);

    const row = await stored(user.id);
    expect(row.focusBand).toBe("LATE_NIGHT");
    expect(row.preferenceMatrix).toEqual(learned);
  });

  it("seeds on the same call that completes onboarding", async () => {
    const user = await newUser("onboard");
    currentUserId = user.id;

    await request(app.getHttpServer())
      .patch(PATCH)
      .send({ focusBand: "AFTERNOON", onboarded: true })
      .expect(200);

    const row = await stored(user.id);
    expect(row.onboardedAt).not.toBeNull();
    expect(row.preferenceMatrix).toEqual(focusBandPrior("AFTERNOON"));
  });

  it("rejects a band outside the four allowed values", async () => {
    const user = await newUser("invalid");
    currentUserId = user.id;

    await request(app.getHttpServer())
      .patch(PATCH)
      .send({ focusBand: "NIGHT" })
      .expect(400);

    const row = await stored(user.id);
    expect(row.focusBand).toBeNull();
    expect(row.preferenceMatrix).toEqual([]);
  });

  it("returns focusBand on GET /users/me", async () => {
    const user = await newUser("me");
    currentUserId = user.id;
    const res = await request(app.getHttpServer()).get(ME).expect(200);
    expect(data<User>(res).focusBand).toBeNull();
  });
});
