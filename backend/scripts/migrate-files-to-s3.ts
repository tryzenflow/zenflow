/**
 * One-off migration: move files stored on local disk into the S3 bucket.
 *
 * Legacy `File.path` is a cwd-relative disk path (`uploads/<multer-name>`);
 * S3-backed rows have `path === "<userId>/<uuid>"` (the object key). For every
 * legacy row this uploads the file to a fresh key and then points `path` at it.
 * Idempotent — migrated rows are skipped, so it is safe to re-run. Row ids are
 * unchanged, so existing `/files/<id>` URLs keep working.
 *
 *   pnpm --filter backend migrate:files-to-s3            # migrate
 *   pnpm --filter backend migrate:files-to-s3 --dry-run  # only list them
 *
 * Boots the app context against `.env.dev` (point it elsewhere with
 * `dotenv -e <file>`). Run it where the legacy `uploads/` dir is readable
 * (the api container in staging/prod), before removing the `uploads` volume.
 */
import { randomUUID } from "crypto";
import { createReadStream } from "fs";
import { join } from "path";
import { S3Client } from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import { ConfigService } from "@nestjs/config";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/prisma/prisma.service";

async function main(): Promise<void> {
  const dryRun = process.argv.includes("--dry-run");
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ["error", "warn"],
  });
  try {
    const prisma = app.get(PrismaService);
    const config = app.get(ConfigService);
    const bucket = config.getOrThrow<string>("S3_BUCKET");
    const s3 = new S3Client({
      endpoint: config.getOrThrow<string>("S3_ENDPOINT"),
      region: config.get<string>("S3_REGION", "us-east-1"),
      credentials: {
        accessKeyId: config.getOrThrow<string>("S3_ACCESS_KEY_ID"),
        secretAccessKey: config.getOrThrow<string>("S3_SECRET_ACCESS_KEY"),
      },
      forcePathStyle: true,
    });

    const files = await prisma.file.findMany({ orderBy: { createdAt: "asc" } });
    const legacy = files.filter((f) => !f.path.startsWith(`${f.userId}/`));
    console.log(`${legacy.length} of ${files.length} files still on disk`);
    if (dryRun) return;

    let migrated = 0;
    const failed: string[] = [];
    for (const file of legacy) {
      const key = `${file.userId}/${randomUUID()}`;
      try {
        await new Upload({
          client: s3,
          params: {
            Bucket: bucket,
            Key: key,
            Body: createReadStream(join(process.cwd(), file.path)),
            ContentType: file.mimetype,
          },
        }).done();
        await prisma.file.update({
          where: { id: file.id },
          data: { path: key },
        });
        migrated++;
      } catch (err) {
        failed.push(file.id);
        console.error(
          `file ${file.id} (${file.path}): ${(err as Error).message}`,
        );
      }
    }
    console.log(`migrated ${migrated}, failed ${failed.length}`);
    if (failed.length) process.exitCode = 1;
  } finally {
    await app.close();
  }
}

void main();
