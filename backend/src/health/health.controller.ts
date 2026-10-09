import { Controller, Get, ServiceUnavailableException } from "@nestjs/common";
import { HealthReport, HealthService } from "./health.service";

/**
 * Served by both roles (ADR-0011): under `/api/v1` on the API, bare on the
 * worker. Errors are 503 so load balancers and compose healthchecks act on them.
 */
@Controller("health")
export class HealthController {
  constructor(private readonly health: HealthService) {}

  /** All dependencies: Postgres, both Redis instances, bandit when configured. */
  @Get()
  async all(): Promise<HealthReport> {
    return this.orThrow(await this.health.all());
  }

  /** Process is up; touches no dependency. */
  @Get("live")
  live(): { status: "ok" } {
    return { status: "ok" };
  }

  /** Ready to serve: Postgres + Redis. */
  @Get("ready")
  async ready(): Promise<HealthReport> {
    return this.orThrow(await this.health.ready());
  }

  private orThrow(report: HealthReport): HealthReport {
    if (report.status !== "ok") throw new ServiceUnavailableException(report);
    return report;
  }
}
