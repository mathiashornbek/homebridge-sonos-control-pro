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

/**
 * Is this player — or the group it belongs to — currently producing sound?
 *
 * Three answers, not two. "I could not ask" used to come back as `false`, and
 * `false` is a definite answer — so `isNotPlaying` said *true* for a speaker
 * that had simply dropped one request on a flaky link, and an evening scene
 * gated on "only if nothing is playing in the living room" took over the
 * household in the middle of an album. `targets.js` already makes the opposite
 * choice for the same question and writes down why: doing nothing is safer.
 *
 * @returns {Promise<boolean|null>} null when the speaker could not be asked.
 */
async function playerIsPlaying(system, name) {
  const player = system.resolve(name);
  if (!player) return null;
  const coordinator = system.coordinatorFor(player) || player;
  try {
    const info = await coordinator.getTransportInfo();
    return PLAYING_STATES.has(info.state);
  } catch {
    return null;
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
      const playing = await playerIsPlaying(system, params.player);
      return playing === null ? null : !playing;
    },
  },

  anyPlaying: {
    params: [],
    async run(system) {
      await system.refreshTopology(undefined, { maxAgeMs: 750 }).catch(() => {});
      const coordinators = system.list().filter((player) => system.coordinatorFor(player) === player);
      // No household at all is not "nothing is playing" — it is not knowing.
      if (coordinators.length === 0) return null;
      const results = await Promise.all(
        coordinators.map(async (coordinator) => {
          try {
            const info = await coordinator.getTransportInfo();
            return PLAYING_STATES.has(info.state);
          } catch {
            return null;
          }
        }),
      );
      if (results.some((state) => state === true)) return true;
      // If not one speaker answered we know nothing, rather than knowing that
      // the house is quiet.
      return results.every((state) => state === null) ? null : false;
    },
  },

  nonePlaying: {
    params: [],
    async run(system) {
      const any = await CONDITIONS.anyPlaying.run(system, {});
      return any === null ? null : !any;
    },
  },

  volumeAbove: {
    params: [
      { key: 'player', type: 'player', required: true },
      { key: 'volume', type: 'volume', required: true, min: 0, max: 100 },
    ],
    async run(system, params) {
      const player = system.resolve(params.player);
      if (!player) return null;
      const volume = await player.getVolume().catch(() => null);
      return volume === null ? null : volume > Number(params.volume);
    },
  },

  volumeBelow: {
    params: [
      { key: 'player', type: 'player', required: true },
      { key: 'volume', type: 'volume', required: true, min: 0, max: 100 },
    ],
    async run(system, params) {
      const player = system.resolve(params.player);
      if (!player) return null;
      const volume = await player.getVolume().catch(() => null);
      return volume === null ? null : volume < Number(params.volume);
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
      if (!player) return null;
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

/**
 * Evaluate a scene's condition.
 *
 * A condition that is absent or of a type we do not know means "run it" — that
 * is a scene with no gate on it. A condition that *is* known but could not be
 * answered means "not met", and the scene takes its else-branch: a gate we
 * cannot read is a gate we do not walk through.
 */
async function evaluateCondition(system, condition) {
  if (!condition || !condition.type || condition.type === 'always') return true;
  const definition = CONDITIONS[condition.type];
  if (!definition) return true;
  return (await definition.run(system, condition.params || {})) === true;
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
