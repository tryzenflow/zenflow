import { vi } from "vitest";

/** Shared spies so tests can assert navigation: `import { router } from "expo-router"`. */
export const router = {
  push: vi.fn(),
  replace: vi.fn(),
  back: vi.fn(),
  navigate: vi.fn(),
  setParams: vi.fn(),
};
export const useRouter = () => router;
export const useLocalSearchParams = vi.fn(() => ({}));
export const useGlobalSearchParams = useLocalSearchParams;
export const usePathname = () => "/";
export const useFocusEffect = (cb: () => void) => {
  // run once like a mounted focus
  cb();
};
export const Redirect = () => null;
export const Stack = Object.assign(() => null, { Screen: () => null });
export const Tabs = Object.assign(() => null, { Screen: () => null });
export const Link = ({ children }: { children?: unknown }) => children as never;
export type Href = string;
