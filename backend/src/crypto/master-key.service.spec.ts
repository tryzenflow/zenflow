import { Test, TestingModule } from "@nestjs/testing";
import { ConfigService } from "@nestjs/config";
import { randomBytes } from "crypto";
import { CryptoService } from "./crypto.service";
import {
  CURRENT_MASTER_KEY_VERSION,
  MasterKeyService,
} from "./master-key.service";
import { KEY_RANDOM_BYTES_SIZE } from "../common/constants";

const LMS_KEY = randomBytes(32).toString("hex");
const PORTAL_KEY = randomBytes(32).toString("hex");

const ENV: Record<string, string> = {
  [`MASTER_LMS_ENCRYPTION_KEY_V${CURRENT_MASTER_KEY_VERSION}`]: LMS_KEY,
  [`MASTER_PORTAL_ENCRYPTION_KEY_V${CURRENT_MASTER_KEY_VERSION}`]: PORTAL_KEY,
};

describe("MasterKeyService", () => {
  let service: MasterKeyService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MasterKeyService,
        CryptoService,
        {
          provide: ConfigService,
          useValue: { get: (name: string) => ENV[name] },
        },
      ],
    }).compile();

    service = module.get<MasterKeyService>(MasterKeyService);
  });

  it("should be defined", () => {
    expect(service).toBeDefined();
  });

  it("wraps and unwraps a DEK, recording the master-key version", () => {
    const dek = randomBytes(KEY_RANDOM_BYTES_SIZE);
    const wrapped = service.wrap("LMS", dek);

    expect(wrapped.masterKeyVersion).toBe(CURRENT_MASTER_KEY_VERSION);
    expect(wrapped.key).toMatch(/^[0-9a-f]+$/);
    expect(wrapped.key).not.toBe(dek.toString("hex"));

    expect(service.unwrap("LMS", wrapped).equals(dek)).toBe(true);
  });

  it("uses a per-provider master key — the wrong provider cannot unwrap", () => {
    const dek = randomBytes(KEY_RANDOM_BYTES_SIZE);
    const wrapped = service.wrap("LMS", dek);

    expect(() => service.unwrap("PORTAL", wrapped)).toThrow();
  });

  it("throws when the recorded master-key version is not configured", () => {
    const dek = randomBytes(KEY_RANDOM_BYTES_SIZE);
    const wrapped = service.wrap("PORTAL", dek);

    expect(() =>
      service.unwrap("PORTAL", { ...wrapped, masterKeyVersion: 99 }),
    ).toThrow(/V99/);
  });
});
