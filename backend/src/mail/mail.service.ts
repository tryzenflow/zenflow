import { MailerService } from "@nestjs-modules/mailer";
import { Injectable } from "@nestjs/common";
import type { Lang } from "@zenflow/shared";
import { join } from "path";
import { PrismaService } from "../prisma/prisma.service";

// Resolved relative to __dirname so it works both from src (ts-node/jest) and
// from dist at runtime — nest-cli copies mail/templates/** (including assets)
// next to the compiled service.
const LOGO_PATH = join(__dirname, "templates", "assets", "logo.png");

@Injectable()
export class MailService {
  constructor(
    private mailerService: MailerService,
    private readonly prisma: PrismaService,
  ) {}

  async sendLoginEmail(to: string, otp: string, from?: string, lang?: Lang) {
    // The language picked on the login screen wins; the stored account
    // preference only applies when the client didn't send one.
    const stored = lang
      ? undefined
      : await this.prisma.user.findUnique({
          where: { email: to },
          select: { lang: true },
        });
    const vi = lang ? lang === "vi" : stored?.lang === "VI_VN";
    const copy = vi
      ? {
          language: "vi",
          pageTitle: "Mã xác minh Zenflow",
          greeting: "Xin chào,",
          welcome: "Chào mừng bạn đến với Zenflow!",
          instructions:
            "Dùng mã xác minh một lần bên dưới để xác nhận email của bạn:",
          expires:
            "Mã có hiệu lực trong 15 phút. Hãy giữ bí mật và không chia sẻ mã với bất kỳ ai.",
          ignore: "Nếu bạn không yêu cầu mã này, hãy bỏ qua email này.",
          thanks: "Cảm ơn bạn,",
          team: "Đội ngũ Zenflow",
          rights: "Bảo lưu mọi quyền.",
        }
      : {
          language: "en",
          pageTitle: "Your Zenflow Verification Code",
          greeting: "Hi,",
          welcome: "Welcome to Zenflow — we're glad you're here!",
          instructions:
            "Use the one-time verification code below to confirm your email:",
          expires:
            "This code expires in 15 minutes. Please keep it private and do not share it with anyone.",
          ignore:
            "If you didn't request this code, you can safely ignore this email.",
          thanks: "Thanks,",
          team: "The Zenflow Team",
          rights: "All rights reserved.",
        };
    await this.mailerService.sendMail({
      // Only set `from` when explicitly provided. nodemailer copies every key
      // present on the message (even `from: undefined`) before applying
      // transport defaults, and it skips a default when the key already exists —
      // so passing `from: undefined` clobbers `defaults.from` and ships a mail
      // with no From header, which Gmail rejects as non-RFC-5322-compliant.
      ...(from ? { from } : {}),
      to,
      subject: vi
        ? "Xác nhận địa chỉ email của bạn"
        : "Confirm your email account",
      template: "./confirm-email",
      context: { otp, ...copy },
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
