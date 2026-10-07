import { existsSync } from "node:fs";
import type { ConfigContext, ExpoConfig } from "@expo/config";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const withAndroidBuildFixes = require("./plugins/withAndroidBuildFixes");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const withIosBuildFixes = require("./plugins/withIosBuildFixes");

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
  // NOTE: `newArchEnabled` was dropped here (and from `ExpoConfig`'s type
  // entirely -- `tsc` fails with TS2353 if it's left in) as of SDK 58: the
  // legacy/bridge architecture was removed from the RN 0.88 toolchain, and
  // `expo`'s own native `ExpoReactNativeFactory.swift` now hardcodes
  // `newArchEnabled: true` unconditionally (`react-native-reanimated@4.x`,
  // pulled in by `expo install --fix` for this SDK, requires Fabric/
  // TurboModules too, so this isn't optional even in principle anymore). The
  // app runs on the New Architecture unconditionally now -- flag any
  // native-module behavior anywhere in the app that assumed the old one.
  version: "0.1.0",
  orientation: "portrait",
  icon: "./assets/images/icon.png",
  scheme: "zenflow",
  userInterfaceStyle: "automatic",
  runtimeVersion: {
    policy: "appVersion",
  },
  // NOTE: the top-level `splash` field (native splash) was removed from
  // `ExpoConfig`'s type in SDK 58 -- it's been superseded by the
  // `expo-splash-screen` config plugin (see `plugins` below) for a while,
  // but the old field was still tolerated by the type until now.
  assetBundlePatterns: ["**/*"],
  ios: {
    supportsTablet: false,
    // App identifiers are globally unique across every Apple developer
    // account, not just your own -- "com.zenflow.app" is already registered
    // to someone else, so a personal team can never claim it (Xcode fails
    // with "cannot be registered ... because it is not available"). Local
    // personal-team device builds need their own throwaway identifier;
    // override it via EXPO_IOS_BUNDLE_ID (e.g. "com.<your-name>.zenflowdev").
    bundleIdentifier: process.env.EXPO_IOS_BUNDLE_ID ?? "com.zenflow.app",
    // Only set for local personal-team device builds -- see the
    // `ios:personal-team` package.json script. Not committed anywhere else
    // since a development team is specific to one developer's Apple ID.
    ...(process.env.EXPO_APPLE_TEAM_ID
      ? { appleTeamId: process.env.EXPO_APPLE_TEAM_ID }
      : {}),
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
    // SDK 58 requires these autolinked packages' config plugins to be listed
    // explicitly (previously implicit) -- `expo install --fix` /
    // `expo-doctor` flagged this after the SDK 52 -> 58 jump.
    "expo-asset",
    "expo-font",
    "expo-secure-store",
    [
      "expo-image-picker",
      {
        photosPermission: "Allow Zenflow to attach photos to your tasks",
        // Camera/microphone are never used (library picker only).
        cameraPermission: false,
        microphonePermission: false,
      },
    ],
    [
      "expo-splash-screen",
      {
        image: "./assets/images/splash.png",
        resizeMode: "contain",
        backgroundColor: "#ffffff",
      },
    ],
    "expo-status-bar",
    "expo-web-browser",
    withAndroidBuildFixes,
    withIosBuildFixes,
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
