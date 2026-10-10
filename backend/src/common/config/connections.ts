/**
 * Connection settings composed from parts (host, port, user, password), never
 * from a URL env var. Every function takes a `get(key)` lookup so it works with
 * `ConfigService`, `process.env` and plain objects alike. Passwords are
 * URL-encoded or passed as options, never spliced in raw.
 *
 * `scripts/with-database-url.cjs` repeats `databaseUrl()` for the Prisma CLI;
 * `connections.spec.ts` keeps the two in step.
 */
export type Getter = (key: string) => string | number | boolean | undefined;

const text = (get: Getter, key: string): string | undefined => {
  const value = get(key);
  if (value === undefined || value === null) return undefined;
  const s = String(value);
  return s === "" ? undefined : s;
};

const need = (get: Getter, key: string): string => {
  const value = text(get, key);
  if (value === undefined) throw new Error(`${key} is not configured`);
  return value;
};

/** `postgresql://user:pass@host:port/db?schema=public[&sslmode=...]` from `DB_*` and `POSTGRES_*`. */
export function databaseUrl(get: Getter): string {
  const user = encodeURIComponent(need(get, "POSTGRES_USER"));
  const password = encodeURIComponent(need(get, "POSTGRES_PASSWORD"));
  const db = encodeURIComponent(need(get, "POSTGRES_DB"));
  const host = need(get, "DB_HOST");
  const port = text(get, "DB_PORT") ?? "5432";
  const params = new URLSearchParams({
    schema: text(get, "DB_SCHEMA") ?? "public",
  });
  const sslmode = text(get, "DB_SSLMODE");
  if (sslmode) params.set("sslmode", sslmode);
  return `postgresql://${user}:${password}@${host}:${port}/${db}?${params}`;
}

export interface RedisConnection {
  host: string;
  port: number;
  password?: string;
}

/** Options for `<PREFIX>_HOST` / `_PORT` / `_PASSWORD`; `undefined` when the host is unset. */
export function redisOptions(
  get: Getter,
  prefix: string,
): RedisConnection | undefined {
  const host = text(get, `${prefix}_HOST`);
  if (!host) return undefined;
  const password = text(get, `${prefix}_PASSWORD`);
  return {
    host,
    port: Number(text(get, `${prefix}_PORT`) ?? 6379),
    ...(password ? { password } : {}),
  };
}

/** `redis://[:pass@]host:port`, for libraries that only take a URL (keyv). */
export function redisUrl({ host, port, password }: RedisConnection): string {
  const auth = password ? `:${encodeURIComponent(password)}@` : "";
  return `redis://${auth}${host}:${port}`;
}

export interface MailTransport {
  host: string;
  port: number;
  secure: boolean;
  auth?: { user: string; pass: string };
}

/** Nodemailer transport from `MAIL_HOST` / `MAIL_PORT` / `MAIL_SECURE` / `MAIL_USER` / `MAIL_PASSWORD`. */
export function mailTransport(get: Getter): MailTransport {
  const user = text(get, "MAIL_USER");
  return {
    host: need(get, "MAIL_HOST"),
    port: Number(text(get, "MAIL_PORT") ?? 587),
    secure: text(get, "MAIL_SECURE") === "true",
    ...(user ? { auth: { user, pass: text(get, "MAIL_PASSWORD") ?? "" } } : {}),
  };
}
