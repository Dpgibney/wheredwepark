const {
  withDangerousMod,
  withXcodeProject,
  withInfoPlist,
} = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

// Swift sources for the "Park Car" App Intent. They MUST compile into the main app
// target (an AppShortcutsProvider in a framework/pod is silently never registered),
// which is why this is a config plugin rather than a local Expo module.
const SWIFT_FILES = [
  'ParkConfig.swift',
  'ParkKeychain.swift',
  'ParkNotifications.swift',
  'LocationOneShot.swift',
  'SupabaseParkClient.swift',
  'CarAppEntity.swift',
  'ParkCarIntent.swift',
  'ParkCarShortcuts.swift',
];

const GROUP_NAME = 'ParkIntent';
const IOS_DEPLOYMENT_TARGET = '16.0';

// 1. Copy the Swift sources into ios/ParkIntent/ on every prebuild.
function withCopiedSwiftSources(config) {
  return withDangerousMod(config, [
    'ios',
    async (cfg) => {
      const srcDir = path.join(cfg.modRequest.projectRoot, 'plugins', 'with-park-intent', 'swift');
      const destDir = path.join(cfg.modRequest.platformProjectRoot, GROUP_NAME);
      fs.mkdirSync(destDir, { recursive: true });
      for (const file of SWIFT_FILES) {
        fs.copyFileSync(path.join(srcDir, file), path.join(destDir, file));
      }
      return cfg;
    },
  ]);
}

// 2. Add the sources to the main target's Compile Sources and force iOS 16 on it.
function withSourcesInMainTarget(config) {
  return withXcodeProject(config, (cfg) => {
    const project = cfg.modResults;
    const target = project.getFirstTarget().uuid;

    // Idempotent: if the group already exists (re-run prebuild), skip re-adding.
    if (!project.pbxGroupByName(GROUP_NAME)) {
      const group = project.addPbxGroup([], GROUP_NAME, GROUP_NAME);
      const mainGroup = project.getFirstProject().firstProject.mainGroup;
      project.addToPbxGroup(group.uuid, mainGroup);
      for (const file of SWIFT_FILES) {
        // File path is relative to the group (which has path "ParkIntent"),
        // so pass the basename only -> resolves to ios/ParkIntent/<file>.
        project.addSourceFile(file, { target }, group.uuid);
      }
    }

    // App Intents fail to *execute* if the target deploys to iOS < 16, so pin it
    // directly on the app target (expo-build-properties only reliably updates pods).
    const configurations = project.pbxXCBuildConfigurationSection();
    for (const key of Object.keys(configurations)) {
      const buildSettings = configurations[key].buildSettings;
      if (buildSettings && buildSettings.PRODUCT_NAME && buildSettings.IPHONEOS_DEPLOYMENT_TARGET) {
        buildSettings.IPHONEOS_DEPLOYMENT_TARGET = IOS_DEPLOYMENT_TARGET;
      }
    }

    return cfg;
  });
}

// 3. Allow background location so the intent can get a fix while locked.
function withLocationBackgroundMode(config) {
  return withInfoPlist(config, (cfg) => {
    const modes = cfg.modResults.UIBackgroundModes ?? [];
    if (!modes.includes('location')) {
      modes.push('location');
    }
    cfg.modResults.UIBackgroundModes = modes;
    return cfg;
  });
}

module.exports = function withParkIntent(config) {
  config = withCopiedSwiftSources(config);
  config = withSourcesInMainTarget(config);
  config = withLocationBackgroundMode(config);
  return config;
};
