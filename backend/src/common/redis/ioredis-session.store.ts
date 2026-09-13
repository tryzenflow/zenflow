import type { Redis } from "ioredis";
import { Store, type SessionData } from "express-session";

/**
 * `express-session` `Store` backed by `ioredis`, replacing `connect-redis`
 * (which hard-codes node-redis's v4 client API — `{expiration:{type:"EX"}}`,
 * `scanIterator`, `mGet` — and can't take an `ioredis` client). Mirrors
 * `connect-redis`'s behavior for the subset `express-session` actually calls:
 * `get`/`set`/`destroy`/`touch`.
 *
 * TTL is derived from `cookie.expires` (falling back to the configured
 * default), matching `connect-redis` so the Redis key and the cookie expire
 * together under the `rolling: true` session config — see
 * `auth/session.config.ts`.
 */
export class IoredisSessionStore extends Store {
  private readonly client: Redis;
  private readonly prefix: string;
  private readonly defaultTtlSec: number;

  constructor(options: { client: Redis; prefix?: string; ttlSec: number }) {
    super();
    this.client = options.client;
    this.prefix = options.prefix ?? "sess:";
    this.defaultTtlSec = options.ttlSec;
  }

  private key(sid: string): string {
    return this.prefix + sid;
  }

  private ttlSecFor(sess: SessionData): number {
    if (sess.cookie?.expires) {
      const ms = new Date(sess.cookie.expires).getTime() - Date.now();
      return Math.ceil(ms / 1000);
    }
    return this.defaultTtlSec;
  }

  async get(
    sid: string,
    callback: (err: unknown, session?: SessionData | null) => void,
  ): Promise<void> {
    try {
      const raw = await this.client.get(this.key(sid));
      callback(null, raw ? (JSON.parse(raw) as SessionData) : null);
    } catch (err) {
      callback(err);
    }
  }

  async set(
    sid: string,
    session: SessionData,
    callback?: (err?: unknown) => void,
  ): Promise<void> {
    const ttlSec = this.ttlSecFor(session);
    if (ttlSec <= 0) {
      return this.destroy(sid, callback);
    }
    try {
      await this.client.set(
        this.key(sid),
        JSON.stringify(session),
        "EX",
        ttlSec,
      );
      callback?.();
    } catch (err) {
      callback?.(err);
    }
  }

  async touch(
    sid: string,
    session: SessionData,
    callback?: (err?: unknown) => void,
  ): Promise<void> {
    try {
      await this.client.expire(this.key(sid), this.ttlSecFor(session));
      callback?.();
    } catch (err) {
      callback?.(err);
    }
  }

  async destroy(sid: string, callback?: (err?: unknown) => void): Promise<void> {
    try {
      await this.client.del(this.key(sid));
      callback?.();
    } catch (err) {
      callback?.(err);
    }
  }
}
