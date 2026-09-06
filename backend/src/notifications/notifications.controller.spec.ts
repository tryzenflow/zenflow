import { Test, TestingModule } from "@nestjs/testing";
import type { User } from "../../generated/prisma";
import { NotificationsController } from "./notifications.controller";
import { NotificationsService } from "./notifications.service";

const USER = { id: "u1" } as User;

const DTO = {
  id: "n1",
  topic: "ASSIGNMENT" as const,
  title: "New assignment: Môn học Mẫu Một",
  content: "Added to your calendar from DLU.",
  sentAt: "2026-09-01T00:00:00.000Z",
  readAt: null,
  actionTakenAt: null,
  sessionId: "s1",
};

describe("NotificationsController", () => {
  let controller: NotificationsController;
  const list = jest.fn();
  const markRead = jest.fn();
  const markActionTaken = jest.fn();

  beforeEach(async () => {
    list
      .mockReset()
      .mockResolvedValue({ notifications: [DTO], unreadCount: 1 });
    markRead
      .mockReset()
      .mockResolvedValue({ ...DTO, readAt: "2026-09-06T00:00:00.000Z" });
    markActionTaken
      .mockReset()
      .mockResolvedValue({ ...DTO, actionTakenAt: "2026-09-06T00:00:00.000Z" });

    const module: TestingModule = await Test.createTestingModule({
      controllers: [NotificationsController],
      providers: [
        {
          provide: NotificationsService,
          useValue: { list, markRead, markActionTaken },
        },
      ],
    }).compile();

    controller = module.get<NotificationsController>(NotificationsController);
  });

  it("should be defined", () => {
    expect(controller).toBeDefined();
  });

  it("wraps list() in the success envelope", async () => {
    const dto = { limit: 20, offset: 0 };

    const res = await controller.list(USER, dto);

    expect(list).toHaveBeenCalledWith(USER, dto);
    expect(res).toEqual({
      success: true,
      message: "Found 1 notifications",
      data: { notifications: [DTO], unreadCount: 1 },
    });
  });

  it("wraps markRead() in the success envelope", async () => {
    const res = await controller.markRead(USER, "n1");

    expect(markRead).toHaveBeenCalledWith(USER, "n1");
    expect(res.success).toBe(true);
    expect(res.message).toBe("Notification marked as read");
    expect(res.data.readAt).toBe("2026-09-06T00:00:00.000Z");
  });

  it("wraps markActionTaken() in the success envelope", async () => {
    const res = await controller.markActionTaken(USER, "n1");

    expect(markActionTaken).toHaveBeenCalledWith(USER, "n1");
    expect(res.success).toBe(true);
    expect(res.message).toBe("Notification marked as acted on");
    expect(res.data.actionTakenAt).toBe("2026-09-06T00:00:00.000Z");
  });
});
