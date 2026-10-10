import axios from "axios";
import { cleanup, configure } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, vi } from "vitest";
import { setLanguage } from "@/lib/i18n";
import { server } from "./msw/server";

// Module-level schemas (zod) snapshot their messages at import; the app
// defaults to Vietnamese, so switch before any screen module loads.
setLanguage("en");
// Screens settle through real HTTP round-trips to MSW; leave headroom for a loaded CI runner.
configure({ asyncUtilTimeout: 4000 });
// Node http adapter: no CORS/XHR emulation involved, MSW intercepts it directly.
axios.defaults.adapter = "http";

vi.mock("expo-secure-store", () => ({
  getItemAsync: vi.fn(async () => null),
  setItemAsync: vi.fn(async () => {}),
  deleteItemAsync: vi.fn(async () => {}),
}));
vi.mock("expo-constants", () => ({ default: { expoConfig: {} } }));
vi.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
  SafeAreaProvider: ({ children }: { children: unknown }) => children,
}));

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  server.resetHandlers();
});
afterAll(() => server.close());
