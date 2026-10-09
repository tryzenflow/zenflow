import Redis from "ioredis";
import { Logger } from "@nestjs/common";

const logger = new Logger("QueueRedis");

/**
 * `ioredis` client for BullMQ on the dedicated queue Redis (`noeviction` +
 * AOF, see ADR-0007/0008). BullMQ requires `maxRetriesPerRequest: null` so a
 * blocking command waits out a Redis restart instead of throwing. Workers
 * `duplicate()` this client for their blocking connection.
 */
export function createQueueConnection(url: string, lazy = false): Redis {
  const client = new Redis(url, {
    maxRetriesPerRequest: null,
    lazyConnect: lazy,
  });
  client.on("error", (err) => logger.warn(`Queue Redis error: ${err.message}`));
  return client;
}
