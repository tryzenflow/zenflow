import { MailerService } from "@nestjs-modules/mailer";
import { Injectable } from "@nestjs/common";

@Injectable()
export class MailService {
  constructor(private mailerService: MailerService) {}

  async sendLoginEmail(to: string, otp: string, from?: string) {
    await this.mailerService.sendMail({
      from,
      to,
      subject: "Confirm your email account",
      template: "./confirm-email",
      context: { otp },
    });
  }
}
