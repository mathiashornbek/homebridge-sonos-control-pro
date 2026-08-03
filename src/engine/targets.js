'use strict';

/**
 * Target resolution: turning "which speakers?" into actual players, at the
 * moment a step runs rather than when it was configured.
 *
 * A target is `{ type, names?, coordinator?, filter? }`.
 *
 *   type: 'all'         every visible player in the household
 *         'players'     exactly the rooms listed in `names`
 *         'allExcept'   every player except the rooms in `names`
 *         'group'       the current members of `coordinator`'s group
 *         'playing'     every player whose group is currently playing
 *         'coordinator' the coordinator of `coordinator`'s group (one player)
 *
 *   filter: 'any'        no extra filtering (default)
 *           'playing'    keep only players whose group is actually playing
 *           'notPlaying' keep only players whose group is idle
 *           'coordinators' keep only group coordinators
 *
 * The `playing` filter is the important one: it is what stops a volume nudge
 * from waking up eleven silent speakers.
 */

const { t } = require('../i18n');

const PLAYING_STATES = new Set(['PLAYING', 'TRANSITIONING']);

/**
 * Ask each *distinct group coordinator* once whether it is playing.
 * Thirteen speakers in one group cost exactly one request, not thirteen.
 *
 * @param {import('../sonos/system').SonosSystem} system
 * @param {import('../sonos/player').SonosPlayer[]} players
 * @returns {Promise<Map<string, boolean>>} coordinator UUID → is playing
 */
async function playingByCoordinator(system, players) {
  const coordinators = new Map();
  for (const player of players) {
    const coordinator = system.coordinatorFor(player);
    if (coordinator && !coordinators.has(coordinator.uuid)) {
      coordinators.set(coordinator.uuid, coordinator);
    }
  }

  const entries = await Promise.all(
    [...coordinators.values()].map(async (coordinator) => {
      try {
        const info = await coordinator.getTransportInfo();
        return [coordinator.uuid, PLAYING_STATES.has(info.state)];
      } catch {
        // If we cannot ask, assume not playing: doing nothing is always safer
        // than changing the volume of a speaker we know nothing about.
        return [coordinator.uuid, false];
      }
    }),
  );

  return new Map(entries);
}

/**
 * Resolve a target descriptor to concrete players.
 *
 * @param {import('../sonos/system').SonosSystem} system
 * @param {object} target
 * @param {object} [options]
 * @param {boolean} [options.refreshTopology] Re-read grouping before resolving.
 * @returns {Promise<{players: import('../sonos/player').SonosPlayer[], missing: string[], skipped: string[]}>}
 */
async function resolveTargets(system, target, { refreshTopology = false } = {}) {
  const descriptor = normalizeTarget(target);
  const missing = [];
  const skipped = [];

  if (refreshTopology || descriptor.filter !== 'any' || descriptor.type === 'group') {
    // Grouping and playback state are the two things that go stale fastest.
    await system.refreshTopology(undefined, { maxAgeMs: 750 }).catch(() => {});
  }

  let players = [];
  const visible = system.list();

  switch (descriptor.type) {
    case 'all':
      players = visible;
      break;

    case 'players': {
      const resolved = system.resolveMany(descriptor.names);
      players = resolved.found;
      missing.push(...resolved.missing);
      break;
    }

    case 'allExcept': {
      const excluded = new Set();
      for (const name of descriptor.names) {
        const player = system.resolve(name);
        if (player) excluded.add(player.uuid);
        else missing.push(name);
      }
      players = visible.filter((player) => !excluded.has(player.uuid));
      break;
    }

    case 'group': {
      const anchor = system.resolve(descriptor.coordinator);
      if (!anchor) {
        missing.push(descriptor.coordinator);
        break;
      }
      players = system.groupMembers(anchor);
      break;
    }

    case 'coordinator': {
      const anchor = system.resolve(descriptor.coordinator);
      if (!anchor) {
        missing.push(descriptor.coordinator);
        break;
      }
      const coordinator = system.coordinatorFor(anchor);
      players = coordinator ? [coordinator] : [];
      break;
    }

    case 'playing':
      players = visible;
      break;

    default:
      players = visible;
      break;
  }

  // De-duplicate while preserving order — a room listed twice must not be
  // nudged twice, which would silently double a relative volume change.
  const unique = [];
  const seen = new Set();
  for (const player of players) {
    if (!player || seen.has(player.uuid)) continue;
    seen.add(player.uuid);
    unique.push(player);
  }
  players = unique;

  if (descriptor.filter === 'coordinators') {
    players = players.filter((player) => system.coordinatorFor(player) === player);
  } else if (descriptor.filter === 'playing' || descriptor.filter === 'notPlaying') {
    const states = await playingByCoordinator(system, players);
    const wantPlaying = descriptor.filter === 'playing';
    players = players.filter((player) => {
      const coordinator = system.coordinatorFor(player);
      const isPlaying = states.get(coordinator?.uuid) === true;
      if (isPlaying === wantPlaying) return true;
      skipped.push(player.name);
      return false;
    });
  }

  return { players, missing, skipped };
}

/** Fill in defaults and coerce loose user input into the canonical shape. */
function normalizeTarget(target) {
  if (!target) return { type: 'all', names: [], coordinator: '', filter: 'any' };
  if (typeof target === 'string') return { type: 'players', names: [target], coordinator: '', filter: 'any' };
  if (Array.isArray(target)) return { type: 'players', names: target, coordinator: '', filter: 'any' };
  const type = target.type || 'all';
  return {
    type,
    names: Array.isArray(target.names) ? target.names.filter(Boolean) : [],
    coordinator: target.coordinator || '',
    // `playing` is a shorthand for "everyone, filtered to what is playing" —
    // settle that here so the refresh decision below sees the real filter.
    filter: type === 'playing' ? 'playing' : target.filter || 'any',
  };
}

/** Short human description, used in the UI and in log lines. */
function describeTarget(target) {
  const descriptor = normalizeTarget(target);
  const suffixKey = {
    playing: 'target.describe.onlyPlaying',
    notPlaying: 'target.describe.onlySilent',
    coordinators: 'target.describe.onlyLeaders',
  }[descriptor.filter];
  const suffix = suffixKey ? ` (${t(suffixKey)})` : '';
  const names = descriptor.names.join(', ');
  const anchor = descriptor.coordinator || t('common.dash');

  switch (descriptor.type) {
    case 'all':
      return `${t('target.all')}${suffix}`;
    case 'players':
      return `${names || t('common.notChosen')}${suffix}`;
    case 'allExcept':
      return `${t('target.allExcept')} ${names || t('common.dash')}${suffix}`;
    case 'group':
      return `${t('target.group')} ${anchor}${suffix}`;
    case 'coordinator':
      return `${t('target.coordinator')} ${anchor}`;
    case 'playing':
      return t('target.allPlaying');
    default:
      return t('target.all');
  }
}

module.exports = { resolveTargets, normalizeTarget, describeTarget, playingByCoordinator, PLAYING_STATES };
