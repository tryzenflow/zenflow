import { FilesInterceptor } from "@nestjs/platform-express";
import { Injectable, mixin, NestInterceptor, Type } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { MulterOptions } from "@nestjs/platform-express/multer/interfaces/multer-options.interface";
import { diskStorage } from "multer";

interface LocalFilesInterceptorOptions {
  fieldName: string;
  path?: string;
  fileFilter?: MulterOptions["fileFilter"];
  limits?: MulterOptions["limits"];
  maxFilesCount?: number;
}

export function LocalFilesInterceptor(
  options: LocalFilesInterceptorOptions
): Type<NestInterceptor> {
  @Injectable()
  class Interceptor implements NestInterceptor {
    filesInterceptor: NestInterceptor;
    constructor(configService: ConfigService) {
      const filesDestination = configService.get("UPLOADED_FILES_DEST");

      const destination = `${filesDestination}${options.path ?? ""}`;

      const multerOptions: MulterOptions = {
        storage: diskStorage({
          destination,
        }),
        fileFilter: options.fileFilter,
        limits: options.limits,
      };

      this.filesInterceptor = new (FilesInterceptor(
        options.fieldName,
        options.maxFilesCount,
        multerOptions
      ))();
    }

    intercept(...args: Parameters<NestInterceptor["intercept"]>) {
      return this.filesInterceptor.intercept(...args);
    }
  }
  return mixin(Interceptor);
}
