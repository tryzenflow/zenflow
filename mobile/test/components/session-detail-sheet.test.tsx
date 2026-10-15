import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { router } from "expo-router";
import { http, HttpResponse } from "msw";
import { type RefObject, createRef } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  SessionDetailSheet,
  type SessionDetailSheetHandle,
} from "@/components/calendar/session-detail-sheet";
import { makeSession } from "@/test/fixtures";
import { API } from "@/test/msw/handlers";
import { server } from "@/test/msw/server";
import { renderScreen } from "@/test/utils/render";

// Props of the sheet's content on its last render, so a test can move it to a snap point
// (gestures do not run under happy-dom).
const sheet = vi.hoisted(() => ({
  props: null as null | Record<string, unknown>,
}));

vi.mock("@/components/ui/bottom-sheet", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/components/ui/bottom-sheet")>();
  const { createElement, forwardRef } = await import("react");
  const BottomSheetContent = forwardRef((props: Record<string, unknown>, ref) => {
    sheet.props = props;
    return createElement(actual.BottomSheetContent, { ...props, ref } as never);
  });
  return { ...actual, BottomSheetContent };
});

// The WebView stand-in shows the document it was given, so the note is assertable.
vi.mock("react-native-webview", () => ({
  WebView: ({ source }: { source: { html: string } }) => (
    <div data-testid="session-note" data-html={source.html} />
  ),
}));

// The font loader reads an asset the component tests do not provide.
vi.mock("@/lib/geist-webview-font", () => ({
  loadGeistWebviewFontDataUri: vi.fn(async () => ""),
}));

const TZ = "Asia/Ho_Chi_Minh";

function snapTo(index: number) {
  const onChange = sheet.props?.onChange as (index: number) => void;
  act(() => onChange(index));
}

function renderSheet() {
  const ref: RefObject<SessionDetailSheetHandle | null> = createRef();
  renderScreen(<SessionDetailSheet ref={ref} tz={TZ} />);
  return ref;
}

beforeEach(() => {
  sheet.props = null;
});

describe("SessionDetailSheet", () => {
  it("opens on the calendar with the session details", async () => {
    const ref = renderSheet();
    act(() =>
      ref.current?.open(
        makeSession({
          id: "a",
          title: "Algorithms lecture",
          type: "TASK",
          anchor: "PINNED",
          // 03:00Z is 10:00 in UTC+7.
          scheduledStartTime: "2026-10-15T03:00:00.000Z",
          durationMinutes: 90,
          deadline: "2026-10-20T10:00:00.000Z",
          location: "Room B201",
          tags: ["Algorithms"],
          reminders: [15],
        }),
      ),
    );
    expect((await screen.findByTestId("session-detail-title")).textContent).toBe(
      "Algorithms lecture",
    );
    expect(screen.getByText("10:00 AM to 11:30 AM")).toBeTruthy();
    expect(screen.getByText("Room B201")).toBeTruthy();
    expect(screen.getByText("Algorithms")).toBeTruthy();
    expect(screen.getByText("Pinned in place")).toBeTruthy();
    expect(screen.getByText("Edit")).toBeTruthy();
  });

  it("keeps the note off the peek snap and loads it at full", async () => {
    const ref = renderSheet();
    act(() =>
      ref.current?.open(makeSession({ id: "a", note: "<p>Read chapter 4</p>" })),
    );
    await screen.findByTestId("session-detail-title");
    expect(screen.queryByTestId("session-note")).toBeNull();
    expect(screen.getByText("Swipe up to read the note")).toBeTruthy();

    snapTo(1);
    const note = await screen.findByTestId("session-note");
    expect(note.getAttribute("data-html")).toContain("<p>Read chapter 4</p>");
  });

  it("does not show a note section for an empty note", async () => {
    const ref = renderSheet();
    act(() => ref.current?.open(makeSession({ id: "a", note: "<p></p>" })));
    await screen.findByTestId("session-detail-title");
    expect(screen.queryByText("Swipe up to read the note")).toBeNull();
    snapTo(1);
    expect(screen.queryByTestId("session-note")).toBeNull();
  });

  it("opens the composer for this session when Edit is pressed", async () => {
    const id = "series1::2026-10-15T03:00:00.000Z";
    const ref = renderSheet();
    act(() =>
      ref.current?.open(
        makeSession({ id, seriesId: "series1", rrule: "FREQ=WEEKLY" }),
      ),
    );
    fireEvent.click(await screen.findByText("Edit"));
    await waitFor(() =>
      expect(router.push).toHaveBeenCalledWith(`/task/${encodeURIComponent(id)}/edit`),
    );
  });

  it("marks the session done from the disc and keeps the sheet open", async () => {
    let completed = false;
    server.use(
      http.post(`${API}/sessions/a/complete`, () => {
        completed = true;
        return HttpResponse.json({
          data: {
            session: { id: "a", completedAt: "2026-10-15T05:00:00.000Z", skipped: false },
            streak: { current: 1, longest: 1 },
          },
        });
      }),
    );
    const ref = renderSheet();
    act(() => ref.current?.open(makeSession({ id: "a", title: "Algorithms lecture" })));
    fireEvent.click(await screen.findByRole("checkbox", { name: "Mark Algorithms lecture done" }));
    await waitFor(() => expect(completed).toBe(true));
    expect(await screen.findByRole("checkbox", { name: "Mark Algorithms lecture not done" })).toBeTruthy();
    expect(screen.getByTestId("session-detail-title").textContent).toBe("Algorithms lecture");
  });
});
