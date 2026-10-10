import { fireEvent, screen, waitFor } from "@testing-library/react";
import { router, useLocalSearchParams } from "expo-router";
import { http, HttpResponse } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import EditSessionScreen from "@/app/task/[id]/edit";
import { useUserStore } from "@/hooks/use-user-store";
import { makeSession } from "@/test/fixtures";
import { API, testUser } from "@/test/msw/handlers";
import { server } from "@/test/msw/server";
import { renderScreen } from "@/test/utils/render";

// Rich-text editor / viewer (WebView) — has its own coverage/ownership.
vi.mock("@/components/tasks/form/description-field", () => ({ DescriptionField: () => null }));

vi.mock("@/lib/geist-webview-font", () => ({ loadGeistWebviewFontDataUri: async () => "" }));

const DEADLINE = "2026-10-20T16:59:59.000Z";
const task = (over = {}) =>
  makeSession({
    id: "t1",
    title: "Revise graphs",
    type: "TASK",
    deadline: DEADLINE,
    scheduledStartTime: "2026-10-15T03:00:00.000Z",
    reminders: [60],
    ...over,
  });

const toastShown = (text: string | RegExp) =>
  waitFor(() => expect(screen.getAllByText(text).length).toBeGreaterThan(0));

let current: ReturnType<typeof makeSession>;
let requests: { method: string; url: URL; body?: unknown }[];

function serve(session: ReturnType<typeof makeSession>) {
  current = session;
  server.use(
    http.get(`${API}/sessions/:id`, () => HttpResponse.json({ data: current })),
    http.patch(`${API}/sessions/:id`, async ({ request }) => {
      const body = await request.json();
      requests.push({ method: "PATCH", url: new URL(request.url), body });
      return HttpResponse.json({ data: { ...current, ...(body as object) } });
    }),
    http.delete(/\/sessions\/.*/, ({ request }) => {
      requests.push({ method: "DELETE", url: new URL(request.url) });
      return HttpResponse.json({ data: { deletedCount: 1 } });
    }),
  );
}

async function open(session = task()) {
  serve(session);
  vi.mocked(useLocalSearchParams).mockReturnValue({ id: session.id } as never);
  renderScreen(<EditSessionScreen />);
  await screen.findByText("Session details");
  await screen.findByText(session.title);
}

async function startEditing() {
  fireEvent.click(screen.getByTestId("task.mode.edit"));
  await screen.findByText("Edit session");
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-15T05:00:00.000Z"));
  requests = [];
  useUserStore.setState({ user: testUser as never, loading: false });
});

afterEach(() => {
  vi.useRealTimers();
  vi.mocked(useLocalSearchParams).mockReturnValue({} as never);
});

describe("EditSessionScreen — viewing", () => {
  it("opens read-only with the session's details", async () => {
    await open();
    expect(screen.getByText("Revise graphs")).toBeTruthy();
    expect(screen.queryByTestId("task.save")).toBeNull();
  });

  it("closes with a toast when the session can't be loaded", async () => {
    server.use(http.get(`${API}/sessions/:id`, () => HttpResponse.json({ message: "Not found" }, { status: 404 })));
    vi.mocked(useLocalSearchParams).mockReturnValue({ id: "gone" } as never);
    renderScreen(<EditSessionScreen />);
    await waitFor(() => expect(router.back).toHaveBeenCalled());
    await toastShown(/Not found|Couldn't open this session/);
  });

  it("close button goes back", async () => {
    await open();
    fireEvent.click(screen.getByTestId("task.close"));
    expect(router.back).toHaveBeenCalled();
  });
});

describe("EditSessionScreen — editing", () => {
  it("prefills the form and saves changes, then jumps to the block", async () => {
    await open();
    await startEditing();
    const title = screen.getByTestId("task.title") as HTMLInputElement;
    expect(title.value).toBe("Revise graphs");
    fireEvent.change(title, { target: { value: "Revise trees" } });
    fireEvent.click(screen.getByTestId("task.save"));
    await waitFor(() => expect(requests.filter((r) => r.method === "PATCH")).toHaveLength(1));
    const patch = requests.find((r) => r.method === "PATCH");
    expect(patch?.url.pathname).toBe("/sessions/t1");
    expect(patch?.body).toMatchObject({ title: "Revise trees", deadline: DEADLINE, reminders: [60] });
    await toastShown("Session updated");
    await waitFor(() =>
      expect(router.replace).toHaveBeenCalledWith({
        pathname: "/",
        params: { date: "2026-10-15T03:00:00.000Z", flash: "t1" },
      }),
    );
  });

  it("refuses an empty title", async () => {
    await open();
    await startEditing();
    fireEvent.change(screen.getByTestId("task.title"), { target: { value: "" } });
    fireEvent.click(screen.getByTestId("task.save"));
    await toastShown("Session name is required");
    expect(requests).toEqual([]);
  });

  it("offers the infeasible policies and retries with the chosen one", async () => {
    await open();
    let attempts = 0;
    server.use(
      http.patch(`${API}/sessions/:id`, async ({ request }) => {
        const body = (await request.json()) as Record<string, unknown>;
        requests.push({ method: "PATCH", url: new URL(request.url), body });
        attempts++;
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
        return HttpResponse.json({ data: { ...current, ...body } });
      }),
    );
    await startEditing();
    fireEvent.change(screen.getByTestId("task.title"), { target: { value: "Revise trees" } });
    fireEvent.click(screen.getByTestId("task.save"));
    await toastShown("Accept conflicts");
    fireEvent.click(screen.getAllByText("Accept conflicts")[0]);
    await waitFor(() => expect(attempts).toBe(2));
    expect(requests[1].body).toMatchObject({ infeasiblePolicy: "ACCEPT_CONFLICTS" });
  });

  it("shows an error and stays when the update fails", async () => {
    await open();
    await startEditing();
    server.use(http.patch(`${API}/sessions/:id`, () => HttpResponse.json({ message: "Conflict with exam" }, { status: 400 })));
    fireEvent.change(screen.getByTestId("task.title"), { target: { value: "Revise trees" } });
    fireEvent.click(screen.getByTestId("task.save"));
    await toastShown(/Conflict with exam|Couldn't update session/);
    expect(router.replace).not.toHaveBeenCalled();
  });
});

describe("EditSessionScreen — deleting", () => {
  it("deletes a one-off session straight away", async () => {
    await open();
    fireEvent.click(screen.getByTestId("task.delete"));
    await toastShown("Session deleted");
    expect(requests).toEqual([expect.objectContaining({ method: "DELETE" })]);
    expect(requests[0].url.pathname).toBe("/sessions/t1");
    expect(router.back).toHaveBeenCalled();
  });

  it("reports a failed delete and stays", async () => {
    await open();
    server.use(http.delete(/\/sessions\/.*/, () => HttpResponse.json({ message: "Locked" }, { status: 400 })));
    fireEvent.click(screen.getByTestId("task.delete"));
    await toastShown(/Locked|Couldn't delete session/);
    expect(router.back).not.toHaveBeenCalled();
  });

  describe("recurring fixed session", () => {
    const occurrenceId = "ser1::2026-10-15T03:00:00.000Z";
    const lecture = () =>
      makeSession({
        id: occurrenceId,
        title: "Weekly lab",
        type: "LECTURE",
        seriesId: "ser1",
        rrule: "FREQ=WEEKLY",
        scheduledStartTime: "2026-10-15T03:00:00.000Z",
      });

    it("asks which part to delete and removes just this occurrence", async () => {
      await open(lecture());
      fireEvent.click(screen.getByTestId("task.delete"));
      expect(await screen.findByText("Delete recurring session")).toBeTruthy();
      expect(requests).toEqual([]);
      fireEvent.click(screen.getByText("This occurrence"));
      await toastShown("Session deleted");
      expect(requests).toHaveLength(1);
      expect(decodeURIComponent(requests[0].url.pathname)).toBe(`/sessions/${occurrenceId}`);
    });

    it("ends the series before this occurrence", async () => {
      await open(lecture());
      fireEvent.click(screen.getByTestId("task.delete"));
      fireEvent.click(await screen.findByText("This and all following"));
      await toastShown("This and later occurrences removed");
      expect(requests[0].url.pathname).toBe("/sessions/series/ser1/truncate");
      expect(requests[0].url.searchParams.get("from")).toBe("2026-10-15T03:00:00.000Z");
    });

    it("deletes the whole series", async () => {
      await open(lecture());
      fireEvent.click(screen.getByTestId("task.delete"));
      fireEvent.click(await screen.findByText("All occurrences"));
      await toastShown("Series deleted");
      expect(requests[0].url.pathname).toBe("/sessions/series/ser1");
      expect(router.back).toHaveBeenCalled();
    });
  });

  it("removes this and later sittings of a multi-sitting task", async () => {
    await open(task({ seriesId: "ser2", sessionIndex: 2, sessionTotal: 4 }));
    fireEvent.click(screen.getByTestId("task.delete"));
    expect(await screen.findByText("Delete session", { selector: "div" })).toBeTruthy();
    fireEvent.click(screen.getByText("This and all later sittings"));
    await toastShown("This and later sittings removed");
    expect(requests[0].url.pathname).toBe("/sessions/series/ser2/from/t1");
  });
});
