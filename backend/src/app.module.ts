import { Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import * as Joi from "@hapi/joi";
import { PrismaModule } from "./prisma/prisma.module";
import { AppService } from "./app.service";
import { AppController } from "./app.controller";
import { AuthModule } from "./auth/auth.module";
import { CacheModule } from "@nestjs/cache-manager";
import { createKeyv } from "@keyv/redis";
import { Keyv } from "keyv";
import { CacheableMemory } from "cacheable";
import { MailService } from "./mail/mail.service";
import { MailModule } from "./mail/mail.module";
import { UsersModule } from "./users/users.module";
import { SessionsModule } from "./sessions/sessions.module";
import { TagsModule } from "./tags/tags.module";
import { FilesModule } from "./files/files.module";
import { SchedulerModule } from "./scheduler/scheduler.module";
import { ScheduleModule } from "@nestjs/schedule";
import { RedisModule } from "./common/redis/redis.module";
import { RateLimitModule } from "./common/rate-limit";
import { CryptoModule } from "./crypto/crypto.module";
import { IntegrationsModule } from "./integrations/integrations.module";

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath:
        process.env.NODE_ENV === "production" ? ".env.prod" : ".env.dev",
      validationSchema: Joi.object({
        DATABASE_URL: Joi.string().required(),
        SESSION_SECRET: Joi.string().required(),
        // Per-provider master keys for the DLU-credential envelope scheme (see
        // crypto/). 32 bytes, hex-encoded (64 chars) each. Each one wraps that
        // provider's per-user UserEncryptionKey rows; never stored in the DB.
        // The `_V<n>` suffix is the master-key version — add a new var (bump
        // MasterKeyService.CURRENT_MASTER_KEY_VERSION) to rotate; unwrapping an
        // old row still resolves its recorded version.
        MASTER_LMS_ENCRYPTION_KEY_V1: Joi.string()
          .length(64)
          .regex(/^[0-9a-fA-F]+$/, "hex")
          .required(),
        MASTER_PORTAL_ENCRYPTION_KEY_V1: Joi.string()
          .length(64)
          .regex(/^[0-9a-fA-F]+$/, "hex")
          .required(),
        CORS_ORIGIN: Joi.string().required(),
        CACHE_URL: Joi.string().uri().required(),
        // Separate Redis instance dedicated to LimitKit's rate-limit
        // counters (see common/rate-limit/) — kept off the session/OTP
        // Redis (CACHE_URL) so counter churn can't evict that data.
        RATE_LIMIT_CACHE_URL: Joi.string().uri().required(),
        MAIL_TRANSPORT: Joi.string().uri().required(),
        MAIL_FROM: Joi.string().email().required(),
        // Idle session lifetime in ms; with rolling sessions, active use keeps
        // extending it. Defaults to 7 days. Drives both the cookie maxAge and
        // the Redis session TTL.
        SESSION_TTL_MS: Joi.number()
          .integer()
          .positive()
          .default(7 * 24 * 60 * 60 * 1000),
        // Session cookie flags, decoupled from NODE_ENV so each environment can
        // opt in independently. Production (cross-site FE on Netlify, API behind
        // TLS) needs COOKIE_SECURE=true + COOKIE_SAMESITE=none; same-origin dev
        // keeps the lax/insecure defaults.
        COOKIE_SECURE: Joi.boolean().default(true),
        COOKIE_SAMESITE: Joi.string()
          .valid("lax", "none", "strict")
          .default("lax"),
        // LimitKit rate limits on the OTP-sending auth endpoints (see
        // common/rate-limit/). Sliding windows, in seconds + max requests.
        OTP_REQUEST_IP_WINDOW_SEC: Joi.number()
          .integer()
          .positive()
          .default(60),
        OTP_REQUEST_IP_LIMIT: Joi.number().integer().positive().default(5),
        OTP_REQUEST_EMAIL_WINDOW_SEC: Joi.number()
          .integer()
          .positive()
          .default(900), // 15 min
        OTP_REQUEST_EMAIL_LIMIT: Joi.number().integer().positive().default(3),
        OTP_VERIFY_IP_WINDOW_SEC: Joi.number().integer().positive().default(60),
        OTP_VERIFY_IP_LIMIT: Joi.number().integer().positive().default(20),
        OTP_VERIFY_EMAIL_WINDOW_SEC: Joi.number()
          .integer()
          .positive()
          .default(600), // 10 min
        OTP_VERIFY_EMAIL_LIMIT: Joi.number().integer().positive().default(10),
        PORTAL_API_KEY: Joi.string().required(),
      }),
    }),
    ScheduleModule.forRoot(),
    CacheModule.registerAsync({
      isGlobal: true,
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        return {
          stores: [
            new Keyv({
              store: new CacheableMemory({ ttl: 900000, lruSize: 10000 }),
            }),
            createKeyv(configService.get("CACHE_URL")),
          ],
        };
      },
    }),
    RedisModule,
    RateLimitModule,
    UsersModule,
    PrismaModule,
    AuthModule,
    MailModule,
    SessionsModule,
    CryptoModule,
    TagsModule,
    FilesModule,
    // Background cron providers (MatrixDecayService, AbandonedSessionsService)
    // plus DayRescheduleService, the implicit single-day repack triggered by
    // SessionsService on create/deadline-edit. The old manual Optimize
    // controller (+ undo) was removed; see scheduler.module.ts.
    SchedulerModule,
    IntegrationsModule,
  ],
  providers: [AppService, MailService],
  controllers: [AppController],
})
export class AppModule {}
