import { describe, expect, it } from "vitest";
import {
  extractOtp,
  loginEmail,
  parseLoginInput,
  switchLoginMode,
} from "../login-id";

describe("parseLoginInput", () => {
  it("keeps digits in ID mode", () => {
    expect(parseLoginInput("20 123 45", "id")).toEqual({ mode: "id", value: "2012345" });
  });

  it("switches to email on an @", () => {
    expect(parseLoginInput("lan@", "id")).toEqual({ mode: "email", value: "lan@" });
  });

  it("switches to email on a letter", () => {
    expect(parseLoginInput("lan", "id")).toEqual({ mode: "email", value: "lan" });
  });

  it("collapses a pasted student address to its ID", () => {
    expect(parseLoginInput(" 2012345@DLU.edu.vn ", "id")).toEqual({
      mode: "id",
      value: "2012345",
    });
  });

  it("leaves email mode alone", () => {
    expect(parseLoginInput("2012345", "email")).toEqual({ mode: "email", value: "2012345" });
  });
});

describe("switchLoginMode", () => {
  it("clears the field when switching to email", () => {
    expect(switchLoginMode("2012345", "email")).toBe("");
  });

  it("carries a student address back to its ID", () => {
    expect(switchLoginMode("2012345@dlu.edu.vn", "id")).toBe("2012345");
    expect(switchLoginMode("lan@dlu.edu.vn", "id")).toBe("");
  });
});

describe("loginEmail", () => {
  it("adds the student domain to an ID", () => {
    expect(loginEmail("2012345", "id")).toBe("2012345@dlu.edu.vn");
  });

  it("sends a full email as typed", () => {
    expect(loginEmail(" lan@dlu.edu.vn ", "email")).toBe("lan@dlu.edu.vn");
  });
});

describe("extractOtp", () => {
  it("keeps typed digits up to six", () => {
    expect(extractOtp("123")).toBe("123");
    expect(extractOtp("1234567")).toBe("123456");
  });

  it("finds the code in a pasted message", () => {
    expect(extractOtp("Zenflow 2026: your code is 482913")).toBe("482913");
    expect(extractOtp("Code 482913, valid for 10 minutes")).toBe("482913");
  });

  it("joins a spaced code", () => {
    expect(extractOtp("482 913")).toBe("482913");
  });
});
