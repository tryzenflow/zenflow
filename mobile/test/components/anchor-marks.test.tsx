import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { type RefObject, createRef } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SessionBlock } from "@/components/calendar/task-block";
import {
  SessionDetailSheet,
  type SessionDetailSheetHandle,
} from "@/components/calendar/session-detail-sheet";
import { buildDayGrid } from "@/lib/day-grid";
import { makeSession } from "@/test/fixtures";
import { API } from "@/test/msw/handlers";
import { server } from "@/test/msw/server";
import { renderScreen } from "@/test/utils/render";
import { waitForContent } from "@/test/utils/skeleton";
import type { DaySegment, SessionAnchor } from "@zenflow/shared";

const TZ = "UTC";
const GRID = buildDayGrid(56);
const START = "2026-10-15T09:00:00.000Z";

function segment(id: string): DaySegment {
  const end = "2026-10-15T10:00:00.000Z";
  return {
    id,
    segmentId: id,
    taskId: id,
    title: "Essay draft",
    start: START,
    end,
    taskStart: START,
    taskEnd: end,
    type: "TASK",
    tags: [],
    state: "fluid",
    location: null,
  } as DaySegment;
}

function renderBlock(anchor: SessionAnchor | undefined) {
  return renderScreen(
    <SessionBlock
      segment={segment("b1")}
      layout={{ column: 0, columns: 1, conflict: false }}
      tz={TZ}
      grid={GRID}
      leftOffset={0}
      blockWidth={300}
      anchor={anchor}
      titleOnly
    />,
  );
}

describe("SessionBlock anchor mark", () => {
  it("shows a hand on a chosen time", () => {
    renderBlock("CHOSEN");
    expect(screen.getByTestId("anchor-mark.b1")).toBeTruthy();
  });

  it("shows a lock on a pinned session", () => {
    renderBlock("PINNED");
    expect(screen.getByTestId("anchor-mark.b1")).toBeTruthy();
  });

  it("shows no mark on an auto session", () => {
    renderBlock("AUTO");
    expect(screen.queryByTestId("anchor-mark.b1")).toBeNull();
  });
});

describe("SessionDetailSheet pin", () => {
  let posted: string[];

  beforeEach(() => {
    posted = [];
    server.use(
      http.post(`${API}/sessions/:id/pin`, ({ params }) => {
        posted.push(`pin:${params.id}`);
        return HttpResponse.json({
          data: makeSession({ id: String(params.id), type: "TASK", anchor: "PINNED", anchoredAt: "2026-10-15T01:00:00.000Z" }),
        });
      }),
      http.delete(`${API}/sessions/:id/pin`, ({ params }) => {
        posted.push(`unpin:${params.id}`);
        return HttpResponse.json({
          data: makeSession({ id: String(params.id), type: "TASK", anchor: "AUTO", anchoredAt: null }),
        });
      }),
    );
  });

  async function openSession(anchor: SessionAnchor) {
    const ref: RefObject<SessionDetailSheetHandle | null> = createRef();
    renderScreen(<SessionDetailSheet ref={ref} tz="UTC" />);
    act(() =>
      ref.current?.open(
        makeSession({ id: "t1", title: "Essay", type: "TASK", anchor, scheduledStartTime: START }),
      ),
    );
    await waitForContent();
  }

  it("explains the state in one line and pins an auto task", async () => {
    await openSession("AUTO");
    expect(screen.getByTestId("session-detail-anchor").textContent).toBe("Moves freely");
    expect(screen.getByText("The scheduler can move it to make room.")).toBeTruthy();

    fireEvent.click(screen.getByTestId("session-detail-pin"));

    await waitFor(() => expect(posted).toEqual(["pin:t1"]));
    await waitFor(() =>
      expect(screen.getByTestId("session-detail-anchor").textContent).toBe("Pinned in place"),
    );
    expect(screen.getByText("Unpin")).toBeTruthy();
  });

  it("unpins a pinned task back to auto", async () => {
    await openSession("PINNED");
    fireEvent.click(screen.getByTestId("session-detail-pin"));

    await waitFor(() => expect(posted).toEqual(["unpin:t1"]));
    await waitFor(() =>
      expect(screen.getByTestId("session-detail-anchor").textContent).toBe("Moves freely"),
    );
  });

  it("shows no pin control on a fixed session", () => {
    const ref: RefObject<SessionDetailSheetHandle | null> = createRef();
    renderScreen(<SessionDetailSheet ref={ref} tz="UTC" />);
    act(() => ref.current?.open(makeSession({ id: "l1", type: "LECTURE", anchor: "AUTO" })));
    expect(screen.queryByTestId("session-detail-pin")).toBeNull();
  });
});
