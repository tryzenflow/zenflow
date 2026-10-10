import { fireEvent, screen, waitFor } from "@testing-library/react";
import { router, useLocalSearchParams } from "expo-router";
import { http, HttpResponse } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import NewSessionScreen from "@/app/task/new";
import { useUserStore } from "@/hooks/use-user-store";
import { makeSession } from "@/test/fixtures";
import { API, testUser } from "@/test/msw/handlers";
import { server } from "@/test/msw/server";
import { renderScreen } from "@/test/utils/render";

// Rich-text editor (WebView) — has its own coverage/ownership.
vi.mock("@/components/tasks/form/description-field", () => ({ DescriptionField: () => null }));

const TOMORROW = "2026-10-16T16:59:59.000Z"; // from the default deadline-options handler
let posts: Record<string, unknown>[];

const toastShown = (text: string | RegExp) =>
  waitFor(() => expect(screen.getAllByText(text).length).toBeGreaterThan(0));

async function fillAndSubmit(title = "Revise graphs") {
  fireEvent.change(screen.getByTestId("task.title"), { target: { value: title } });
  // Chips are inert until the deadline options load; the form then defaults to "No rush".
  await screen.findByText(/^Due /);
  fireEvent.click(screen.getByTestId("task.deadline.tomorrow"));
  fireEvent.click(screen.getByTestId("task.save"));
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-15T05:00:00.000Z"));
  posts = [];
  useUserStore.setState({ user: testUser as never, loading: false });
  server.use(
    http.post(`${API}/sessions`, async ({ request }) => {
      posts.push((await request.json()) as Record<string, unknown>);
      return HttpResponse.json({
        data: makeSession({
          id: "new1",
          title: "Revise graphs",
          type: "TASK",
          scheduledStartTime: "2026-10-15T03:00:00.000Z",
        }),
      });
    }),
  );
});

afterEach(() => {
  vi.useRealTimers();
  vi.mocked(useLocalSearchParams).mockReturnValue({} as never);
});

describe("NewSessionScreen", () => {
  it("opens as a blank task with the default reminder", () => {
    renderScreen(<NewSessionScreen />);
    expect(screen.getAllByText("New session").length).toBeGreaterThan(0);
    expect((screen.getByTestId("task.title") as HTMLInputElement).value).toBe("");
    expect(screen.getByText("1 hour before")).toBeTruthy();
    expect(screen.getByTestId("task.deadline.tomorrow")).toBeTruthy();
  });

  it("uses the user's default reminder from Settings", () => {
    useUserStore.setState({ user: { ...testUser, defaultReminderMinutes: 15 } as never });
    renderScreen(<NewSessionScreen />);
    expect(screen.getByText("15 min before")).toBeTruthy();
  });

  it("prefills the title and the day from the route params", () => {
    vi.mocked(useLocalSearchParams).mockReturnValue({
      start: "2026-10-15T03:00:00.000Z",
      title: "Prepare for Final exam",
    } as never);
    renderScreen(<NewSessionScreen />);
    expect((screen.getByTestId("task.title") as HTMLInputElement).value).toBe(
      "Prepare for Final exam",
    );
    expect(screen.getByText("From Thursday, Oct 15")).toBeTruthy();
  });

  it("refuses an empty title without calling the API", async () => {
    renderScreen(<NewSessionScreen />);
    fireEvent.click(screen.getByTestId("task.save"));
    await toastShown("Session name is required");
    expect(posts).toEqual([]);
    expect(router.replace).not.toHaveBeenCalled();
  });

  it("defaults the deadline to 'No rush' once the options load", async () => {
    renderScreen(<NewSessionScreen />);
    fireEvent.change(screen.getByTestId("task.title"), { target: { value: "Someday" } });
    await screen.findByText(/^Due /);
    fireEvent.click(screen.getByTestId("task.save"));
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]).toMatchObject({ deadline: "2026-12-31T16:59:59.000Z" });
  });

  it("creates a task with the chosen deadline and jumps to where it was placed", async () => {
    renderScreen(<NewSessionScreen />);
    await fillAndSubmit();
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]).toMatchObject({
      type: "TASK",
      title: "Revise graphs",
      durationMinutes: 60,
      deadline: TOMORROW,
      reminders: [60],
      tags: [],
    });
    await waitFor(() =>
      expect(router.replace).toHaveBeenCalledWith({
        pathname: "/",
        params: { date: "2026-10-15T03:00:00.000Z", flash: "new1" },
      }),
    );
    await toastShown("Scheduled for 10:00 AM");
    await toastShown("Thu Oct 15");
  });

  it("just goes back when the scheduler found no slot", async () => {
    server.use(
      http.post(`${API}/sessions`, () =>
        HttpResponse.json({
          data: makeSession({ id: "new2", title: "Revise graphs", type: "TASK", scheduledStartTime: null }),
        }),
      ),
    );
    renderScreen(<NewSessionScreen />);
    await fillAndSubmit();
    await waitFor(() => expect(router.back).toHaveBeenCalled());
    expect(router.replace).not.toHaveBeenCalled();
    await toastShown("Task created");
  });

  it("offers both policies when the deadline can't be met, then retries with the chosen one", async () => {
    let calls = 0;
    server.use(
      http.post(`${API}/sessions`, async ({ request }) => {
        const body = (await request.json()) as Record<string, unknown>;
        posts.push(body);
        calls++;
        if (!body.infeasiblePolicy) {
          return HttpResponse.json(
            {
              success: false,
              statusCode: 409,
              code: "SCHEDULE_INFEASIBLE",
              message: "No room before the deadline",
              options: ["ACCEPT_CONFLICTS", "ACCEPT_LATE_DEADLINE"],
            },
            { status: 409 },
          );
        }
        return HttpResponse.json({
          data: makeSession({ id: "new3", title: "Revise graphs", type: "TASK", late: true }),
        });
      }),
    );
    renderScreen(<NewSessionScreen />);
    await fillAndSubmit();
    await toastShown("Accept conflicts");
    expect(screen.getAllByText("Accept late deadline").length).toBeGreaterThan(0);
    expect(router.replace).not.toHaveBeenCalled();
    fireEvent.click(screen.getAllByText("Accept late deadline")[0]);
    await waitFor(() => expect(calls).toBe(2));
    expect(posts[1]).toMatchObject({ infeasiblePolicy: "ACCEPT_LATE_DEADLINE" });
    await waitFor(() => expect(router.replace).toHaveBeenCalled());
  });

  it("hands a divergent placement to the week view's slot-pick sheet", async () => {
    server.use(
      http.post(`${API}/sessions`, () =>
        HttpResponse.json({
          data: {
            ...makeSession({ id: "new4", title: "Revise graphs", type: "TASK" }),
            divergent: true,
            slotProposalId: "p1",
            primarySlot: "2026-10-15T03:00:00.000Z",
            alternativeSlot: "2026-10-16T03:00:00.000Z",
          },
        }),
      ),
    );
    renderScreen(<NewSessionScreen />);
    await fillAndSubmit();
    await waitFor(() =>
      expect(router.replace).toHaveBeenCalledWith({
        pathname: "/",
        params: { date: "2026-10-15T03:00:00.000Z", flash: "new4" },
      }),
    );
    const { takePendingSlotPick } = await import("@/lib/pending-slot-pick");
    expect(takePendingSlotPick()).toMatchObject({ kind: "single", slotProposalId: "p1" });
  });

  it("shows the server's message when creating fails and stays on the form", async () => {
    server.use(
      http.post(`${API}/sessions`, () =>
        HttpResponse.json({ message: "Too many sessions today" }, { status: 400 }),
      ),
    );
    renderScreen(<NewSessionScreen />);
    await fillAndSubmit();
    await waitFor(() => expect(screen.queryAllByText(/Too many sessions today|Couldn't create the session/).length).toBeGreaterThan(0));
    expect(router.replace).not.toHaveBeenCalled();
    expect(router.back).not.toHaveBeenCalled();
  });
});
