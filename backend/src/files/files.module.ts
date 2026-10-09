import { Module } from "@nestjs/common";
import { FILES_SERVICE } from "./files.service";
import { S3FilesService } from "./s3-files.service";
import { FilesController } from "./files.controller";
import { FileUrlSignerService } from "./file-url-signer.service";
import { NoteFilesService } from "./note-files.service";
import { PrismaModule } from "../prisma/prisma.module";

@Module({
  imports: [PrismaModule],
  providers: [
    { provide: FILES_SERVICE, useClass: S3FilesService },
    FileUrlSignerService,
    NoteFilesService,
  ],
  controllers: [FilesController],
  exports: [FILES_SERVICE, FileUrlSignerService, NoteFilesService],
})
export class FilesModule {}
