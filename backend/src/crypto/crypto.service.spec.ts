import { Test, TestingModule } from "@nestjs/testing";
import { randomBytes } from "crypto";
import { CryptoService } from "./crypto.service";
import {
  ENCRYPTION_ALGORITHM,
  IV_RANDOM_BYTES_SIZE,
  KEY_RANDOM_BYTES_SIZE,
} from "../common/constants";

describe("CryptoService", () => {
  let service: CryptoService;

  const key = () => randomBytes(KEY_RANDOM_BYTES_SIZE);
  const iv = () => randomBytes(IV_RANDOM_BYTES_SIZE);

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [CryptoService],
    }).compile();

    service = module.get<CryptoService>(CryptoService);
  });

  it("should be defined", () => {
    expect(service).toBeDefined();
  });

  it("round-trips a secret through encrypt → decrypt", () => {
    const k = key();
    const v = iv();
    const secret = "s3cr3t-DLU-p@ssw0rd";

    const { encrypted, authTag } = service.encryptString({
      key: k,
      iv: v,
      algorithm: ENCRYPTION_ALGORITHM,
      secret,
    });

    expect(encrypted).toMatch(/^[0-9a-f]+$/);
    expect(authTag).toMatch(/^[0-9a-f]+$/);
    expect(encrypted).not.toContain(secret);

    const { decrypted } = service.decryptString({
      key: k,
      iv: v,
      algorithm: ENCRYPTION_ALGORITHM,
      encrypted,
      authTag,
    });
    expect(decrypted).toBe(secret);
  });

  it("fails to decrypt with the wrong key", () => {
    const v = iv();
    const { encrypted, authTag } = service.encryptString({
      key: key(),
      iv: v,
      algorithm: ENCRYPTION_ALGORITHM,
      secret: "hello",
    });

    expect(() =>
      service.decryptString({
        key: key(),
        iv: v,
        algorithm: ENCRYPTION_ALGORITHM,
        encrypted,
        authTag,
      }),
    ).toThrow();
  });

  it("fails to decrypt tampered ciphertext (GCM auth tag)", () => {
    const k = key();
    const v = iv();
    const { encrypted, authTag } = service.encryptString({
      key: k,
      iv: v,
      algorithm: ENCRYPTION_ALGORITHM,
      secret: "hello",
    });

    const flipped = `${encrypted.slice(0, -2)}${
      encrypted.endsWith("00") ? "ff" : "00"
    }`;
    expect(() =>
      service.decryptString({
        key: k,
        iv: v,
        algorithm: ENCRYPTION_ALGORITHM,
        encrypted: flipped,
        authTag,
      }),
    ).toThrow();
  });
});
