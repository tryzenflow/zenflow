const { getDefaultConfig } = require('expo/metro-config');
const { withUniwindConfig } = require('uniwind/metro');
const path = require('path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '..');

const config = getDefaultConfig(projectRoot);

// pnpm workspace: watch the monorepo root and resolve node_modules from both
// this package and the root (pnpm hoists via symlinks, unlike npm/yarn).
config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];
config.resolver.disableHierarchicalLookup = true;
config.resolver.unstable_enableSymlinks = true;

// Package exports must stay off project-wide: Metro's package-exports
// resolution breaks expo-router's internal `expo-router/entry-classic`
// subpath alias (resolves to a 500 "Unable to resolve module" on every
// bundle request -> blank screen in Expo Go). Uniwind's own dependency
// (culori) requires it on, so scope it to just those two packages —
// see https://docs.uniwind.dev/faq (unstable_enablePackageExports conflicts).
config.resolver.unstable_enablePackageExports = false;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (['uniwind', 'culori'].some((prefix) => moduleName.startsWith(prefix))) {
    return context.resolveRequest(
      { ...context, unstable_enablePackageExports: true },
      moduleName,
      platform,
    );
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = withUniwindConfig(config, {
  // relative path to your global.css file (from previous step)
  cssEntryFile: './global.css',
  // (optional) path where we gonna auto-generate typings
  // defaults to project's root
  dtsFile: './uniwind-types.d.ts',
});
