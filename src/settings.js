'use strict';

/** Must match the `platform` value in config.json. */
const PLATFORM_NAME = 'SonosControlPro';

/**
 * Aliases this plugin has shipped under before. Still registered, so an
 * existing config.json keeps working without being edited.
 */
const LEGACY_PLATFORM_NAMES = ['SonosControl', 'SonosFlows'];

/**
 * Must match the npm package name.
 *
 * The plain `homebridge-sonos-control` name belongs to somebody else's plugin
 * on npm. Sharing it would make Homebridge UI offer "updates" that quietly
 * replace this plugin with a different one, so the name has to stay distinct.
 */
const PLUGIN_NAME = 'homebridge-sonos-control-pro';

/** Package names this plugin used to have, and which must not linger. */
const SUPERSEDED_PACKAGES = ['homebridge-sonos-control', 'homebridge-sonos-flows'];

/**
 * Namespace for HomeKit accessory UUIDs.
 *
 * Deliberately *not* the package name: renaming the package must not change
 * the identity of switches that already exist in Apple Home.
 */
const ACCESSORY_NAMESPACE = 'homebridge-sonos-control';

/** Sub-directory inside the Homebridge storage path where we keep our state. */
const STATE_DIR = 'sonos-control-pro';

/** Where state lived under earlier names; migrated on first start, newest first. */
const LEGACY_STATE_DIRS = ['sonos-control', 'sonos-flows'];

/** File holding every scene the user has defined. */
const SCENES_FILE = 'scenes.json';

/** File the plugin writes so the custom UI can find the running control API. */
const RUNTIME_FILE = 'runtime.json';

/** Directory holding automatic backups of scenes.json. */
const BACKUP_DIR = 'backups';

/** Current schema version of scenes.json. Bump when the shape changes. */
const SCHEMA_VERSION = 1;

module.exports = {
  PLATFORM_NAME,
  LEGACY_PLATFORM_NAMES,
  PLUGIN_NAME,
  SUPERSEDED_PACKAGES,
  ACCESSORY_NAMESPACE,
  STATE_DIR,
  LEGACY_STATE_DIRS,
  SCENES_FILE,
  RUNTIME_FILE,
  BACKUP_DIR,
  SCHEMA_VERSION,
};
