/**
 * One-off migration: move files stored on local disk into the S3 bucket.
 *
 * Legacy `File.path` is a cwd-relative disk path (`uploads/<multer-name>`);
 * S3-backed rows have `path === "<userId>/<uuid>"` (the object key). For every
 * legacy row this uploads the file to a fresh key and then points `path` at it.
 * Idempotent — migrated rows are skipped, so it is safe to re-run. Row ids are
 * unchanged, so existing `/files/<id>` URLs keep working.
 *
 * Compiled into `dist/` with the API, so it runs inside the production image
 * (where the legacy `uploads/` volume is mounted), before that volume is removed:
 *
 *   docker compose exec api node dist/files/migrate-to-s3.cli.js            # migrate
 *   docker compose exec api node dist/files/migrate-to-s3.cli.js --dry-run  # only list
 *
 * Locally: `pnpm --filter backend migrate:files-to-s3 [--dry-run]` (ts-node,
 * `.env.dev`).
 */
import { randomUUID } from "crypto";
import { createReadStream } from "fs";
import { join } from "path";
import { DeleteObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import { ConfigService } from "@nestjs/config";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "../app.module";
import { PrismaService } from "../prisma/prisma.service";

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
      let uploaded = false;
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
        uploaded = true;
        // Guarded on the old path: if the row was removed (or already migrated)
        // since we read it, nothing matches and the new object is cleaned up.
        const { count } = await prisma.file.updateMany({
          where: { id: file.id, path: file.path },
          data: { path: key },
        });
        if (count === 0) throw new Error("row removed or changed; skipped");
        migrated++;
      } catch (err) {
        if (uploaded)
          await s3
            .send(new DeleteObjectCommand({ Bucket: bucket, Key: key }))
            .catch(() => undefined);
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
