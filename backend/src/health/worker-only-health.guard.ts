import {
  CanActivate,
  ExecutionContext,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { HealthController } from "./health.controller";

/**
 * Worker (ADR-0011): the shared module graph registers every feature
 * controller, but the worker has no session middleware or validation pipe, so
 * it answers only the health routes and 404s the rest.
 */
@Injectable()
export class WorkerOnlyHealthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    if (context.getClass() !== HealthController) throw new NotFoundException();
    return true;
  }
}
