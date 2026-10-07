import { Test, TestingModule } from "@nestjs/testing";
import { InternalServerErrorException } from "@nestjs/common";
import { LocalSerializer } from "./local.serializer";
import { UsersService } from "../../users/users.service";

describe("LocalSerializer.deserializeUser", () => {
  const make = async (findById: jest.Mock) => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LocalSerializer,
        { provide: UsersService, useValue: { findById } },
      ],
    }).compile();
    return module.get<LocalSerializer>(LocalSerializer);
  };

  it("passes the user through", async () => {
    const done = jest.fn();
    await (
      await make(jest.fn().mockResolvedValue({ id: "u" }))
    ).deserializeUser("u", done);
    expect(done).toHaveBeenCalledWith(null, { id: "u" });
  });

  it("invalidates the session when the user no longer exists", async () => {
    const done = jest.fn();
    await (
      await make(jest.fn().mockResolvedValue(null))
    ).deserializeUser("u", done);
    expect(done).toHaveBeenCalledWith(null, false);
  });

  it("forwards errors to done() instead of rejecting", async () => {
    const done = jest.fn();
    const err = new InternalServerErrorException();
    await expect(
      (await make(jest.fn().mockRejectedValue(err))).deserializeUser("u", done),
    ).resolves.toBeUndefined();
    expect(done).toHaveBeenCalledWith(err);
  });
});
