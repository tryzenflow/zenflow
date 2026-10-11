import { MAX_UPLOAD_BYTES } from "@zenflow/shared";
import { describe, expect, it } from "vitest";
import { describeUploadError, splitOversize } from "../upload-limits";

const axiosErr = (status: number, message?: string) => ({
  isAxiosError: true,
  message: "",
  response: { status, data: message ? { message } : undefined },
});

describe("splitOversize", () => {
  it("rejects files over the cap and lets unknown sizes through", () => {
    const parts = [
      { name: "ok", size: MAX_UPLOAD_BYTES },
      { name: "big", size: MAX_UPLOAD_BYTES + 1 },
      { name: "unknown" },
      { name: "null", size: null },
    ];
    const { ok, tooLarge } = splitOversize(parts);
    expect(ok.map((p) => p.name)).toEqual(["ok", "unknown", "null"]);
    expect(tooLarge.map((p) => p.name)).toEqual(["big"]);
  });
});

describe("describeUploadError", () => {
  it("names the file cap and the storage quota separately", () => {
    expect(describeUploadError(axiosErr(413, "File too large"))).toMatch(/^File too large\n/);
    expect(describeUploadError(axiosErr(413, "Storage full"))).toMatch(/^Storage full\n/);
    expect(describeUploadError(axiosErr(413))).toMatch(/^File too large\n/);
  });
  it("ignores other failures", () => {
    expect(describeUploadError(axiosErr(500))).toBeNull();
    expect(describeUploadError(new Error("x"))).toBeNull();
  });
});
