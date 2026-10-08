import { createMMKV } from "react-native-mmkv";
import { type KV, createSessionDisk } from "./session-disk";

/**
 * MMKV-backed disk cache of the calendar (see `session-disk.ts`). Not
 * encrypted: it holds only the signed-in user's own schedule and is wiped on
 * logout; credentials stay in SecureStore.
 */
const mmkv = createMMKV({ id: "zenflow.sessions" });

const kv: KV = {
  getString: (k) => mmkv.getString(k),
  set: (k, v) => mmkv.set(k, v),
  remove: (k) => {
    mmkv.remove(k);
  },
  getAllKeys: () => mmkv.getAllKeys(),
};

export const sessionDisk = createSessionDisk(kv);
