import { describe, expect, it } from "vitest";
import { legalUrl } from "../legal-links";

describe("legalUrl", () => {
  it("points at the public site, not the API host", () => {
    expect(legalUrl("privacy", "en")).toBe(
      "https://usezenflow.com/privacy?lang=en",
    );
  });

  it("passes the app language through, defaulting unknowns to English", () => {
    expect(legalUrl("terms", "vi")).toBe(
      "https://usezenflow.com/terms?lang=vi",
    );
    expect(legalUrl("terms", "fr")).toBe(
      "https://usezenflow.com/terms?lang=en",
    );
  });

  it("drops a trailing slash on the site", () => {
    expect(legalUrl("terms", "en", "http://localhost:8000/")).toBe(
      "http://localhost:8000/terms?lang=en",
    );
  });
});
