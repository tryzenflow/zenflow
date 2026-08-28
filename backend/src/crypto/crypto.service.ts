import { Injectable } from "@nestjs/common";
import {
  createCipheriv,
  CipherGCM,
  createDecipheriv,
  DecipherGCM,
} from "crypto";
import { DecryptOptions, EncryptOptions } from "./interfaces/crypto-options";

/**
 * Low-level authenticated-encryption primitive. Pure: it does no I/O and holds
 * no keys — the caller supplies `key`/`iv` and stores whatever comes back.
 *
 * `encryptString` and `decryptString` are exact inverses over hex strings:
 * `encrypted` and `authTag` are hex on the way out and expected as hex on the
 * way back in (see `crypto-options.ts`).
 */
@Injectable()
export class CryptoService {
  encryptString({ key, iv, algorithm, secret }: EncryptOptions): {
    encrypted: string;
    authTag: string;
  } {
    const cipher = createCipheriv(algorithm, key, iv) as CipherGCM;
    const encrypted = Buffer.concat([
      cipher.update(secret, "utf-8"),
      cipher.final(),
    ]).toString("hex");
    const authTag = cipher.getAuthTag().toString("hex");
    return { encrypted, authTag };
  }

  /** Throws if the auth tag does not verify (tampered ciphertext / wrong key). */
  decryptString({ algorithm, authTag, iv, key, encrypted }: DecryptOptions): {
    decrypted: string;
  } {
    const decipher = createDecipheriv(algorithm, key, iv) as DecipherGCM;
    decipher.setAuthTag(Buffer.from(authTag, "hex"));
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(encrypted, "hex")),
      decipher.final(),
    ]).toString("utf-8");
    return { decrypted };
  }
}
