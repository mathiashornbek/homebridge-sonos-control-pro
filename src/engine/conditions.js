'use strict';

const { PLAYING_STATES } = require('./targets');
const { t, tFirst } = require('../i18n');

/**
 * Optional gate in front of a scene: when it evaluates false the scene runs its
 * else-steps instead. Keeps the door open for if/else scenes without forcing
 * every scene to think about it.
 *
 * As with the actions, no visible text lives here. Labels come from
 * `condition.<id>.label`, help from `condition.<id>.help`, and a field's name
 * from `condition.<id>.<key>` falling back to `condition.field.<key>`.
 */

/** Is this player — or the group it belongs to — currently producing sound? */
async function playerIsPlaying(system, name) {
  const player = system.resolve(name);
  if (!player) return false;
  const coordinator = system.coordinatorFor(player) || player;
  try {
    const info = await coordinator.getTransportInfo();
    return PLAYING_STATES.has(info.state);
  } catch {
    return false;
  }
}

/** Minutes since midnight, local time. */
function minutesOfDay(date = new Date()) {
  return date.getHours() * 60 + date.getMinutes();
}

function parseClock(value) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(value || '').trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

const CONDITIONS = {
  always: {
    params: [],
    async run() {
      return true;
    },
  },

  isPlaying: {
    params: [{ key: 'player', type: 'player', required: true }],
    async run(system, params) {
      return playerIsPlaying(system, params.player);
    },
  },

  isNotPlaying: {
    params: [{ key: 'player', type: 'player', required: true }],
    async run(system, params) {
      return !(await playerIsPlaying(system, params.player));
    },
  },

  anyPlaying: {
    params: [],
    async run(system) {
      await system.refreshTopology(undefined, { maxAgeMs: 750 }).catch(() => {});
      const coordinators = system.list().filter((player) => system.coordinatorFor(player) === player);
      const results = await Promise.all(
        coordinators.map(async (coordinator) => {
          try {
            const info = await coordinator.getTransportInfo();
            return PLAYING_STATES.has(info.state);
          } catch {
            return false;
          }
        }),
      );
      return results.some(Boolean);
    },
  },

  nonePlaying: {
    params: [],
    async run(system) {
      return !(await CONDITIONS.anyPlaying.run(system, {}));
    },
  },

  volumeAbove: {
    params: [
      { key: 'player', type: 'player', required: true },
      { key: 'volume', type: 'volume', required: true, min: 0, max: 100 },
    ],
    async run(system, params) {
      const player = system.resolve(params.player);
      if (!player) return false;
      const volume = await player.getVolume().catch(() => null);
      return volume !== null && volume > Number(params.volume);
    },
  },

  volumeBelow: {
    params: [
      { key: 'player', type: 'player', required: true },
      { key: 'volume', type: 'volume', required: true, min: 0, max: 100 },
    ],
    async run(system, params) {
      const player = system.resolve(params.player);
      if (!player) return false;
      const volume = await player.getVolume().catch(() => null);
      return volume !== null && volume < Number(params.volume);
    },
  },

  isInGroup: {
    params: [
      { key: 'player', type: 'player', required: true },
      { key: 'coordinator', type: 'player' },
    ],
    async run(system, params) {
      await system.refreshTopology(undefined, { maxAgeMs: 750 }).catch(() => {});
      const player = system.resolve(params.player);
      if (!player) return false;
      const coordinator = system.coordinatorFor(player);
      if (!params.coordinator) return system.groupMembers(player).length > 1;
      const wanted = system.resolve(params.coordinator);
      return Boolean(wanted && coordinator && coordinator.uuid === wanted.uuid);
    },
  },

  timeBetween: {
    params: [
      { key: 'from', type: 'time', required: true },
      { key: 'to', type: 'time', required: true },
    ],
    async run(_system, params) {
      const from = parseClock(params.from);
      const to = parseClock(params.to);
      if (from === null || to === null) return true;
      const now = minutesOfDay();
      return from <= to ? now >= from && now < to : now >= from || now < to;
    },
  },
};

/** Evaluate a scene's condition. Missing or unknown conditions mean "run it". */
async function evaluateCondition(system, condition) {
  if (!condition || !condition.type || condition.type === 'always') return true;
  const definition = CONDITIONS[condition.type];
  if (!definition) return true;
  return Boolean(await definition.run(system, condition.params || {}));
}

/** Catalogue for the UI, translated on every request. */
function conditionCatalogue() {
  return Object.entries(CONDITIONS).map(([id, definition]) => ({
    id,
    label: t(`condition.${id}.label`),
    help: tFirst([`condition.${id}.help`]),
    params: (definition.params || []).map((param) => {
      const out = { ...param };
      out.label = tFirst([`condition.${id}.${param.key}`, `condition.field.${param.key}`]) || param.key;
      const placeholder = tFirst([`condition.${id}.${param.key}Placeholder`]);
      if (placeholder) out.placeholder = placeholder;
      return out;
    }),
  }));
}

function describeCondition(condition) {
  if (!condition || !condition.type || condition.type === 'always') return t('condition.always.label');
  const definition = CONDITIONS[condition.type];
  if (!definition) return t('describe.unknownCondition');
  const params = condition.params || {};
  const bits = [t(`condition.${condition.type}.label`)];
  if (params.player) bits.push(params.player);
  if (params.volume !== undefined) bits.push(`${params.volume}%`);
  if (params.coordinator) bits.push(`(${params.coordinator})`);
  if (params.from) bits.push(`${params.from}–${params.to}`);
  return bits.join(' ');
}

module.exports = { CONDITIONS, evaluateCondition, conditionCatalogue, describeCondition, parseClock };
