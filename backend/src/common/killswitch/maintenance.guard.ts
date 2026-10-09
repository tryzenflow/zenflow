import {
  CanActivate,
  ExecutionContext,
  Injectable,
  ServiceUnavailableException,
} from "@nestjs/common";
import type { Request } from "express";
import { KillSwitchService } from "./killswitch.service";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * `maintenance` flag: while on, every non-GET API request is rejected with
 * 503. Reads and `/health*` stay up so probes and the app shell keep working.
 */
@Injectable()
export class MaintenanceGuard implements CanActivate {
  constructor(private readonly killSwitch: KillSwitchService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== "http") return true;
    const req = context.switchToHttp().getRequest<Request>();
    if (SAFE_METHODS.has(req.method)) return true;
    if (/\/health(\/|$)/.test(req.path)) return true;
    if (await this.killSwitch.isEnabled("maintenance")) {
      throw new ServiceUnavailableException({
        success: false,
        message: "Zenflow is under maintenance, please try again shortly",
      });
    }
    return true;
  }
}
