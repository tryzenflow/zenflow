import { isEmailDomainAllowed, parseAllowedDomains } from "./email-domain";

describe("parseAllowedDomains", () => {
  it("splits, trims, lowercases and drops a leading @", () => {
    expect(parseAllowedDomains(" DLU.edu.vn, @Example.com ,,")).toEqual([
      "dlu.edu.vn",
      "example.com",
    ]);
  });

  it("treats unset and blank as no list", () => {
    expect(parseAllowedDomains(undefined)).toEqual([]);
    expect(parseAllowedDomains("  ")).toEqual([]);
  });
});

describe("isEmailDomainAllowed", () => {
  const allowed = ["dlu.edu.vn"];

  it("allows everything when no list is set", () => {
    expect(isEmailDomainAllowed("a@gmail.com", [])).toBe(true);
  });

  it("allows the exact domain, case-insensitively", () => {
    expect(isEmailDomainAllowed("2012345@dlu.edu.vn", allowed)).toBe(true);
    expect(isEmailDomainAllowed("Someone@DLU.EDU.VN", allowed)).toBe(true);
  });

  it("allows subdomains of an allowed domain", () => {
    expect(isEmailDomainAllowed("x@student.dlu.edu.vn", allowed)).toBe(true);
  });

  it("rejects other domains and lookalikes", () => {
    expect(isEmailDomainAllowed("a@gmail.com", allowed)).toBe(false);
    expect(isEmailDomainAllowed("a@evil-dlu.edu.vn", allowed)).toBe(false);
    expect(isEmailDomainAllowed("a@dlu.edu.vn.evil.com", allowed)).toBe(false);
    expect(isEmailDomainAllowed("a@xdlu.edu.vn", allowed)).toBe(false);
  });

  it("rejects an address with no @", () => {
    expect(isEmailDomainAllowed("dlu.edu.vn", allowed)).toBe(false);
  });

  it("uses the last @ so a quoted local part cannot smuggle a domain", () => {
    expect(isEmailDomainAllowed('"a@dlu.edu.vn"@gmail.com', allowed)).toBe(
      false,
    );
  });
});
