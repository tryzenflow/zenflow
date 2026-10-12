import type { ConfigService } from "@nestjs/config";
import {
  MAX_UPLOAD_BYTES,
  MAX_UPLOAD_FILES,
  MAX_USER_STORAGE_BYTES,
  type FileLimits,
} from "@zenflow/shared";

/** Effective upload limits: `UPLOAD_*` env vars, else the shared defaults. */
export function readFileLimits(config: ConfigService): FileLimits {
  return {
    maxFileBytes: config.get<number>("UPLOAD_MAX_FILE_BYTES", MAX_UPLOAD_BYTES),
    maxFilesPerRequest: config.get<number>(
      "UPLOAD_MAX_FILES_PER_REQUEST",
      MAX_UPLOAD_FILES,
    ),
    userQuotaBytes: config.get<number>(
      "UPLOAD_USER_QUOTA_BYTES",
      MAX_USER_STORAGE_BYTES,
    ),
  };
}
