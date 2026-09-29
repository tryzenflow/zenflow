#!/usr/bin/env node
// Prebuild-generated ios/ can't be signed by a personal (free) Apple
// Developer team out of the box:
//
// 1. `expo-notifications` is autolinked, so Expo re-applies its iOS config
//    plugin (which writes the `aps-environment` entitlement) on every
//    `expo prebuild`, regardless of app.config.ts's `plugins` array or its
//    order -- there's no config-plugin-level way to opt out. Personal teams
//    reject signing any profile with the Push Notifications capability.
// 2. A fresh `expo prebuild` never sets `ProvisioningStyle = Automatic` on
//    the target, so xcodebuild has no certificate/profile to fall back to
//    and fails with "No code signing certificates are available to use."
//    even once `ios.appleTeamId` (set via EXPO_APPLE_TEAM_ID) puts
//    DEVELOPMENT_TEAM in place.
//
// Run this after `expo prebuild` for local device builds under a personal
// team (see the `ios:personal-team` package.json script). Paid-team builds
// (CI/TestFlight/EAS) don't need any of this.
const { existsSync, readFileSync, writeFileSync } = require("node:fs");
const { join } = require("node:path");
const plist = require("plist");
const xcode = require("xcode");

const iosDir = join(__dirname, "../ios");
const entitlementsPath = join(iosDir, "Zenflow/Zenflow.entitlements");
const pbxprojPath = join(iosDir, "Zenflow.xcodeproj/project.pbxproj");

if (!existsSync(entitlementsPath) || !existsSync(pbxprojPath)) {
  console.error(`ios/ project not found under ${iosDir} -- run "expo prebuild --platform ios" first.`);
  process.exit(1);
}

const entitlements = plist.parse(readFileSync(entitlementsPath, "utf8"));
if ("aps-environment" in entitlements) {
  delete entitlements["aps-environment"];
  writeFileSync(entitlementsPath, plist.build(entitlements));
  console.log(`Stripped aps-environment from ${entitlementsPath}`);
} else {
  console.log("aps-environment already absent, nothing to do.");
}

const project = xcode.project(pbxprojPath);
project.parseSync();
project.addTargetAttribute("ProvisioningStyle", "Automatic", project.getFirstTarget());
writeFileSync(pbxprojPath, project.writeSync());
console.log(`Set ProvisioningStyle = Automatic on the Zenflow target in ${pbxprojPath}`);
