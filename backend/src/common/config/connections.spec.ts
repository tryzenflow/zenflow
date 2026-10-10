import { createRequire } from "node:module";
import {
  databaseUrl,
  mailTransport,
  redisOptions,
  redisUrl,
  type Getter,
} from "./connections";

const from =
  (env: Record<string, string | number | boolean>): Getter =>
  (key) =>
    env[key];

const DB = {
  DB_HOST: "postgres",
  POSTGRES_USER: "admin",
  POSTGRES_PASSWORD: "p@ss:w/rd#1%",
  POSTGRES_DB: "zenflow-prod",
};

describe("databaseUrl", () => {
  it("encodes credentials and defaults port and schema", () => {
    expect(databaseUrl(from(DB))).toBe(
      "postgresql://admin:p%40ss%3Aw%2Frd%231%25@postgres:5432/zenflow-prod?schema=public",
    );
  });

  it("takes port, schema and sslmode when given", () => {
    const url = databaseUrl(
      from({ ...DB, DB_PORT: 5433, DB_SCHEMA: "app", DB_SSLMODE: "require" }),
    );
    expect(url).toBe(
      "postgresql://admin:p%40ss%3Aw%2Frd%231%25@postgres:5433/zenflow-prod?schema=app&sslmode=require",
    );
  });

  it("round-trips through the URL parser", () => {
    const u = new URL(databaseUrl(from(DB)));
    expect(decodeURIComponent(u.password)).toBe(DB.POSTGRES_PASSWORD);
    expect(u.hostname).toBe("postgres");
  });

  it("names the missing key", () => {
    expect(() => databaseUrl(from({ ...DB, POSTGRES_PASSWORD: "" }))).toThrow(
      "POSTGRES_PASSWORD is not configured",
    );
  });

  it("matches the Prisma CLI wrapper", () => {
    const { databaseUrl: cli } = createRequire(__filename)(
      "../../../scripts/with-database-url.cjs",
    ) as { databaseUrl: (env: Record<string, string>) => string };
    const env = { ...DB, DB_PORT: "5433", DB_SSLMODE: "disable" };
    expect(cli(env)).toBe(databaseUrl(from(env)));
  });
});

describe("redisOptions", () => {
  it("is undefined without a host", () => {
    expect(redisOptions(from({}), "QUEUE_REDIS")).toBeUndefined();
    expect(
      redisOptions(from({ QUEUE_REDIS_HOST: "" }), "QUEUE_REDIS"),
    ).toBeUndefined();
  });

  it("defaults the port and omits an unset password", () => {
    expect(
      redisOptions(from({ SESSION_REDIS_HOST: "c" }), "SESSION_REDIS"),
    ).toEqual({
      host: "c",
      port: 6379,
    });
  });

  it("reads port and password per prefix", () => {
    const get = from({
      REDIS_PUBSUB_HOST: "ps",
      REDIS_PUBSUB_PORT: "6382",
      REDIS_PUBSUB_PASSWORD: "s3cr@t",
    });
    expect(redisOptions(get, "REDIS_PUBSUB")).toEqual({
      host: "ps",
      port: 6382,
      password: "s3cr@t",
    });
  });
});

describe("redisUrl", () => {
  it("renders without and with a password", () => {
    expect(redisUrl({ host: "c", port: 6379 })).toBe("redis://c:6379");
    expect(redisUrl({ host: "c", port: 6379, password: "a@b" })).toBe(
      "redis://:a%40b@c:6379",
    );
  });
});

describe("mailTransport", () => {
  it("omits auth without a user (Mailpit)", () => {
    expect(mailTransport(from({ MAIL_HOST: "mail", MAIL_PORT: 1025 }))).toEqual(
      { host: "mail", port: 1025, secure: false },
    );
  });

  it("adds auth and secure", () => {
    expect(
      mailTransport(
        from({
          MAIL_HOST: "smtp.example.com",
          MAIL_PORT: 465,
          MAIL_SECURE: "true",
          MAIL_USER: "u",
          MAIL_PASSWORD: "p@ss",
        }),
      ),
    ).toEqual({
      host: "smtp.example.com",
      port: 465,
      secure: true,
      auth: { user: "u", pass: "p@ss" },
    });
  });

  it("defaults the port to 587", () => {
    expect(mailTransport(from({ MAIL_HOST: "h" })).port).toBe(587);
  });
});
