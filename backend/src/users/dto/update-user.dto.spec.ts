import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { UpdateUserDto } from "./update-user.dto";

const errors = (body: object) =>
  validate(plainToInstance(UpdateUserDto, body), {
    whitelist: true,
    forbidNonWhitelisted: true,
  });

describe("UpdateUserDto", () => {
  it("accepts valid preferences", async () => {
    expect(
      await errors({
        timezone: "Asia/Ho_Chi_Minh",
        lang: "vi",
        defaultReminderMinutes: 30,
      }),
    ).toHaveLength(0);
    expect(await errors({})).toHaveLength(0);
    expect(await errors({ onboarded: true })).toHaveLength(0);
    expect(await errors({ allowNotifications: false })).toHaveLength(0);
    expect(await errors({ seenTip: "create-task" })).toHaveLength(0);
  });

  it.each([
    { timezone: "Mars/Olympus" },
    { lang: "VI_VN" },
    { lang: "fr" },
    { defaultReminderMinutes: 7 },
    { defaultReminderMinutes: "10" },
    { onboarded: false },
    { onboarded: "true" },
    { allowNotifications: "false" },
    { allowNotifications: 0 },
    { seenTip: "nope" },
    { seenTip: ["create-task"] },
    { seenTips: ["create-task"] },
    { unknown: 1 },
  ])("rejects %j", async (body) => {
    expect((await errors(body)).length).toBeGreaterThan(0);
  });
});
