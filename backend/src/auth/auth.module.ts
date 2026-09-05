import { Module } from "@nestjs/common";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";
import { UsersModule } from "../users/users.module";
import { MailModule } from "../mail/mail.module";
import { SessionsModule } from "../sessions/sessions.module";
import { LocalStrategy } from "./strategies";
import { LocalSerializer } from "./serializers";

@Module({
  imports: [UsersModule, MailModule, SessionsModule],
  controllers: [AuthController],
  providers: [AuthService, LocalStrategy, LocalSerializer],
})
export class AuthModule {}
