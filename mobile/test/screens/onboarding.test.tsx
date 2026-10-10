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

let patches: Record<string, unknown>[];
let bulkBodies: { names: string[] }[];

beforeEach(() => {
  patches = [];
  bulkBodies = [];
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
  );
});

const primary = () => screen.getByTestId("onboarding.primary");
const secondary = () => screen.getByTestId("onboarding.secondary");
const next = async (title: string) =>
  waitFor(() => expect(screen.getByText(title)).toBeTruthy());

// Preselected on a fresh account (lib/onboarding.ts initialTagSelection).
const DEFAULT_TAGS = ["Study", "Exam", "Assignment", "Project"];

const TITLES = [
  "What should we call you?",
  "Connect your LMS or portal",
  "Stay ahead of deadlines",
  "Where are you?",
  "Default reminder",
  "Pick your tags",
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
    await next("Connect your LMS or portal");
    expect(patches).toEqual([{ name: "Minh" }]);
    expect(useUserStore.getState().user?.name).toBe("Minh");
  });

  it("does not PATCH when the name is unchanged", async () => {
    renderScreen(<OnboardingScreen />);
    fireEvent.click(primary());
    await next("Connect your LMS or portal");
    expect(patches).toEqual([]);
  });

  it("keeps the user on the name step and toasts when the save fails", async () => {
    server.use(http.patch(BASIC_INFO, () => HttpResponse.json({ message: "no" }, { status: 500 })));
    renderScreen(<OnboardingScreen />);
    fireEvent.change(screen.getByDisplayValue("Test User"), { target: { value: "Minh" } });
    fireEvent.click(primary());
    await waitFor(() => expect(screen.getByText("Couldn't save. Try again.")).toBeTruthy());
    expect(screen.getByText("What should we call you?")).toBeTruthy();
  });

  it("goes back a step and hides Back again on the first step", async () => {
    renderScreen(<OnboardingScreen />);
    fireEvent.click(primary());
    await next("Connect your LMS or portal");
    fireEvent.click(screen.getByLabelText("Back"));
    await next("What should we call you?");
    expect(screen.queryByLabelText("Back")).toBeNull();
  });

  it("offers Skip for now on the LMS step while nothing is connected", async () => {
    renderScreen(<OnboardingScreen />);
    fireEvent.click(primary());
    await next("Connect your LMS or portal");
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
    fireEvent.click(primary());
    await next("Connect your LMS or portal");
    await waitFor(() => expect(screen.queryByText("Skip for now")).toBeNull());
  });

  describe("notifications step", () => {
    async function openNotifications() {
      renderScreen(<OnboardingScreen />);
      await skipTo("Stay ahead of deadlines");
    }

    it("turns notifications on quietly and advances", async () => {
      await openNotifications();
      fireEvent.click(primary());
      await next("Where are you?");
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
      await next("Where are you?");
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

  describe("preference steps", () => {
    it("saves a timezone choice and the default reminder through the shared updater", async () => {
      renderScreen(<OnboardingScreen />);
      await skipTo("Where are you?");
      fireEvent.click(screen.getByText("Detected from device"));
      expect(notif.update).toHaveBeenCalledWith({ timezone: expect.anything() });
      fireEvent.click(primary());
      await next("Default reminder");
      fireEvent.click(screen.getByText("5 min before"));
      expect(notif.update).toHaveBeenCalledWith({ defaultReminder: 5 });
    });

    it("stays on the step with a toast when a preference save fails", async () => {
      notif.update.mockResolvedValue(false);
      renderScreen(<OnboardingScreen />);
      await skipTo("Where are you?");
      fireEvent.click(screen.getByText("Detected from device"));
      await waitFor(() => expect(screen.getByText("Couldn't save. Try again.")).toBeTruthy());
      fireEvent.click(primary());
      await waitFor(() => expect(screen.getByText("Where are you?")).toBeTruthy());
    });
  });

  describe("tags and finish", () => {
    async function openTags() {
      renderScreen(<OnboardingScreen />);
      await skipTo("Pick your tags");
    }

    function clearTags() {
      for (const name of DEFAULT_TAGS) fireEvent.click(screen.getByText(name));
    }

    it("posts the preselected tags minus any toggled off in one bulk call", async () => {
      await openTags();
      fireEvent.click(screen.getByText("Exam")); // deselect one of the four defaults
      fireEvent.click(primary());
      await next("You’re all set");
      expect(bulkBodies).toHaveLength(1);
      expect(bulkBodies[0].names).toEqual(["Study", "Assignment", "Project"]);
      expect(screen.getByText("3 selected")).toBeTruthy();
    });

    it("skips tags without creating any once the selection is cleared", async () => {
      await openTags();
      clearTags();
      fireEvent.click(secondary());
      await next("You’re all set");
      expect(bulkBodies).toEqual([]);
    });

    it("lists skipped steps on the summary and reopens one, returning to the summary", async () => {
      await openTags();
      clearTags();
      fireEvent.click(secondary());
      await next("You’re all set");
      const setUp = screen.getAllByText("Set up");
      expect(setUp.length).toBe(2); // LMS + notifications were skipped
      fireEvent.click(setUp[0]);
      await next("Connect your LMS or portal");
      fireEvent.click(primary());
      await next("You’re all set");
    });

    it("completes onboarding with onboarded:true", async () => {
      await openTags();
      clearTags();
      fireEvent.click(secondary());
      await next("You’re all set");
      fireEvent.click(screen.getByText("Open my calendar"));
      await waitFor(() => expect(patches).toContainEqual({ onboarded: true }));
    });

    it("toasts and stays on the summary when completing fails", async () => {
      await openTags();
      clearTags();
      fireEvent.click(secondary());
      await next("You’re all set");
      server.use(http.patch(BASIC_INFO, () => HttpResponse.json({ message: "no" }, { status: 500 })));
      fireEvent.click(screen.getByText("Open my calendar"));
      await waitFor(() => expect(screen.getByText("Couldn't save. Try again.")).toBeTruthy());
      expect(screen.getByText("You’re all set")).toBeTruthy();
    });
  });
});
