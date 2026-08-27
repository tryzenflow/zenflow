import type { FileMetadata } from "@/types/files";
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
 * Fetch a file's bytes through the authenticated `api` client and return a
 * `data:` URI. `@10play/tentap-editor`'s `RichText` (see
 * `components/tasks/form/description-field.tsx`) renders into a real,
 * separate WebView document with its own cookie jar, entirely disconnected
 * from `lib/api-client.ts`'s manually-replayed session `Cookie` header (see
 * that file's Auth doc comment) — so a bare `<img src>`/`<video src>`/
 * `<audio src>` pointed straight at a `CookieAuthGuard`-protected
 * `/files/:id` URL 401s silently inside the WebView, with no error surfaced
 * to RN. Fetching the bytes through the already-authenticated `api` client
 * and inlining them as a `data:` URI sidesteps the WebView ever needing to
 * authenticate itself — same fix shape as `lib/geist-webview-font.ts`'s
 * embedded font.
 */
export async function fetchFileDataUri(
  id: string,
  mimetype: string,
): Promise<string> {
  const response = await api.get(`/files/${id}`, { responseType: "blob" });
  const blob = response.data as Blob;
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () =>
      reject(reader.error ?? new Error("Failed to read downloaded file"));
    reader.onload = () => resolve(reader.result as string);
    reader.readAsDataURL(blob);
  });
}
