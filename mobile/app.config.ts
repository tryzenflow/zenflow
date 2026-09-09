import { existsSync } from "node:fs";
import type { ConfigContext, ExpoConfig } from "@expo/config";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const withAndroidBuildFixes = require("./plugins/withAndroidBuildFixes");

// FCM (Android push) needs the Firebase Android app config baked into the
// native build. Drop `google-services.json` (from the Firebase console) next
// to this file; until then Android push is simply inert and the build still
// works. iOS/APNs needs no analogous file — just the push entitlement the
// `expo-notifications` plugin adds.
const googleServicesFile = existsSync("./google-services.json")
  ? "./google-services.json"
  : undefined;

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: "Zenflow",
  slug: "zenflow",
  newArchEnabled: false,
  version: "0.1.0",
  orientation: "portrait",
  icon: "./assets/images/icon.png",
  scheme: "zenflow",
  userInterfaceStyle: "automatic",
  runtimeVersion: {
    policy: "appVersion",
  },
  splash: {
    image: "./assets/images/splash.png",
    resizeMode: "contain",
    backgroundColor: "#ffffff",
  },
  assetBundlePatterns: ["**/*"],
  ios: {
    supportsTablet: false,
    bundleIdentifier: "com.zenflow.app",
  },
  android: {
    adaptiveIcon: {
      foregroundImage: "./assets/images/adaptive-icon.png",
      backgroundColor: "#ffffff",
    },
    package: "com.zenflow.app",
    ...(googleServicesFile ? { googleServicesFile } : {}),
    // Resize the visible window when the keyboard opens instead of the
    // default pan behavior — required for `KeyboardAvoidingView`
    // (`SessionFormScreen`) to work; without this the fixed footer + focused
    // input near the bottom of the task form scroll can end up hidden under
    // the keyboard on Android (mirrors the `android_keyboardInputMode`
    // already passed to `BottomSheetModal` for the tag picker's own sheet).
    softwareKeyboardLayoutMode: "resize",
  },
  web: {
    bundler: "metro",
    output: "single",
    favicon: "./assets/images/favicon.png",
  },
  plugins: [
    ["expo-router"],
    "@react-native-community/datetimepicker",
    // Adds the iOS push entitlement (`aps-environment`) + the Android
    // notification permission / channel wiring. Raw FCM/APNs tokens come from
    // `Notifications.getDevicePushTokenAsync()` (see `lib/push.ts`).
    "expo-notifications",
    withAndroidBuildFixes,
  ],
  experiments: {
    typedRoutes: true,
  },
  extra: {
    eas: {
      projectId: "",
    },
  },
  owner: "*",
});
