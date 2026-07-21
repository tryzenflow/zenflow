import type { ConfigContext, ExpoConfig } from "@expo/config";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const withAndroidBuildFixes = require("./plugins/withAndroidBuildFixes");

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: "Zenflow",
  slug: "zenflow",
  newArchEnabled: true,
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
  },
  web: {
    bundler: "metro",
    output: "single",
    favicon: "./assets/images/favicon.png",
  },
  plugins: [["expo-router"], withAndroidBuildFixes],
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
