import path from "node:path";
import { defineConfig } from "vitest/config";

/**
 * Component/integration layer of the mobile test pyramid. Screens render
 * through `react-native-web` (already a dependency) in jsdom, with the API
 * mocked at the HTTP level by MSW. Native modules are stubbed in
 * `test/setup.component.tsx`. See `docs/mobile/testing.md`.
 */
export default defineConfig({
  resolve: {
    alias: [
      { find: /^react-native$/, replacement: "react-native-web" },
      { find: /^nativewind$/, replacement: path.resolve(__dirname, "test/mocks/nativewind.ts") },
      { find: /^react-native-svg$/, replacement: path.resolve(__dirname, "test/mocks/svg.tsx") },
      { find: /^lucide-react-native$/, replacement: path.resolve(__dirname, "test/mocks/icons.tsx") },
      { find: /^phosphor-react-native$/, replacement: path.resolve(__dirname, "test/mocks/icons.tsx") },
      { find: /^react-native-mmkv$/, replacement: path.resolve(__dirname, "test/mocks/mmkv.ts") },
      { find: /^(expo-linear-gradient|expo-haptics|expo)$/, replacement: path.resolve(__dirname, "test/mocks/expo-simple.tsx") },
      { find: /^react-native-gesture-handler$/, replacement: path.resolve(__dirname, "test/mocks/gesture-handler.tsx") },
      { find: /^expo-router$/, replacement: path.resolve(__dirname, "test/mocks/expo-router.ts") },
      { find: /^@react-native-async-storage\/async-storage$/, replacement: path.resolve(__dirname, "test/mocks/async-storage.ts") },
      { find: /^expo-blur$/, replacement: path.resolve(__dirname, "test/mocks/expo-blur.tsx") },
      { find: /^react-native-reanimated$/, replacement: path.resolve(__dirname, "test/mocks/reanimated.tsx") },
      { find: /^react-native-screens$/, replacement: path.resolve(__dirname, "test/mocks/screens.tsx") },
      { find: /^@react-native-community\/datetimepicker$/, replacement: path.resolve(__dirname, "test/mocks/datetimepicker.tsx") },
      { find: /^react-native-webview$/, replacement: path.resolve(__dirname, "test/mocks/webview.tsx") },
      { find: /^expo-file-system$/, replacement: path.resolve(__dirname, "test/mocks/expo-file-system.ts") },
      { find: /^react-native-gesture-handler\/ReanimatedSwipeable$/, replacement: path.resolve(__dirname, "test/mocks/swipeable.tsx") },
      { find: /^expo-notifications$/, replacement: path.resolve(__dirname, "test/mocks/expo-notifications.ts") },
      { find: /^expo-device$/, replacement: path.resolve(__dirname, "test/mocks/expo-device.ts") },
      { find: /^@\//, replacement: `${path.resolve(__dirname)}/` },
    ],
  },
  define: { __DEV__: "true" },
  esbuild: { jsx: "automatic" },
  test: {
    // Not under app/: expo-router would treat test files there as routes.
    include: ["test/**/*.test.tsx"],
    environment: "happy-dom",
    // Same origin as the mocked API so happy-dom's XHR skips CORS preflight.
    environmentOptions: { happyDOM: { url: "http://api.test" } },
    setupFiles: ["./vitest.setup.ts", "./test/setup.component.tsx"],
    env: { EXPO_PUBLIC_API_URL: "http://api.test" },
    css: false,
    server: { deps: { inline: [/react-native/, /nativewind/, /lucide-react-native/, /phosphor-react-native/] } },
  },
});
