import { hideEmail } from "./hide-email";

describe("hideEmail", () => {
  test("masks username with more than 2 characters", () => {
    expect(hideEmail("johndoe@example.com")).toBe("j*****e@example.com");
  });

  test("masks username with 2 characters", () => {
    expect(hideEmail("ab@example.com")).toBe("a*@example.com");
  });

  test("does not mask username with 1 character", () => {
    expect(hideEmail("a@example.com")).toBe("a@example.com");
  });

  test("handles invalid email (no @)", () => {
    expect(hideEmail("invalidemail")).toBe("Invalid email");
  });

  test("handles username with special characters", () => {
    expect(hideEmail("user.name+tag@example.com")).toBe(
      "u***********g@example.com",
    );
  });

  test("handles empty string", () => {
    expect(hideEmail("")).toBe("Invalid email");
  });

  test("handles email with @ but no username", () => {
    expect(hideEmail("@example.com")).toBe("Invalid email");
  });
});
