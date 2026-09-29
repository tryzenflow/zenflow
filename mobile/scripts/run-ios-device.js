#!/usr/bin/env node
// Xcode 26+ merged the simulator and physical-device pickers into one
// "Device Hub" list. A bare `expo run:ios --device` (no value) either
// prompts interactively or, in a non-interactive shell, silently picks the
// first entry in that merged list -- which can be a simulator -- while still
// routing the install through the physical-device (`devicectl`) code path,
// crashing with an opaque "Error: null". Passing the device's exact UDID
// sidesteps the ambiguous auto-selection entirely. Find it once via
// `xcrun devicectl list devices` and export it as EXPO_DEVICE_UDID.
const { spawnSync } = require("node:child_process");

const args = ["run:ios", "--device"];
if (process.env.EXPO_DEVICE_UDID) {
  args.push(process.env.EXPO_DEVICE_UDID);
}

const result = spawnSync("npx", ["expo", ...args], { stdio: "inherit" });
process.exit(result.status ?? 1);
