import { studentIdOf, usernameMatchesEmail } from "./student-id";

describe("studentIdOf", () => {
  it.each([
    ["2123456@dlu.edu.vn", "2123456"],
    [" 2123456@DLU.edu.vn ", "2123456"],
    ["2123456@student.dlu.edu.vn", "2123456"],
    ["2123456@evil-dlu.edu.vn", null],
    ["2123456@dlu.edu.vn.evil.com", null],
    ["dev@example.test", null],
    ["@dlu.edu.vn", null],
    ["no-at-sign", null],
  ])("%s gives %s", (email, id) => {
    expect(studentIdOf(email)).toBe(id);
  });
});

describe("usernameMatchesEmail", () => {
  it("takes only the student's own ID for a DLU address", () => {
    expect(usernameMatchesEmail("2123456@dlu.edu.vn", "2123456")).toBe(true);
    expect(usernameMatchesEmail("2123456@dlu.edu.vn", "2123457")).toBe(false);
    expect(
      usernameMatchesEmail("2123456@dlu.edu.vn", "2123456@dlu.edu.vn"),
    ).toBe(false);
  });

  it("leaves other addresses unchecked", () => {
    expect(usernameMatchesEmail("dev@example.test", "2123457")).toBe(true);
  });
});
