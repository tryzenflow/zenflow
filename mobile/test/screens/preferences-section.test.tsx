import { fireEvent, screen, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PreferencesSection } from "@/components/settings/preferences-section";
import { useUserStore } from "@/hooks/use-user-store";
import { API, testUser } from "@/test/msw/handlers";
import { server } from "@/test/msw/server";
import { renderScreen } from "@/test/utils/render";

const toggle = vi.hoisted(() => ({ active: false, setEnabled: vi.fn(async () => true) }));
vi.mock("@/hooks/use-notification-toggle", () => ({
  useNotificationToggle: () => toggle,
}));

const BASIC_INFO = `${API}/users/update/basic-info`;
let patches: Record<string, unknown>[];

beforeEach(() => {
  patches = [];
  toggle.active = false;
  useUserStore.setState({
    user: { ...testUser, lang: "en", timezone: "Asia/Ho_Chi_Minh", defaultReminderMinutes: 10 } as never,
    loading: false,
  });
  server.use(
    http.patch(BASIC_INFO, async ({ request }) => {
      const body = (await request.json()) as Record<string, unknown>;
      patches.push(body);
      return HttpResponse.json({ data: { ...testUser, ...body } });
    }),
  );
});

describe("PreferencesSection", () => {
  it("shows the account's language, timezone and default reminder", async () => {
    renderScreen(<PreferencesSection />);
    expect(await screen.findByText("🇬🇧 English")).toBeTruthy();
    expect(screen.getByText("Asia/Ho_Chi_Minh")).toBeTruthy();
    expect(screen.getByText("10 min before")).toBeTruthy();
  });

  it("saves a new default reminder", async () => {
    renderScreen(<PreferencesSection />);
    await screen.findByText("10 min before");
    fireEvent.click(screen.getByText("Default reminder", { selector: "div" }));
    fireEvent.click(await screen.findByText("5 min before"));
    await waitFor(() => expect(patches).toEqual([{ defaultReminderMinutes: 5 }]));
    await waitFor(() => expect(screen.getAllByText("5 min before").length).toBeGreaterThan(0));
  });

  it("saves a new language", async () => {
    renderScreen(<PreferencesSection />);
    await screen.findByText("🇬🇧 English");
    fireEvent.click(screen.getByText("Language", { selector: "div" }));
    fireEvent.click(await screen.findByText("Tiếng Việt"));
    await waitFor(() => expect(patches).toEqual([{ lang: "vi" }]));
  });

  it("rolls the row back and toasts when saving fails", async () => {
    server.use(http.patch(BASIC_INFO, () => HttpResponse.json({ message: "no" }, { status: 500 })));
    renderScreen(<PreferencesSection />);
    await screen.findByText("10 min before");
    fireEvent.click(screen.getByText("Default reminder", { selector: "div" }));
    fireEvent.click(await screen.findByText("5 min before"));
    await waitFor(() =>
      expect(screen.getAllByText("Couldn't save preference").length).toBeGreaterThan(0),
    );
    expect(screen.getByText("10 min before")).toBeTruthy();
  });

  it("turns notifications on through the shared toggle", async () => {
    renderScreen(<PreferencesSection />);
    const sw = await screen.findByRole("switch");
    expect(sw.getAttribute("aria-checked")).toBe("false");
    fireEvent.click(sw);
    await waitFor(() => expect(toggle.setEnabled).toHaveBeenCalledWith(true));
  });

  it("reflects active notifications and turns them off", async () => {
    toggle.active = true;
    renderScreen(<PreferencesSection />);
    const sw = await screen.findByRole("switch");
    expect(sw.getAttribute("aria-checked")).toBe("true");
    fireEvent.click(sw);
    await waitFor(() => expect(toggle.setEnabled).toHaveBeenCalledWith(false));
  });
});
