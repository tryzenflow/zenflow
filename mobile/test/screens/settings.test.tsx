import { fireEvent, screen, waitFor } from "@testing-library/react";
import { router } from "expo-router";
import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useUserStore } from "@/hooks/use-user-store";
import { API, testUser } from "@/test/msw/handlers";
import { server } from "@/test/msw/server";
import { renderScreen } from "@/test/utils/render";
import SettingsScreen from "@/app/(app)/settings";

// Heavy sections with their own coverage/ownership — not under test here.
vi.mock("@/components/settings/dlu-accounts-section", () => ({ DluAccountsSection: () => null }));
vi.mock("@/components/settings/finish-setup-card", () => ({ FinishSetupCard: () => null }));
vi.mock("@/components/settings/tags-row", () => ({ TagsRow: () => null }));
vi.mock("@/components/settings/preferences-section", () => ({ PreferencesSection: () => null }));
vi.mock("@/components/settings/profile-row", () => ({ ProfileRow: () => null }));
vi.mock("@/hooks/use-notification-toggle", () => ({
  useNotificationToggle: () => ({ ready: false, active: false, setEnabled: vi.fn() }),
}));
vi.mock("@/hooks/use-push-status-store", () => ({
  usePushStatusStore: { getState: () => ({ unregisterOnLogout: vi.fn(async () => {}) }) },
}));
vi.mock("@/lib/tab-bar-metrics", () => ({ useTabBarOverlayHeight: () => 0 }));
vi.mock("@/lib/android-navigation-bar", () => ({ setAndroidNavigationBar: vi.fn() }));

beforeEach(() => {
  useUserStore.setState({ user: testUser as never, loading: false });
});

describe("SettingsScreen sign out", () => {
  it("calls the logout endpoint, clears the user and goes to login", async () => {
    let logoutCalls = 0;
    server.use(
      http.post(`${API}/auth/logout`, () => {
        logoutCalls++;
        return HttpResponse.json({ ok: true });
      }),
    );
    renderScreen(<SettingsScreen />);
    fireEvent.click(screen.getByTestId("settings.sign-out"));
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/(auth)/login"));
    expect(logoutCalls).toBe(1);
    expect(useUserStore.getState().user).toBeNull();
  });

  it("still signs out locally when the logout request fails", async () => {
    server.use(http.post(`${API}/auth/logout`, () => HttpResponse.error()));
    renderScreen(<SettingsScreen />);
    fireEvent.click(screen.getByTestId("settings.sign-out"));
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/(auth)/login"));
    expect(useUserStore.getState().user).toBeNull();
  });
});
