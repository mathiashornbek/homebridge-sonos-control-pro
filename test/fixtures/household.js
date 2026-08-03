'use strict';

/**
 * A made-up fourteen-room household, used by every test that needs a real one.
 *
 * The shape matters, not the names: one room that leads the group, two that are
 * regularly told to stay out, a mix of quiet and loud levels, and a favourite of
 * each kind (a stream, a container, and one only some scenes use). Tests assert
 * on *behaviour* — who joined, who was skipped, what the log said — so the names
 * are deliberately dull.
 */

const LEADER = 'Kitchen';

const ROOMS = [
  'Kitchen',
  'Pantry',
  'Dining Room',
  'Living Room',
  'Upstairs Lounge',
  'Study',
  'Upstairs Bath',
  'Bathroom',
  'Utility Room',
  'Guest Room',
  'Dressing Room',
  'Playroom',
  'Bedroom',
  'Garage',
];

const FAVORITES = [
  { title: 'City Radio', description: 'Radio', uri: 'x-sonosapi-hls:city-radio', container: false },
  { title: 'Dinner Jazz', description: 'Streaming', uri: 'x-rincon-cpcontainer:1006206cjazz', container: true },
  { title: 'Late Night Mix', description: 'Streaming', uri: 'x-rincon-cpcontainer:1006206clate', container: true },
];

const PLAYLISTS = [{ title: 'Saved Queue', uri: 'file:///jffs/settings/savedqueues.rsq#1', container: true }];

const RADIO = [{ title: 'Coast FM', uri: 'x-rincon-mp3radio://coast', container: false }];

/** Quiet background levels — every room except the two that stay out. */
const VOLUMES_QUIET = {
  Kitchen: 8,
  Pantry: 8,
  'Upstairs Lounge': 10,
  'Dining Room': 10,
  Study: 10,
  Bathroom: 10,
  'Upstairs Bath': 10,
  'Dressing Room': 10,
  'Utility Room': 12,
  'Guest Room': 13,
  Playroom: 13,
  Bedroom: 14,
};

const VOLUMES_BACKGROUND = { ...VOLUMES_QUIET, Pantry: 9 };

/** Loud, and the whole house is in — including the two usual absentees. */
const VOLUMES_PARTY = {
  Kitchen: 40,
  Pantry: 39,
  'Living Room': 40,
  'Upstairs Lounge': 40,
  'Dining Room': 42,
  'Upstairs Bath': 40,
  Garage: 40,
  Bathroom: 40,
  'Guest Room': 42,
  Playroom: 42,
  'Dressing Room': 40,
  Study: 40,
  Bedroom: 46,
  'Utility Room': 42,
};

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

function musicScene({ name, description, icon, favorite, leave, volumes, shuffle }) {
  return {
    name,
    description,
    icon,
    enabled: true,
    switchType: 'momentary',
    autoOffMs: 1000,
    mode: 'parallel',
    condition: { type: 'always', params: {} },
    steps: [
      step('groupAndPlay', {
        params: {
          coordinator: LEADER,
          source: { type: 'favorite', value: favorite },
          membersMode: 'all',
          leave,
          members: [],
          volumes,
          defaultVolume: '',
          timing: 'auto',
          volumeDelayMs: 1000,
          groupDelayMs: 2000,
          modeDelayMs: 3000,
          shuffle,
          repeat: null,
          crossfade: null,
          startPlaying: true,
        },
      }),
    ],
    elseSteps: [],
    offSteps: [],
  };
}

const SCENES = [
  musicScene({
    name: 'Play City Radio',
    description: 'City Radio everywhere except the living room and the garage.',
    icon: 'radio',
    favorite: 'City Radio',
    leave: ['Living Room', 'Garage'],
    volumes: VOLUMES_QUIET,
    shuffle: null,
  }),

  musicScene({
    name: 'Background music',
    description: 'Quiet music everywhere except the living room and the garage.',
    icon: 'music',
    favorite: 'Dinner Jazz',
    leave: ['Living Room', 'Garage'],
    volumes: VOLUMES_BACKGROUND,
    shuffle: true,
  }),

  musicScene({
    name: 'Party mode',
    description: 'The whole house, loud.',
    icon: 'flame',
    favorite: 'Late Night Mix',
    leave: [],
    volumes: VOLUMES_PARTY,
    shuffle: true,
  }),

  {
    name: 'Join the living room',
    description: 'Puts the living room into the group.',
    icon: 'link',
    enabled: true,
    switchType: 'momentary',
    autoOffMs: 1000,
    mode: 'parallel',
    condition: { type: 'always', params: {} },
    steps: [
      step('joinGroup', {
        target: { type: 'players', names: ['Living Room'], coordinator: '', filter: 'any' },
        params: { coordinator: LEADER },
      }),
    ],
    elseSteps: [],
    offSteps: [],
  },

  {
    name: 'Pause everything',
    description: 'Pauses whatever is playing.',
    icon: 'pause',
    enabled: true,
    switchType: 'momentary',
    autoOffMs: 1000,
    mode: 'parallel',
    condition: { type: 'always', params: {} },
    steps: [step('pause', { target: { type: 'all', names: [], coordinator: '', filter: 'any' } })],
    elseSteps: [],
    offSteps: [],
  },

  {
    name: 'Volume up',
    description: '+5 % — only where something is playing.',
    icon: 'volume-up',
    enabled: true,
    switchType: 'momentary',
    autoOffMs: 600,
    mode: 'parallel',
    condition: { type: 'always', params: {} },
    steps: [
      step('adjustVolume', {
        target: { type: 'all', names: [], coordinator: '', filter: 'playing' },
        params: { delta: 5 },
      }),
    ],
    elseSteps: [],
    offSteps: [],
  },

  {
    name: 'Volume down',
    description: '−5 % — only where something is playing.',
    icon: 'volume-down',
    enabled: true,
    switchType: 'momentary',
    autoOffMs: 600,
    mode: 'parallel',
    condition: { type: 'always', params: {} },
    steps: [
      step('adjustVolume', {
        target: { type: 'all', names: [], coordinator: '', filter: 'playing' },
        params: { delta: -5 },
      }),
    ],
    elseSteps: [],
    offSteps: [],
  },
];

module.exports = {
  LEADER,
  ROOMS,
  FAVORITES,
  PLAYLISTS,
  RADIO,
  SCENES,
  VOLUMES_QUIET,
  VOLUMES_BACKGROUND,
  VOLUMES_PARTY,
};
