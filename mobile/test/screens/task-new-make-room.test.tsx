import { fireEvent, screen, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import NewSessionScreen from "@/app/task/new";
import { DRAFT_NEW, useComposerStore } from "@/lib/composer-store";
import { useUserStore } from "@/hooks/use-user-store";
import { makeSession } from "@/test/fixtures";
import { API, testUser } from "@/test/msw/handlers";
import { server } from "@/test/msw/server";
import { renderScreen } from "@/test/utils/render";
import type { PlacementPlan } from "@zenflow/shared";

vi.mock("@/components/tasks/note/description-field", () => ({ DescriptionField: () => null }));

const plan: PlacementPlan = {
  id: "plan-1",
  sessionId: null,
  start: "2026-10-15T03:00:00.000Z",
  moves: [
    {
      id: "chosen",
      from: "2026-10-15T03:00:00.000Z",
      to: "2026-10-15T05:00:00.000Z",
      anchor: "CHOSEN",
      cost: 10,
    },
  ],
  expiresAt: "2026-10-15T04:00:00.000Z",
};

let posts: { path: string; body: Record<string, unknown> }[];
let placeWithPlan: boolean;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-15T05:00:00.000Z"));
  posts = [];
  placeWithPlan = true;
  useUserStore.setState({ user: testUser as never, loading: false });
  useComposerStore.setState({ drafts: {}, courseDuration: {} });
  server.use(
    http.post(`${API}/sessions`, async ({ request }) => {
      const body = (await request.json()) as Record<string, unknown>;
      posts.push({ path: "/sessions", body });
      if (placeWithPlan && !body.infeasiblePolicy) {
        return HttpResponse.json(
          { success: false, statusCode: 409, code: "NEEDS_CONFIRMATION", data: { plan } },
          { status: 409 },
        );
      }
      return HttpResponse.json({
        data: makeSession({ id: "new1", title: "Urgent essay", type: "TASK", scheduledStartTime: plan.start }),
      });
    }),
    http.get(`${API}/sessions/:id`, ({ params }) => {
      // `deadline-options` matches this pattern too: let its own handler answer.
      if (params.id === "deadline-options") return undefined;
      return HttpResponse.json({
        data: makeSession({
          id: String(params.id),
          title: "Lab report",
          durationMinutes: 45,
          scheduledStartTime: "2026-10-15T03:00:00.000Z",
          anchor: "CHOSEN",
        }),
      });
    }),
    http.post(`${API}/sessions/placement/confirm`, async ({ request }) => {
      posts.push({ path: "/sessions/placement/confirm", body: (await request.json()) as Record<string, unknown> });
      return HttpResponse.json({
        data: {
          session: makeSession({ id: "new1", title: "Urgent essay", type: "TASK", scheduledStartTime: plan.start }),
          displacedSessions: [],
          undoGroupId: "group-1",
        },
      });
    }),
  );
});

afterEach(() => {
  vi.useRealTimers();
});

/** Fill the form and press save, with No rush off so the tomorrow chip is the deadline. */
async function submitUrgentTask() {
  fireEvent.change(screen.getByTestId("task.title"), { target: { value: "Urgent essay" } });
  await waitFor(() =>
    expect(screen.getByTestId("task.deadline.chip.noRush").getAttribute("aria-checked")).toBe("true"),
  );
  fireEvent.click(screen.getByTestId("task.deadline.chip.tomorrow"));
  fireEvent.click(screen.getByTestId("task.save"));
}

describe("NewSessionScreen Make room", () => {
  it("opens the sheet with before and after rows when a placement needs confirming", async () => {
    renderScreen(<NewSessionScreen />);
    await submitUrgentTask();

    expect(await screen.findByTestId("make-room-title")).toBeTruthy();
    const before = screen.getByTestId("make-room-before");
    const after = screen.getByTestId("make-room-after");
    expect(before.textContent).toContain("Lab report");
    expect(after.textContent).toContain("Urgent essay");
    expect(after.textContent).toContain("Lab report");
    expect(posts.map((p) => p.path)).toEqual(["/sessions"]);
  });

  it("Move it applies the held plan and sends nothing else", async () => {
    renderScreen(<NewSessionScreen />);
    await submitUrgentTask();
    await screen.findByTestId("make-room.move");

    fireEvent.click(screen.getByTestId("make-room.move"));

    await waitFor(() =>
      expect(posts.map((p) => p.path)).toEqual(["/sessions", "/sessions/placement/confirm"]),
    );
    expect(posts[1].body).toEqual({ planId: "plan-1" });
  });

  it("Keep mine and accept late retries with the late-deadline policy", async () => {
    renderScreen(<NewSessionScreen />);
    await submitUrgentTask();
    await screen.findByTestId("make-room.late");

    fireEvent.click(screen.getByTestId("make-room.late"));

    await waitFor(() => expect(posts).toHaveLength(2));
    expect(posts[1].body).toMatchObject({ infeasiblePolicy: "ACCEPT_LATE_DEADLINE" });
    expect(useComposerStore.getState().drafts[DRAFT_NEW]).toBeUndefined();
  });
});
