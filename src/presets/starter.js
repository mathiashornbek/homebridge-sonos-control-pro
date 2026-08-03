'use strict';

const { t } = require('../i18n');

/**
 * The four scenes almost every household ends up wanting.
 *
 * Deliberately not a list of room names: a preset that hard-codes rooms is
 * useless in anyone else's house. This one describes *shapes* — "everyone",
 * "everyone that is playing" — and the one value it genuinely cannot guess,
 * which speaker leads the group, is filled in from the household at the moment
 * it is applied. Load it into an empty install and all four scenes work.
 *
 * Everything it creates is ordinary data, so it can be edited, reordered and
 * deleted like any hand-built scene. It is a starting point, not a template
 * you are tied to.
 */

const ID = 'starter';

function step(action, extra = {}) {
  return {
    action,
    enabled: true,
    delayMs: 0,
    target: { type: 'all', names: [], coordinator: '', filter: 'any' },
    params: {},
    ...extra,
  };
}

function scene(name, description, icon, steps, autoOffMs = 1000) {
  return {
    name,
    description,
    icon,
    enabled: true,
    switchType: 'momentary',
    autoOffMs,
    mode: 'parallel',
    condition: { type: 'always', params: {} },
    steps,
    elseSteps: [],
    offSteps: [],
  };
}

/** Built fresh on every read, so the names follow the chosen language. */
function buildScenes() {
  return [
    scene(
      t('preset.starter.musicEverywhere'),
      t('preset.starter.musicEverywhereHelp'),
      'music',
      [
        step('groupAndPlay', {
          params: {
            // Filled in by hydrate() from the household that is actually there.
            coordinator: '',
            source: { type: 'keep', value: '' },
            membersMode: 'all',
            leave: [],
            members: [],
            volumes: {},
            defaultVolume: 15,
            timing: 'auto',
            volumeDelayMs: 1000,
            groupDelayMs: 2000,
            modeDelayMs: 3000,
            shuffle: null,
            repeat: null,
            crossfade: null,
            startPlaying: true,
          },
        }),
      ],
    ),

    scene(t('preset.starter.pauseAll'), t('preset.starter.pauseAllHelp'), 'pause', [
      step('pause', { target: { type: 'all', names: [], coordinator: '', filter: 'any' } }),
    ]),

    scene(
      t('preset.starter.volumeUp'),
      t('preset.starter.volumeUpHelp'),
      'volume-up',
      [
        step('adjustVolume', {
          target: { type: 'all', names: [], coordinator: '', filter: 'playing' },
          params: { delta: 5 },
        }),
      ],
      600,
    ),

    scene(
      t('preset.starter.volumeDown'),
      t('preset.starter.volumeDownHelp'),
      'volume-down',
      [
        step('adjustVolume', {
          target: { type: 'all', names: [], coordinator: '', filter: 'playing' },
          params: { delta: -5 },
        }),
      ],
      600,
    ),
  ];
}

/**
 * Fill in the one thing the preset cannot know in advance.
 *
 * The group leader has to be a speaker that exists, so it is taken from the
 * household at apply time — the first visible one, which the user can change in
 * a single click afterwards. With no speakers found yet the field is simply left
 * empty and the editor says so, which is better than inventing a room name that
 * will never resolve.
 *
 * @param {object[]} scenes  A fresh copy, safe to mutate.
 * @param {import('../sonos/system').SonosSystem} [system]
 */
function hydrate(scenes, system) {
  const first = system?.list?.()[0]?.name;
  if (!first) return scenes;
  for (const entry of scenes) {
    for (const item of entry.steps || []) {
      if (item.action === 'groupAndPlay' && !item.params.coordinator) {
        item.params.coordinator = first;
      }
    }
  }
  return scenes;
}

module.exports = {
  id: ID,
  hydrate,
  // Getters, not values: the language can change while the plugin is running.
  get name() {
    return t('preset.starter.name');
  },
  get description() {
    return t('preset.starter.description');
  },
  get scenes() {
    return buildScenes();
  },
  expectedRooms: [],
  expectedFavorites: [],
};
