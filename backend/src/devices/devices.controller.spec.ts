import { Test, TestingModule } from "@nestjs/testing";
import { type User } from "../../generated/prisma";
import { DevicesController } from "./devices.controller";
import { DevicesService } from "./devices.service";

const USER = { id: "u1" } as User;

async function make() {
  const service = {
    registerDevice: jest.fn().mockResolvedValue({ id: "d1" }),
    unregisterDevice: jest.fn().mockResolvedValue({ pushToken: "tok-a" }),
  };
  const module: TestingModule = await Test.createTestingModule({
    controllers: [DevicesController],
    providers: [{ provide: DevicesService, useValue: service }],
  }).compile();
  return {
    service,
    controller: module.get<DevicesController>(DevicesController),
  };
}

describe("DevicesController", () => {
  it("register forwards the user + dto and wraps the envelope", async () => {
    const { controller, service } = await make();

    const res = await controller.register(USER, {
      platform: "ANDROID",
      pushToken: "tok-a",
    });

    expect(service.registerDevice).toHaveBeenCalledWith(USER, {
      platform: "ANDROID",
      pushToken: "tok-a",
    });
    expect(res).toEqual({
      success: true,
      message: "Device registered",
      data: { id: "d1" },
    });
  });

  it("unregister forwards just the token and wraps the envelope", async () => {
    const { controller, service } = await make();

    const res = await controller.unregister(USER, { pushToken: "tok-a" });

    expect(service.unregisterDevice).toHaveBeenCalledWith(USER, "tok-a");
    expect(res).toEqual({
      success: true,
      message: "Device unregistered",
      data: { pushToken: "tok-a" },
    });
  });
});
