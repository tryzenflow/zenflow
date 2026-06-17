import { MailerService } from "@nestjs-modules/mailer";
import { Injectable } from "@nestjs/common";
import { join } from "path";

// Resolved relative to __dirname so it works both from src (ts-node/jest) and
// from dist at runtime — nest-cli copies mail/templates/** (including assets)
// next to the compiled service.
const LOGO_PATH = join(__dirname, "templates", "assets", "logo.png");

@Injectable()
export class MailService {
  constructor(private mailerService: MailerService) {}

  async sendLoginEmail(to: string, otp: string, from?: string) {
    await this.mailerService.sendMail({
      // Only set `from` when explicitly provided. nodemailer copies every key
      // present on the message (even `from: undefined`) before applying
      // transport defaults, and it skips a default when the key already exists —
      // so passing `from: undefined` clobbers `defaults.from` and ships a mail
      // with no From header, which Gmail rejects as non-RFC-5322-compliant.
      ...(from ? { from } : {}),
      to,
      subject: "Confirm your email account",
      template: "./confirm-email",
      context: { otp },
      attachments: [
        {
          filename: "logo.png",
          path: LOGO_PATH,
          cid: "logo",
        },
      ],
    });
  }
}
