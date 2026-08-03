'use strict';

const { PLATFORM_NAME, LEGACY_PLATFORM_NAMES, PLUGIN_NAME } = require('./src/settings');
const { SonosControlPlatform } = require('./src/platform');

/**
 * Homebridge entry point.
 *
 * Every alias this plugin has ever used is registered, so a config.json still
 * saying `"platform": "SonosControl"` or `"SonosFlows"` keeps loading without
 * the user having to edit anything.
 *
 * @param {import('homebridge').API} api
 */
module.exports = (api) => {
  api.registerPlatform(PLUGIN_NAME, PLATFORM_NAME, SonosControlPlatform);
  for (const alias of LEGACY_PLATFORM_NAMES) {
    api.registerPlatform(PLUGIN_NAME, alias, SonosControlPlatform);
  }
};
