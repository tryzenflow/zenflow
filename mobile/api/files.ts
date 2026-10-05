import type { FileMetadata } from "@/types/files";
import { safeFileName } from "@/lib/file-link";
import { Directory, File as ExpoFile, Paths } from "expo-file-system";
import { api } from "./base";

export interface PickedFilePart {
  uri: string;
  name: string;
  mimeType: string;
}

/**
 * Multipart upload — mirrors `frontend/src/hooks/use-file-uploads.ts`'s
 * `fetch(.../files/upload, { body: formData })`. RN's `FormData` accepts a
 * `{ uri, name, type }` object directly for a file part (no in-memory read
 * needed); axios/RN set the `multipart/form-data` boundary themselves, so we
 * don't set a `Content-Type` header here — hardcoding one without the
 * boundary would break the request.
 */
export async function uploadFiles(
  files: PickedFilePart[],
): Promise<FileMetadata[]> {
  const formData = new FormData();
  for (const file of files) {
    formData.append("files", {
      uri: file.uri,
      name: file.name,
      type: file.mimeType,
    } as unknown as Blob);
  }
  const { data } = await api.post("/files/upload", formData);
  return data.data;
}

export async function getFileMetadata(id: string): Promise<FileMetadata> {
  const { data } = await api.get(`/files/metadata/${id}`);
  return data.data;
}

/**
 * Download a file through the authenticated `api` client into the app cache
 * dir and return it, ready for `file.preview()` (OS viewer / share sheet).
 * Used for non-media note links: the system browser has no session cookie,
 * so `Linking.openURL` on `/files/:id` would 401.
 */
export async function downloadFileToCache(
  id: string,
): Promise<{ file: ExpoFile; mimeType: string; name: string }> {
  const meta = await getFileMetadata(id);
  const response = await api.get(`/files/${id}`, {
    responseType: "arraybuffer",
    timeout: 60_000,
  });
  const dir = new Directory(Paths.cache, "note-files", id);
  dir.create({ idempotent: true, intermediates: true });
  const file = new ExpoFile(dir, safeFileName(meta.originalName));
  await file.write(new Uint8Array(response.data as ArrayBuffer));
  return { file, mimeType: meta.mimetype, name: meta.originalName };
}
