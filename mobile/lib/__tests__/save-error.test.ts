import { describe, expect, it } from "vitest";
import {
  NETWORK_ERROR_MESSAGE,
  SERVER_ERROR_MESSAGE,
  TIMEOUT_ERROR_MESSAGE,
  TOO_LARGE_ERROR_MESSAGE,
  describeSaveError,
  extractServerMessage,
} from "../save-error";

const axiosErr = (over: Record<string, unknown>) => ({
  isAxiosError: true,
  message: "",
  ...over,
});

describe("extractServerMessage", () => {
  it("handles string, array, and junk bodies", () => {
    expect(extractServerMessage({ message: " hi " })).toBe("hi");
    expect(extractServerMessage({ message: ["a", "b"] })).toBe("a\nb");
    expect(extractServerMessage({ message: "" })).toBeUndefined();
    expect(extractServerMessage("<html>")).toBeUndefined();
    expect(extractServerMessage(undefined)).toBeUndefined();
  });
});

describe("describeSaveError", () => {
  it("uses the server message for a 4xx", () => {
    const e = axiosErr({ response: { status: 400, data: { message: "Bad title" } } });
    expect(describeSaveError(e, "fb")).toBe("Bad title");
  });
  it("falls back for a 4xx without a message", () => {
    expect(describeSaveError(axiosErr({ response: { status: 400, data: "" } }), "fb")).toBe("fb");
  });
  it("maps 413 to the too-large message even with a body message", () => {
    const e = axiosErr({ response: { status: 413, data: { message: "request entity too large" } } });
    expect(describeSaveError(e, "fb")).toBe(TOO_LARGE_ERROR_MESSAGE);
  });
  it("maps 500 with or without a message to the server-error message", () => {
    expect(
      describeSaveError(axiosErr({ response: { status: 500, data: { message: "Internal server error" } } }), "fb"),
    ).toBe(SERVER_ERROR_MESSAGE);
    expect(describeSaveError(axiosErr({ response: { status: 502, data: "<html>" } }), "fb")).toBe(
      SERVER_ERROR_MESSAGE,
    );
  });
  it("maps no-response errors to network vs timeout", () => {
    expect(describeSaveError(axiosErr({ code: "ERR_NETWORK", message: "Network Error" }), "fb")).toBe(
      NETWORK_ERROR_MESSAGE,
    );
    expect(describeSaveError(axiosErr({ code: "ECONNABORTED", message: "timeout of 8000ms exceeded" }), "fb")).toBe(
      TIMEOUT_ERROR_MESSAGE,
    );
  });
  it("falls back for non-axios errors", () => {
    expect(describeSaveError(new Error("boom"), "fb")).toBe("fb");
    expect(describeSaveError(undefined, "fb")).toBe("fb");
  });
});
