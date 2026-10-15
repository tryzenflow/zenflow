import { zonedDate } from "@zenflow/core";
import { format } from "date-fns";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it, vi } from "vitest";
import OnboardingScreen from "@/app/(onboarding)/index";
import { useIntegrationStore } from "@/hooks/use-integration-store";
import { useUserStore } from "@/hooks/use-user-store";
import { API, testUser } from "@/test/msw/handlers";
import { server } from "@/test/msw/server";
import { renderScreen } from "@/test/utils/render";

// One mutable stand-in for the shared notification mechanism (it has its own
// rules; here we only drive the onboarding steps around it).
const notif = vi.hoisted(() => ({
  active: false,
  permissionGranted: false,
  ready: true,
  prefs: {
    language: "en",
    timezone: "Asia/Ho_Chi_Minh",
    timezoneMode: "device",
    defaultReminder: 10,
  },
  update: vi.fn(async () => true),
  setEnabled: vi.fn(async () => true),
}));

vi.mock("@/hooks/use-notification-toggle", () => ({
  useNotificationToggle: () => notif,
}));
vi.mock("@/hooks/use-push-status-store", () => ({
  usePushStatusStore: Object.assign(() => null, {
    getState: () => ({ permission: "denied", refresh: vi.fn(async () => {}) }),
  }),
}));
vi.mock("@/components/settings/dlu-accounts-section", () => ({
  DluAccountsSection: () => <div data-testid="dlu-section" />,
}));

const BASIC_INFO = `${API}/users/update/basic-info`;

// Created for a fresh account when onboarding finishes (lib/onboarding.ts initialTagSelection).
const DEFAULT_TAGS = ["Study", "Exam", "Assignment", "Project"];

let patches: Record<string, unknown>[];
let bulkBodies: { names: string[] }[];
type SessionBody = {
  type: string;
  title: string;
  durationMinutes: number;
  scheduledStartTime: string;
  rrule: string;
};
let sessionBodies: SessionBody[];

beforeEach(() => {
  patches = [];
  bulkBodies = [];
  sessionBodies = [];
  notif.active = false;
  notif.permissionGranted = false;
  notif.update.mockResolvedValue(true);
  notif.setEnabled.mockResolvedValue(true);
  useUserStore.setState({ user: { ...testUser, onboardedAt: null } as never, loading: false });
  useIntegrationStore.setState({ integrations: [], loading: true });
  server.use(
    http.patch(BASIC_INFO, async ({ request }) => {
      const body = (await request.json()) as Record<string, unknown>;
      patches.push(body);
      return HttpResponse.json({ data: { ...testUser, ...body } });
    }),
    http.get(`${API}/tags`, () => HttpResponse.json({ data: { tags: [] } })),
    http.post(`${API}/tags/bulk`, async ({ request }) => {
      const body = (await request.json()) as { names: string[] };
      bulkBodies.push(body);
      return HttpResponse.json({ data: { tags: body.names.map((name) => ({ id: name, name })) } });
    }),
    http.get(`${API}/sessions/search`, () => HttpResponse.json({ data: { sessions: [], nextCursor: null } })),
    http.post(`${API}/sessions`, async ({ request }) => {
      const body = (await request.json()) as SessionBody;
      sessionBodies.push(body);
      return HttpResponse.json({ data: { session: { id: body.title, ...body } } });
    }),
  );
});

const primary = () => screen.getByTestId("onboarding.primary");
const secondary = () => screen.getByTestId("onboarding.secondary");
const next = async (title: string) =>
  waitFor(() => expect(screen.getByText(title)).toBeTruthy());

const TITLES = [
  "What should we call you?",
  "When do you focus best?",
  "Connect your LMS or portal",
  "Stay ahead of deadlines",
  "You’re all set",
];

/** Skip forward (secondary button) until `title` shows, awaiting each hop. */
async function skipTo(title: string) {
  for (const hop of TITLES.slice(1, TITLES.indexOf(title) + 1)) {
    fireEvent.click(secondary());
    await next(hop);
  }
}

describe("OnboardingScreen", () => {
  it("starts on the name step with the name prefilled and no back button", () => {
    renderScreen(<OnboardingScreen />);
    expect(screen.getByText("What should we call you?")).toBeTruthy();
    expect((screen.getByDisplayValue("Test User") as HTMLInputElement).value).toBe("Test User");
    expect(screen.queryByLabelText("Back")).toBeNull();
  });

  it("disables Continue while the name is blank", () => {
    renderScreen(<OnboardingScreen />);
    fireEvent.change(screen.getByDisplayValue("Test User"), { target: { value: "   " } });
    expect(primary().hasAttribute("disabled") || primary().getAttribute("aria-disabled") === "true").toBe(true);
  });

  it("saves an edited name and moves to the LMS step", async () => {
    renderScreen(<OnboardingScreen />);
    fireEvent.change(screen.getByDisplayValue("Test User"), { target: { value: "  Minh  " } });
    fireEvent.click(primary());
    await next("When do you focus best?");
    expect(patches).toEqual([{ name: "Minh" }]);
    expect(useUserStore.getState().user?.name).toBe("Minh");
  });

  it("does not PATCH when the name is unchanged", async () => {
    renderScreen(<OnboardingScreen />);
    fireEvent.click(primary());
    await next("When do you focus best?");
    expect(patches).toEqual([]);
  });

  it("keeps the user on the name step and toasts when the save fails", async () => {
    server.use(http.patch(BASIC_INFO, () => HttpResponse.json({ message: "no" }, { status: 500 })));
    renderScreen(<OnboardingScreen />);
    fireEvent.change(screen.getByDisplayValue("Test User"), { target: { value: "Minh" } });
    fireEvent.click(primary());
    await waitFor(() => expect(screen.getByText("Couldn't save")).toBeTruthy());
    expect(screen.getByText("What should we call you?")).toBeTruthy();
  });

  it("goes back a step and hides Back again on the first step", async () => {
    renderScreen(<OnboardingScreen />);
    fireEvent.click(primary());
    await next("When do you focus best?");
    fireEvent.click(screen.getByLabelText("Back"));
    await next("What should we call you?");
    expect(screen.queryByLabelText("Back")).toBeNull();
  });

  it("offers Skip for now on the LMS step while nothing is connected", async () => {
    renderScreen(<OnboardingScreen />);
    await skipTo("Connect your LMS or portal");
    expect(screen.getByTestId("dlu-section")).toBeTruthy();
    expect(screen.getByText("Skip for now")).toBeTruthy();
  });

  it("hides Skip for now on the LMS step once an account is connected", async () => {
    server.use(
      http.get(`${API}/integrations`, () =>
        HttpResponse.json({
          data: { integrations: [{ provider: "PORTAL", connected: true }] },
        }),
      ),
    );
    renderScreen(<OnboardingScreen />);
    await skipTo("Connect your LMS or portal");
    await waitFor(() => expect(screen.queryByText("Skip for now")).toBeNull());
  });

  describe("focus step", () => {
    async function openFocus() {
      renderScreen(<OnboardingScreen />);
      await skipTo("When do you focus best?");
    }

    const isDisabled = (el: HTMLElement) =>
      el.hasAttribute("disabled") || el.getAttribute("aria-disabled") === "true";

    it("offers the four bands with their hours and nothing picked", async () => {
      await openFocus();
      for (const label of ["Morning", "Afternoon", "Evening", "Late night"]) {
        expect(screen.getByText(label)).toBeTruthy();
      }
      expect(screen.getByText("08:00 to 12:00")).toBeTruthy();
      expect(screen.getByText("21:00 to 02:00")).toBeTruthy();
      expect(screen.getAllByRole("radio").every((r) => r.getAttribute("aria-checked") === "false")).toBe(true);
      expect(isDisabled(primary())).toBe(true);
    });

    it("saves the picked band and moves to the LMS step", async () => {
      await openFocus();
      fireEvent.click(screen.getByTestId("onboarding.focus.AFTERNOON"));
      expect(isDisabled(primary())).toBe(false);
      fireEvent.click(primary());
      await next("Connect your LMS or portal");
      expect(patches).toEqual([{ focusBand: "AFTERNOON" }]);
      expect(useUserStore.getState().user?.focusBand).toBe("AFTERNOON");
    });

    it("skips without saving a band", async () => {
      await openFocus();
      fireEvent.click(secondary());
      await next("Connect your LMS or portal");
      expect(patches).toEqual([]);
    });

    it("preselects the saved band and does not PATCH when it is unchanged", async () => {
      useUserStore.setState({
        user: { ...testUser, onboardedAt: null, focusBand: "EVENING" } as never,
        loading: false,
      });
      await openFocus();
      expect(screen.getByTestId("onboarding.focus.EVENING").getAttribute("aria-checked")).toBe("true");
      fireEvent.click(primary());
      await next("Connect your LMS or portal");
      expect(patches).toEqual([]);
    });

    it("stays on the step and toasts when the save fails", async () => {
      server.use(http.patch(BASIC_INFO, () => HttpResponse.json({ message: "no" }, { status: 500 })));
      await openFocus();
      fireEvent.click(screen.getByTestId("onboarding.focus.MORNING"));
      fireEvent.click(primary());
      await waitFor(() => expect(screen.getByText("Couldn't save")).toBeTruthy());
      expect(screen.getByText("When do you focus best?")).toBeTruthy();
    });
  });

  describe("notifications step", () => {
    async function openNotifications() {
      renderScreen(<OnboardingScreen />);
      await skipTo("Stay ahead of deadlines");
    }

    it("turns notifications on quietly and advances", async () => {
      await openNotifications();
      fireEvent.click(primary());
      await next("You’re all set");
      expect(notif.setEnabled).toHaveBeenCalledWith(true, { quiet: true });
    });

    it("shows the blocked hint and stays when permission is denied", async () => {
      notif.setEnabled.mockResolvedValue(false);
      await openNotifications();
      fireEvent.click(primary());
      await waitFor(() => expect(screen.getByText("Notifications are blocked")).toBeTruthy());
      expect(screen.getByText("Stay ahead of deadlines")).toBeTruthy();
      expect(screen.getAllByText("Open system settings").length).toBeGreaterThan(0);
    });

    it("'Not now' turns notifications off and advances", async () => {
      await openNotifications();
      fireEvent.click(screen.getByText("Not now"));
      await next("You’re all set");
      expect(notif.setEnabled).toHaveBeenCalledWith(false);
    });

    it("reflects the active state on the switch and offers Continue", async () => {
      notif.active = true;
      await openNotifications();
      const toggle = screen.getByTestId("onboarding.notifications-switch");
      expect(toggle.getAttribute("aria-checked")).toBe("true");
      expect(screen.queryByText("Not now")).toBeNull();
      expect(screen.getByText("Continue")).toBeTruthy();
    });
  });

  describe("finish", () => {
    async function openSummary() {
      renderScreen(<OnboardingScreen />);
      await skipTo("You’re all set");
    }

    it("has no timezone, reminder or tags steps", async () => {
      await openSummary();
      expect(screen.queryByText("Where are you?")).toBeNull();
      expect(screen.queryByText("Default reminder")).toBeNull();
      expect(screen.queryByText("Pick your tags")).toBeNull();
    });

    it("lists skipped steps on the summary and reopens one, returning to the summary", async () => {
      await openSummary();
      const setUp = screen.getAllByText("Set up");
      expect(setUp.length).toBe(2); // LMS + notifications were skipped
      fireEvent.click(setUp[0]);
      await next("Connect your LMS or portal");
      fireEvent.click(primary());
      await next("You’re all set");
    });

    it("creates the default tags in one bulk call and completes onboarding", async () => {
      await openSummary();
      fireEvent.click(screen.getByText("Open my calendar"));
      await waitFor(() => expect(patches).toContainEqual({ onboarded: true }));
      expect(bulkBodies).toHaveLength(1);
      expect(bulkBodies[0].names).toEqual(DEFAULT_TAGS);
    });

    it("keeps tags the user already has and adds no duplicates", async () => {
      server.use(
        http.get(`${API}/tags`, () => HttpResponse.json({ data: { tags: [{ id: "1", name: "Study" }] } })),
      );
      await openSummary();
      fireEvent.click(screen.getByText("Open my calendar"));
      await waitFor(() => expect(patches).toContainEqual({ onboarded: true }));
      // Resuming with a saved suggestion keeps exactly those: nothing new to create.
      expect(bulkBodies).toEqual([]);
    });

    it("still completes when the tag setup fails", async () => {
      server.use(http.get(`${API}/tags`, () => HttpResponse.json({ message: "no" }, { status: 500 })));
      await openSummary();
      fireEvent.click(screen.getByText("Open my calendar"));
      await waitFor(() => expect(patches).toContainEqual({ onboarded: true }));
    });

    it("creates the Sleep, Lunch break and Dinner DND series in the user's timezone", async () => {
      await openSummary();
      fireEvent.click(screen.getByText("Open my calendar"));
      await waitFor(() => expect(patches).toContainEqual({ onboarded: true }));
      expect(sessionBodies.map((b) => b.title)).toEqual(["Sleep", "Lunch break", "Dinner"]);
      const [sleep, lunch, dinner] = sessionBodies;
      expect(sessionBodies.every((b) => b.type === "DND" && b.rrule === "FREQ=DAILY")).toBe(true);
      expect([sleep.durationMinutes, lunch.durationMinutes, dinner.durationMinutes]).toEqual([420, 60, 60]);
      const wall = (iso: string) => format(zonedDate(iso, "Asia/Ho_Chi_Minh"), "HH:mm");
      expect([sleep, lunch, dinner].map((b) => wall(b.scheduledStartTime))).toEqual(["23:00", "11:30", "17:00"]);
    });

    it("skips a routine that already exists as a DND series", async () => {
      server.use(
        http.get(`${API}/sessions/search`, () =>
          HttpResponse.json({
            data: { sessions: [{ type: "DND", title: "Dinner", rrule: "FREQ=DAILY" }], nextCursor: null },
          }),
        ),
      );
      await openSummary();
      fireEvent.click(screen.getByText("Open my calendar"));
      await waitFor(() => expect(patches).toContainEqual({ onboarded: true }));
      expect(sessionBodies.map((b) => b.title)).toEqual(["Sleep", "Lunch break"]);
    });

    it("still completes when a routine fails to save", async () => {
      server.use(http.post(`${API}/sessions`, () => HttpResponse.json({ message: "no" }, { status: 500 })));
      await openSummary();
      fireEvent.click(screen.getByText("Open my calendar"));
      await waitFor(() => expect(patches).toContainEqual({ onboarded: true }));
    });

    it("creates no routines when the lookup fails, so a retry cannot duplicate them", async () => {
      server.use(http.get(`${API}/sessions/search`, () => HttpResponse.json({ message: "no" }, { status: 500 })));
      await openSummary();
      fireEvent.click(screen.getByText("Open my calendar"));
      await waitFor(() => expect(patches).toContainEqual({ onboarded: true }));
      expect(sessionBodies).toEqual([]);
    });

    it("toasts and stays on the summary when completing fails", async () => {
      await openSummary();
      server.use(http.patch(BASIC_INFO, () => HttpResponse.json({ message: "no" }, { status: 500 })));
      fireEvent.click(screen.getByText("Open my calendar"));
      await waitFor(() => expect(screen.getByText("Couldn't save")).toBeTruthy());
      expect(screen.getByText("You’re all set")).toBeTruthy();
    });
  });
});
