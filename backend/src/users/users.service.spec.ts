import { NotFoundException } from "@nestjs/common";
import { Prisma } from "../../generated/prisma";
import { PostgresErrorCode } from "../prisma/error-codes";
import { UsersService } from "./users.service";
import type { User } from "../../generated/prisma";

const user = { id: "user-1" } as User;

type UpdateArgs = { where: { id: string }; data: Record<string, unknown> };

function makeService() {
  const update = jest.fn(
    (args: UpdateArgs): { id: string } & Record<string, unknown> => ({
      id: user.id,
      ...args.data,
    }),
  );
  const prisma = { user: { update } };
  const service = new UsersService(prisma as never);
  return { service, update };
}

describe("UsersService.update", () => {
  it("persists a name change (timezone is no longer editable here)", async () => {
    const { service, update } = makeService();

    await service.update(user.id, { name: "New Name" });

    expect(update).toHaveBeenCalledWith({
      where: { id: user.id },
      data: { name: "New Name" },
    });
  });

  it("throws NotFoundException when the user doesn't exist", async () => {
    const update = jest.fn(() => {
      throw new Prisma.PrismaClientKnownRequestError("Record not found", {
        code: PostgresErrorCode.RecordNotFound,
        clientVersion: "test",
      });
    });
    const prisma = { user: { update } };
    const service = new UsersService(prisma as never);

    await expect(
      service.update("missing", { name: "New Name" }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
