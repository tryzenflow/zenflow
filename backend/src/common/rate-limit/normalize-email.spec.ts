import { normalizeEmailForRateLimit as n } from "./normalize-email";

describe("normalizeEmailForRateLimit", () => {
  it("trims and lower-cases", () => {
    expect(n("  Foo@Bar.COM ")).toBe("foo@bar.com");
  });
  it("strips +tag from the local part", () => {
    expect(n("a+x@school.edu")).toBe("a@school.edu");
    expect(n("a+x+y@school.edu")).toBe("a@school.edu");
  });
  it("keeps dots for non-gmail domains", () => {
    expect(n("a.b@school.edu")).toBe("a.b@school.edu");
  });
  it("drops dots and unifies the domain for gmail and googlemail", () => {
    expect(n("A.B.c+spam@Gmail.com")).toBe("abc@gmail.com");
    expect(n("a.bc@googlemail.com")).toBe("abc@gmail.com");
  });
  it("leaves a leading + and malformed input alone", () => {
    expect(n("+x@a.com")).toBe("+x@a.com");
    expect(n("not-an-email")).toBe("not-an-email");
  });
});
