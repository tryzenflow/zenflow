import axios from "axios";
import { resetNavLock } from "@/lib/nav";
import { act, cleanup, configure, getConfig } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, vi } from "vitest";
import { setLanguage } from "@/lib/i18n";
import { server } from "./msw/server";

// Module-level schemas (zod) snapshot their messages at import; the app
// defaults to Vietnamese, so switch before any screen module loads.
setLanguage("en");
// Screens settle through real HTTP round-trips to MSW; leave headroom for a loaded CI runner.
// react-native-web's Pressable applies its latest onPress/disabled in a passive effect, so a click
// fired right after a screen change can hit the previous step's stale handler and be dropped (flaky
// under CPU load). Flush pending effects when every findBy*/waitFor resolves, before the next click.
const { asyncWrapper } = getConfig();
configure({
  asyncUtilTimeout: 4000,
  asyncWrapper: async (cb) => {
    const result = await asyncWrapper(cb);
    await act(async () => {});
    return result;
  },
});
// Node http adapter: no CORS/XHR emulation involved, MSW intercepts it directly.
axios.defaults.adapter = "http";

vi.mock("expo-secure-store", () => ({
  getItemAsync: vi.fn(async () => null),
  setItemAsync: vi.fn(async () => {}),
  deleteItemAsync: vi.fn(async () => {}),
}));
vi.mock("expo-constants", () => ({ default: { expoConfig: {} } }));
// Reads a bundled font through expo-asset, which has no native module here.
vi.mock("@/lib/geist-webview-font", () => ({
  loadGeistWebviewFontDataUri: async () => "",
}));
vi.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
  SafeAreaProvider: ({ children }: { children: unknown }) => children,
}));

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  resetNavLock();
  server.resetHandlers();
});
afterAll(() => server.close());
