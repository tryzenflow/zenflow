import { describe, expect, it } from "vitest";
import { legalUrl } from "../legal-links";

describe("legalUrl", () => {
  it("uses the API origin, not its /api/v1 prefix", () => {
    expect(legalUrl("privacy", "https://zenflow.alphatrann.com/api/v1", "en")).toBe(
      "https://zenflow.alphatrann.com/privacy?lang=en",
    );
  });

  it("passes the app language through, defaulting unknowns to English", () => {
    expect(legalUrl("terms", "http://localhost:8000/api/v1", "vi")).toBe(
      "http://localhost:8000/terms?lang=vi",
    );
    expect(legalUrl("terms", "http://localhost:8000", "fr")).toBe(
      "http://localhost:8000/terms?lang=en",
    );
  });

  it("is null without a usable base URL", () => {
    expect(legalUrl("terms", undefined, "en")).toBeNull();
    expect(legalUrl("terms", "not a url", "en")).toBeNull();
  });
});
