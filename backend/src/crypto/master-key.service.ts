import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { randomBytes } from "crypto";
import type { IntegrationProvider } from "@zenflow/shared";
import {
  ENCRYPTION_ALGORITHM,
  IV_RANDOM_BYTES_SIZE,
} from "../common/constants";
import { CryptoService } from "./crypto.service";

/**
 * Master-key version to wrap NEW keys with. Bump this the same commit you add a
 * `MASTER_<PROVIDER>_ENCRYPTION_KEY_V<n>` env var; existing rows keep their
 * recorded `masterKeyVersion` and still unwrap against the older env var until
 * they are re-wrapped.
 */
export const CURRENT_MASTER_KEY_VERSION = 1;

/** A per-user data-encryption key after being wrapped under a master key. */
export interface WrappedKey {
  /** Hex ciphertext of the DEK. */
  key: string;
  /** Hex IV of the wrap operation. */
  iv: string;
  /** Hex GCM auth tag of the wrap operation. */
  authTag: string;
  /** Which `MASTER_<provider>_ENCRYPTION_KEY_V<n>` produced `key`. */
  masterKeyVersion: number;
  algorithm: string;
}

/**
 * Outer layer of the two-layer envelope: wraps / unwraps a per-user
 * data-encryption key (DEK) under the provider-specific master key held in the
 * environment (never in the DB). The inner layer — credentials encrypted under
 * the DEK — is `CryptoService` driven by `IntegrationsService`.
 */
@Injectable()
export class MasterKeyService {
  constructor(
    private readonly config: ConfigService,
    private readonly crypto: CryptoService,
  ) {}

  private masterKey(provider: IntegrationProvider, version: number): Buffer {
    const name = `MASTER_${provider}_ENCRYPTION_KEY_V${version}`;
    const hex = this.config.get<string>(name);
    if (!hex) {
      // Boot-time Joi validation covers the current version; this guards
      // unwrapping a row whose (older) master-key version is no longer
      // configured.
      throw new Error(`Master key env var ${name} is not configured`);
    }
    return Buffer.from(hex, "hex");
  }

  /** Wrap a raw 32-byte DEK under the current master key for `provider`. */
  wrap(provider: IntegrationProvider, dek: Buffer): WrappedKey {
    const masterKeyVersion = CURRENT_MASTER_KEY_VERSION;
    const iv = randomBytes(IV_RANDOM_BYTES_SIZE);
    const { encrypted, authTag } = this.crypto.encryptString({
      key: this.masterKey(provider, masterKeyVersion),
      iv,
      algorithm: ENCRYPTION_ALGORITHM,
      secret: dek.toString("hex"),
    });
    return {
      key: encrypted,
      iv: iv.toString("hex"),
      authTag,
      masterKeyVersion,
      algorithm: ENCRYPTION_ALGORITHM,
    };
  }

  /** Reverse of `wrap`. Throws if the master key is wrong or `key` is tampered. */
  unwrap(
    provider: IntegrationProvider,
    wrapped: {
      key: string;
      iv: string;
      authTag: string;
      masterKeyVersion: number;
      algorithm: string;
    },
  ): Buffer {
    const { decrypted } = this.crypto.decryptString({
      key: this.masterKey(provider, wrapped.masterKeyVersion),
      iv: Buffer.from(wrapped.iv, "hex"),
      algorithm: wrapped.algorithm,
      encrypted: wrapped.key,
      authTag: wrapped.authTag,
    });
    return Buffer.from(decrypted, "hex");
  }
}
