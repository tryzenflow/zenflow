import { Test, TestingModule } from "@nestjs/testing";
import type { User } from "../../generated/prisma";
import { IntegrationsController } from "./integrations.controller";
import { IntegrationsService } from "./integrations.service";

const USER = { id: "u1" } as User;

describe("IntegrationsController", () => {
  let controller: IntegrationsController;
  const connect = jest.fn();
  const status = jest.fn();
  const disconnect = jest.fn();

  beforeEach(async () => {
    connect.mockReset().mockResolvedValue({
      provider: "LMS",
      connected: true,
      lastVerifiedAt: "2026-08-28T00:00:00.000Z",
    });
    status.mockReset().mockResolvedValue({ integrations: [] });
    disconnect.mockReset().mockResolvedValue({
      provider: "PORTAL",
      connected: false,
      lastVerifiedAt: null,
    });

    const module: TestingModule = await Test.createTestingModule({
      controllers: [IntegrationsController],
      providers: [
        {
          provide: IntegrationsService,
          useValue: { connect, status, disconnect },
        },
      ],
    }).compile();

    controller = module.get<IntegrationsController>(IntegrationsController);
  });

  it("should be defined", () => {
    expect(controller).toBeDefined();
  });

  it("wraps connect() in the success envelope", async () => {
    const dto = { provider: "LMS" as const, username: "sv", password: "pw" };

    const res = await controller.connect(USER, dto);

    expect(connect).toHaveBeenCalledWith(USER, dto);
    expect(res).toEqual({
      success: true,
      message: "LMS account connected",
      data: {
        provider: "LMS",
        connected: true,
        lastVerifiedAt: "2026-08-28T00:00:00.000Z",
      },
    });
  });

  it("wraps list() in the success envelope", async () => {
    const res = await controller.list(USER);

    expect(status).toHaveBeenCalledWith(USER);
    expect(res).toEqual({
      success: true,
      message: "Integration status",
      data: { integrations: [] },
    });
  });

  it("wraps disconnect() in the success envelope", async () => {
    const res = await controller.disconnect(USER, "PORTAL");

    expect(disconnect).toHaveBeenCalledWith(USER, "PORTAL");
    expect(res.success).toBe(true);
    expect(res.message).toBe("PORTAL account disconnected");
  });
});
