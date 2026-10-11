import { getFileMetadata } from "@/api/files";
import AsyncStorage from "@react-native-async-storage/async-storage";

/**
 * Sizes of uploaded files by id (from `GET /files/metadata/:id`), kept on the
 * device so a document card can show its size offline once it has been seen.
 * A file's bytes never change under its id, so entries never go stale.
 */
const KEY = "file-sizes.v1";
let sizes: Record<string, number> | null = null;

async function load(): Promise<Record<string, number>> {
  if (sizes) return sizes;
  try {
    const raw = await AsyncStorage.getItem(KEY);
    sizes = raw ? (JSON.parse(raw) as Record<string, number>) : {};
  } catch {
    sizes = {};
  }
  return sizes;
}

/** Sizes for `ids`: saved ones at once, the rest fetched unless `fetchMissing` is false. */
export async function fileSizesFor(
  ids: string[],
  fetchMissing: boolean,
): Promise<Record<string, number>> {
  const known = await load();
  const found: Record<string, number> = {};
  let learned = false;
  await Promise.all(
    ids.map(async (id) => {
      if (known[id] !== undefined) {
        found[id] = known[id];
        return;
      }
      if (!fetchMissing) return;
      try {
        const meta = await getFileMetadata(id);
        known[id] = meta.size;
        found[id] = meta.size;
        learned = true;
      } catch {
        // No size for now; the card shows without one.
      }
    }),
  );
  if (learned) AsyncStorage.setItem(KEY, JSON.stringify(known)).catch(() => {});
  return found;
}
