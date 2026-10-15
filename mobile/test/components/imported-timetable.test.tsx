import { screen, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { ImportedTimetable } from "@/components/onboarding/imported-timetable";
import { API } from "@/test/msw/handlers";
import { server } from "@/test/msw/server";
import { renderScreen } from "@/test/utils/render";

function session(id: string, title: string, source: string) {
  return {
    id,
    title,
    source,
    location: "B1-201",
    scheduledStartTime: "2026-10-19T02:00:00.000Z",
    durationMinutes: 90,
    type: "LECTURE",
  };
}

describe("ImportedTimetable", () => {
  it("shows the synced sessions of the week and hides the user's own", async () => {
    server.use(
      http.get(`${API}/sessions`, () =>
        HttpResponse.json({
          data: {
            sessions: [
              session("mine", "My own task", "USER"),
              session("lec", "Data structures", "PORTAL"),
            ],
          },
        }),
      ),
    );
    renderScreen(<ImportedTimetable />);
    await waitFor(() => expect(screen.getByText("Data structures")).toBeTruthy());
    expect(screen.queryByText("My own task")).toBeNull();
    expect(screen.getByText("Your timetable")).toBeTruthy();
  });

  it("reads the current week", async () => {
    const views: string[] = [];
    server.use(
      http.get(`${API}/sessions`, ({ request }) => {
        views.push(new URL(request.url).searchParams.get("view") ?? "");
        return HttpResponse.json({
          data: { sessions: [session("lec", "Data structures", "PORTAL")] },
        });
      }),
    );
    renderScreen(<ImportedTimetable />);
    await waitFor(() => expect(screen.getByText("Data structures")).toBeTruthy());
    expect(views[0]).toBe("week");
  });
});
