import { Module } from "@nestjs/common";
import { LocalFilesService } from "./local-files.service";
import { FilesController } from "./files.controller";
import { PrismaModule } from "../prisma/prisma.module";

@Module({
  imports: [PrismaModule],
  providers: [LocalFilesService],
  controllers: [FilesController],
  exports: [LocalFilesService],
})
export class FilesModule {}
