import { fireEvent, screen, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it } from "vitest";
import { SessionBlock } from "@/components/calendar/task-block";
import { buildDayGrid } from "@/lib/day-grid";
import { useSlotAlternativeStore } from "@/lib/slot-alternatives";
import type { DaySegment } from "@zenflow/shared";
import { API } from "@/test/msw/handlers";
import { server } from "@/test/msw/server";
import { renderScreen } from "@/test/utils/render";

// Tz is UTC so the wall clock in the fixtures reads the same as the ISO string.
const TZ = "UTC";
const GRID = buildDayGrid(56);

function segment(overrides: Partial<DaySegment> & { minutes: number }): DaySegment {
  const { minutes, ...rest } = overrides;
  const start = "2026-10-15T09:00:00.000Z";
  const end = new Date(new Date(start).getTime() + minutes * 60_000).toISOString();
  return {
    id: "s1",
    segmentId: "s1",
    taskId: "s1",
    title: "Calculus lecture",
    start,
    end,
    taskStart: start,
    taskEnd: end,
    type: "TASK",
    tags: [],
    state: "fluid",
    location: null,
    ...rest,
  } as DaySegment;
}

function renderBlock(seg: DaySegment, deadline?: string) {
  return renderScreen(
    <SessionBlock
      segment={seg}
      layout={{ column: 0, columns: 1, conflict: false }}
      tz={TZ}
      grid={GRID}
      leftOffset={0}
      blockWidth={300}
      deadline={deadline}
    />,
  );
}

describe("SessionBlock content tiers", () => {
  it("shows only the title for a 15 minute block", () => {
    renderBlock(segment({ minutes: 15 }));
    expect(screen.getByText("Calculus lecture")).toBeTruthy();
    expect(screen.queryByText(/9:00/)).toBeNull();
  });

  it("adds the start time under 44px", () => {
    renderBlock(segment({ minutes: 30, location: "Room 4" }));
    expect(screen.getByText("Calculus lecture")).toBeTruthy();
    expect(screen.getByText(/9:00/)).toBeTruthy();
    expect(screen.queryByText("Room 4")).toBeNull();
  });

  it("adds the location from 44px", () => {
    renderBlock(segment({ minutes: 60, location: "Room 4" }));
    expect(screen.getByText("Calculus lecture")).toBeTruthy();
    expect(screen.getByText(/9:00/)).toBeTruthy();
    expect(screen.getByText("Room 4")).toBeTruthy();
  });

  it("shows Online for a meeting link", () => {
    renderBlock(segment({ minutes: 60, location: "https://meet.example.com/abc" }));
    expect(screen.getByText("Online")).toBeTruthy();
  });

  it("carries no badges or due chips, even when overdue", () => {
    renderBlock(segment({ minutes: 60 }), "2026-10-15T08:00:00.000Z");
    expect(screen.queryByText(/^Due/)).toBeNull();
    expect(screen.queryByText("Overdue")).toBeNull();
  });
});

describe("SessionBlock — Other time", () => {
  let swaps: unknown[];

  beforeEach(() => {
    useSlotAlternativeStore.setState({ byId: {} });
    swaps = [];
    server.use(
      http.post(`${API}/sessions/:id/slot-pick`, async ({ request, params }) => {
        swaps.push({ id: params.id, body: await request.json() });
        return HttpResponse.json({
          data: {
            session: { id: params.id, scheduledStartTime: "2026-10-15T06:00:00.000Z" },
            chosenByUser: "alternative",
          },
        });
      }),
    );
  });

  it("offers no chip when the placement proposed no alternative", () => {
    renderBlock(segment({ minutes: 60 }));
    expect(screen.queryByTestId("other-time.s1")).toBeNull();
  });

  it("swaps to the alternative in one tap and drops the chip", async () => {
    useSlotAlternativeStore.setState({
      byId: {
        s1: {
          slotProposalId: "p1",
          primarySlot: "2026-10-15T03:00:00.000Z",
          alternativeSlot: "2026-10-15T06:00:00.000Z",
        },
      },
    });
    renderBlock(segment({ minutes: 60 }));

    fireEvent.click(screen.getByTestId("other-time.s1"));

    await waitFor(() =>
      expect(swaps).toEqual([{ id: "s1", body: { slotProposalId: "p1", chose: "alternative" } }]),
    );
    await waitFor(() => expect(screen.queryByTestId("other-time.s1")).toBeNull());
  });
});
