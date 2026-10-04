import { randomUUID } from "crypto";
import { createReadStream } from "fs";
import { rm } from "fs/promises";
import { Readable } from "stream";
import {
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Prisma } from "../../generated/prisma";
import { PrismaService } from "../prisma/prisma.service";
import { UploadFileDto } from "./dto";
import { FilesService } from "./files.service";

/**
 * Stores file bytes in an S3-compatible bucket; `File.path` holds the object
 * key. The bucket is provisioned by infrastructure (compose `storage-init`),
 * never by the app.
 */
@Injectable()
export class S3FilesService implements FilesService {
  private readonly logger = new Logger(S3FilesService.name);
  private readonly s3: S3Client;
  private readonly bucket: string;

  constructor(
    private prisma: PrismaService,
    configService: ConfigService,
  ) {
    this.bucket = configService.getOrThrow<string>("S3_BUCKET");
    this.s3 = new S3Client({
      endpoint: configService.getOrThrow<string>("S3_ENDPOINT"),
      region: configService.get<string>("S3_REGION", "us-east-1"),
      credentials: {
        accessKeyId: configService.getOrThrow<string>("S3_ACCESS_KEY_ID"),
        secretAccessKey: configService.getOrThrow<string>(
          "S3_SECRET_ACCESS_KEY",
        ),
      },
      forcePathStyle: true,
    });
  }

  async upload(uploadFilesDto: UploadFileDto[], userId: string) {
    const uploadedKeys: string[] = [];
    try {
      const data: Prisma.FileCreateManyInput[] = [];
      for (const dto of uploadFilesDto) {
        const key = `${userId}/${randomUUID()}`;
        await new Upload({
          client: this.s3,
          params: {
            Bucket: this.bucket,
            Key: key,
            Body: createReadStream(dto.path),
            ContentType: dto.mimetype,
          },
        }).done();
        uploadedKeys.push(key);
        data.push({ ...dto, path: key, userId });
      }
      return await this.prisma.file.createManyAndReturn({
        data,
        select: { id: true, originalName: true, mimetype: true, size: true },
      });
    } catch (err) {
      await this.deleteObjects(uploadedKeys);
      throw err;
    } finally {
      // multer wrote the upload to a temp file; it is no longer needed.
      await Promise.all(
        uploadFilesDto.map((dto) => rm(dto.path, { force: true })),
      );
    }
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

  async download(id: string, userId: string) {
    const file = await this.findOne(id, userId);
    const { Body } = await this.s3.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: file.path }),
    );
    if (!(Body instanceof Readable))
      throw new NotFoundException({
        success: false,
        message: "Cannot find file content",
      });
    return { file, stream: Body };
  }

  async remove(keys: string[], userId: string) {
    const toDeleteFiles = await this.prisma.file.findMany({
      where: { id: { in: keys }, userId },
    });
    await this.prisma.file.deleteMany({
      where: { id: { in: toDeleteFiles.map((f) => f.id) }, userId },
    });
    await this.deleteObjects(toDeleteFiles.map((f) => f.path));
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

  /** Best-effort delete; failures are logged so orphans can be swept later. */
  private async deleteObjects(keys: string[]) {
    if (keys.length === 0) return;
    try {
      if (keys.length === 1) {
        await this.s3.send(
          new DeleteObjectCommand({ Bucket: this.bucket, Key: keys[0] }),
        );
        return;
      }
      await this.s3.send(
        new DeleteObjectsCommand({
          Bucket: this.bucket,
          Delete: { Objects: keys.map((Key) => ({ Key })), Quiet: true },
        }),
      );
    } catch (err) {
      this.logger.error(
        `Failed to delete objects [${keys.join(", ")}]: ${(err as Error).message}`,
      );
    }
  }
}
