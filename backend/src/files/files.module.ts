import { Module } from "@nestjs/common";
import { FILES_SERVICE } from "./files.service";
import { S3FilesService } from "./s3-files.service";
import { FilesController } from "./files.controller";
import { PrismaModule } from "../prisma/prisma.module";

@Module({
  imports: [PrismaModule],
  providers: [{ provide: FILES_SERVICE, useClass: S3FilesService }],
  controllers: [FilesController],
  exports: [FILES_SERVICE],
})
export class FilesModule {}
