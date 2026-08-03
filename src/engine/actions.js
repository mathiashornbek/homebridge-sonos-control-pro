'use strict';

const { resolveTargets, describeTarget } = require('./targets');
const { t, tFirst } = require('../i18n');

/**
 * The action catalogue.
 *
 * Every entry is both the implementation *and* the description the UI renders,
 * so adding a new action never means editing the front-end by hand.
 *
 *   category    key into `category.*`, grouping in the action picker
 *   targets     'multi' | 'single' | 'none'  — what the target picker offers
 *   params      field descriptors for the editor
 *   run         (ctx, step, players) => Promise<string>  returns a log summary
 *
 * No visible text lives here. Labels, help and placeholders are looked up by
 * convention when the catalogue is built, so the same definition renders in
 * whichever language the user picked:
 *
 *   label        action.<id>.label
 *   help         action.<id>.help          (optional)
 *   param label  action.<id>.<paramKey>    falling back to param.<paramKey>
 *   param help   action.<id>.<paramKey>Help
 *   placeholder  action.<id>.<paramKey>Placeholder
 */

/** The repeat modes, in the active language. */
function repeatModes() {
  return [
    { value: 'none', label: t('repeat.none') },
    { value: 'all', label: t('repeat.all') },
    { value: 'one', label: t('repeat.one') },
  ];
}

/**
 * Reduce a set of players to the coordinators that actually own their transport.
 *
 * Sonos slaves a grouped speaker's transport to its coordinator: sending Pause
 * to a follower answers "transition not available" and changes nothing. Asking
 * the coordinators instead is both correct and far fewer round trips — thirteen
 * grouped speakers become one request.
 *
 * @param {import('../sonos/system').SonosSystem} system
 * @param {import('../sonos/player').SonosPlayer[]} players
 */
function toCoordinators(system, players) {
  const seen = new Set();
  const out = [];
  for (const player of players) {
    const coordinator = inheritSignal(player, system.coordinatorFor(player) || player);
    if (seen.has(coordinator.uuid)) continue;
    seen.add(coordinator.uuid);
    out.push(coordinator);
  }
  return out;
}

/**
 * Carry a player's cancellation signal across to another player.
 *
 * `system.coordinatorFor()` hands back the raw player from the registry, which
 * has no signal attached. Without this, cancelling a scene stops the commands
 * aimed at the speakers it named but not the ones aimed at their group leader
 * — so an abandoned scene could still finish setting the music, and beat the
 * scene that replaced it.
 */
function inheritSignal(source, target) {
  if (!target || !source?._signal || target === source) return target;
  return target.withSignal(source._signal);
}

/**
 * The player that should receive a "play this" command for a given room.
 *
 * Picking a grouped room in the Sonos app and starting something plays it for
 * the whole group; this keeps that behaviour rather than silently tearing the
 * group apart.
 */
function playbackTarget(system, player) {
  if (!player) return player;
  return inheritSignal(player, system.coordinatorFor(player) || player);
}

/**
 * Run a job over many players, a few at a time.
 *
 * Every grouping change makes Sonos broadcast a new topology to the whole
 * household, so firing eleven of them into the same instant means the players
 * spend their time gossiping instead of answering us. A modest cap keeps the
 * wall-clock the same and the network calm.
 *
 * @param {Array} items
 * @param {(item: any) => Promise<any>} worker
 * @param {number} limit
 */
async function inBatches(items, worker, limit = 6) {
  const results = [];
  for (let index = 0; index < items.length; index += limit) {
    const batch = items.slice(index, index + limit);
    results.push(...(await Promise.allSettled(batch.map(worker))));
  }
  return results;
}

/** Run the same operation on many players at once, tolerating individual failures. */
async function forEachPlayer(players, log, worker) {
  const results = await Promise.allSettled(players.map((player) => worker(player)));
  const failed = [];
  results.forEach((result, index) => {
    if (result.status === 'rejected') {
      failed.push(players[index].name);
      log.debug?.(`  ↳ ${players[index].name}: ${result.reason?.message || result.reason}`);
    }
  });
  return failed;
}

function summarise(players, failed, skipped, verb) {
  const done = players.length - failed.length;
  const parts = [
    done === 1 ? t('result.onOneSpeaker', { verb }) : t('result.onSpeakers', { verb, done }),
  ];
  if (skipped?.length) parts.push(t('result.skippedSilent', { count: skipped.length }));
  if (failed.length) parts.push(t('result.failed', { names: failed.join(', ') }));
  return parts.join(' · ');
}

/**
 * Read a numeric parameter, refusing blanks.
 *
 * Coercing an empty field to 0 would mute the house and report success; a step
 * that is not fully configured has to say so instead.
 *
 * @param {*} value
 * @param {string} labelKey A dictionary key naming the field, for the message.
 */
function requireNumber(value, labelKey, min, max) {
  const label = tFirst([labelKey, `param.${labelKey}`]) || labelKey;
  if (value === '' || value === null || value === undefined) {
    throw new Error(t('error.missingNumber', { label: label.toLowerCase() }));
  }
  const number = Number(value);
  if (!Number.isFinite(number)) {
    throw new Error(t('error.invalidNumber', { value, label: label.toLowerCase() }));
  }
  if (number < min || number > max) {
    throw new Error(t('error.numberRange', { label, min, max, value: number }));
  }
  return number;
}

/**
 * Turn a source descriptor into something a player can be handed.
 * @param {import('../sonos/system').SonosSystem} system
 * @param {{type: string, value: string, title?: string}} source
 */
async function resolveSource(system, source) {
  const value = source.value || '';
  switch (source.type) {
    case 'favorite': {
      const favorite = await system.findFavorite(value);
      if (!favorite) throw new Error(t('error.favoriteGone', { name: value }));
      return favorite;
    }
    case 'playlist': {
      const playlist = await system.findPlaylist(value);
      if (!playlist) throw new Error(t('error.playlistGone', { name: value }));
      return { ...playlist, isContainer: true };
    }
    case 'radio': {
      const station = await system.findRadio(value);
      if (!station) throw new Error(t('error.radioGone', { name: value }));
      return { ...station, isContainer: false };
    }
    case 'uri':
      if (!value) throw new Error(t('error.noUri'));
      return { uri: value, title: source.title || 'Stream', isContainer: false, metadata: '' };
    default:
      throw new Error(t('error.unknownSource', { type: source.type }));
  }
}

/**
 * Look up a per-room volume, tolerating the room having been renamed in Sonos.
 * Keys are matched by identity first, then by the system's own name resolver.
 * @returns {number|null}
 */
function findVolumeFor(volumeMap, player, system) {
  if (!volumeMap || typeof volumeMap !== 'object') return null;
  if (Object.prototype.hasOwnProperty.call(volumeMap, player.name)) {
    const direct = Number(volumeMap[player.name]);
    return Number.isFinite(direct) ? direct : null;
  }
  if (Object.prototype.hasOwnProperty.call(volumeMap, player.uuid)) {
    const byId = Number(volumeMap[player.uuid]);
    return Number.isFinite(byId) ? byId : null;
  }
  for (const [key, value] of Object.entries(volumeMap)) {
    const resolved = system.resolve(key);
    if (resolved && resolved.uuid === player.uuid) {
      const number = Number(value);
      return Number.isFinite(number) ? number : null;
    }
  }
  return null;
}

const ACTIONS = {
  // ---------------------------------------------------------- music scene

  groupAndPlay: {
    category: 'musicScene',
    targets: 'none',
    composite: true,
    params: [
      { key: 'coordinator', type: 'player', required: true },
      { key: 'source', type: 'source', default: { type: 'keep', value: '' } },
      {
        key: 'membersMode',
        type: 'select',
        default: 'all',
        options: [
          { value: 'all', labelKey: 'action.groupAndPlay.membersModeAll' },
          { value: 'list', labelKey: 'action.groupAndPlay.membersModeList' },
        ],
      },
      { key: 'leave', type: 'players', default: [] },
      { key: 'members', type: 'players', default: [], showWhen: { membersMode: 'list' } },
      { key: 'volumes', type: 'volumeMap', default: {} },
      { key: 'defaultVolume', type: 'volume', min: 0, max: 100 },
      {
        key: 'timing',
        type: 'select',
        default: 'auto',
        options: [
          { value: 'auto', labelKey: 'action.groupAndPlay.timingAuto' },
          { value: 'fixed', labelKey: 'action.groupAndPlay.timingFixed' },
        ],
      },
      { key: 'volumeDelayMs', type: 'delay', default: 1000, showWhen: { timing: 'fixed' } },
      { key: 'groupDelayMs', type: 'delay', default: 2000, showWhen: { timing: 'fixed' } },
      { key: 'shuffle', type: 'tristate', default: null },
      { key: 'repeat', type: 'tristateRepeat', default: null },
      { key: 'crossfade', type: 'tristate', default: null },
      { key: 'modeDelayMs', type: 'delay', default: 3000, advanced: true, showWhen: { timing: 'fixed' } },
      { key: 'startPlaying', type: 'boolean', default: true, advanced: true },
    ],

    async run(ctx, step) {
      const params = step.params || {};
      const system = ctx.system;
      const startedAt = Date.now();
      const fixedTiming = (params.timing || 'auto') === 'fixed';
      const bind = (player) => (player && ctx.signal ? player.withSignal(ctx.signal) : player);

      // In "fixed" mode a phase begins at a set offset from the scene's start —
      // measured against the clock, not stacked on top of however long the
      // previous phase happened to take.
      const phaseAt = async (offsetMs) => {
        if (ctx.signal?.aborted) throw Object.assign(new Error(t('error.aborted')), { aborted: true });
        if (!fixedTiming) return;
        await ctx.sleep(Math.max(0, (Number(offsetMs) || 0) - (Date.now() - startedAt)));
      };

      await system.ensureReady().catch(() => {});
      await system.refreshTopology(undefined, { maxAgeMs: 750 }).catch(() => {});

      const coordinatorRoom = system.resolve(params.coordinator);
      const coordinator = bind(coordinatorRoom);
      if (!coordinator) throw new Error(t('error.coordinatorGone', { name: params.coordinator }));

      const unknown = [];
      const pick = (names) => {
        const out = [];
        const seen = new Set([coordinatorRoom.uuid]);
        for (const name of names || []) {
          const player = system.resolve(name);
          if (!player) {
            unknown.push(name);
            continue;
          }
          if (seen.has(player.uuid)) continue;
          seen.add(player.uuid);
          out.push(bind(player));
        }
        return out;
      };

      // Leavers are resolved first: in "alle"-mode they are what defines the group.
      const leavers = pick(params.leave);
      const leaverUuids = new Set(leavers.map((player) => player.uuid));

      let members;
      if ((params.membersMode || 'all') === 'all') {
        // Self-maintaining: everything the household currently has, minus the
        // leader and minus whoever was explicitly told to stay out. A speaker
        // added to Sonos next month joins this scene without any editing.
        members = system
          .list()
          .filter((player) => player.uuid !== coordinatorRoom.uuid && !leaverUuids.has(player.uuid))
          .map(bind);
      } else {
        // A speaker cannot both join and leave — the explicit member list wins.
        members = pick(params.members).filter((player) => !leaverUuids.has(player.uuid));
      }

      if (unknown.length > 0) ctx.log.warn(t('log.unknownSpeaker', { names: unknown.join(', ') }));

      // If the chosen leader is currently following someone else's group, break
      // it out first — otherwise its transport is slaved and the source would
      // either be refused or start playing in the wrong group.
      if (!coordinator.isCoordinator) {
        await coordinator
          .leaveGroup()
          // Book it immediately. Reading the topology back would be answered
          // from the cache we filled moments ago, and leaving the model
          // believing the leader is still inside its old group makes every
          // later decision in this scene wrong — including "is this member
          // already following?", which would skip joins that are needed.
          .then(() => system.noteGrouping(coordinatorRoom.uuid, coordinatorRoom.uuid))
          .catch((error) => {
            ctx.log.debug?.(`  ↳ ${coordinator.name}: ${error.message}`);
          });
      }

      const notes = [];
      const volumeDelay = Number(params.volumeDelayMs) || 0;
      const groupDelay = Number(params.groupDelayMs) || 0;
      const modeDelay = Number(params.modeDelayMs) || 0;

      // Grouping calls are the slowest thing a scene does, and most of them
      // are no-ops on a repeat press: the house is usually already grouped
      // exactly the way this scene wants it. The topology was just refreshed,
      // so we can tell, and skipping them is both faster and quieter.
      const alreadyAlone = (player) => system.groupMembers(player).length <= 1;
      const alreadyFollowing = (player) =>
        system.coordinatorFor(player)?.uuid === coordinatorRoom.uuid;

      const leaversToMove = leavers.filter((player) => !alreadyAlone(player));
      const membersToJoin = members.filter((player) => !alreadyFollowing(player));
      const skippedGrouping =
        leavers.length - leaversToMove.length + (members.length - membersToJoin.length);

      // ── opening ── the leavers step out and the leader loads its source.
      //
      // Held as thunks, not as promises: a promise starts the moment it is
      // built, and the whole point below is that nothing makes a sound until
      // the levels are in place.
      const opening = [];
      for (const player of leaversToMove) {
        opening.push(() =>
          player
            .leaveGroup()
            .then(() => system.noteGrouping(player.uuid, player.uuid))
            .catch((error) => {
              ctx.log.debug?.(`  ↳ ${player.name}: ${error.message}`);
            }),
        );
      }

      const source = params.source || { type: 'keep' };
      if (source.type && source.type !== 'keep') {
        opening.push(async () => {
          const item = await resolveSource(system, source);
          const how = await system.playOn(coordinator, item);
          notes.push(
            how === 'reused'
              ? t('describe.continuedPlaying', { title: item.title })
              : t('describe.playingNow', { title: item.title }),
          );
        });
      } else if (params.startPlaying !== false) {
        opening.push(() => coordinator.play().catch(() => {}));
      }

      // ── volume ── set before a note is played.
      //
      // A speaker left at 60 % from last night would otherwise blast for the
      // fraction of a second it takes the level to catch up. On automatic
      // timing the levels therefore go out first and the source waits for
      // them; it costs one round trip, which is nothing next to the shock.
      // Fixed timing keeps the source first, because that is what choosing it
      // asks for.
      const volumeMap = params.volumes || {};
      const hasDefault =
        params.defaultVolume !== undefined && params.defaultVolume !== null && params.defaultVolume !== '';
      const volumeTargets = [coordinator, ...members];
      const volumeWork = [];
      for (const player of volumeTargets) {
        const explicit = findVolumeFor(volumeMap, player, system);
        const value = explicit !== null ? explicit : hasDefault ? Number(params.defaultVolume) : null;
        if (value === null) continue;
        volumeWork.push(
          (async () => {
            await phaseAt(volumeDelay);
            await player.setVolume(value).catch((error) => {
              ctx.log.debug?.(`  ↳ ${player.name}: ${error.message}`);
            });
          })(),
        );
      }

      if (fixedTiming) {
        // The source starts at t=0 and the levels land at their own offset.
        await Promise.all([...opening.map((start) => start()), ...volumeWork]);
      } else {
        // Levels first, then everything that makes a sound.
        await Promise.all(volumeWork);
        await Promise.all(opening.map((start) => start()));
      }
      if (leaversToMove.length) {
        notes.push(t('result.left', { names: leaversToMove.map((p) => p.name).join(', ') }));
      }
      if (volumeWork.length) notes.push(t('result.volumesSet', { count: volumeWork.length }));

      // ── grouping ── one shared moment where the whole group forms.
      if (membersToJoin.length > 0) {
        await phaseAt(groupDelay);
        const joined = await inBatches(membersToJoin, (player) =>
          player
            .joinGroup(coordinator.uuid)
            .then(() => system.noteGrouping(player.uuid, coordinatorRoom.uuid)),
        );
        const failedNames = membersToJoin
          .filter((_, index) => joined[index].status === 'rejected')
          .map((player) => player.name);
        notes.push(
          t('result.joined', {
            count: membersToJoin.length - failedNames.length,
            player: coordinator.name,
          }),
        );
        if (failedNames.length) notes.push(t('result.joinFailed', { names: failedNames.join(', ') }));
      }
      if (skippedGrouping > 0) notes.push(t('result.alreadyInPlace', { count: skippedGrouping }));

      // ── modes ── play modes last, once the group exists.
      const wantsModes =
        params.shuffle !== null && params.shuffle !== undefined
          ? true
          : (params.repeat !== null && params.repeat !== undefined) ||
            (params.crossfade !== null && params.crossfade !== undefined);
      if (wantsModes) {
        await phaseAt(modeDelay);
        try {
          const work = [];
          if (
            (params.shuffle !== null && params.shuffle !== undefined) ||
            (params.repeat !== null && params.repeat !== undefined)
          ) {
            work.push(
              system.setPlayModeOn(coordinator, { shuffle: params.shuffle, repeat: params.repeat }),
            );
          }
          if (params.crossfade !== null && params.crossfade !== undefined) {
            work.push(coordinator.setCrossfade(Boolean(params.crossfade)));
          }
          await Promise.all(work);
          notes.push(t('result.modesSet'));
        } catch (error) {
          ctx.log.debug?.(`  ↳ ${coordinator.name}: ${error.message}`);
        }
      }

      notes.push(`${Date.now() - startedAt} ms`);
      return `${coordinator.name}: ${notes.join(' · ')}`;
    },
  },

  // ------------------------------------------------------------- playback

  playFavorite: {
    category: 'playback',
    targets: 'single',
    params: [{ key: 'favorite', type: 'favorite', required: true }],
    async run(ctx, step, players) {
      const player = playbackTarget(ctx.system, players[0]);
      if (!player) throw new Error(t('error.noSpeakerChosen'));
      const favorite = await ctx.system.findFavorite(step.params.favorite);
      if (!favorite) throw new Error(t('error.favoriteGone', { name: step.params.favorite }));
      const how = await ctx.system.playOn(player, favorite);
      return t(how === 'reused' ? 'result.continuing' : 'result.playing', {
        title: favorite.title,
        player: player.name,
      });
    },
  },

  playPlaylist: {
    category: 'playback',
    targets: 'single',
    params: [{ key: 'playlist', type: 'playlist', required: true }],
    async run(ctx, step, players) {
      const player = playbackTarget(ctx.system, players[0]);
      if (!player) throw new Error(t('error.noSpeakerChosen'));
      const playlist = await ctx.system.findPlaylist(step.params.playlist);
      if (!playlist) throw new Error(t('error.playlistGone', { name: step.params.playlist }));
      const how = await ctx.system.playOn(player, { ...playlist, isContainer: true });
      return t(how === 'reused' ? 'result.continuingPlaylist' : 'result.playingPlaylist', {
        title: playlist.title,
        player: player.name,
      });
    },
  },

  playRadio: {
    category: 'playback',
    targets: 'single',
    params: [{ key: 'radio', type: 'radio', required: true }],
    async run(ctx, step, players) {
      const player = playbackTarget(ctx.system, players[0]);
      if (!player) throw new Error(t('error.noSpeakerChosen'));
      const station = await ctx.system.findRadio(step.params.radio);
      if (!station) throw new Error(t('error.radioGone', { name: step.params.radio }));
      await ctx.system.playOn(player, { ...station, isContainer: false });
      return t('result.playingRadio', { title: station.title, player: player.name });
    },
  },

  playUri: {
    category: 'playback',
    targets: 'single',
    params: [
      { key: 'uri', type: 'text', required: true },
      { key: 'title', type: 'text' },
    ],
    async run(ctx, step, players) {
      const player = playbackTarget(ctx.system, players[0]);
      if (!player) throw new Error(t('error.noSpeakerChosen'));
      await player.playItem({ uri: step.params.uri, title: step.params.title || 'Stream' });
      return t('result.playingUri', { uri: step.params.uri, player: player.name });
    },
  },

  play: {
    category: 'playback',
    targets: 'multi',
    params: [],
    async run(ctx, step, players) {
      const targets = toCoordinators(ctx.system, players);
      const failed = await forEachPlayer(targets, ctx.log, (player) => player.play());
      return summarise(targets, failed, step._skipped, t('verb.play'));
    },
  },

  pause: {
    category: 'playback',
    targets: 'multi',
    params: [],
    async run(ctx, step, players) {
      // An idle player answers 701 to Pause; that is not an error worth showing
      // the user, so swallow exactly that case.
      const targets = toCoordinators(ctx.system, players);
      const failed = await forEachPlayer(targets, ctx.log, async (player) => {
        try {
          await player.pause();
        } catch (error) {
          if (error.upnpErrorCode === 701 || error.upnpErrorCode === 800) return;
          throw error;
        }
      });
      return summarise(targets, failed, step._skipped, t('verb.pause'));
    },
  },

  stop: {
    category: 'playback',
    targets: 'multi',
    params: [],
    async run(ctx, step, players) {
      const targets = toCoordinators(ctx.system, players);
      const failed = await forEachPlayer(targets, ctx.log, async (player) => {
        try {
          await player.stop();
        } catch (error) {
          if (error.upnpErrorCode === 701 || error.upnpErrorCode === 800) return;
          throw error;
        }
      });
      return summarise(targets, failed, step._skipped, t('verb.stop'));
    },
  },

  togglePlay: {
    category: 'playback',
    targets: 'multi',
    params: [],
    async run(ctx, step, players) {
      const targets = toCoordinators(ctx.system, players);
      const failed = await forEachPlayer(targets, ctx.log, async (player) => {
        const info = await player.getTransportInfo();
        if (info.state === 'PLAYING') await player.pause();
        else await player.play();
      });
      return summarise(targets, failed, step._skipped, t('verb.togglePlay'));
    },
  },

  next: {
    category: 'playback',
    targets: 'multi',
    params: [],
    async run(ctx, step, players) {
      const targets = toCoordinators(ctx.system, players);
      const failed = await forEachPlayer(targets, ctx.log, (player) => player.next());
      return summarise(targets, failed, step._skipped, t('verb.next'));
    },
  },

  previous: {
    category: 'playback',
    targets: 'multi',
    params: [],
    async run(ctx, step, players) {
      const targets = toCoordinators(ctx.system, players);
      const failed = await forEachPlayer(targets, ctx.log, (player) => player.previous());
      return summarise(targets, failed, step._skipped, t('verb.previous'));
    },
  },

  playLineIn: {
    category: 'playback',
    targets: 'single',
    params: [],
    async run(ctx, step, players) {
      const player = players[0];
      if (!player) throw new Error(t('error.noSpeakerChosen'));
      await player.playLineIn();
      await player.play();
      return t('result.lineIn', { player: player.name });
    },
  },

  playTVInput: {
    category: 'playback',
    targets: 'single',
    params: [],
    async run(ctx, step, players) {
      const player = players[0];
      if (!player) throw new Error(t('error.noSpeakerChosen'));
      await player.playTVInput();
      return t('result.tvInput', { player: player.name });
    },
  },

  // --------------------------------------------------------------- volume

  setVolume: {
    category: 'volume',
    targets: 'multi',
    params: [{ key: 'volume', type: 'volume', required: true, min: 0, max: 100 }],
    async run(ctx, step, players) {
      const volume = requireNumber(step.params.volume, 'param.volume', 0, 100);
      const failed = await forEachPlayer(players, ctx.log, (player) => player.setVolume(volume));
      return summarise(players, failed, step._skipped, t('result.volumeAt', { volume }));
    },
  },

  adjustVolume: {
    category: 'volume',
    targets: 'multi',
    params: [{ key: 'delta', type: 'number', required: true, min: -100, max: 100, step: 1 }],
    async run(ctx, step, players) {
      const delta = requireNumber(step.params.delta, 'param.delta', -100, 100);
      const changes = [];
      const failed = await forEachPlayer(players, ctx.log, async (player) => {
        const next = await player.setRelativeVolume(delta);
        changes.push(`${player.name}→${next}%`);
      });
      const verb = t('verb.delta', { delta: `${delta > 0 ? '+' : ''}${delta}` });
      const summary = summarise(players, failed, step._skipped, verb);
      return changes.length ? `${summary} · ${changes.sort().join(', ')}` : summary;
    },
  },

  setGroupVolume: {
    category: 'volume',
    targets: 'single',
    params: [{ key: 'volume', type: 'volume', required: true, min: 0, max: 100 }],
    async run(ctx, step, players) {
      const player = players[0];
      if (!player) throw new Error(t('error.noSpeakerChosen'));
      const coordinator = playbackTarget(ctx.system, player);
      const volume = requireNumber(step.params.volume, 'param.volume', 0, 100);
      await coordinator.setGroupVolume(volume);
      return t('result.groupVolume', { volume, player: coordinator.name });
    },
  },

  adjustGroupVolume: {
    category: 'volume',
    targets: 'single',
    params: [{ key: 'delta', type: 'number', required: true, min: -100, max: 100 }],
    async run(ctx, step, players) {
      const player = players[0];
      if (!player) throw new Error(t('error.noSpeakerChosen'));
      const coordinator = playbackTarget(ctx.system, player);
      const delta = requireNumber(step.params.delta, 'param.delta', -100, 100);
      await coordinator.setRelativeGroupVolume(delta);
      return t('result.groupVolumeDelta', { player: coordinator.name, delta });
    },
  },

  setMute: {
    category: 'volume',
    targets: 'multi',
    params: [{ key: 'muted', type: 'boolean', default: true }],
    async run(ctx, step, players) {
      const muted = step.params.muted !== false;
      const failed = await forEachPlayer(players, ctx.log, (player) => player.setMute(muted));
      return summarise(players, failed, step._skipped, t(muted ? 'verb.muted' : 'verb.unmuted'));
    },
  },

  toggleMute: {
    category: 'volume',
    targets: 'multi',
    params: [],
    async run(ctx, step, players) {
      const failed = await forEachPlayer(players, ctx.log, async (player) => {
        const muted = await player.getMute();
        await player.setMute(!muted);
      });
      return summarise(players, failed, step._skipped, t('verb.toggleMute'));
    },
  },

  // -------------------------------------------------------------- grouping

  joinGroup: {
    category: 'grouping',
    targets: 'multi',
    params: [{ key: 'coordinator', type: 'player', required: true }],
    async run(ctx, step, players) {
      const chosen = ctx.system.resolve(step.params.coordinator);
      if (!chosen) throw new Error(t('error.coordinatorMissing', { name: step.params.coordinator }));
      // `x-rincon:` only accepts a group coordinator. If the chosen room is
      // itself following someone, joining its UUID would fault on every member.
      const coordinator = inheritSignal(chosen, ctx.system.coordinatorFor(chosen) || chosen);
      await ctx.system.refreshTopology(undefined, { maxAgeMs: 750 }).catch(() => {});
      const joiners = players.filter(
        (player) =>
          player.uuid !== coordinator.uuid &&
          ctx.system.coordinatorFor(player)?.uuid !== coordinator.uuid,
      );
      if (joiners.length === 0) return t('result.joinedAll', { player: coordinator.name });
      const failed = await forEachPlayer(joiners, ctx.log, (player) =>
        player.joinGroup(coordinator.uuid).then(() => ctx.system.noteGrouping(player.uuid, coordinator.uuid)),
      );
      return summarise(joiners, failed, step._skipped, t('verb.joined', { player: coordinator.name }));
    },
  },

  leaveGroup: {
    category: 'grouping',
    targets: 'multi',
    params: [],
    async run(ctx, step, players) {
      const failed = await forEachPlayer(players, ctx.log, (player) =>
        player.leaveGroup().then(() => ctx.system.noteGrouping(player.uuid, player.uuid)),
      );
      return summarise(players, failed, step._skipped, t('verb.leftGroup'));
    },
  },

  // ----------------------------------------------------------------- modes

  setShuffle: {
    category: 'settings',
    targets: 'single',
    params: [{ key: 'enabled', type: 'boolean', default: true }],
    async run(ctx, step, players) {
      const player = players[0];
      if (!player) throw new Error(t('error.noSpeakerChosen'));
      const coordinator = playbackTarget(ctx.system, player);
      const on = step.params.enabled !== false;
      await ctx.system.setPlayModeOn(coordinator, { shuffle: on });
      return t('result.shuffle', {
        state: t(on ? 'tristate.on' : 'tristate.off').toLowerCase(),
        player: coordinator.name,
      });
    },
  },

  setRepeat: {
    category: 'settings',
    targets: 'single',
    params: [{ key: 'mode', type: 'select', optionsKey: 'repeat', default: 'none' }],
    async run(ctx, step, players) {
      const player = players[0];
      if (!player) throw new Error(t('error.noSpeakerChosen'));
      const coordinator = playbackTarget(ctx.system, player);
      const mode = step.params.mode || 'none';
      await ctx.system.setPlayModeOn(coordinator, { repeat: mode });
      return t('result.repeat', { mode: t(`repeat.${mode}`), player: coordinator.name });
    },
  },

  setCrossfade: {
    category: 'settings',
    targets: 'single',
    params: [{ key: 'enabled', type: 'boolean', default: true }],
    async run(ctx, step, players) {
      const player = players[0];
      if (!player) throw new Error(t('error.noSpeakerChosen'));
      const coordinator = playbackTarget(ctx.system, player);
      const on = step.params.enabled !== false;
      await coordinator.setCrossfade(on);
      return t('result.crossfade', {
        state: t(on ? 'tristate.on' : 'tristate.off').toLowerCase(),
        player: coordinator.name,
      });
    },
  },

  setLoudness: {
    category: 'settings',
    targets: 'multi',
    params: [{ key: 'enabled', type: 'boolean', default: true }],
    async run(ctx, step, players) {
      const failed = await forEachPlayer(players, ctx.log, (player) =>
        player.setLoudness(step.params.enabled !== false),
      );
      return summarise(players, failed, step._skipped, t('verb.loudness'));
    },
  },

  setBassTreble: {
    category: 'settings',
    targets: 'multi',
    params: [
      { key: 'bass', type: 'number', min: -10, max: 10, default: 0 },
      { key: 'treble', type: 'number', min: -10, max: 10, default: 0 },
    ],
    async run(ctx, step, players) {
      const failed = await forEachPlayer(players, ctx.log, async (player) => {
        await player.setBass(step.params.bass ?? 0);
        await player.setTreble(step.params.treble ?? 0);
      });
      return summarise(players, failed, step._skipped, t('verb.bassTreble'));
    },
  },

  // ------------------------------------------------------------- flow logic

  wait: {
    category: 'flow',
    targets: 'none',
    params: [{ key: 'seconds', type: 'number', required: true, min: 0, max: 300, step: 0.5 }],
    async run(ctx, step) {
      const ms = Math.max(0, Number(step.params.seconds) * 1000);
      await ctx.sleep(ms);
      return t('result.waited', { seconds: step.params.seconds });
    },
  },

  snapshot: {
    category: 'flow',
    targets: 'multi',
    params: [{ key: 'slot', type: 'text', default: 'default' }],
    async run(ctx, step, players) {
      const slot = step.params.slot || 'default';
      const entries = await Promise.all(
        players.map(async (player) => {
          const coordinator = inheritSignal(player, ctx.system.coordinatorFor(player) || player);
          const isCoordinator = coordinator.uuid === player.uuid;
          const [volume, muted, media, transport, position] = await Promise.all([
            player.getVolume().catch(() => null),
            player.getMute().catch(() => null),
            isCoordinator ? player.getMediaInfo().catch(() => null) : Promise.resolve(null),
            isCoordinator ? player.getTransportInfo().catch(() => null) : Promise.resolve(null),
            isCoordinator ? player.getPositionInfo().catch(() => null) : Promise.resolve(null),
          ]);
          return {
            uuid: player.uuid,
            name: player.name,
            volume,
            muted,
            coordinatorUuid: coordinator.uuid,
            isCoordinator,
            uri: media?.uri || '',
            metadata: media?.metadata || '',
            state: transport?.state || '',
            track: position?.track || 0,
            position: position?.position || '',
          };
        }),
      );
      ctx.snapshots.set(slot, { savedAt: Date.now(), entries });
      return t('result.snapshotSaved', { count: entries.length, slot });
    },
  },

  restore: {
    category: 'flow',
    targets: 'none',
    params: [
      { key: 'slot', type: 'text', default: 'default' },
      { key: 'restoreVolume', type: 'boolean', default: true },
      { key: 'restorePlayback', type: 'boolean', default: true },
    ],
    async run(ctx, step) {
      const slot = step.params.slot || 'default';
      const snapshot = ctx.snapshots.get(slot);
      if (!snapshot) throw new Error(t('error.noSnapshot', { slot }));

      const byUuid = new Map(ctx.system.list().map((player) => [player.uuid, player]));
      const coordinators = snapshot.entries.filter((entry) => entry.isCoordinator);
      const followers = snapshot.entries.filter((entry) => !entry.isCoordinator);

      if (step.params.restorePlayback !== false) {
        for (const entry of coordinators) {
          const player = byUuid.get(entry.uuid);
          if (!player) continue;
          try {
            await player.leaveGroup();
            if (entry.uri) await player.setAVTransportURI(entry.uri, entry.metadata);
          } catch (error) {
            ctx.log.debug?.(`  ↳ ${entry.name}: ${error.message}`);
          }
        }
        for (const entry of followers) {
          const player = byUuid.get(entry.uuid);
          if (!player) continue;
          try {
            await player.joinGroup(entry.coordinatorUuid);
          } catch (error) {
            ctx.log.debug?.(`  ↳ ${entry.name}: ${error.message}`);
          }
        }
      }

      if (step.params.restoreVolume !== false) {
        await Promise.allSettled(
          snapshot.entries.map(async (entry) => {
            const player = byUuid.get(entry.uuid);
            if (!player) return;
            if (entry.volume !== null) await player.setVolume(entry.volume);
            if (entry.muted !== null) await player.setMute(entry.muted);
          }),
        );
      }

      if (step.params.restorePlayback !== false) {
        await Promise.allSettled(
          coordinators.map(async (entry) => {
            const player = byUuid.get(entry.uuid);
            if (!player || entry.state !== 'PLAYING') return;
            if (entry.track > 1) await player.seekTrack(entry.track).catch(() => {});
            await player.play().catch(() => {});
          }),
        );
      }

      return t('result.restored', { slot, count: snapshot.entries.length });
    },
  },

  runScene: {
    category: 'flow',
    targets: 'none',
    params: [{ key: 'sceneId', type: 'scene', required: true }],
    async run(ctx, step) {
      const name = await ctx.runScene(step.params.sceneId);
      return t('result.ranScene', { name });
    },
  },
};

/**
 * Actions that decide what plays or who is grouped with whom.
 *
 * Two scenes containing any of these must not overlap: they would issue
 * contradictory AVTransport commands to the same speakers, which Sonos
 * serialises and answers slowly. The later press wins.
 */
const EXCLUSIVE_ACTIONS = new Set([
  'groupAndPlay',
  'playFavorite',
  'playPlaylist',
  'playRadio',
  'playUri',
  'playLineIn',
  'playTVInput',
  'joinGroup',
  'leaveGroup',
  'restore',
  'runScene',
]);

/** @param {string} action */
function isExclusiveAction(action) {
  return EXCLUSIVE_ACTIONS.has(action);
}

/** The order categories appear in the action picker — most used first. */
const CATEGORY_ORDER = ['musicScene', 'playback', 'volume', 'grouping', 'settings', 'flow'];

/**
 * Translate one parameter descriptor.
 *
 * The label is looked up per action first, so "Volume" can be "Threshold" in
 * one place and "Level" in another without either action needing to spell it
 * out; the generic `param.*` entry catches the ones that are simply the same
 * word everywhere.
 *
 * @param {string} actionId
 * @param {object} param
 */
function translateParam(actionId, param) {
  const out = { ...param };
  out.label = tFirst([`action.${actionId}.${param.key}`, `param.${param.key}`]) || param.key;
  const help = tFirst([`action.${actionId}.${param.key}Help`]);
  if (help) out.help = help;
  const placeholder = tFirst([`action.${actionId}.${param.key}Placeholder`]);
  if (placeholder) out.placeholder = placeholder;
  if (param.optionsKey === 'repeat') out.options = repeatModes();
  else if (param.options) {
    out.options = param.options.map((option) => ({
      value: option.value,
      label: option.labelKey ? t(option.labelKey) : option.label,
    }));
  }
  return out;
}

/**
 * Catalogue in the shape the UI wants: grouped, ordered, translated, and
 * without the code. Rebuilt on every request, so switching language in the
 * settings takes effect on the next render rather than on the next restart.
 */
function actionCatalogue() {
  const byCategory = new Map();
  for (const [id, definition] of Object.entries(ACTIONS)) {
    const entry = {
      id,
      label: t(`action.${id}.label`),
      help: tFirst([`action.${id}.help`]),
      targets: definition.targets,
      composite: Boolean(definition.composite),
      params: (definition.params || []).map((param) => translateParam(id, param)),
    };
    if (!byCategory.has(definition.category)) byCategory.set(definition.category, []);
    byCategory.get(definition.category).push(entry);
  }
  return [...byCategory.entries()]
    .sort((a, b) => {
      const left = CATEGORY_ORDER.indexOf(a[0]);
      const right = CATEGORY_ORDER.indexOf(b[0]);
      return (left === -1 ? 99 : left) - (right === -1 ? 99 : right);
    })
    .map(([category, actions]) => ({ id: category, category: t(`category.${category}`), actions }));
}

/**
 * Resolve the players a step should act on, honouring the action's target mode.
 * @returns {Promise<{players: object[], missing: string[], skipped: string[]}>}
 */
async function playersForStep(system, step) {
  const definition = ACTIONS[step.action];
  if (!definition) throw new Error(t('error.unknownAction', { action: step.action }));
  if (definition.targets === 'none') return { players: [], missing: [], skipped: [] };

  const resolved = await resolveTargets(system, step.target);
  if (definition.targets === 'single') {
    return { ...resolved, players: resolved.players.slice(0, 1) };
  }
  return resolved;
}

/** One-line human description of a configured step, for the UI and the log. */
function describeStep(step) {
  const definition = ACTIONS[step.action];
  if (!definition) return t('describe.unknownAction', { action: step.action });
  const params = step.params || {};

  if (step.action === 'groupAndPlay') {
    const bits = [];
    const source = params.source || {};
    if (source.type && source.type !== 'keep') bits.push(`"${source.value}"`);
    bits.push(t('describe.on', { name: params.coordinator || t('common.dash') }));
    if ((params.membersMode || 'all') === 'all') bits.push(t('describe.plusEveryoneElse'));
    else if ((params.members || []).length) {
      bits.push(t('describe.plusCount', { count: params.members.length }));
    }
    const leaveCount = (params.leave || []).length;
    if (leaveCount) bits.push(t('describe.minus', { names: (params.leave || []).join(', ') }));
    return t('describe.musicScene', { parts: bits.join(' ') });
  }

  const bits = [t(`action.${step.action}.label`)];
  if (params.favorite) bits.push(`"${params.favorite}"`);
  if (params.playlist) bits.push(`"${params.playlist}"`);
  if (params.radio) bits.push(`"${params.radio}"`);
  if (params.volume !== undefined) bits.push(`${params.volume}%`);
  if (params.delta !== undefined) bits.push(`${params.delta > 0 ? '+' : ''}${params.delta}%`);
  if (params.coordinator) bits.push(`→ ${params.coordinator}`);
  if (params.seconds !== undefined) bits.push(`${params.seconds} ${t('common.seconds')}`);
  if (definition.targets !== 'none') bits.push(`· ${describeTarget(step.target)}`);
  return bits.join(' ');
}

module.exports = {
  ACTIONS,
  inBatches,
  inheritSignal,
  EXCLUSIVE_ACTIONS,
  isExclusiveAction,
  toCoordinators,
  playbackTarget,
  requireNumber,
  actionCatalogue,
  playersForStep,
  describeStep,
  resolveSource,
  findVolumeFor,
  repeatModes,
};
