import type { Cache } from "cache-manager";
import { CACHE_MANAGER } from "@nestjs/cache-manager";
import {
  BadRequestException,
  HttpException,
  Inject,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from "@nestjs/common";
import { generateOTP } from "./utils";
import { UsersService } from "../users/users.service";
import { MailService } from "../mail/mail.service";
import { UpdateUserDto } from "../users/dto";

@Injectable()
export class AuthService {
  constructor(
    @Inject(CACHE_MANAGER) private cacheManager: Cache,
    private usersService: UsersService,
    private mailService: MailService
  ) {}

  async requestOTPCode(email: string) {
    try {
      const otpCode = generateOTP();
      await this.cacheManager.set(`otp:${email}`, otpCode);
      await this.mailService.sendLoginEmail(email, otpCode);
    } catch (error) {
      throw new InternalServerErrorException();
    }
  }

  async updateBasicInfo(userId: number, { name, timezone }: UpdateUserDto) {
    try {
      const user = await this.usersService.update(userId, {
        name,
        timezone,
      });
      return user;
    } catch (error) {
      throw new InternalServerErrorException();
    }
  }

  private async createUserIfNotExists(email: string) {
    let user = await this.usersService.findByEmail(email);
    if (!user) user = await this.usersService.create({ email });
    return user;
  }

  async verifyOTPCode(email: string, providedOtp: string) {
    try {
      const otpCode = await this.cacheManager.get<string | null>(
        `otp:${email}`
      );
      if (!otpCode)
        throw new NotFoundException(
          "OTP Code is not found or may have been expired"
        );

      if (otpCode !== providedOtp) {
        throw new BadRequestException("Incorrect OTP provided");
      }
      await this.cacheManager.del(`otp:${email}`);
      const user = await this.createUserIfNotExists(email);
      return user;
    } catch (error) {
      if (error instanceof HttpException) throw error;
      throw new InternalServerErrorException();
    }
  }
}
