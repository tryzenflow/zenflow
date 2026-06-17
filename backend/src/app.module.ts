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
import { TasksModule } from "./tasks/tasks.module";
import { TagsModule } from "./tags/tags.module";
import { FilesModule } from "./files/files.module";
import { ScheduleModule } from "@nestjs/schedule";

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath:
        process.env.NODE_ENV === "production" ? ".env.prod" : ".env.dev",
      validationSchema: Joi.object({
        DATABASE_URL: Joi.string().required(),
        SESSION_SECRET: Joi.string().required(),
        CORS_ORIGIN: Joi.string().required(),
        CACHE_URL: Joi.string().uri().required(),
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
    UsersModule,
    PrismaModule,
    AuthModule,
    MailModule,
    TasksModule,
    TagsModule,
    FilesModule,
  ],
  providers: [AppService, MailService],
  controllers: [AppController],
})
export class AppModule {}
