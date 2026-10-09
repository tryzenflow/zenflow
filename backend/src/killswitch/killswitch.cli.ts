/**
 * Operator CLI for the runtime kill switch (ADR-0008, docs/ops/kill-switch.md).
 *
 *   killswitch status
 *   killswitch off <flag> <reason...>      (shorthand; also `on`)
 *   killswitch set <flag> <on|off> --reason "<why>"
 *   killswitch history [--limit 20]
 *
 * Locally: `pnpm --filter backend killswitch -- list`. Boots only the config +
 * Redis modules (no API, no crons). Every `set` goes through
 * `KillSwitchService.set`, which writes the flag and its audit record in one
 * atomic Lua call.
 */
import { userInfo } from "os";
import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { NestFactory } from "@nestjs/core";
import { RedisModule } from "../common/redis/redis.module";
import {
  KILLSWITCH_FLAG_NAMES,
  type KillSwitchFlag,
} from "../common/killswitch/killswitch.flags";
import { KillSwitchService } from "../common/killswitch/killswitch.service";

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true }), RedisModule],
  providers: [KillSwitchService],
})
class CliModule {}

function option(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

async function main(): Promise<number> {
  const [command, ...rest] = process.argv.slice(2);
  const app = await NestFactory.createApplicationContext(CliModule, {
    logger: ["error", "warn"],
  });
  try {
    const ks = app.get(KillSwitchService);
    // `list` must show real state, not fail-safe defaults from a cold socket.
    await ks.waitUntilReady();
    switch (command) {
      case "status":
      case "list": {
        const flags = await ks.all();
        for (const f of KILLSWITCH_FLAG_NAMES) {
          console.log(`${f.padEnd(14)} ${flags[f] ? "on" : "off"}`);
        }
        return 0;
      }
      case "history": {
        const limit = Number(option(rest, "--limit") ?? 20);
        for (const e of await ks.history(limit)) {
          console.log(
            `${e.at}  ${e.flag.padEnd(14)} ${e.value ? "on " : "off"}  ${e.actor}  ${e.reason}`,
          );
        }
        return 0;
      }
      case "on":
      case "off":
      case "set": {
        const short = command !== "set";
        const [flag, state] = short ? [rest[0], command] : rest;
        const reason = short
          ? rest.slice(1).join(" ")
          : option(rest, "--reason");
        if (!KILLSWITCH_FLAG_NAMES.includes(flag as KillSwitchFlag)) {
          console.error(
            `unknown flag; one of: ${KILLSWITCH_FLAG_NAMES.join(", ")}`,
          );
          return 2;
        }
        if (state !== "on" && state !== "off") {
          console.error("state must be 'on' or 'off'");
          return 2;
        }
        if (!reason) {
          console.error(
            "a reason is required (it is the audit record): killswitch off <flag> <why>",
          );
          return 2;
        }
        const actor = process.env.KILLSWITCH_ACTOR ?? userInfo().username;
        await ks.set(flag as KillSwitchFlag, state === "on", actor, reason);
        console.log(`${flag} -> ${state} (applies within the cache TTL, ~5s)`);
        return 0;
      }
      default:
        console.error("usage: killswitch <list|history|set> ...");
        return 2;
    }
  } finally {
    await app.close();
  }
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error(err);
    process.exit(1);
  },
);
