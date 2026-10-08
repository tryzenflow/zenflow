const { withAndroidManifest } = require("@expo/config-plugins");

// E2E/CI builds talk to a plain-HTTP API on the emulator host (10.0.2.2).
// Android release builds block cleartext by default, so this is opt-in via
// ZENFLOW_E2E=1 and never applied to real release builds.
module.exports = (config) => {
  if (process.env.ZENFLOW_E2E !== "1") return config;
  return withAndroidManifest(config, (config) => {
    const app = config.modResults.manifest.application?.[0];
    if (app) app.$["android:usesCleartextTraffic"] = "true";
    return config;
  });
};
