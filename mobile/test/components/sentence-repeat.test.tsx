import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SentenceRepeat } from "@/components/ui/sentence-repeat";
import { renderScreen } from "@/test/utils/render";

const ANCHOR = "2026-10-15"; // a Thursday

describe("SentenceRepeat", () => {
  it("says it does not repeat for a one-off", () => {
    renderScreen(
      <SentenceRepeat value={undefined} onChange={() => {}} anchorDate={ANCHOR} testID="rep" />,
    );
    expect(screen.getByTestId("rep.sentence").textContent).toBe("Does not repeat.");
  });

  it("defaults a weekly repeat to the anchor's weekday", () => {
    const onChange = vi.fn();
    renderScreen(
      <SentenceRepeat value={undefined} onChange={onChange} anchorDate={ANCHOR} testID="rep" />,
    );
    fireEvent.click(screen.getByTestId("rep.freq.WEEKLY"));
    expect(onChange).toHaveBeenLastCalledWith("FREQ=WEEKLY;BYDAY=TH");
  });

  it("builds the sentence from the weekdays and the end", () => {
    renderScreen(
      <SentenceRepeat
        value="FREQ=WEEKLY;BYDAY=MO,WE;UNTIL=20261122T000000Z"
        onChange={() => {}}
        anchorDate="2026-10-12"
        testID="rep"
      />,
    );
    expect(screen.getByTestId("rep.sentence").textContent).toBe(
      "Repeats every Monday and Wednesday, for 6 weeks.",
    );
  });

  it("adds and removes weekdays, keeping at least one", () => {
    const onChange = vi.fn();
    const { unmount } = renderScreen(
      <SentenceRepeat value="FREQ=WEEKLY;BYDAY=MO" onChange={onChange} anchorDate={ANCHOR} testID="rep" />,
    );
    fireEvent.click(screen.getByTestId("rep.day.FR"));
    expect(onChange).toHaveBeenLastCalledWith("FREQ=WEEKLY;BYDAY=MO,FR");
    unmount();
    renderScreen(
      <SentenceRepeat value="FREQ=WEEKLY;BYDAY=MO,FR" onChange={onChange} anchorDate={ANCHOR} testID="rep" />,
    );
    fireEvent.click(screen.getByTestId("rep.day.MO"));
    expect(onChange).toHaveBeenLastCalledWith("FREQ=WEEKLY;BYDAY=FR");
  });

  it("sets an end of four weeks from the anchor", () => {
    const onChange = vi.fn();
    renderScreen(
      <SentenceRepeat value="FREQ=DAILY" onChange={onChange} anchorDate={ANCHOR} testID="rep" />,
    );
    fireEvent.click(screen.getByTestId("rep.end.4"));
    expect(onChange).toHaveBeenLastCalledWith("FREQ=DAILY;UNTIL=20261111T000000Z");
  });
});
