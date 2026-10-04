import { tmpdir } from "os";
import { FilesInterceptor } from "@nestjs/platform-express";
import { Injectable, mixin, NestInterceptor, Type } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { MulterOptions } from "@nestjs/platform-express/multer/interfaces/multer-options.interface";
import { diskStorage } from "multer";

interface FilesUploadInterceptorOptions {
  fieldName: string;
  fileFilter?: MulterOptions["fileFilter"];
  limits?: MulterOptions["limits"];
  maxFilesCount?: number;
}

/**
 * Buffers multipart uploads to a temp directory (not memory — up to 5×100 MB
 * per request); `FilesService.upload` moves them to storage and removes them.
 */
export function FilesUploadInterceptor(
  options: FilesUploadInterceptorOptions,
): Type<NestInterceptor> {
  @Injectable()
  class Interceptor implements NestInterceptor {
    filesInterceptor: NestInterceptor;
    constructor(configService: ConfigService) {
      const destination = configService.get<string>("UPLOAD_TMP_DIR", tmpdir());

      const multerOptions: MulterOptions = {
        storage: diskStorage({ destination }),
        fileFilter: options.fileFilter,
        limits: options.limits,
      };

      this.filesInterceptor = new (FilesInterceptor(
        options.fieldName,
        options.maxFilesCount,
        multerOptions,
      ))();
    }

    intercept(...args: Parameters<NestInterceptor["intercept"]>) {
      return this.filesInterceptor.intercept(...args);
    }
  }
  return mixin(Interceptor);
}
