'use strict';

const starter = require('./starter');

/**
 * Ready-made scene collections the user can load with one button.
 * A preset is just data — applying one goes through the normal store, so it can
 * be edited, reordered and deleted like anything else.
 */
const PRESETS = [starter];

function listPresets() {
  return PRESETS.map((preset) => ({
    id: preset.id,
    name: preset.name,
    description: preset.description,
    sceneCount: preset.scenes.length,
    sceneNames: preset.scenes.map((scene) => scene.name),
    expectedRooms: preset.expectedRooms || [],
    expectedFavorites: preset.expectedFavorites || [],
  }));
}

function getPreset(id) {
  return PRESETS.find((preset) => preset.id === id) || null;
}

/**
 * Check a preset against what the household actually has, so the user is told
 * about a renamed room or a deleted favourite *before* the scene misbehaves.
 *
 * @param {object} preset
 * @param {import('../sonos/system').SonosSystem} system
 */
async function validatePreset(preset, system) {
  const missingRooms = (preset.expectedRooms || []).filter((room) => !system.resolve(room));
  const missingFavorites = [];
  for (const favorite of preset.expectedFavorites || []) {
    const match = await system.findFavorite(favorite).catch(() => null);
    if (!match) missingFavorites.push(favorite);
  }
  // A preset that names no rooms is not opinionated about the household, so
  // there is nothing to call "extra".
  const extraRooms = (preset.expectedRooms || []).length
    ? system
        .list()
        .map((player) => player.name)
        .filter((name) => !preset.expectedRooms.includes(name))
    : [];
  return { missingRooms, missingFavorites, extraRooms };
}

module.exports = { PRESETS, listPresets, getPreset, validatePreset };
