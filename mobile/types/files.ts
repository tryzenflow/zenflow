// Mirrors `frontend/src/types/files.ts` — the `/files` endpoints' response
// shape (`@zenflow/shared` doesn't currently cover file uploads, so this is
// hand-synced the same way `frontend/`'s copy is).
export interface FileMetadata {
  id: string;
  originalName: string;
  mimetype: string;
  size: number;
  /** Signed session-less URL, relative to the API origin (`/api/v1/files/:id?sig=…`). */
  url: string;
}
