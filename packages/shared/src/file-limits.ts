/** Default largest single uploaded file. The server's `UPLOAD_MAX_FILE_BYTES` overrides it. */
export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

/** Default total stored bytes per user across all files. Overridden by `UPLOAD_USER_QUOTA_BYTES`. */
export const MAX_USER_STORAGE_BYTES = 150 * 1024 * 1024;

/** Default files per upload request. Overridden by `UPLOAD_MAX_FILES_PER_REQUEST`. */
export const MAX_UPLOAD_FILES = 5;

/** Effective upload limits as served by `GET /files/limits`. */
export interface FileLimits {
  maxFileBytes: number;
  maxFilesPerRequest: number;
  userQuotaBytes: number;
}
