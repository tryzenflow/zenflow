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

@Module({
  imports: [
    ConfigModule.forRoot({
      envFilePath: ".env.dev",
      validationSchema: Joi.object({
        DATABASE_URL: Joi.string().required(),
        SESSION_SECRET: Joi.string().required(),
        CORS_ORIGIN: Joi.string().required(),
        CACHE_URL: Joi.string().required(),
        MAIL_TRANSPORT: Joi.string().required(),
      }),
    }),
    CacheModule.registerAsync({
      isGlobal: true,
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: async (configService: ConfigService) => {
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
  ],
  providers: [AppService, MailService],
  controllers: [AppController],
})
export class AppModule {}
