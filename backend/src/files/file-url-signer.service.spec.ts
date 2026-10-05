import { ConfigService } from "@nestjs/config";
import { FileUrlSignerService } from "./file-url-signer.service";

const make = (secret = "s".repeat(32)) =>
  new FileUrlSignerService({
    getOrThrow: () => secret,
  } as unknown as ConfigService);

describe("FileUrlSignerService", () => {
  it("verifies a valid signature", () => {
    const s = make();
    expect(s.verify("f1", s.sign("f1"))).toBe(true);
  });
  it("rejects a bad, wrong-id, wrong-secret, or non-string signature", () => {
    const s = make();
    expect(s.verify("f1", "nope")).toBe(false);
    expect(s.verify("f2", s.sign("f1"))).toBe(false);
    expect(s.verify("f1", make("x".repeat(32)).sign("f1"))).toBe(false);
    expect(s.verify("f1", undefined)).toBe(false);
    expect(s.verify("f1", ["a"])).toBe(false);
  });
  it("builds a relative prefixed url", () => {
    const s = make();
    expect(s.url("f1")).toBe(`/api/v1/files/f1?sig=${s.sign("f1")}`);
  });
});
