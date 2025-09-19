import { rm } from "fs/promises";
import { PrismaService } from "../prisma/prisma.service";
import { UploadFileDto } from "./dto";
import { FilesService } from "./files.service";
import { Injectable, NotFoundException } from "@nestjs/common";

@Injectable()
export class LocalFilesService implements FilesService {
  constructor(private prisma: PrismaService) {}

  async upload(uploadFilesDto: UploadFileDto[], userId: string) {
    const files = await this.prisma.file.createManyAndReturn({
      data: uploadFilesDto.map((dto) => ({ ...dto, userId })),
      omit: { path: true, filename: true, userId: true },
    });
    return files;
  }

  async findOne(id: string, userId: string) {
    const file = await this.prisma.file.findUnique({
      where: { id, userId },
    });
    if (!file)
      throw new NotFoundException({
        success: false,
        message: "Cannot find file with the given `id`",
      });
    return file;
  }

  async remove(keys: string[], userId: string) {
    const toDeleteFiles = await this.prisma.file.findMany({
      where: { id: { in: keys }, userId },
    });
    if (toDeleteFiles.length < keys.length)
      throw new NotFoundException({
        success: false,
        message: "Cannot find some files with the given `ids`",
      });
    await this.prisma.file.deleteMany({ where: { id: { in: keys } } });
    for (const file of toDeleteFiles) {
      try {
        await rm(file.path);
      } catch {}
    }
  }
}
