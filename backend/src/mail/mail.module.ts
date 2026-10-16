import { MailerModule } from "@nestjs-modules/mailer";
import { Global, Module } from "@nestjs/common";
import { MailService } from "./mail.service";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { mailTransport } from "../common/config/connections";
import { PrismaModule } from "../prisma/prisma.module";

@Global()
@Module({
  imports: [
    PrismaModule,
    MailerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        transport: mailTransport((key) => config.get(key)),
        defaults: {
          from: `"Zenflow" <${config.get("MAIL_FROM")}>`,
        },
      }),
    }),
  ],
  providers: [MailService],
  exports: [MailService],
})
export class MailModule {}
