import { fireEvent, screen, waitFor } from "@testing-library/react";
import { router, useLocalSearchParams } from "expo-router";
import { http, HttpResponse } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import NewSessionScreen from "@/app/task/new";
import { DRAFT_NEW, useComposerStore } from "@/lib/composer-store";
import { useSlotAlternativeStore } from "@/lib/slot-alternatives";
import { useUserStore } from "@/hooks/use-user-store";
import { makeSession } from "@/test/fixtures";
import { API, testUser } from "@/test/msw/handlers";
import { server } from "@/test/msw/server";
import { renderScreen } from "@/test/utils/render";

// Rich-text editor (WebView) — has its own coverage/ownership.
vi.mock("@/components/tasks/note/description-field", () => ({ DescriptionField: () => null }));

// The mocked "tomorrow" deadline option, 23:59 in the test user's zone.
const TOMORROW = "2026-10-16T16:59:59.000Z";
let posts: Record<string, unknown>[];

const toastShown = (text: string | RegExp) =>
  waitFor(() => expect(screen.getAllByText(text).length).toBeGreaterThan(0));

/** Waits for the deadline chips to load, which turns "No rush" on by default. */
async function deadlinesReady() {
  await waitFor(() =>
    expect(screen.getByTestId("task.deadline.chip.noRush").getAttribute("aria-checked")).toBe("true"),
  );
}

/** Reminders, repeat and notes sit under More options, folded by default. */
async function openMoreOptions() {
  fireEvent.click(screen.getByTestId("task.more"));
  await screen.findByTestId("task.more.body");
}

async function typeLine(text: string) {
  fireEvent.change(screen.getByTestId("task.title"), { target: { value: text } });
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-15T05:00:00.000Z"));
  posts = [];
  useUserStore.setState({ user: testUser as never, loading: false });
  useComposerStore.setState({ drafts: {}, courseDuration: {} });
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
  it("opens as a blank task with the default reminder and No rush", async () => {
    renderScreen(<NewSessionScreen />);
    expect(screen.getAllByText("New session").length).toBeGreaterThan(0);
    expect((screen.getByTestId("task.title") as HTMLInputElement).value).toBe("");
    await openMoreOptions();
    expect(screen.getByText("1 hour before")).toBeTruthy();
    await deadlinesReady();
  });

  it("uses the user's default reminder from Settings", async () => {
    useUserStore.setState({ user: { ...testUser, defaultReminderMinutes: 15 } as never });
    renderScreen(<NewSessionScreen />);
    await openMoreOptions();
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

  it("creates a task from the chosen deadline and the default duration", async () => {
    renderScreen(<NewSessionScreen />);
    await typeLine("Revise graphs");
    await deadlinesReady();
    fireEvent.click(screen.getByTestId("task.deadline.chip.tomorrow"));
    fireEvent.click(screen.getByTestId("task.save"));
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]).toMatchObject({
      type: "TASK",
      title: "Revise graphs",
      durationMinutes: 60,
      deadline: TOMORROW,
    });
    await waitFor(() => expect(router.dismissTo).toHaveBeenCalled());
  });

  it("reads a known course, a deadline and a duration from one line", async () => {
    server.use(
      http.get(`${API}/tags`, () =>
        HttpResponse.json({ data: { tags: [{ id: "c1", name: "OOP" }] } }),
      ),
    );
    renderScreen(<NewSessionScreen />);
    await deadlinesReady();
    await typeLine("OOP essay due fri 3h");
    expect((screen.getByTestId("task.title") as HTMLInputElement).value).toBe(
      "OOP essay due fri 3h",
    );
    await waitFor(() => expect(screen.getByTestId("task.course.chip.OOP")).toBeTruthy());
    fireEvent.click(screen.getByTestId("task.save"));
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]).toMatchObject({
      type: "TASK",
      title: "OOP essay",
      tags: ["OOP"],
      durationMinutes: 180,
      deadline: TOMORROW,
    });
  });

  it("creates a fixed event when the line names a time of day", async () => {
    renderScreen(<NewSessionScreen />);
    await typeLine("Lecture at 9am");
    fireEvent.click(screen.getByTestId("task.save"));
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]).toMatchObject({
      type: "LECTURE",
      title: "Lecture",
      durationMinutes: 60,
      // 09:00 in Ho Chi Minh time on the 15th.
      scheduledStartTime: "2026-10-15T02:00:00.000Z",
    });
  });

  it("keeps a draft when the sheet is closed, and restores it on the next open", async () => {
    const first = renderScreen(<NewSessionScreen />);
    await typeLine("Draft idea");
    fireEvent.click(screen.getByTestId("task.close"));
    expect(router.back).toHaveBeenCalled();
    expect(useComposerStore.getState().drafts[DRAFT_NEW]?.title).toBe("Draft idea");
    first.unmount();

    renderScreen(<NewSessionScreen />);
    expect((screen.getByTestId("task.title") as HTMLInputElement).value).toBe("Draft idea");
  });

  it("applies the placed slot with no choice sheet and keeps the alternative for Other time", async () => {
    server.use(
      http.post(`${API}/sessions`, () =>
        HttpResponse.json({
          data: {
            ...makeSession({
              id: "new1",
              title: "Revise graphs",
              type: "TASK",
              scheduledStartTime: "2026-10-15T03:00:00.000Z",
            }),
            divergent: true,
            slotProposalId: "sp1",
            primarySlot: "2026-10-15T03:00:00.000Z",
            alternativeSlot: "2026-10-15T06:00:00.000Z",
          },
        }),
      ),
    );
    useSlotAlternativeStore.setState({ byId: {} });
    renderScreen(<NewSessionScreen />);
    await typeLine("Revise graphs");
    await deadlinesReady();
    fireEvent.click(screen.getByTestId("task.deadline.chip.tomorrow"));
    fireEvent.click(screen.getByTestId("task.save"));

    await waitFor(() =>
      expect(router.dismissTo).toHaveBeenCalledWith({
        pathname: "/",
        params: { date: "2026-10-15T03:00:00.000Z", flash: "new1" },
      }),
    );
    expect(useSlotAlternativeStore.getState().byId.new1).toEqual({
      slotProposalId: "sp1",
      primarySlot: "2026-10-15T03:00:00.000Z",
      alternativeSlot: "2026-10-15T06:00:00.000Z",
    });
    expect(screen.queryByText("Choose a time")).toBeNull();
  });
});
