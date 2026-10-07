import { describe, expect, it } from "vitest";
import {
  firstInvalidField,
  hasDetailContent,
  hasDetailError,
  hasNewSessionInput,
  isFormDirty,
  invalidFields,
  showTitleCounter,
} from "../form-validation";

describe("form validation order", () => {
  it("returns invalid fields top to bottom regardless of error order", () => {
    const errors = { location: { message: "x" }, deadline: {}, title: {} };
    expect(invalidFields(errors)).toEqual(["title", "deadline", "location"]);
    expect(firstInvalidField(errors)).toBe("title");
  });
  it("folds date, start and end into the When field", () => {
    expect(invalidFields({ endTime: {}, date: {} })).toEqual(["when"]);
  });
  it("ignores unknown and empty entries", () => {
    expect(firstInvalidField({ foo: {}, title: undefined })).toBeNull();
  });
  it("flags errors inside More details", () => {
    expect(hasDetailError({ location: {} })).toBe(true);
    expect(hasDetailError({ title: {} })).toBe(false);
  });
});

describe("more details content", () => {
  it("is empty for a bare session", () => {
    expect(
      hasDetailContent({ note: "<p></p>", location: " ", tags: [], reminders: [] }),
    ).toBe(false);
  });
  it("detects each kind of saved detail", () => {
    expect(hasDetailContent({ note: "<p>Read ch. 3</p>" })).toBe(true);
    expect(hasDetailContent({ location: "A204" })).toBe(true);
    expect(hasDetailContent({ tags: ["math"] })).toBe(true);
    expect(hasDetailContent({ reminders: [15] })).toBe(true);
  });
});

describe("title counter", () => {
  it("only appears near the limit", () => {
    expect(showTitleCounter(10, 60)).toBe(false);
    expect(showTitleCounter(48, 60)).toBe(true);
  });
});

describe("dirty guards", () => {
  it("ignores the editor's empty-paragraph echo", () => {
    expect(isFormDirty({ note: true }, { note: "<p></p>" }, { note: "" })).toBe(false);
    expect(isFormDirty({ note: true }, { note: "<p>hi</p>" }, { note: "" })).toBe(true);
  });
  it("counts any other changed field, including arrays", () => {
    expect(isFormDirty({ title: true }, {}, {})).toBe(true);
    expect(isFormDirty({ tags: [true] }, {}, {})).toBe(true);
    expect(isFormDirty({ tags: [] }, {}, {})).toBe(false);
  });
  it("create form is dirty once anything is typed", () => {
    expect(hasNewSessionInput({ title: "  ", note: "<p></p>", tags: [] })).toBe(false);
    expect(hasNewSessionInput({ title: "Essay" })).toBe(true);
  });
});
