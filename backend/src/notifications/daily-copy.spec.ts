import { dailyBriefCopy, dailyCheckinCopy } from "./localize-notification";

describe("dailyBriefCopy", () => {
  it("states both counts and the first item in English", () => {
    expect(
      dailyBriefCopy(
        { classes: 3, blocks: 2, firstTitle: "Databases", firstTime: "08:00" },
        "EN_US",
      ),
    ).toEqual({
      title: "3 classes, 2 study blocks",
      body: "First up: Databases at 08:00",
    });
  });

  it("uses singular nouns for one of each", () => {
    expect(
      dailyBriefCopy(
        { classes: 1, blocks: 1, firstTitle: "Lab", firstTime: "13:30" },
        undefined,
      ).title,
    ).toBe("1 class, 1 study block");
  });

  it("omits a zero count", () => {
    expect(
      dailyBriefCopy(
        { classes: 0, blocks: 2, firstTitle: "Essay", firstTime: "09:00" },
        "EN_US",
      ).title,
    ).toBe("2 study blocks");
  });

  it("translates to Vietnamese for VI_VN", () => {
    expect(
      dailyBriefCopy(
        { classes: 3, blocks: 2, firstTitle: "Databases", firstTime: "08:00" },
        "VI_VN",
      ),
    ).toEqual({
      title: "3 tiết học, 2 buổi học tập",
      body: "Tiếp theo: Databases lúc 08:00",
    });
  });

  it("keeps copy free of separators", () => {
    const { title, body } = dailyBriefCopy(
      { classes: 1, blocks: 1, firstTitle: "A", firstTime: "08:00" },
      "EN_US",
    );
    for (const s of [title, body]) {
      expect(s).not.toMatch(/[·—–|→]/);
    }
  });
});

describe("dailyCheckinCopy", () => {
  it("asks for the check-in in English", () => {
    expect(dailyCheckinCopy("EN_US")).toEqual({
      title: "Check in on today",
      body: "Mark today's sessions done or missed.",
    });
  });

  it("translates to Vietnamese for VI_VN", () => {
    expect(dailyCheckinCopy("VI_VN")).toEqual({
      title: "Kiểm tra hôm nay",
      body: "Đánh dấu các buổi hôm nay là xong hoặc bỏ lỡ.",
    });
  });
});
