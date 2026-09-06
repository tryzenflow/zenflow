import { Test, TestingModule } from "@nestjs/testing";
import {
  BadRequestException,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { randomBytes } from "crypto";
import type { User } from "../../generated/prisma";
import { PrismaService } from "../prisma/prisma.service";
import { CryptoService } from "../crypto/crypto.service";
import {
  CURRENT_MASTER_KEY_VERSION,
  MasterKeyService,
} from "../crypto/master-key.service";
import { ENCRYPTION_ALGORITHM } from "../common/constants";
import { IntegrationAuthService } from "./integration-auth.service";
import { IntegrationsService } from "./integrations.service";
import { IngestionSyncService } from "../ingestion/ingestion-sync.service";

// ── in-memory Prisma double ────────────────────────────────────────────────
interface IntegrationRow {
  id: string;
  userId: string;
  provider: string;
  encryptedCredentials: string;
  iv: string | null;
  authTag: string | null;
  encryptionVersion: number;
  lastVerifiedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}
interface KeyRow {
  id: string;
  userId: string;
  provider: string;
  version: number;
  masterKeyVersion: number;
  key: string;
  iv: string;
  authTag: string;
  algorithm: string;
  createdAt: Date;
}
type UP = { userId: string; provider: string };
type UPV = UP & { version: number };

/** Newest-first job rows per integration, the shape LATEST_JOB_SELECT reads. */
interface JobRow {
  integrationId: string;
  table: "lmsSyncJobs" | "portalApiJobs";
  status: string;
  createdAt: Date;
}

function makePrismaDouble() {
  const integrations: IntegrationRow[] = [];
  const keys: KeyRow[] = [];
  const jobs: JobRow[] = [];

  /** What `include`/`select`ing LATEST_JOB_SELECT yields for one integration. */
  const withJobs = (row: IntegrationRow) => {
    const newest = (table: JobRow["table"]) =>
      jobs
        .filter((j) => j.integrationId === row.id && j.table === table)
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
        .slice(0, 1)
        .map((j) => ({ status: j.status, createdAt: j.createdAt }));
    return {
      ...row,
      lmsSyncJobs: newest("lmsSyncJobs"),
      portalApiJobs: newest("portalApiJobs"),
    };
  };

  const prisma = {
    integration: {
      upsert: (args: {
        where: { userId_provider: UP };
        create: Omit<
          IntegrationRow,
          "id" | "createdAt" | "updatedAt" | "iv" | "authTag" | "lastVerifiedAt"
        > &
          Partial<IntegrationRow>;
        update: Partial<IntegrationRow>;
      }): Promise<IntegrationRow> => {
        const { userId, provider } = args.where.userId_provider;
        const existing = integrations.find(
          (r) => r.userId === userId && r.provider === provider,
        );
        if (existing) {
          Object.assign(existing, args.update, { updatedAt: new Date() });
          return Promise.resolve(withJobs(existing));
        }
        const row: IntegrationRow = {
          id: `i${integrations.length + 1}`,
          createdAt: new Date(),
          updatedAt: new Date(),
          iv: null,
          authTag: null,
          lastVerifiedAt: null,
          ...args.create,
        };
        integrations.push(row);
        return Promise.resolve(withJobs(row));
      },
      findMany: (args: { where: { userId: string } }) =>
        Promise.resolve(
          integrations
            .filter((r) => r.userId === args.where.userId)
            .map((r) => withJobs(r)),
        ),
      findUnique: (args: { where: { userId_provider: UP } }) => {
        const { userId, provider } = args.where.userId_provider;
        const row = integrations.find(
          (r) => r.userId === userId && r.provider === provider,
        );
        return Promise.resolve(row ? withJobs(row) : null);
      },
      deleteMany: (args: { where: UP }): Promise<{ count: number }> => {
        let count = 0;
        for (let i = integrations.length - 1; i >= 0; i--) {
          if (
            integrations[i].userId === args.where.userId &&
            integrations[i].provider === args.where.provider
          ) {
            integrations.splice(i, 1);
            count++;
          }
        }
        return Promise.resolve({ count });
      },
    },
    userEncryptionKey: {
      findFirst: (args: { where: UP }): Promise<KeyRow | null> => {
        const matches = keys
          .filter(
            (k) =>
              k.userId === args.where.userId &&
              k.provider === args.where.provider,
          )
          .sort((a, b) => b.version - a.version);
        return Promise.resolve(matches[0] ?? null);
      },
      findUnique: (args: {
        where: { userId_provider_version: UPV };
      }): Promise<KeyRow | null> => {
        const { userId, provider, version } =
          args.where.userId_provider_version;
        return Promise.resolve(
          keys.find(
            (k) =>
              k.userId === userId &&
              k.provider === provider &&
              k.version === version,
          ) ?? null,
        );
      },
      create: (args: {
        data: Omit<KeyRow, "id" | "createdAt">;
      }): Promise<KeyRow> => {
        const row: KeyRow = {
          id: `k${keys.length + 1}`,
          createdAt: new Date(),
          ...args.data,
        };
        keys.push(row);
        return Promise.resolve(row);
      },
    },
  };

  return { prisma, integrations, keys, jobs };
}

// ── fixtures ──────────────────────────────────────────────────────────────
const LMS_MASTER = randomBytes(32).toString("hex");
const PORTAL_MASTER = randomBytes(32).toString("hex");
const ENV: Record<string, string> = {
  [`MASTER_LMS_ENCRYPTION_KEY_V${CURRENT_MASTER_KEY_VERSION}`]: LMS_MASTER,
  [`MASTER_PORTAL_ENCRYPTION_KEY_V${CURRENT_MASTER_KEY_VERSION}`]:
    PORTAL_MASTER,
};

const USER = { id: "u1" } as User;
const creds = {
  provider: "LMS" as const,
  username: "sv123",
  password: "pw-123",
};

describe("IntegrationsService", () => {
  let service: IntegrationsService;
  let crypto: CryptoService;
  let verifyCredentials: jest.Mock;
  let syncNow: jest.Mock;
  let db: ReturnType<typeof makePrismaDouble>;

  beforeEach(async () => {
    db = makePrismaDouble();
    verifyCredentials = jest.fn().mockResolvedValue(true);
    syncNow = jest.fn().mockResolvedValue(undefined);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        IntegrationsService,
        CryptoService,
        MasterKeyService,
        { provide: PrismaService, useValue: db.prisma },
        { provide: ConfigService, useValue: { get: (n: string) => ENV[n] } },
        { provide: IntegrationAuthService, useValue: { verifyCredentials } },
        { provide: IngestionSyncService, useValue: { syncNow } },
      ],
    }).compile();

    service = module.get<IntegrationsService>(IntegrationsService);
    crypto = module.get<CryptoService>(CryptoService);
  });

  it("should be defined", () => {
    expect(service).toBeDefined();
  });

  describe("connect", () => {
    it("verifies, provisions a wrapped DEK once, and stores encrypted creds", async () => {
      const status = await service.connect(USER, creds);

      expect(verifyCredentials).toHaveBeenCalledWith("LMS", "sv123", "pw-123");
      expect(status).toEqual({
        provider: "LMS",
        connected: true,
        lastVerifiedAt: expect.any(String) as string,
        lastSyncedAt: null,
        lastSyncStatus: null,
      });

      expect(db.keys).toHaveLength(1);
      expect(db.keys[0].provider).toBe("LMS");
      expect(db.keys[0].key).not.toContain("pw-123");

      expect(db.integrations).toHaveLength(1);
      const row = db.integrations[0];
      expect(row.iv).toMatch(/^[0-9a-f]+$/);
      expect(row.authTag).toMatch(/^[0-9a-f]+$/);
      expect(row.encryptionVersion).toBe(1);
      expect(row.encryptedCredentials).not.toContain("pw-123");
      expect(row.encryptedCredentials).not.toContain("sv123");
    });

    it("re-connect reuses the existing DEK and upserts one row", async () => {
      await service.connect(USER, creds);
      await service.connect(USER, { ...creds, password: "new-pw" });

      expect(db.keys).toHaveLength(1);
      expect(db.integrations).toHaveLength(1);
      const revealed = await service.revealCredentials("u1", "LMS");
      expect(revealed.password).toBe("new-pw");
    });

    it("rejects bad credentials with 400 and stores nothing", async () => {
      verifyCredentials.mockResolvedValue(false);

      await expect(service.connect(USER, creds)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(db.integrations).toHaveLength(0);
      expect(db.keys).toHaveLength(0);
    });

    it("maps an unreachable DLU to 503 (not a bad-password error)", async () => {
      verifyCredentials.mockRejectedValue(new Error("timeout"));

      await expect(service.connect(USER, creds)).rejects.toBeInstanceOf(
        ServiceUnavailableException,
      );
    });
  });

  describe("update", () => {
    it("uses existing credentials when only password is supplied", async () => {
      await service.connect(USER, creds);
      const revealSpy = jest.spyOn(service, "revealCredentials");

      const status = await service.update(USER, "LMS", { password: "new-pw" });

      expect(revealSpy).toHaveBeenCalledWith("u1", "LMS");
      expect(verifyCredentials).toHaveBeenLastCalledWith(
        "LMS",
        "sv123",
        "new-pw",
      );
      expect(status).toEqual({
        provider: "LMS",
        connected: true,
        lastVerifiedAt: expect.any(String) as string,
        lastSyncedAt: null,
        lastSyncStatus: null,
      });
      await expect(service.revealCredentials("u1", "LMS")).resolves.toEqual({
        username: "sv123",
        password: "new-pw",
      });
    });

    it("uses existing credentials when only username is supplied", async () => {
      await service.connect(USER, creds);
      const revealSpy = jest.spyOn(service, "revealCredentials");

      const status = await service.update(USER, "LMS", {
        username: "new-user",
      });

      expect(revealSpy).toHaveBeenCalledWith("u1", "LMS");
      expect(verifyCredentials).toHaveBeenLastCalledWith(
        "LMS",
        "new-user",
        "pw-123",
      );
      expect(status).toEqual({
        provider: "LMS",
        connected: true,
        lastVerifiedAt: expect.any(String) as string,
        lastSyncedAt: null,
        lastSyncStatus: null,
      });
      await expect(service.revealCredentials("u1", "LMS")).resolves.toEqual({
        username: "new-user",
        password: "pw-123",
      });
    });

    it("requires both fields before creating a first connection", async () => {
      await expect(
        service.update(USER, "LMS", { password: "pw-123" }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe("status", () => {
    it("returns an entry for every provider", async () => {
      await service.connect(USER, creds);

      const { integrations } = await service.status(USER);
      expect(integrations).toEqual(
        expect.arrayContaining([
          {
            provider: "LMS",
            connected: true,
            lastVerifiedAt: expect.any(String) as string,
            lastSyncedAt: null,
            lastSyncStatus: null,
          },
          {
            provider: "PORTAL",
            connected: false,
            lastVerifiedAt: null,
            lastSyncedAt: null,
            lastSyncStatus: null,
          },
        ]),
      );
    });

    it("surfaces the newest job row as lastSyncedAt / lastSyncStatus", async () => {
      await service.connect(USER, creds);
      const integrationId = db.integrations[0].id;
      // Two runs for this student; only the newer one may be reported.
      db.jobs.push(
        {
          integrationId,
          table: "lmsSyncJobs",
          status: "FAILED",
          createdAt: new Date("2026-09-05T01:00:00.000Z"),
        },
        {
          integrationId,
          table: "lmsSyncJobs",
          status: "COMPLETED",
          createdAt: new Date("2026-09-06T01:00:00.000Z"),
        },
      );

      const { integrations } = await service.status(USER);
      const lms = integrations.find((i) => i.provider === "LMS");

      expect(lms).toMatchObject({
        lastSyncedAt: "2026-09-06T01:00:00.000Z",
        lastSyncStatus: "COMPLETED",
      });
    });
  });

  describe("sync", () => {
    it("runs the watchers, then reports the run just performed", async () => {
      await service.connect(USER, creds);
      const integrationId = db.integrations[0].id;
      // The watchers write their job row; this stands in for that.
      syncNow.mockImplementation(() => {
        db.jobs.push({
          integrationId,
          table: "lmsSyncJobs",
          status: "COMPLETED",
          createdAt: new Date("2026-09-06T04:00:00.000Z"),
        });
        return Promise.resolve();
      });

      const status = await service.sync(USER, "LMS");

      expect(syncNow).toHaveBeenCalledWith("u1", "LMS");
      expect(status).toMatchObject({
        provider: "LMS",
        connected: true,
        lastSyncedAt: "2026-09-06T04:00:00.000Z",
        lastSyncStatus: "COMPLETED",
      });
      // Never a counts payload — run counts stay in the job rows and the logs.
      expect(Object.keys(status).sort()).toEqual([
        "connected",
        "lastSyncStatus",
        "lastSyncedAt",
        "lastVerifiedAt",
        "provider",
      ]);
    });

    it("reports a failed run rather than throwing", async () => {
      await service.connect(USER, creds);
      const integrationId = db.integrations[0].id;
      syncNow.mockImplementation(() => {
        db.jobs.push({
          integrationId,
          table: "lmsSyncJobs",
          status: "FAILED",
          createdAt: new Date("2026-09-06T04:00:00.000Z"),
        });
        return Promise.resolve();
      });

      await expect(service.sync(USER, "LMS")).resolves.toMatchObject({
        lastSyncStatus: "FAILED",
      });
    });

    it("404s when the provider is not connected, and runs nothing", async () => {
      await expect(service.sync(USER, "PORTAL")).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(syncNow).not.toHaveBeenCalled();
    });
  });

  describe("disconnect", () => {
    it("removes the row, is idempotent, and keeps the DEK", async () => {
      await service.connect(USER, creds);

      await expect(service.disconnect(USER, "LMS")).resolves.toEqual({
        provider: "LMS",
        connected: false,
        lastVerifiedAt: null,
        lastSyncedAt: null,
        lastSyncStatus: null,
      });
      await expect(service.disconnect(USER, "LMS")).resolves.toBeDefined();

      expect(db.integrations).toHaveLength(0);
      expect(db.keys).toHaveLength(1);
    });
  });

  describe("two-layer envelope", () => {
    it("round-trips credentials through both layers", async () => {
      await service.connect(USER, creds);

      const revealed = await service.revealCredentials("u1", "LMS");
      expect(revealed).toEqual({ username: "sv123", password: "pw-123" });
    });

    it("a master-key-only compromise cannot decrypt the credential blob", async () => {
      await service.connect(USER, creds);
      const row = db.integrations[0];

      // Attacker has the DB row AND the LMS master key, but skips the DEK
      // unwrap step: decrypting the credential blob directly under the master
      // key fails the GCM auth check.
      expect(() =>
        crypto.decryptString({
          key: Buffer.from(LMS_MASTER, "hex"),
          iv: Buffer.from(row.iv as string, "hex"),
          algorithm: ENCRYPTION_ALGORITHM,
          encrypted: row.encryptedCredentials,
          authTag: row.authTag as string,
        }),
      ).toThrow();
    });
  });
});
