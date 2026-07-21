const {
  withProjectBuildGradle,
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
// That's pinned separately, to 1.9.24, by react-native's own gradle/libs.versions.toml (our root
// buildscript classpath declares `kotlin-gradle-plugin` with no version, so it inherits RN's
// transitive pin). When the template's default drifts to 1.9.25 while RN stays pinned at 1.9.24,
// expo-modules-core picks Compose Compiler 1.5.15 (which requires Kotlin 1.9.25) while the
// project actually compiles with Kotlin 1.9.24, and the build fails with a Compose/Kotlin
// version-compatibility error. Pin `android.kotlinVersion` back to RN's real version so the two
// stay in lockstep.
const REACT_NATIVE_KOTLIN_VERSION = "1.9.24";

function withKotlinVersionPin(config) {
  return withGradleProperties(config, (config) => {
    config.modResults = config.modResults.filter(
      (item) => !(item.type === "property" && item.key === "android.kotlinVersion"),
    );
    config.modResults.push({
      type: "property",
      key: "android.kotlinVersion",
      value: REACT_NATIVE_KOTLIN_VERSION,
    });
    return config;
  });
}

module.exports = function withAndroidBuildFixes(config) {
  config = withSonatypeSnapshotFix(config);
  config = withKotlinVersionPin(config);
  return config;
};
