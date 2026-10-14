const {
  withProjectBuildGradle,
  withAppBuildGradle,
  withGradleProperties,
} = require("@expo/config-plugins");

// The React Native Gradle Plugin unconditionally adds
// https://oss.sonatype.org/content/repositories/snapshots/ to every project's repositories
// ("for users on nightlies" - see DependencyUtils.configureRepositories in
// @react-native/gradle-plugin), from an afterEvaluate hook on the app project. That host is
// frequently unreachable (504s), and unlike a 404, a network failure there aborts dependency
// resolution instead of falling through to mavenCentral. There's no opt-out property, so once
// all projects finish evaluating we drop that repository, which makes Gradle skip it entirely.
const SONATYPE_SNAPSHOT_FIX = `
gradle.projectsEvaluated {
    allprojects {
        repositories.removeAll { repo ->
            repo instanceof org.gradle.api.artifacts.repositories.MavenArtifactRepository &&
                repo.url.toString().contains('oss.sonatype.org/content/repositories/snapshots')
        }
    }
}
`;

function withSonatypeSnapshotFix(config) {
  return withProjectBuildGradle(config, (config) => {
    if (config.modResults.language !== "groovy") {
      throw new Error(
        "withSonatypeSnapshotFix only supports Groovy android/build.gradle files",
      );
    }
    if (!config.modResults.contents.includes("oss.sonatype.org")) {
      config.modResults.contents += SONATYPE_SNAPSHOT_FIX;
    }
    return config;
  });
}

// android/build.gradle's `ext.kotlinVersion` (default supplied by the current Expo prebuild
// template) is just a string used to look up expo-modules-core's Compose Compiler version - it
// does NOT control the Kotlin Gradle Plugin version actually applied to compile the project.
// That's pinned separately by react-native's own gradle/libs.versions.toml (our root buildscript
// classpath declares `kotlin-gradle-plugin` with no version, so it inherits RN's transitive pin).
// If the two drift apart, expo-modules-core selects a Compose Compiler for one Kotlin version
// while the project actually compiles with another, and the build fails with a Compose/Kotlin
// version-compatibility error. Pin `android.kotlinVersion` to RN's real version so the two stay
// in lockstep. RN 0.76.9 pins Kotlin 1.9.25 (see
// node_modules/@react-native/gradle-plugin/gradle/libs.versions.toml); keep this in sync when
// bumping react-native.
const REACT_NATIVE_KOTLIN_VERSION = "1.9.25";

function withKotlinVersionPin(config) {
  return withGradleProperties(config, (config) => {
    config.modResults = config.modResults.filter(
      (item) =>
        !(item.type === "property" && (item.key === "android.kotlinVersion" || item.key === "android.minSdkVersion")),
    );
    config.modResults.push({
      type: "property",
      key: "android.kotlinVersion",
      value: REACT_NATIVE_KOTLIN_VERSION,
    });
    config.modResults.push({
      type: "property",
      key: "android.minSdkVersion",
      value: "24",
    });
    return config;
  });
}

// The Expo template signs release builds with the shared debug keystore, so every APK carries a
// key anyone can reproduce, and Android refuses to update over an app signed with a different
// key. When ANDROID_KEYSTORE_PATH is set (CI release builds) the release build type signs with
// that keystore; without it (PR builds, e2e, local) it keeps the debug key so builds still work.
const RELEASE_SIGNING_CONFIG = `
        release {
            if (System.getenv('ANDROID_KEYSTORE_PATH')) {
                storeFile file(System.getenv('ANDROID_KEYSTORE_PATH'))
                storePassword System.getenv('ANDROID_KEYSTORE_PASSWORD')
                keyAlias System.getenv('ANDROID_KEY_ALIAS')
                keyPassword System.getenv('ANDROID_KEY_PASSWORD')
            }
        }`;

function withReleaseSigning(config) {
  return withAppBuildGradle(config, (config) => {
    let src = config.modResults.contents;
    if (src.includes("ANDROID_KEYSTORE_PATH")) return config;
    const debugBlock = /(signingConfigs \{\s*debug \{[^}]*\})/;
    const releaseUse =
      /(release \{\s*\/\/ Caution![^\n]*\n\s*\/\/ see[^\n]*\n\s*)signingConfig signingConfigs\.debug/;
    if (!debugBlock.test(src) || !releaseUse.test(src)) {
      throw new Error(
        "withReleaseSigning: android/app/build.gradle no longer matches the Expo template",
      );
    }
    src = src
      .replace(debugBlock, `$1${RELEASE_SIGNING_CONFIG}`)
      .replace(
        releaseUse,
        "$1signingConfig System.getenv('ANDROID_KEYSTORE_PATH') ? signingConfigs.release : signingConfigs.debug",
      );
    config.modResults.contents = src;
    return config;
  });
}

module.exports = function withAndroidBuildFixes(config) {
  config = withReleaseSigning(config);
  config = withSonatypeSnapshotFix(config);
  config = withKotlinVersionPin(config);
  return config;
};
