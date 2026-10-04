import { createHmac, timingSafeEqual } from "crypto";
import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

/**
 * Capability URLs for files: `sig = base64url(HMAC-SHA256(fileId, FILE_URL_SECRET))`.
 * Stable and non-expiring so links can be stored in notes. Rotating
 * `FILE_URL_SECRET` invalidates every stored link.
 */
@Injectable()
export class FileUrlSignerService {
  private readonly secret: string;

  constructor(configService: ConfigService) {
    this.secret = configService.getOrThrow<string>("FILE_URL_SECRET");
  }

  sign(fileId: string): string {
    return createHmac("sha256", this.secret).update(fileId).digest("base64url");
  }

  verify(fileId: string, sig: unknown): boolean {
    if (typeof sig !== "string") return false;
    const expected = Buffer.from(this.sign(fileId));
    const given = Buffer.from(sig);
    return given.length === expected.length && timingSafeEqual(given, expected);
  }

  /** Relative to the API origin (includes the global prefix). */
  url(fileId: string): string {
    return `/api/v1/files/${encodeURIComponent(fileId)}?sig=${this.sign(fileId)}`;
  }
}
