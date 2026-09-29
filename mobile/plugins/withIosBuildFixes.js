const { withPodfile } = require("@expo/config-plugins");

// NOTE: this file used to also carry `withIosNoSceneManifest`, a workaround
// for a "No Scene Lifecycle Adoption" SIGTRAP on standalone launch (Xcode's
// debugger just warned; a bare Home Screen tap or `devicectl launch` crashed
// before JS loaded). That was needed because SDK 52's generated AppDelegate
// had no UIScene support at all -- it wrote a minimal
// `UIApplicationSceneManifest` with only `UIApplicationSupportsMultipleScenes:
// false` and no `UISceneConfigurations`, to opt out of the check entirely.
//
// SDK 58's own template now ships a real `SceneDelegate.swift` (required by
// the iOS 27 SDK -- see `ios/*/AppDelegate.swift`'s comment) and generates a
// complete `UIApplicationSceneManifest` + `UISceneConfigurations` block
// wiring it up out of the box. Re-applying the old override would strip that
// `UISceneConfigurations` entry back out and break scene delegation again --
// so it's dropped here rather than carried forward. Do not re-add it without
// re-checking the generated Info.plist first.

// CocoaPods generates a resource-bundle target for pods that ship resources
// (e.g. RNCAsyncStorage-RNCAsyncStorage_resources) with a hardcoded
// IPHONEOS_DEPLOYMENT_TARGET of 9.0, ignoring the `platform :ios, ...` line
// and the deployment target Expo's `react_native_post_install` sets on the
// *pod* targets themselves. Xcode 26+'s SDK only supports 15.0+, so building
// fails with "the range of supported deployment target versions is 15.0 to
// ...x" on those resource-bundle targets specifically. Clamp every target's
// (not just pods') deployment target up to the Podfile's own minimum.
//
// Separately, the `fmt` pod (11.0.2, pulled in transitively by RCT-Folly)
// only disables its `consteval`-based compile-time format-string checking
// for Apple Clang versions below 14 (see fmt/base.h: "consteval is broken in
// Apple clang < 14"). Xcode 26/27's much newer Clang has its own regression
// in the same area that fmt's version check doesn't know about, so
// `fmt::format_to(..., FMT_STRING(...), ...)` fails to compile with "call to
// consteval function ... is not a constant expression". A `-DFMT_USE_CONSTEVAL=0`
// preprocessor define does NOT fix this: base.h defines that macro itself,
// unconditionally, inside a plain #if/#elif chain (no #ifndef guard), so its
// own `#define FMT_USE_CONSTEVAL 1` always wins over anything passed on the
// command line (silently, past just a "macro redefinition" compiler note).
// The only way to actually disable it is to patch the version check in the
// vendored header so it also treats this Clang as broken.
//
// As of RN 0.88 (SDK 58) this branch is believed dead in practice: RN now
// ships Folly/fmt (fmt bumped to 12.1.0) prebuilt inside a binary
// `ReactNativeDependencies.xcframework` (see `RCT_USE_PREBUILT_RNCORE` /
// `EXPO_USE_PRECOMPILED_MODULES` in ios/Podfile) instead of compiling fmt
// from source per-project -- confirmed there is no `ios/Pods/fmt/` directory
// post-`pod install` for `fmt: {path: build/rndeps-facades/fmt}` to patch,
// only headers re-exported from the prebuilt xcframework. Whoever built that
// artifact already compiled it successfully against some Clang, so the bug
// this works around isn't reachable through the normal build path anymore.
// Kept (guarded by the `File.exist?` check below, so it's a no-op) rather
// than deleted, in case a `ios.buildReactNativeFromSource: true` Podfile
// property or a future SDK reverts to source-built Folly/fmt.
// Anchored on the `post_install do |installer|` line itself rather than any
// text inside RN's template body -- that body has changed shape across SDK
// bumps (the Xcode-14 resource-bundle-signing comment this used to anchor on
// is gone as of the RN 0.88 template) and a stale anchor fails *silently*
// here (String#replace returns the input unchanged on no match, and
// `withPodfile` has no way to detect that), so prefer the anchor least
// likely to move. Runs before `react_native_post_install` on purpose: it
// only raises deployment targets that are already below the Podfile's own
// minimum, so ordering relative to RN's own post-install pass doesn't matter.
const BUILD_FIXES_ANCHOR = "post_install do |installer|";
const BUILD_FIXES = `${BUILD_FIXES_ANCHOR}
    # See withIosBuildFixes.js.
    installer.pods_project.targets.each do |target|
      target.build_configurations.each do |config|
        deployment_target = config.build_settings['IPHONEOS_DEPLOYMENT_TARGET']
        if deployment_target && Gem::Version.new(deployment_target) < Gem::Version.new(min_ios_version_supported)
          config.build_settings['IPHONEOS_DEPLOYMENT_TARGET'] = min_ios_version_supported
        end
      end
    end

    fmt_base_header = File.join(installer.sandbox.root, 'fmt/include/fmt/base.h')
    if File.exist?(fmt_base_header)
      contents = File.read(fmt_base_header)
      patched = contents.sub(/__apple_build_version__ < \\d+L/, '__apple_build_version__ < 99999999L')
      File.write(fmt_base_header, patched) if patched != contents
    end
`;

function withIosPodsBuildFixes(config) {
  return withPodfile(config, (config) => {
    if (!config.modResults.contents.includes("withIosBuildFixes.js")) {
      if (!config.modResults.contents.includes(BUILD_FIXES_ANCHOR)) {
        // Fail loudly instead of the silent no-op this bit us with once
        // already (String#replace on a missing anchor just returns the
        // input unchanged) -- a future RN/Expo template bump that renames
        // `post_install do |installer|` needs a human to re-anchor this.
        throw new Error(
          "withIosBuildFixes: Podfile anchor not found (expected a " +
            `"${BUILD_FIXES_ANCHOR}" block) -- the RN/Expo Podfile template ` +
            "shape changed again; update plugins/withIosBuildFixes.js.",
        );
      }
      config.modResults.contents = config.modResults.contents.replace(
        BUILD_FIXES_ANCHOR,
        BUILD_FIXES,
      );
    }
    return config;
  });
}

module.exports = function withIosBuildFixes(config) {
  config = withIosPodsBuildFixes(config);
  return config;
};
