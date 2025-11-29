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
      select: { id: true, originalName: true, mimetype: true, size: true },
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
    await this.prisma.file.deleteMany({ where: { id: { in: keys } } });
    const deleteOperations = toDeleteFiles.map((file) => rm(file.path));
    await Promise.all(deleteOperations).catch(() => {});
  }

  async getMetadata(id: string, userId: string) {
    const file = await this.prisma.file.findUnique({
      where: { id, userId },
      select: { id: true, originalName: true, mimetype: true, size: true },
    });
    if (!file)
      throw new NotFoundException({
        success: false,
        message: "Cannot find file with the given `id`",
      });
    return file;
  }
}
