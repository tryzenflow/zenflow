import { ConfigService } from "@nestjs/config";
import {
  BadGatewayException,
  BadRequestException,
  forwardRef,
  Inject,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { randomBytes } from "crypto";
import type { JobStatus, User } from "../../generated/prisma";
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
import { UpstreamUnavailableHttpException } from "../common/upstream-unavailable.exception";
import { SyncCooldownException } from "./sync-cooldown.exception";
import { SyncInflightGuard } from "./sync-inflight.service";
import { IntegrationAuthService } from "./integration-auth.service";
import {
  IngestionSyncService,
  ManualSyncUnavailableError,
  type ManualSyncOutcome,
} from "../ingestion/ingestion-sync.service";
import {
  DATA_KINDS_BY_PROVIDER,
  IngestionScheduleService,
} from "../ingestion/ingestion-schedule.service";
import { ConnectIntegrationDto } from "./dto/connect-integration.dto";
import { UpdateIntegrationDto } from "./dto/update-integration.dto";

/** Every provider we report status for, connected or not. */
const ALL_PROVIDERS: readonly IntegrationProvider[] = ["LMS", "PORTAL"];

/** Newest ingestion run for an integration, whichever table it lives in. */
type LatestJob = { status: JobStatus; createdAt: Date };

/**
 * Both job tables are shaped the same; a provider only ever populates one of
 * them, so taking the newest of each and picking the non-empty side avoids
 * branching on `provider` at every call site.
 */
const LATEST_JOB_SELECT = {
  lmsSyncJobs: {
    orderBy: { createdAt: "desc" },
    take: 1,
    select: { status: true, createdAt: true },
  },
  portalApiJobs: {
    orderBy: { createdAt: "desc" },
    take: 1,
    select: { status: true, createdAt: true },
  },
  schedules: {
    select: { kind: true, lastSuccessAt: true, consecutiveFailures: true },
  },
} as const;

type ScheduleRows = {
  kind: string;
  lastSuccessAt: Date | null;
  consecutiveFailures: number;
}[];

/** Is a pass that feeds the calendar currently failing? */
function isFailing(
  provider: IntegrationProvider,
  row: { schedules?: ScheduleRows },
): boolean {
  return DATA_KINDS_BY_PROVIDER[provider].some(
    (kind) =>
      (row.schedules?.find((s) => s.kind === kind)?.consecutiveFailures ?? 0) >
      0,
  );
}

/**
 * When every data pass of `provider` last came back clean: the oldest of their
 * success stamps, so one pass that keeps failing (or never ran) cannot be
 * hidden behind another's success. Null until all of them have succeeded.
 */
function lastGoodSyncOf(
  provider: IntegrationProvider,
  row: { schedules?: ScheduleRows },
): Date | null {
  const stamps = DATA_KINDS_BY_PROVIDER[provider].map(
    (kind) => row.schedules?.find((s) => s.kind === kind)?.lastSuccessAt,
  );
  if (stamps.some((stamp) => !stamp)) return null;
  return new Date(Math.min(...stamps.map((stamp) => stamp!.getTime())));
}

function latestJobOf(row: {
  lmsSyncJobs?: LatestJob[];
  portalApiJobs?: LatestJob[];
}): LatestJob | null {
  return row.lmsSyncJobs?.[0] ?? row.portalApiJobs?.[0] ?? null;
}

interface DecryptedDek {
  key: Buffer;
  /** `UserEncryptionKey.version` this DEK corresponds to. */
  version: number;
}

/**
 * LMS / portal credential storage.
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
    private readonly config: ConfigService,
    private readonly crypto: CryptoService,
    private readonly masterKeys: MasterKeyService,
    private readonly integrationAuth: IntegrationAuthService,
    private readonly syncInflight: SyncInflightGuard,
    // Mutually dependent by design: the watchers need `revealCredentials`, and
    // the manual sync trigger needs the watchers. See `IngestionModule`.
    @Inject(forwardRef(() => IngestionSyncService))
    private readonly ingestionSync: IngestionSyncService,
    // Issue #56: a newly connected student needs their rolling-schedule rows
    // now, not at the next tick's backfill sweep.
    @Inject(forwardRef(() => IngestionScheduleService))
    private readonly ingestionSchedule: IngestionScheduleService,
  ) {}

  /** `POST /integrations` — verify against DLU, then encrypt + upsert. */
  async connect(
    user: User,
    dto: ConnectIntegrationDto,
  ): Promise<IntegrationStatus> {
    return this.storeCredentials(user, dto.provider, {
      username: dto.username,
      password: dto.password,
    });
  }

  async update(
    user: User,
    provider: IntegrationProvider,
    dto: UpdateIntegrationDto,
  ): Promise<IntegrationStatus> {
    const current = await this.prisma.integration.findUnique({
      where: { userId_provider: { userId: user.id, provider } },
      select: {
        encryptedCredentials: true,
        iv: true,
        authTag: true,
        encryptionVersion: true,
      },
    });

    if (!current) {
      if (!dto.username || !dto.password) {
        throw new BadRequestException(
          "Provide both username and password to connect this provider for the first time.",
        );
      }
      return this.storeCredentials(user, provider, {
        username: dto.username,
        password: dto.password,
      });
    }

    const existing = await this.revealCredentials(user.id, provider);
    const username = dto.username ?? existing.username;
    const password = dto.password ?? existing.password;

    if (!username || !password) {
      throw new BadRequestException(
        "Provide at least a username or password to update this account.",
      );
    }

    return this.storeCredentials(user, provider, {
      username,
      password,
    });
  }

  /**
   * `GET /integrations` — one entry per provider; no secret material.
   *
   * `lastSyncedAt` / `lastSyncStatus` come from the newest job row for that
   * integration (`LmsSyncJob` for LMS, `PortalAPIJob` for the portal). Only that
   * pair is exposed: the job's items — request URLs, status codes, raw response
   * bodies — stay backend-internal diagnostics.
   */
  async status(user: User): Promise<IntegrationStatusListResponse> {
    const rows = await this.prisma.integration.findMany({
      where: { userId: user.id },
      select: {
        provider: true,
        lastVerifiedAt: true,
        ...LATEST_JOB_SELECT,
      },
    });
    const byProvider = new Map(rows.map((r) => [r.provider, r]));
    return {
      integrations: ALL_PROVIDERS.map((provider) => {
        const row = byProvider.get(provider);
        return this.toStatus(
          provider,
          row?.lastVerifiedAt ?? null,
          !!row,
          row ? latestJobOf(row) : null,
          row ? lastGoodSyncOf(provider, row) : null,
          row ? isFailing(provider, row) : false,
        );
      }),
    };
  }

  /**
   * `POST /integrations/:provider/sync` — run this student's watchers now.
   *
   * The reply is the provider's {@link IntegrationStatus}, **not** a per-run
   * counts payload: what the run did lives in its job rows and the logs, and
   * the only run facts that belong in the API contract are `lastSyncedAt` /
   * `lastSyncStatus` — which this reads back *after* awaiting the run, so they
   * describe the sync just performed rather than the previous one.
   *
   * `PORTAL` covers two upstream endpoints (timetable and exams), so it queues
   * two jobs and the status reflects whichever job row finished last. The sync
   * runs on the fetch workers; if it has not finished after
   * `SYNC_MANUAL_WAIT_MS` the reply carries `syncPending: true` (HTTP 202) with
   * the current status.
   */
  async sync(
    user: User,
    provider: IntegrationProvider,
  ): Promise<IntegrationStatus> {
    const connected = await this.prisma.integration.findUnique({
      where: { userId_provider: { userId: user.id, provider } },
      select: { id: true },
    });
    if (!connected) {
      throw new NotFoundException(
        `No ${this.label(provider)} account connected`,
      );
    }

    // At least `SYNC_MANUAL_COOLDOWN_SEC` between two runs of this provider,
    // whoever ran the last one: a student mashing the button, or pressing it
    // right after the ticker synced, would only repeat the same DLU requests.
    const lastRun = await this.ingestionSchedule.lastRunAt(
      connected.id,
      provider,
    );
    if (lastRun) {
      const cooldownMs =
        (this.config.get<number>("SYNC_MANUAL_COOLDOWN_SEC") ?? 900) * 1000;
      const wait = lastRun.getTime() + cooldownMs - Date.now();
      if (wait > 0) {
        throw new SyncCooldownException(this.label(provider), wait);
      }
    }

    // Upstream circuit breaker open: refuse with 503 + Retry-After instead of
    // making the student wait out timeouts.
    const wait = this.ingestionSync.upstreamUnavailableFor(provider);
    if (wait !== null) {
      throw new UpstreamUnavailableHttpException(
        `DLU ${this.label(provider)} is temporarily unavailable. Your data is safe and will sync automatically; please try again later.`,
        wait,
      );
    }

    // An in-flight duplicate is a 409 here.
    let outcome: ManualSyncOutcome;
    try {
      outcome = await this.syncInflight.run(user.id, provider, () =>
        this.ingestionSync.syncNow(user.id, provider),
      );
    } catch (err) {
      // The breaker lives in the workers, so the peek above rarely trips: this
      // is where a parked job or an unreachable queue becomes a 503.
      if (err instanceof ManualSyncUnavailableError) {
        throw new UpstreamUnavailableHttpException(
          err.reason === "upstream"
            ? `DLU ${this.label(provider)} is temporarily unavailable. Your data is safe and will sync automatically; please try again later.`
            : "Sync is temporarily unavailable. Please try again in a moment.",
          err.retryAfterMs,
        );
      }
      throw err;
    }

    // The jobs defer the schedule rows that came back clean (or count the
    // failure) themselves, so it also happens when we stop waiting.

    // A pass that failed (no token, rejected login, upstream error) is an error
    // the student must see, not a 201 that another pass's success papers over.
    // The job rows still say what happened; the controller charges no quota.
    if (!outcome.complete && !outcome.pending) {
      throw new BadGatewayException(
        `DLU ${this.label(provider)} sync did not complete. Check your account details and try again.`,
      );
    }
    const status = await this.statusOf(user.id, provider);
    // Still running in the background: the controller answers 202.
    return outcome.pending ? { ...status, syncPending: true } : status;
  }

  /** One provider's status, re-read from the DB (job rows included). */
  private async statusOf(
    userId: string,
    provider: IntegrationProvider,
  ): Promise<IntegrationStatus> {
    const row = await this.prisma.integration.findUnique({
      where: { userId_provider: { userId, provider } },
      select: { provider: true, lastVerifiedAt: true, ...LATEST_JOB_SELECT },
    });
    if (!row) return this.toStatus(provider, null, false);
    return this.toStatus(
      provider,
      row.lastVerifiedAt,
      true,
      latestJobOf(row),
      lastGoodSyncOf(provider, row),
      isFailing(provider, row),
    );
  }

  private async storeCredentials(
    user: User,
    provider: IntegrationProvider,
    credentials: { username: string; password: string },
  ): Promise<IntegrationStatus> {
    let valid: boolean;
    try {
      valid = await this.integrationAuth.verifyCredentials(
        provider,
        credentials.username,
        credentials.password,
      );
    } catch {
      throw new ServiceUnavailableException(
        "Couldn't reach DLU to verify your account. Please try again in a moment.",
      );
    }
    if (!valid) {
      throw new BadRequestException(
        `Could not sign in to your DLU ${this.label(provider)} account. Check your username and password.`,
      );
    }

    const dek = await this.ensureUserKey(user.id, provider);
    const iv = randomBytes(IV_RANDOM_BYTES_SIZE);
    const { encrypted, authTag } = this.crypto.encryptString({
      key: dek.key,
      iv,
      algorithm: ENCRYPTION_ALGORITHM,
      secret: JSON.stringify(credentials),
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
        userId_provider: { userId: user.id, provider },
      },
      create: { userId: user.id, provider, ...payload },
      update: payload,
      include: LATEST_JOB_SELECT,
    });

    // Issue #56: seed the rolling-schedule rows for this provider. Idempotent,
    // so a reconnect neither duplicates them nor resets an existing cadence.
    // Discovery is seeded due immediately and the walks a lead behind it, so a
    // brand-new integration's confirmed section set is known before anything
    // tries to read it.
    await this.ingestionSchedule.ensureRows(row.id, provider, now);

    // Re-connecting doesn't erase the run history, so report the same sync
    // state `GET /integrations` would.
    return this.toStatus(
      row.provider,
      row.lastVerifiedAt,
      true,
      latestJobOf(row),
      lastGoodSyncOf(provider, row),
      isFailing(provider, row),
    );
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
    lastSync: LatestJob | null = null,
    lastSuccess: Date | null = null,
    failing = false,
  ): IntegrationStatus {
    return {
      provider,
      connected,
      lastVerifiedAt: lastVerifiedAt ? lastVerifiedAt.toISOString() : null,
      lastSyncedAt: lastSync ? lastSync.createdAt.toISOString() : null,
      lastSyncStatus: lastSync ? lastSync.status : null,
      lastSuccessAt: lastSuccess ? lastSuccess.toISOString() : null,
      failing,
    };
  }

  private label(provider: IntegrationProvider): string {
    return provider === "LMS" ? "LMS" : "portal";
  }
}
