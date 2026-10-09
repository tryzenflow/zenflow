import { spawnSync } from "child_process";
import * as path from "path";

/**
 * Postgres backup service, end to end (ADR-0014, docs/ops/backups.md).
 *
 * Boots `compose.backup-e2e.yml`: its own Postgres + MinIO and the real `backup`
 * service (same scripts and crond entrypoint as staging/prod, scheduled every
 * minute). Everything is observed from outside: objects in MinIO, the textfile
 * metrics, and exit codes of the scripts. No ports are published and no other
 * stack is touched, so it runs next to a dev/test stack.
 *
 * Part of `pnpm --filter backend test:e2e`; alone: `pnpm --filter backend exec jest
 * --config ./test/jest-e2e.json backup`. Needs Docker; ~2 min, mostly waiting for
 * crond's first tick.
 */

jest.setTimeout(420_000);

const COMPOSE = path.join(__dirname, "compose.backup-e2e.yml");
const PROJECT = "zenflow-backup-e2e";
const BUCKET = "zenflow-backups-e2e";
const PREFIX = "zenflow/e2e";

type Run = { code: number; out: string };

/** Throwaway age keypair, generated per run (see beforeAll); never committed. */
let ageEnv: Record<string, string> = {};

function generateAgeKeypair(): Record<string, string> {
  const r = spawnSync(
    "docker",
    [
      "run",
      "--rm",
      "--entrypoint",
      "sh",
      "postgres:18.4-alpine",
      "-c",
      "apk add --no-cache age >/dev/null 2>&1 && age-keygen 2>/dev/null",
    ],
    { encoding: "utf8" },
  );
  const pub = /age1[a-z0-9]+/.exec(r.stdout)?.[0];
  const secret = /AGE-SECRET-KEY-[A-Z0-9]+/.exec(r.stdout)?.[0];
  if (!pub || !secret)
    throw new Error(`age-keygen failed: ${r.stdout}${r.stderr}`);
  return { BACKUP_AGE_RECIPIENT: pub, BACKUP_AGE_IDENTITY: secret };
}

function dc(args: string[], input?: string): Run {
  const r = spawnSync(
    "docker",
    ["compose", "-p", PROJECT, "-f", COMPOSE, ...args],
    {
      encoding: "utf8",
      input,
      env: { ...process.env, ...ageEnv },
    },
  );
  return { code: r.status ?? 1, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

/** Runs a shell snippet inside the backup container with its job environment. */
function inBackup(script: string): Run {
  return dc([
    "exec",
    "-T",
    "backup",
    "sh",
    "-c",
    `. /run/backup.env; . /opt/backup/lib.sh; ${script}`,
  ]);
}

function ok(r: Run): string {
  if (r.code !== 0) throw new Error(`exit ${r.code}: ${r.out}`);
  return r.out.trim();
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function until<T>(
  what: string,
  fn: () => T | undefined | false,
  ms = 150_000,
): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = fn();
    if (v) return v;
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await sleep(3_000);
  }
}

/** Value of a one-sample textfile metric, or undefined when the job never wrote it. */
function metric(file: string): number | undefined {
  const r = dc(["exec", "-T", "backup", "cat", `/metrics/${file}.prom`]);
  if (r.code !== 0) return undefined;
  const line = r.out.split("\n").find((l) => l && !l.startsWith("#"));
  return line ? Number(line.trim().split(/\s+/).pop()) : undefined;
}

function listKeys(): string[] {
  const out = ok(
    inBackup(`s3 s3 ls --recursive s3://${BUCKET}/${PREFIX}/ || true`),
  );
  return out
    .split("\n")
    .map((l) => l.trim().split(/\s+/)[3])
    .filter(Boolean);
}

describe("backup service", () => {
  beforeAll(() => {
    ageEnv = generateAgeKeypair();
    dc(["down", "-v", "--remove-orphans"]);
    ok(dc(["up", "-d", "--wait"])); // --wait: backup is healthy once crond runs
    // A minimal "prisma" shape: the restore test checks _prisma_migrations is non-empty.
    ok(
      dc(
        [
          "exec",
          "-T",
          "postgres",
          "psql",
          "-U",
          "e2e",
          "-d",
          "zenflow",
          "-v",
          "ON_ERROR_STOP=1",
        ],
        `CREATE TABLE _prisma_migrations (id int);
         INSERT INTO _prisma_migrations VALUES (1);
         CREATE TABLE marker (v text);
         INSERT INTO marker VALUES ('hello-backup');
         INSERT INTO marker SELECT md5(g::text) FROM generate_series(1, 5000) g;`,
      ),
    );
  });

  afterAll(() => {
    if (process.env.KEEP_STACK !== "1") dc(["down", "-v", "--remove-orphans"]);
  });

  it("installs a crontab with both the backup and the restore job", () => {
    const tab = ok(dc(["exec", "-T", "backup", "cat", "/etc/crontabs/root"]));
    expect(tab).toMatch(/backup\.sh/);
    expect(tab).toMatch(/restore-test\.sh/);
  });

  it("crond uploads an encrypted dump and records the metrics", async () => {
    const key = await until("a cron-made dump in S3", () =>
      listKeys().find((k) => k.endsWith(".dump.age")),
    );
    expect(key).toMatch(
      new RegExp(
        `^${PREFIX}/\\d{4}/\\d{2}/\\d{2}/zenflow-\\d{8}T\\d{6}Z\\.dump\\.age$`,
      ),
    );

    // Ciphertext, not a pg_dump custom archive.
    const head = ok(
      inBackup(
        `s3 s3 cp --only-show-errors s3://${BUCKET}/${key} /tmp/head.age && head -c 21 /tmp/head.age`,
      ),
    );
    expect(head).toBe("age-encryption.org/v1");

    await until(
      "backup metrics",
      () => metric("zenflow_backup_success") !== undefined,
    );
    const ts = metric("zenflow_backup_success")!;
    expect(Date.now() / 1000 - ts).toBeLessThan(300);
    expect(metric("zenflow_backup_size")).toBeGreaterThan(1000);
  });

  it("snapshots the Vault data directory next to the dump", async () => {
    const key = await until("a vault snapshot", () =>
      listKeys().find((k) => /vault-.*\.tar\.age$/.test(k)),
    );
    expect(key).toBeTruthy();
  });

  it("the dump decrypts with the identity and contains the data", () => {
    ok(inBackup("sh /opt/backup/backup.sh")); // a dump taken after the seed
    const latest = listKeys()
      .filter((k) => k.endsWith(".dump.age"))
      .sort()
      .pop()!;
    const out = ok(
      inBackup(
        `d=$(mktemp -d); printf '%s\\n' "$BACKUP_AGE_IDENTITY" > $d/id;
         s3 s3 cp --only-show-errors s3://${BUCKET}/${latest} $d/x.age
         age -d -i $d/id -o $d/x.dump $d/x.age
         pg_restore -f - $d/x.dump | grep -c hello-backup; rm -rf $d`,
      ),
    );
    expect(Number(out)).toBeGreaterThan(0);
  });

  it("the restore test passes when run by cron and by hand", async () => {
    await until(
      "cron-made restore metric",
      () => metric("zenflow_backup_restore_success") !== undefined,
    );
    const out = ok(inBackup("sh /opt/backup/restore-test.sh"));
    expect(out).toMatch(/restore OK: \d+ tables, \d+ migrations/);
  });

  it("the restore test fails with a wrong age identity and keeps the old metric", () => {
    const before = metric("zenflow_backup_restore_success");
    const r = inBackup(
      "BACKUP_AGE_IDENTITY=AGE-SECRET-KEY-1NOTAREALKEY sh /opt/backup/restore-test.sh",
    );
    expect(r.code).not.toBe(0);
    expect(metric("zenflow_backup_restore_success")).toBe(before);
  });

  it("the restore test fails and writes nothing when there is no dump", () => {
    const r = inBackup(`BACKUP_ENV=nobackups sh /opt/backup/restore-test.sh`);
    expect(r.code).not.toBe(0);
    expect(r.out).toMatch(/no dump found/);
  });

  it("a suspiciously small dump fails the run and records no success", () => {
    const before = metric("zenflow_backup_success");
    const r = inBackup("BACKUP_MIN_BYTES=999999999 sh /opt/backup/backup.sh");
    expect(r.code).not.toBe(0);
    expect(r.out).toMatch(/below BACKUP_MIN_BYTES/);
    expect(metric("zenflow_backup_success")).toBe(before);
    expect(metric("zenflow_backup_size")).toBeGreaterThan(0); // size still reported for the alert
  });

  it("an S3 failure fails the run and records no success", () => {
    const before = metric("zenflow_backup_success");
    const r = inBackup(
      "BACKUP_S3_SECRET_ACCESS_KEY=wrong sh /opt/backup/backup.sh",
    );
    expect(r.code).not.toBe(0);
    expect(metric("zenflow_backup_success")).toBe(before);
  });

  it("a database failure fails the run and records no success", () => {
    const before = metric("zenflow_backup_success");
    const r = inBackup("POSTGRES_DB=does_not_exist sh /opt/backup/backup.sh");
    expect(r.code).not.toBe(0);
    expect(metric("zenflow_backup_success")).toBe(before);
  });

  it("prunes by age and keeps recent objects", () => {
    const put = (day: string) =>
      ok(
        inBackup(
          `echo x | s3 s3 cp --only-show-errors - s3://${BUCKET}/${PREFIX}/${day}/zenflow-old.dump.age`,
        ),
      );
    put("2000/01/01");
    put("2020/06/15");
    ok(
      inBackup(
        `put=$(date -u -d "@$(( $(date +%s) - 86400 ))" +%Y/%m/%d); echo x | s3 s3 cp --only-show-errors - s3://${BUCKET}/${PREFIX}/$put/zenflow-yesterday.dump.age`,
      ),
    );

    ok(inBackup("BACKUP_PRUNE_DAYS=1 sh /opt/backup/backup.sh"));

    const keys = listKeys();
    expect(keys.some((k) => k.includes("/2000/01/01/"))).toBe(false);
    expect(keys.some((k) => k.includes("/2020/06/15/"))).toBe(false);
    expect(keys.some((k) => k.endsWith("zenflow-yesterday.dump.age"))).toBe(
      true,
    );
    expect(keys.filter((k) => /zenflow-\d{8}T/.test(k)).length).toBeGreaterThan(
      0,
    );
  });

  it("does not prune when BACKUP_PRUNE_DAYS is unset (prod relies on S3 lifecycle)", () => {
    ok(
      inBackup(
        `echo x | s3 s3 cp --only-show-errors - s3://${BUCKET}/${PREFIX}/2001/02/03/zenflow-old.dump.age`,
      ),
    );
    ok(inBackup("sh /opt/backup/backup.sh"));
    expect(listKeys().some((k) => k.includes("/2001/02/03/"))).toBe(true);
  });
});
