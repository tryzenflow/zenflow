import { type KV, createSessionDisk } from "./session-disk";

/** Web has no MMKV; keep the same interface backed by nothing (memory cache only). */
const empty: KV = {
  getString: () => undefined,
  set: () => {},
  remove: () => {},
  getAllKeys: () => [],
};

export const sessionDisk = createSessionDisk(empty);
