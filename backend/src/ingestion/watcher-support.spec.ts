import type { ConfigService } from "@nestjs/config";
import { PrismaService } from "../prisma/prisma.service";
import {
  eachIntegrationTarget,
  INTEGRATION_BATCH_SIZE,
  isIngestionEnabled,
  jobItemBody,
  MAX_RESPONSE_BODY_CHARS,
  sleep,
  statusCodeOf,
} from "./watcher-support";

const config = (value: unknown): ConfigService =>
  ({ get: () => value }) as unknown as ConfigService;

describe("isIngestionEnabled", () => {
  it.each([
    [true, true],
    [undefined, true], // absent falls back to the Joi default
    ["true", true],
    [false, false],
    ["false", false], // an unvalidated env hands back the raw string
  ])("reads %p as %p", (raw, expected) => {
    expect(isIngestionEnabled(config(raw))).toBe(expected);
  });
});

describe("statusCodeOf", () => {
  it("recovers the status the HTTP clients embed in their message", () => {
    expect(
      statusCodeOf(new Error("LMS calendar request failed (status 503)")),
    ).toBe(503);
    expect(
      statusCodeOf(new Error("Portal request to /api/x failed (status 401)")),
    ).toBe(401);
  });

  it("is null when there is no status to recover", () => {
    expect(statusCodeOf(new Error("DLU LMS is unreachable"))).toBeNull();
    expect(statusCodeOf("not even an Error")).toBeNull();
  });
});

describe("jobItemBody", () => {
  it("keeps the raw payload and the parser's skip reasons together", () => {
    const body = jobItemBody({
      body: { weeks: [] },
      skipped: [{ ref: "portal:meeting:1000002", reason: "periods 5-6" }],
    });

    expect(JSON.parse(body)).toEqual({
      body: { weeks: [] },
      skipped: [{ ref: "portal:meeting:1000002", reason: "periods 5-6" }],
    });
  });

  it("records an error instead of a body when the request failed", () => {
    expect(JSON.parse(jobItemBody({ error: "boom" }))).toEqual({
      body: null,
      skipped: [],
      error: "boom",
    });
  });

  it("truncates a pathological payload rather than writing it whole", () => {
    const body = jobItemBody({ body: "x".repeat(MAX_RESPONSE_BODY_CHARS * 2) });

    expect(body.length).toBeLessThan(MAX_RESPONSE_BODY_CHARS + 20);
    expect(body.endsWith("[truncated]")).toBe(true);
  });
});

describe("sleep", () => {
  it("resolves immediately for a non-positive delay", async () => {
    const before = Date.now();
    await sleep(0);
    expect(Date.now() - before).toBeLessThan(50);
  });
});

describe("eachIntegrationTarget", () => {
  /** Pages `rows` the way Prisma's cursor pagination would. */
  function prismaOver(
    rows: { id: string; userId: string; provider: string; timezone: string }[],
  ) {
    const calls: Record<string, unknown>[] = [];
    const client = {
      integration: {
        findMany: (args: {
          where: { provider: string; userId?: string };
          take: number;
          cursor?: { id: string };
        }) => {
          calls.push(args);
          let page = rows
            .filter((r) => r.provider === args.where.provider)
            .filter((r) => !args.where.userId || r.userId === args.where.userId)
            .sort((a, b) => a.id.localeCompare(b.id));
          if (args.cursor) {
            page = page.slice(
              page.findIndex((r) => r.id === args.cursor!.id) + 1,
            );
          }
          return Promise.resolve(
            page.slice(0, args.take).map((r) => ({
              id: r.id,
              userId: r.userId,
              user: { timezone: r.timezone },
            })),
          );
        },
      },
    };
    return { prisma: client as unknown as PrismaService, calls };
  }

  const row = (n: number, provider = "LMS") => ({
    id: `int-${String(n).padStart(4, "0")}`,
    userId: `u${n}`,
    provider,
    timezone: "Asia/Ho_Chi_Minh",
  });

  it("visits every integration for the provider, in id order", async () => {
    const { prisma } = prismaOver([row(1), row(2), row(3, "PORTAL")]);
    const seen: string[] = [];

    const count = await eachIntegrationTarget(prisma, "LMS", undefined, (t) => {
      seen.push(t.integrationId);
      return Promise.resolve();
    });

    expect(count).toBe(2);
    expect(seen).toEqual(["int-0001", "int-0002"]);
  });

  it("carries the owner's timezone through", async () => {
    const { prisma } = prismaOver([row(1)]);
    const zones: string[] = [];

    await eachIntegrationTarget(prisma, "LMS", undefined, (t) => {
      zones.push(t.timezone);
      return Promise.resolve();
    });

    expect(zones).toEqual(["Asia/Ho_Chi_Minh"]);
  });

  it("pages past the batch size instead of loading the table", async () => {
    const rows = Array.from({ length: INTEGRATION_BATCH_SIZE + 5 }, (_, i) =>
      row(i + 1),
    );
    const { prisma, calls } = prismaOver(rows);
    let visited = 0;

    const count = await eachIntegrationTarget(prisma, "LMS", undefined, () => {
      visited += 1;
      return Promise.resolve();
    });

    expect(count).toBe(INTEGRATION_BATCH_SIZE + 5);
    expect(visited).toBe(INTEGRATION_BATCH_SIZE + 5);
    expect(calls).toHaveLength(2);
    expect(calls[1].cursor).toEqual({
      id: `int-${String(INTEGRATION_BATCH_SIZE).padStart(4, "0")}`,
    });
  });

  it("narrows to one student when a userId is given", async () => {
    const { prisma } = prismaOver([row(1), row(2)]);
    const seen: string[] = [];

    const count = await eachIntegrationTarget(prisma, "LMS", "u2", (t) => {
      seen.push(t.userId);
      return Promise.resolve();
    });

    expect(count).toBe(1);
    expect(seen).toEqual(["u2"]);
  });
});
