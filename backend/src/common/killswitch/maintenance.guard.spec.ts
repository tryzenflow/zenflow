import {
  ServiceUnavailableException,
  type ExecutionContext,
} from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { KillSwitchService } from "./killswitch.service";
import { MaintenanceGuard } from "./maintenance.guard";

const ctx = (method: string, path: string): ExecutionContext =>
  ({
    getType: () => "http",
    switchToHttp: () => ({ getRequest: () => ({ method, path }) }),
  }) as unknown as ExecutionContext;

async function build(maintenance: boolean) {
  const module = await Test.createTestingModule({
    providers: [
      MaintenanceGuard,
      {
        provide: KillSwitchService,
        useValue: { isEnabled: jest.fn().mockResolvedValue(maintenance) },
      },
    ],
  }).compile();
  return module.get(MaintenanceGuard);
}

describe("MaintenanceGuard", () => {
  it("rejects writes with 503 while maintenance is on", async () => {
    const guard = await build(true);
    await expect(
      guard.canActivate(ctx("POST", "/api/v1/sessions")),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it("lets reads and health through while on", async () => {
    const guard = await build(true);
    await expect(
      guard.canActivate(ctx("GET", "/api/v1/sessions")),
    ).resolves.toBe(true);
    await expect(
      guard.canActivate(ctx("POST", "/api/v1/health")),
    ).resolves.toBe(true);
  });

  it("lets writes through while off", async () => {
    const guard = await build(false);
    await expect(
      guard.canActivate(ctx("POST", "/api/v1/sessions")),
    ).resolves.toBe(true);
  });
});
