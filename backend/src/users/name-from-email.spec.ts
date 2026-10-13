import { nameFromEmail } from "./name-from-email";

describe("nameFromEmail", () => {
  it("title-cases the words of the local part", () => {
    expect(nameFromEmail("an.nguyen@dlu.edu.vn")).toBe("An Nguyen");
    expect(nameFromEmail("TRAN_thai-anh@x.com")).toBe("Tran Thai Anh");
  });

  it("ignores a +tag and the domain", () => {
    expect(nameFromEmail("alpha+work@gmail.com")).toBe("Alpha");
  });

  it("drops words that contain digits", () => {
    expect(nameFromEmail("anh2k5.tran@x.com")).toBe("Tran");
  });

  it("keeps the placeholder when nothing readable is left", () => {
    expect(nameFromEmail("2012345@dlu.edu.vn")).toBe("New User");
    expect(nameFromEmail("@x.com")).toBe("New User");
  });

  it("handles non-ASCII letters and caps the length", () => {
    expect(nameFromEmail("trần.thái@x.com")).toBe("Trần Thái");
    expect(nameFromEmail(`${"a".repeat(80)}@x.com`)).toHaveLength(60);
  });
});
