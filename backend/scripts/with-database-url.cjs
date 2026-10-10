#!/usr/bin/env node
// Runs a command with DATABASE_URL composed from DB_HOST / DB_PORT / POSTGRES_* /
// DB_SCHEMA / DB_SSLMODE, for the Prisma CLI, which reads DATABASE_URL straight
// from the environment (prisma/schema.prisma). The app never reads a URL var:
// it builds the same string in src/common/config/connections.ts, and
// connections.spec.ts keeps the two identical.
//
//   node scripts/with-database-url.cjs npx prisma migrate deploy
const { spawn } = require("node:child_process");

function databaseUrl(env) {
  const need = (key) => {
    if (!env[key]) throw new Error(`${key} is not configured`);
    return env[key];
  };
  const params = new URLSearchParams({ schema: env.DB_SCHEMA || "public" });
  if (env.DB_SSLMODE) params.set("sslmode", env.DB_SSLMODE);
  return (
    `postgresql://${encodeURIComponent(need("POSTGRES_USER"))}:` +
    `${encodeURIComponent(need("POSTGRES_PASSWORD"))}@${need("DB_HOST")}:` +
    `${env.DB_PORT || "5432"}/${encodeURIComponent(need("POSTGRES_DB"))}?${params}`
  );
}

module.exports = { databaseUrl };

if (require.main === module) {
  const [cmd, ...args] = process.argv.slice(2);
  if (!cmd) {
    console.error("usage: with-database-url.cjs <command> [args...]");
    process.exit(2);
  }
  let url;
  try {
    url = databaseUrl(process.env);
  } catch (err) {
    console.error(`with-database-url: ${err.message}`);
    process.exit(1);
  }
  const child = spawn(cmd, args, {
    stdio: "inherit",
    env: { ...process.env, DATABASE_URL: url },
  });
  child.on("exit", (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
}
