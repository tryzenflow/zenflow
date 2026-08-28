import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { randomBytes } from "crypto";
import type { User } from "../../generated/prisma";
import type {
  IntegrationProvider,
  IntegrationStatus,
  IntegrationStatusListResponse,
} from "@zenflow/shared";
import {
  ENCRYPTION_ALGORITHM,
  IV_RANDOM_BYTES_SIZE,
  KEY_RANDOM_BYTES_SIZE,
} from "../common/constants";
import { PrismaService } from "../prisma/prisma.service";
import { CryptoService } from "../crypto/crypto.service";
import { MasterKeyService } from "../crypto/master-key.service";
import { DluAuthService } from "./dlu-auth.service";
import { ConnectIntegrationDto } from "./dto/connect-integration.dto";

/** Every provider we report status for, connected or not. */
const ALL_PROVIDERS: readonly IntegrationProvider[] = ["LMS", "PORTAL"];

interface DecryptedDek {
  key: Buffer;
  /** `UserEncryptionKey.version` this DEK corresponds to. */
  version: number;
}

/**
 * DLU LMS / portal credential storage.
 *
 * Two-layer envelope:
 *  1. credentials → AES-256-GCM under the user's per-provider DEK
 *     (`Integration.encryptedCredentials` / `iv` / `authTag`)
 *  2. that DEK → AES-256-GCM under the provider master key
 *     (`UserEncryptionKey`, via `MasterKeyService`)
 *
 * Nothing here logs a username, password, ciphertext, IV, or auth tag.
 */
@Injectable()
export class IntegrationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly masterKeys: MasterKeyService,
    private readonly dluAuth: DluAuthService,
  ) {}

  /** `POST /integrations` — verify against DLU, then encrypt + upsert. */
  async connect(
    user: User,
    dto: ConnectIntegrationDto,
  ): Promise<IntegrationStatus> {
    let valid: boolean;
    try {
      valid = await this.dluAuth.verifyCredentials(
        dto.provider,
        dto.username,
        dto.password,
      );
    } catch (error) {
      throw new ServiceUnavailableException(
        "Couldn't reach DLU to verify your account. Please try again in a moment.",
      );
    }
    if (!valid) {
      throw new BadRequestException(
        `Could not sign in to your DLU ${this.label(dto.provider)} account. Check your username and password.`,
      );
    }

    const dek = await this.ensureUserKey(user.id, dto.provider);
    const iv = randomBytes(IV_RANDOM_BYTES_SIZE);
    const { encrypted, authTag } = this.crypto.encryptString({
      key: dek.key,
      iv,
      algorithm: ENCRYPTION_ALGORITHM,
      secret: JSON.stringify({
        username: dto.username,
        password: dto.password,
      }),
    });

    const now = new Date();
    const payload = {
      encryptedCredentials: encrypted,
      iv: iv.toString("hex"),
      authTag,
      encryptionVersion: dek.version,
      lastVerifiedAt: now,
    };
    const row = await this.prisma.integration.upsert({
      where: {
        userId_provider: { userId: user.id, provider: dto.provider },
      },
      create: { userId: user.id, provider: dto.provider, ...payload },
      update: payload,
    });

    return this.toStatus(row.provider, row.lastVerifiedAt);
  }

  /** `GET /integrations` — one entry per provider; no secret material. */
  async status(user: User): Promise<IntegrationStatusListResponse> {
    const rows = await this.prisma.integration.findMany({
      where: { userId: user.id },
      select: { provider: true, lastVerifiedAt: true },
    });
    const byProvider = new Map(rows.map((r) => [r.provider, r]));
    return {
      integrations: ALL_PROVIDERS.map((provider) => {
        const row = byProvider.get(provider);
        return this.toStatus(provider, row?.lastVerifiedAt ?? null, !!row);
      }),
    };
  }

  /** `DELETE /integrations/:provider` — idempotent; keeps the DEK. */
  async disconnect(
    user: User,
    provider: IntegrationProvider,
  ): Promise<IntegrationStatus> {
    await this.prisma.integration.deleteMany({
      where: { userId: user.id, provider },
    });
    return this.toStatus(provider, null, false);
  }

  /**
   * Decrypt the stored credentials for a provider. Deliberately **not** wired
   * to any controller — it exists so the round-trip is testable and so the
   * ingestion service (#29) can share the exact scheme. Full envelope:
   * unwrap the DEK under the master key, then decrypt the credentials.
   */
  async revealCredentials(
    userId: string,
    provider: IntegrationProvider,
  ): Promise<{ username: string; password: string }> {
    const row = await this.prisma.integration.findUnique({
      where: { userId_provider: { userId, provider } },
    });
    if (!row) {
      throw new NotFoundException(
        `No ${this.label(provider)} account connected`,
      );
    }
    if (!row.iv || !row.authTag) {
      throw new InternalServerErrorException(
        "Stored credential row is missing its IV / auth tag",
      );
    }

    const dekRow = await this.prisma.userEncryptionKey.findUnique({
      where: {
        userId_provider_version: {
          userId,
          provider,
          version: row.encryptionVersion,
        },
      },
    });
    if (!dekRow) {
      throw new InternalServerErrorException(
        "Encryption key for this credential version is missing",
      );
    }

    const dek = this.masterKeys.unwrap(provider, dekRow);
    const { decrypted } = this.crypto.decryptString({
      key: dek,
      iv: Buffer.from(row.iv, "hex"),
      algorithm: ENCRYPTION_ALGORITHM,
      encrypted: row.encryptedCredentials,
      authTag: row.authTag,
    });
    return JSON.parse(decrypted) as { username: string; password: string };
  }

  /**
   * Lazily provision (once per user+provider) the data-encryption key, wrapped
   * under the provider master key. Returns the plaintext DEK for immediate use.
   */
  private async ensureUserKey(
    userId: string,
    provider: IntegrationProvider,
  ): Promise<DecryptedDek> {
    const existing = await this.prisma.userEncryptionKey.findFirst({
      where: { userId, provider },
      orderBy: { version: "desc" },
    });
    if (existing) {
      return {
        key: this.masterKeys.unwrap(provider, existing),
        version: existing.version,
      };
    }

    const dek = randomBytes(KEY_RANDOM_BYTES_SIZE);
    const wrapped = this.masterKeys.wrap(provider, dek);
    const created = await this.prisma.userEncryptionKey.create({
      data: {
        userId,
        provider,
        version: 1,
        masterKeyVersion: wrapped.masterKeyVersion,
        key: wrapped.key,
        iv: wrapped.iv,
        authTag: wrapped.authTag,
        algorithm: wrapped.algorithm,
      },
    });
    return { key: dek, version: created.version };
  }

  private toStatus(
    provider: IntegrationProvider,
    lastVerifiedAt: Date | null,
    connected = true,
  ): IntegrationStatus {
    return {
      provider,
      connected,
      lastVerifiedAt: lastVerifiedAt ? lastVerifiedAt.toISOString() : null,
    };
  }

  private label(provider: IntegrationProvider): string {
    return provider === "LMS" ? "LMS" : "portal";
  }
}
