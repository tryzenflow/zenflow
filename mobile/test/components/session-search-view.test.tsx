import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SessionSearchView } from "@/components/calendar/session-search-view";
import { useUserStore } from "@/hooks/use-user-store";
import { makeSession } from "@/test/fixtures";
import { API, testUser } from "@/test/msw/handlers";
import { server } from "@/test/msw/server";
import { renderScreen } from "@/test/utils/render";
import { SESSION_TONES } from "@zenflow/core";
import type { Session, SessionSearchResponse } from "@zenflow/shared";

const TZ = "UTC";

interface SearchCall {
  q: string | null;
  direction: string | null;
  cursor: string | null;
  anchor: string | null;
}

let calls: SearchCall[] = [];

function respondWith(
  pages: Record<string, SessionSearchResponse | ((call: SearchCall) => SessionSearchResponse)>,
) {
  server.use(
    http.get(`${API}/sessions/search`, ({ request }) => {
      const url = new URL(request.url);
      const call: SearchCall = {
        q: url.searchParams.get("q"),
        direction: url.searchParams.get("direction"),
        cursor: url.searchParams.get("cursor"),
        anchor: url.searchParams.get("anchor"),
      };
      calls.push(call);
      const page = pages[call.direction ?? "forward"];
      const body = typeof page === "function" ? page(call) : page;
      return HttpResponse.json({ success: true, message: "ok", data: body });
    }),
  );
}

const session = (overrides: Partial<Session>) => makeSession(overrides);

beforeEach(() => {
  calls = [];
  useUserStore.setState({
    user: { ...testUser, timezone: TZ } as never,
    loading: false,
  });
});

describe("SessionSearchView", () => {
  it("lists sessions under one header per day, in start order", async () => {
    respondWith({
      backward: {
        sessions: [
          session({
            id: "a",
            title: "Algebra lecture",
            type: "LECTURE",
            scheduledStartTime: "2026-10-14T08:00:00.000Z",
          }),
        ],
        nextCursor: null,
      },
      forward: {
        sessions: [
          session({
            id: "b",
            title: "Essay draft",
            type: "TASK",
            scheduledStartTime: "2026-10-15T09:00:00.000Z",
          }),
          session({
            id: "c",
            title: "Physics exam",
            type: "EXAM",
            scheduledStartTime: "2026-10-15T13:00:00.000Z",
          }),
        ],
        nextCursor: null,
      },
    });

    renderScreen(<SessionSearchView onClose={() => {}} />);

    const day15 = await screen.findByTestId("session-search.day.2026-10-15");
    expect(screen.getByTestId("session-search.day.2026-10-14")).toBeTruthy();
    expect(screen.queryByText(/Algebra lecture/)).toBeTruthy();
    const rows = screen.getAllByTestId(/^session-search\.row\./).map((el) => el.getAttribute("data-testid"));
    expect(rows).toEqual([
      "session-search.row.a",
      "session-search.row.b",
      "session-search.row.c",
    ]);
    expect(day15).toBeTruthy();
  });

  it("colours each row's left border by session type", async () => {
    respondWith({
      backward: { sessions: [], nextCursor: null },
      forward: {
        sessions: [
          session({ id: "exam", title: "Physics exam", type: "EXAM", scheduledStartTime: "2026-10-15T13:00:00.000Z" }),
          session({ id: "task", title: "Essay draft", type: "TASK", scheduledStartTime: "2026-10-15T14:00:00.000Z" }),
        ],
        nextCursor: null,
      },
    });

    renderScreen(<SessionSearchView onClose={() => {}} />);

    const exam = await screen.findByTestId("session-search.row.exam");
    const task = screen.getByTestId("session-search.row.task");
    expect(channels(getComputedStyle(exam).borderLeftColor)).toBe(hexToRgb(SESSION_TONES.exam.base));
    expect(channels(getComputedStyle(task).borderLeftColor)).toBe(hexToRgb(SESSION_TONES.task.base));
    expect(channels(getComputedStyle(exam).borderLeftColor)).not.toBe(
      channels(getComputedStyle(task).borderLeftColor),
    );
  });

  it("highlights the typed words in matching titles", async () => {
    respondWith({
      backward: { sessions: [], nextCursor: null },
      forward: {
        sessions: [
          session({ id: "e1", title: "OOP Essay", scheduledStartTime: "2026-10-15T09:00:00.000Z" }),
        ],
        nextCursor: null,
      },
    });

    renderScreen(<SessionSearchView onClose={() => {}} />);
    await screen.findByTestId("session-search.row.e1");

    fireEvent.change(screen.getByTestId("session-search.input"), {
      target: { value: "essay" },
    });

    const row = await screen.findByTestId("session-search.row.e1");
    await waitFor(() => expect(calls.some((c) => c.q === "essay")).toBe(true));
    expect(within(row).getByTestId("session-search.match").textContent).toBe("Essay");
    expect(row.textContent).toContain("OOP Essay");
  });

  it("shows the empty state when nothing is scheduled", async () => {
    respondWith({
      backward: { sessions: [], nextCursor: null },
      forward: { sessions: [], nextCursor: null },
    });

    renderScreen(<SessionSearchView onClose={() => {}} />);

    expect(await screen.findByText("No sessions yet")).toBeTruthy();
  });

  it("shows the no-match state for a query with no hits", async () => {
    respondWith({
      backward: { sessions: [], nextCursor: null },
      forward: { sessions: [], nextCursor: null },
    });

    renderScreen(<SessionSearchView onClose={() => {}} />);
    await screen.findByText("No sessions yet");

    fireEvent.change(screen.getByTestId("session-search.input"), {
      target: { value: "zzz" },
    });

    expect(await screen.findByText("No sessions match")).toBeTruthy();
  });

  it("loads both directions around the anchor on open", async () => {
    respondWith({
      backward: { sessions: [], nextCursor: null },
      forward: { sessions: [], nextCursor: null },
    });

    renderScreen(<SessionSearchView onClose={() => {}} />);
    await screen.findByText("No sessions yet");

    const directions = calls.map((c) => c.direction).sort();
    expect(directions).toEqual(["backward", "forward"]);
    expect(calls.every((c) => c.anchor && !Number.isNaN(Date.parse(c.anchor)))).toBe(true);
    expect(calls.every((c) => c.cursor === null)).toBe(true);
  });

  it("calls onClose from the Back button", async () => {
    respondWith({
      backward: { sessions: [], nextCursor: null },
      forward: { sessions: [], nextCursor: null },
    });
    const onClose = vi.fn();

    renderScreen(<SessionSearchView onClose={onClose} />);
    await screen.findByText("No sessions yet");
    fireEvent.click(screen.getByTestId("session-search.back"));

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

/** happy-dom reports computed colours as `rgb(a)(...)`; compare the channels, not the spelling. */
function hexToRgb(hex: string): string {
  const n = Number.parseInt(hex.slice(1), 16);
  return `${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}`;
}

function channels(computed: string): string {
  return computed.match(/\d+/g)?.slice(0, 3).join(", ") ?? "";
}
