import { Test, TestingModule } from "@nestjs/testing";
import { User } from "../../generated/prisma";
import { PrismaService } from "../prisma/prisma.service";
import { UsersService } from "../users/users.service";
import { userFixture } from "./test-utils";
import { UsersController } from "./users.controller";

describe("AuthController (integration with AuthService)", () => {
  let controller: UsersController;
  let service: UsersService;
  let prisma: PrismaService;
  let user: User;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [UsersController],
      providers: [
        UsersService,
        {
          provide: PrismaService,
          useValue: {
            user: { update: jest.fn() },
          },
        },
      ],
    }).compile();

    controller = module.get<UsersController>(UsersController);
    service = module.get(UsersService);
    prisma = module.get(PrismaService);
    user = userFixture();
  });

  describe("update name", () => {
    it("should call the service with the correct arguments", async () => {
      jest.spyOn(service, "update");
      jest.spyOn(prisma.user, "update").mockResolvedValue(user);

      await controller.updateBasicInfo(
        { name: user.name, timezone: "UTC" },
        user
      );
      expect(service.update).toHaveBeenCalledWith(user.id, {
        name: user.name,
        timezone: "UTC",
      });
    });
  });
});
