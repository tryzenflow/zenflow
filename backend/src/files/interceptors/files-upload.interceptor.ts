import { tmpdir } from "os";
import { FilesInterceptor } from "@nestjs/platform-express";
import { Injectable, mixin, NestInterceptor, Type } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { MulterOptions } from "@nestjs/platform-express/multer/interfaces/multer-options.interface";
import { diskStorage } from "multer";
import { readFileLimits } from "../file-limits";

interface FilesUploadInterceptorOptions {
  fieldName: string;
  fileFilter?: MulterOptions["fileFilter"];
}

/**
 * Buffers multipart uploads to a temp directory (not memory — up to
 * `UPLOAD_MAX_FILES_PER_REQUEST` × `UPLOAD_MAX_FILE_BYTES` per request); `FilesService.upload` moves them to storage and removes them.
 */
export function FilesUploadInterceptor(
  options: FilesUploadInterceptorOptions,
): Type<NestInterceptor> {
  @Injectable()
  class Interceptor implements NestInterceptor {
    filesInterceptor: NestInterceptor;
    constructor(configService: ConfigService) {
      const destination = configService.get<string>("UPLOAD_TMP_DIR", tmpdir());

      const { maxFileBytes, maxFilesPerRequest } =
        readFileLimits(configService);
      const multerOptions: MulterOptions = {
        storage: diskStorage({ destination }),
        fileFilter: options.fileFilter,
        limits: { fileSize: maxFileBytes },
      };

      this.filesInterceptor = new (FilesInterceptor(
        options.fieldName,
        maxFilesPerRequest,
        multerOptions,
      ))();
    }

    intercept(...args: Parameters<NestInterceptor["intercept"]>) {
      return this.filesInterceptor.intercept(...args);
    }
  }
  return mixin(Interceptor);
}
