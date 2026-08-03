'use strict';

const { EventEmitter } = require('node:events');
const { discover } = require('./ssdp');
const { SonosPlayer } = require('./player');
const { parseXml, findAll } = require('./xml');
const { t } = require('../i18n');

/**
 * Normalise a room name so "Stue 1. Sal" and "stue 1 sal" match.
 * Danish letters are transliterated the conventional way (æ→ae, ø→oe, å→aa),
 * which is what people type when their keyboard is in the way.
 */
function normalizeName(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/æ/g, 'ae')
    .replace(/ø/g, 'oe')
    .replace(/å/g, 'aa')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Every spelling of a room name we are willing to accept.
 *
 * Both Danish conventions are covered — "Køkken" answers to *koekken* and to
 * *kokken* — plus a space-free form so "Stue1.Sal" still lands. Matching is
 * "do the two name's variant sets overlap", which stays symmetric.
 *
 * @param {string} name
 * @returns {Set<string>}
 */
function nameVariants(name) {
  const translit = normalizeName(name);
  const plain = String(name || '')
    .toLowerCase()
    .replace(/æ/g, 'a')
    .replace(/ø/g, 'o')
    .replace(/å/g, 'a')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
  const variants = new Set([translit, plain]);
  for (const variant of [...variants]) variants.add(variant.replace(/\s+/g, ''));
  variants.delete('');
  return variants;
}

function variantsOverlap(left, right) {
  for (const value of left) if (right.has(value)) return true;
  return false;
}

/**
 * The whole Sonos household, kept warm in memory.
 *
 * Responsibilities:
 *  - find players (SSDP, plus any manually seeded IPs)
 *  - keep the group topology fresh
 *  - resolve friendly room names to players, tolerantly
 *  - cache favourites / playlists / radio so the UI feels instant
 */
class SonosSystem extends EventEmitter {
  /**
   * @param {object} options
   * @param {{info: Function, warn: Function, error: Function, debug: Function}} options.log
   * @param {string[]} [options.seedHosts]     IPs to probe directly if SSDP is blocked.
   * @param {number} [options.discoveryTimeout]
   * @param {number} [options.topologyIntervalMs]
   * @param {number} [options.libraryTtlMs]
   */
  constructor({
    log,
    seedHosts = [],
    discoveryTimeout = 4000,
    topologyIntervalMs = 30000,
    libraryTtlMs = 300000,
    port,
  } = {}) {
    super();
    this.log = log;
    this.seedHosts = seedHosts.filter(Boolean);
    /** Overridable only so the test suite can run fake players on loopback. */
    this.port = port;
    this.discoveryTimeout = discoveryTimeout;
    this.topologyIntervalMs = topologyIntervalMs;
    this.libraryTtlMs = libraryTtlMs;

    /** @type {Map<string, SonosPlayer>} keyed by UUID */
    this.players = new Map();
    /** @type {Array<{coordinatorUuid: string, id: string, memberUuids: string[]}>} */
    this.groups = [];

    this._library = { favorites: [], playlists: [], radio: [], fetchedAt: 0, loaded: false };
    this._libraryPromise = null;
    this._topologyPromise = null;
    this._topologySource = null;
    /**
     * What we last pushed onto each coordinator's queue, so re-running a scene
     * does not pay for a second round-trip to Spotify.
     * @type {Map<string, {uri: string, updateId: string}>}
     */
    this._queueMemo = new Map();
    /**
     * The play mode we last set on a coordinator, so a scene that wants
     * shuffle on does not have to read the current mode back first.
     *
     * Short-lived on purpose: anyone can change shuffle or repeat from the
     * Sonos app, and a memo that never expired would keep writing the stale
     * half back — silently turning repeat off every time a scene set shuffle.
     * @type {Map<string, {shuffle: boolean, repeat: string, at: number}>}
     */
    this._playModeMemo = new Map();
    this.playModeMemoTtlMs = 30000;
    this._topologyTimer = null;
    this._rediscoverTimer = null;
    this._discovering = null;
    this.lastDiscoveryAt = 0;
    this.lastTopologyAt = 0;
    this.ready = false;
    /** Rooms seen for the first time since the plugin started, newest first. */
    this.recentlyAdded = [];
  }

  /**
   * Make sure we know the household before acting on it.
   *
   * A scene pressed seconds after a reboot must not fail just because the
   * network sweep had not finished; it simply waits for it.
   */
  async ensureReady() {
    if (this.players.size > 0) return this.list();
    return this.discover({ force: true });
  }

  // ------------------------------------------------------------------ lookup

  /** Every visible player, sorted by room name. */
  list() {
    return [...this.players.values()]
      .filter((player) => !player.invisible)
      .sort((a, b) => a.name.localeCompare(b.name, 'da'));
  }

  /** Resolve a room name (or UUID, or IP) to a player. Returns null when unknown. */
  resolve(nameOrId) {
    if (!nameOrId) return null;
    const raw = String(nameOrId).trim();
    if (this.players.has(raw)) return this.players.get(raw);

    // Only ever hand back a real, addressable room. Both halves of a stereo
    // pair report the same ZoneName, but the satellite is Invisible and is not
    // a valid group coordinator — resolving to it breaks every join.
    const candidates = this.list();

    for (const player of candidates) {
      if (player.name === raw || player.host === raw) return player;
    }

    // Then tolerate spelling drift — but never partial names, so "Stue" can
    // not silently resolve to "Stue 1. Sal".
    const wanted = nameVariants(raw);
    for (const player of candidates) {
      if (variantsOverlap(wanted, nameVariants(player.name))) return player;
    }

    // Last resort: an invisible member matched. Answer with the room that
    // actually owns it rather than pretending we found nothing.
    for (const player of this.players.values()) {
      if (player.host === raw || variantsOverlap(wanted, nameVariants(player.name))) {
        const owner = this.players.get(player.coordinatorUuid);
        if (owner && !owner.invisible) return owner;
      }
    }
    return null;
  }

  /**
   * Resolve a list of names, reporting which ones did not exist so the caller
   * can tell the user instead of silently doing less than they asked for.
   * @param {string[]} names
   */
  resolveMany(names) {
    const found = [];
    const missing = [];
    for (const name of names || []) {
      const player = this.resolve(name);
      if (player) found.push(player);
      else missing.push(name);
    }
    return { found, missing };
  }

  /** The player currently coordinating `player`'s group. */
  coordinatorFor(player) {
    if (!player) return null;
    return this.players.get(player.coordinatorUuid) || player;
  }

  /** All players currently grouped with `player`, coordinator first. */
  groupMembers(player) {
    if (!player) return [];
    const coordinator = this.coordinatorFor(player);
    const group = this.groups.find((entry) => entry.coordinatorUuid === coordinator.uuid);
    if (!group) return [player];
    return group.memberUuids.map((uuid) => this.players.get(uuid)).filter(Boolean);
  }

  // --------------------------------------------------------------- discovery

  /**
   * Find players. Safe to call repeatedly; concurrent calls share one sweep.
   * @param {{force?: boolean}} [options]
   */
  async discover({ force = false } = {}) {
    if (this._discovering) return this._discovering;
    if (!force && this.players.size > 0 && Date.now() - this.lastDiscoveryAt < 10000) {
      return [...this.players.values()];
    }

    this._discovering = (async () => {
      // Keyed by "host:port" so two entries for the same host on different
      // ports do not collapse into one.
      const targets = new Map();
      const remember = (host, port) => {
        if (!host) return;
        targets.set(`${host}:${port || this.port || ''}`, { host, port: port || this.port });
      };
      for (const seed of this.seedHosts) {
        // A seed may name a port — "192.168.1.40:1400" — which is what makes a
        // household on anything other than the standard port testable.
        const [host, port] = String(seed).split(':');
        remember(host, port ? Number(port) : undefined);
      }
      try {
        // One answer describes the whole household, so there is no reason to
        // sit out the full search window before getting on with it.
        // A Sonos household is one household: whoever answers first can
        // describe all of it, so there is nothing to gain from sitting out the
        // rest of the search window.
        const hits = await discover({ timeout: this.discoveryTimeout, stopAfterFirst: true });
        for (const hit of hits) remember(hit.host, hit.port);
      } catch (error) {
        this.log.debug?.(`SSDP sweep failed: ${error.message}`);
      }

      if (targets.size === 0 && this.players.size > 0) {
        // Nothing answered but we already know players — keep what we have and
        // let the topology refresh decide whether they are really gone.
        for (const player of this.players.values()) remember(player.host, player.port);
      }

      // One player is enough to learn the whole household, but describing a few
      // in parallel makes us resilient to the first one being asleep.
      const described = await Promise.allSettled(
        [...targets.values()].map(async ({ host, port }) => {
          const player = new SonosPlayer({ host, port });
          await player.describe(4000);
          return player;
        }),
      );

      const knownBefore = new Set(this.players.keys());
      let seed = null;
      for (const result of described) {
        if (result.status !== 'fulfilled') continue;
        const player = result.value;
        if (!player.uuid) continue;
        this._upsert(player);
        if (!seed) seed = player;
      }
      this._firstSweep = this._firstSweep === undefined ? true : false;
      this._knownBefore = knownBefore;

      if (!seed) {
        this.ready = false;
        this.lastDiscoveryAt = Date.now();
        if (hosts.size === 0) {
          this.log.warn(
            'No Sonos players answered discovery. If your network blocks multicast, add their IP addresses under Settings → Manual player IPs.',
          );
        }
        return [];
      }

      await this.refreshTopology(seed);
      this.lastDiscoveryAt = Date.now();
      this.ready = this.players.size > 0;

      // Topology is what really reveals the household, so compare afterwards.
      const appeared = this.list().filter((player) => !this._knownBefore.has(player.uuid));
      if (appeared.length > 0 && !this._firstSweep) {
        for (const player of appeared) {
          this.recentlyAdded = [
            { uuid: player.uuid, name: player.name, seenAt: Date.now() },
            ...this.recentlyAdded.filter((entry) => entry.uuid !== player.uuid),
          ].slice(0, 20);
        }
        this.log.info(
          t(appeared.length === 1 ? 'log.newPlayers' : 'log.newPlayersMany', {
            names: appeared.map((player) => player.name).join(', '),
          }),
        );
        this.emit('newPlayers', appeared.map((player) => player.name));
      }

      this.emit('players', this.list());
      return this.list();
    })().finally(() => {
      this._discovering = null;
    });

    return this._discovering;
  }

  /** @private */
  _upsert(player) {
    const existing = this.players.get(player.uuid);
    if (existing) {
      existing.host = player.host || existing.host;
      existing.name = player.name || existing.name;
      existing.model = player.model || existing.model;
      return existing;
    }
    this.players.set(player.uuid, player);
    return player;
  }

  /**
   * Ask one player for the household topology and rebuild our view from it.
   *
   * A scene fires many steps at once and several of them want fresh grouping;
   * they all share one request rather than hammering the same speaker. A very
   * recent result is reused outright.
   *
   * Callers that just need "recent enough" pass `maxAgeMs`; the default is to
   * go and look, because an explicit call means the answer matters.
   *
   * @param {SonosPlayer} [seed]
   * @param {{maxAgeMs?: number}} [options]
   */
  refreshTopology(seed, { maxAgeMs = 0 } = {}) {
    if (!seed && this.lastTopologyAt && Date.now() - this.lastTopologyAt < maxAgeMs) {
      return Promise.resolve(this.groups);
    }
    if (this._topologyPromise) return this._topologyPromise;
    this._topologyPromise = this._refreshTopology(seed).finally(() => {
      this._topologyPromise = null;
    });
    return this._topologyPromise;
  }

  /** @private */
  async _refreshTopology(seed) {
    // Prefer whoever answered last: a sleeping speaker must not cost us a full
    // timeout on every single refresh just because it sorts first by name.
    const source =
      seed ||
      (this._topologySource && this.players.get(this._topologySource.uuid)) ||
      this.list()[0] ||
      [...this.players.values()][0];
    if (!source) return this.groups;

    let xml = '';
    let answered = source;
    try {
      xml = await source.getZoneGroupState();
    } catch (error) {
      // Ask everyone else at once instead of waiting out one timeout after
      // another — the first usable answer wins.
      const alternates = [...this.players.values()].filter((player) => player !== source);
      if (alternates.length > 0) {
        try {
          const winner = await Promise.any(
            alternates.map(async (alternate) => ({
              player: alternate,
              xml: await alternate.getZoneGroupState(),
            })),
          );
          xml = winner.xml;
          answered = winner.player;
        } catch {
          /* every player refused */
        }
      }
      if (!xml) {
        this._topologySource = null;
        this.log.debug?.(t('log.topologyFailed', { message: error.message }));
        return this.groups;
      }
    }
    this._topologySource = answered;

    const document = parseXml(xml);
    const groupNodes = findAll(document, 'ZoneGroup');
    if (groupNodes.length === 0) return this.groups;

    const groups = [];
    const seen = new Set();

    for (const groupNode of groupNodes) {
      const coordinatorUuid = groupNode.attrs.Coordinator || '';
      const memberUuids = [];

      for (const memberNode of groupNode.children) {
        if (memberNode.local !== 'ZoneGroupMember') continue;
        const uuid = memberNode.attrs.UUID;
        if (!uuid) continue;

        const invisible =
          memberNode.attrs.Invisible === '1' || memberNode.attrs.IsZoneBridge === '1';
        const locationMatch = /^https?:\/\/([^:/]+)(?::(\d+))?/.exec(memberNode.attrs.Location || '');
        const host = locationMatch ? locationMatch[1] : '';
        const port = locationMatch?.[2] ? Number(locationMatch[2]) : this.port;

        let player = this.players.get(uuid);
        if (!player) {
          player = new SonosPlayer({ uuid, host, name: memberNode.attrs.ZoneName || '', port });
          this.players.set(uuid, player);
        }
        if (host) player.host = host;
        if (port) player.port = port;
        if (memberNode.attrs.ZoneName) player.name = memberNode.attrs.ZoneName;
        player.invisible = invisible;
        player.coordinatorUuid = coordinatorUuid || uuid;
        player.groupId = groupNode.attrs.ID || '';
        seen.add(uuid);
        if (!invisible) memberUuids.push(uuid);
      }

      if (memberUuids.length > 0) {
        // Coordinator first — callers rely on that ordering.
        memberUuids.sort((a, b) => (a === coordinatorUuid ? -1 : b === coordinatorUuid ? 1 : 0));
        groups.push({ coordinatorUuid, id: groupNode.attrs.ID || coordinatorUuid, memberUuids });
      }
    }

    // Drop players the household no longer reports (removed, or permanently off).
    for (const uuid of [...this.players.keys()]) {
      if (!seen.has(uuid)) this.players.delete(uuid);
    }

    this.groups = groups;
    this.lastTopologyAt = Date.now();
    this.emit('topology', groups);
    return groups;
  }

  /**
   * Record a grouping change we just made ourselves.
   *
   * Without this, the short topology-reuse window would still describe the
   * household as it was a moment ago — and a scene run twice in quick
   * succession would either redo work it had just done, or worse, decide that
   * work was unnecessary based on a stale picture.
   *
   * @param {string} playerUuid
   * @param {string} coordinatorUuid  The player's own uuid means "standalone".
   */
  noteGrouping(playerUuid, coordinatorUuid) {
    const player = this.players.get(playerUuid);
    if (!player) return;
    player.coordinatorUuid = coordinatorUuid || playerUuid;
    this._rebuildGroups();
  }

  /** @private Derive `groups` from what each player currently follows. */
  _rebuildGroups() {
    const byCoordinator = new Map();
    for (const player of this.players.values()) {
      if (player.invisible) continue;
      const coordinator = player.coordinatorUuid || player.uuid;
      if (!byCoordinator.has(coordinator)) byCoordinator.set(coordinator, []);
      byCoordinator.get(coordinator).push(player.uuid);
    }
    this.groups = [...byCoordinator.entries()].map(([coordinatorUuid, memberUuids]) => {
      memberUuids.sort((a, b) => (a === coordinatorUuid ? -1 : b === coordinatorUuid ? 1 : 0));
      return { coordinatorUuid, id: coordinatorUuid, memberUuids };
    });
  }

  /** Refresh topology on a timer so the UI and conditions stay honest. */
  startTopologyWatch() {
    if (this._topologyTimer) return;
    this._topologyTimer = setInterval(() => {
      this.refreshTopology().catch(() => {});
    }, this.topologyIntervalMs);
    this._topologyTimer.unref?.();
  }

  /**
   * Sweep the network now and then, so a speaker you set up this afternoon is
   * simply there — no restart, no button to press.
   * @param {number} [intervalMs]
   */
  startDiscoveryWatch(intervalMs = 300000) {
    if (this._rediscoverTimer) return;
    this._rediscoverTimer = setInterval(() => {
      this.discover({ force: true }).catch(() => {});
    }, Math.max(60000, intervalMs));
    this._rediscoverTimer.unref?.();
  }

  stop() {
    if (this._topologyTimer) {
      clearInterval(this._topologyTimer);
      this._topologyTimer = null;
    }
    if (this._rediscoverTimer) {
      clearInterval(this._rediscoverTimer);
      this._rediscoverTimer = null;
    }
    this.removeAllListeners();
  }

  /**
   * Start something on a player, skipping the expensive part when it is
   * already loaded.
   *
   * Pushing a Spotify playlist onto the queue means Sonos fetches it from the
   * service — comfortably the slowest thing a scene does. If the very same
   * container is still sitting in the queue and the player is still pointed at
   * that queue, pressing the scene again only needs a Play.
   *
   * @param {import('./player').SonosPlayer} player
   * @param {{uri: string, metadata?: string, isContainer?: boolean, title?: string}} item
   * @param {{reuseQueue?: boolean}} [options]
   * @returns {Promise<'reused'|'loaded'>}
   */
  async playOn(player, item, { reuseQueue = true } = {}) {
    if (item.isContainer && reuseQueue) {
      const memo = this._queueMemo.get(player.uuid);
      if (memo && memo.uri === item.uri) {
        const [media, queue] = await Promise.all([
          player.getMediaInfo().catch(() => null),
          player.getQueueInfo().catch(() => null),
        ]);
        const pointedAtQueue = media?.uri === `x-rincon-queue:${player.uuid}#0`;
        // The update id catches anyone — including the Sonos app — having
        // changed the queue behind our back.
        const untouched = queue && queue.total > 0 && queue.updateId === memo.updateId;
        if (pointedAtQueue && untouched) {
          await player.play();
          return 'reused';
        }
      }
    }

    await player.playItem(item);

    if (item.isContainer) {
      const queue = await player.getQueueInfo().catch(() => null);
      if (queue) this._queueMemo.set(player.uuid, { uri: item.uri, updateId: queue.updateId });
      else this._queueMemo.delete(player.uuid);
    } else {
      this._queueMemo.delete(player.uuid);
    }
    return 'loaded';
  }

  /**
   * Set shuffle and/or repeat in a single request where possible.
   *
   * Sonos encodes both in one PlayMode string, so changing only one normally
   * means reading the current value back first. We remember what we set, which
   * removes that round trip on every scene after the first.
   *
   * @param {import('./player').SonosPlayer} player
   * @param {{shuffle?: boolean|null, repeat?: string|null}} wanted
   */
  async setPlayModeOn(player, wanted) {
    const known = this._playModeMemo.get(player.uuid);
    const fresh = known && Date.now() - known.at < this.playModeMemoTtlMs;
    const needsRead =
      wanted.shuffle === null ||
      wanted.shuffle === undefined ||
      wanted.repeat === null ||
      wanted.repeat === undefined;

    let current = fresh ? known : null;
    if (needsRead && !current) current = await player.getPlayMode();

    const shuffle =
      wanted.shuffle === null || wanted.shuffle === undefined
        ? Boolean(current?.shuffle)
        : Boolean(wanted.shuffle);
    const repeat =
      wanted.repeat === null || wanted.repeat === undefined ? current?.repeat || 'none' : wanted.repeat;

    await player.setPlayMode(shuffle, repeat);
    this._playModeMemo.set(player.uuid, { shuffle, repeat, at: Date.now() });
    return { shuffle, repeat };
  }

  // ----------------------------------------------------------------- library

  /**
   * Favourites, playlists and radio stations. Cached, because browsing takes
   * a few hundred milliseconds and the answer barely ever changes.
   * @param {{force?: boolean}} [options]
   */
  async getLibrary({ force = false } = {}) {
    const fresh = Date.now() - this._library.fetchedAt < this.libraryTtlMs;
    // Gate on "have we loaded it", not "did it contain favourites" — a house
    // that only uses playlists would otherwise re-browse everything every time.
    if (!force && fresh && this._library.loaded) return this._library;
    if (this._libraryPromise) return this._libraryPromise;

    this._libraryPromise = (async () => {
      const source = this.list()[0];
      if (!source) return this._library;
      const [favorites, playlists, radio] = await Promise.all([
        source.getFavorites().catch(() => []),
        source.getPlaylists().catch(() => []),
        source.getRadioStations().catch(() => []),
      ]);
      this._library = { favorites, playlists, radio, fetchedAt: Date.now(), loaded: true };
      this.emit('library', this._library);
      return this._library;
    })().finally(() => {
      this._libraryPromise = null;
    });

    return this._libraryPromise;
  }

  /**
   * Find a favourite by name. Falls back to a case-insensitive contains match,
   * because emoji and punctuation in favourite names are easy to mistype.
   * @param {string} name
   */
  async findFavorite(name) {
    const library = await this.getLibrary();
    return this._pick(library.favorites, name);
  }

  async findPlaylist(name) {
    const library = await this.getLibrary();
    return this._pick(library.playlists, name);
  }

  async findRadio(name) {
    const library = await this.getLibrary();
    return this._pick(library.radio, name);
  }

  /** @private */
  _pick(items, name) {
    if (!name) return null;
    const wanted = String(name).trim();
    const exact = items.find((item) => item.title === wanted);
    if (exact) return exact;
    const variants = nameVariants(wanted);
    const loose = items.find((item) => variantsOverlap(variants, nameVariants(item.title)));
    if (loose) return loose;
    // Last resort: a favourite whose title contains what was asked for. Emoji
    // and punctuation in favourite names make exact matching brittle.
    const normalized = normalizeName(wanted);
    if (normalized.length <= 2) return null;
    return items.find((item) => normalizeName(item.title).includes(normalized)) || null;
  }

  /**
   * A compact snapshot for the UI.
   *
   * Playback state belongs to the *group*, not to the individual speaker: a
   * follower's own transport is slaved and reports nothing useful. So the
   * state is read once per group coordinator and applied to every member —
   * one request per group instead of one per speaker, and an answer that
   * matches what you actually hear in the room.
   */
  async snapshot({ withState = false } = {}) {
    const players = this.list();
    const base = players.map((player) => ({
      ...player.toJSON(),
      coordinatorName: this.coordinatorFor(player)?.name || player.name,
    }));
    if (!withState) return base;

    await this.refreshTopology(undefined, { maxAgeMs: 2000 }).catch(() => {});

    // One transport read per group.
    const coordinators = new Map();
    for (const player of this.list()) {
      const coordinator = this.coordinatorFor(player) || player;
      if (!coordinators.has(coordinator.uuid)) coordinators.set(coordinator.uuid, coordinator);
    }

    const groupState = new Map();
    await Promise.all(
      [...coordinators.values()].map(async (coordinator) => {
        const [transport, position] = await Promise.all([
          coordinator.getTransportInfo().catch(() => null),
          coordinator.getPositionInfo().catch(() => null),
        ]);
        const state = transport?.state || null;
        const playing = state === 'PLAYING' || state === 'TRANSITIONING';
        groupState.set(coordinator.uuid, {
          state,
          playing,
          title: playing ? position?.title || '' : '',
          artist: playing ? position?.artist || '' : '',
          albumArt: playing ? position?.albumArt || '' : '',
        });
      }),
    );

    // Volume and mute are genuinely per speaker.
    const levels = await Promise.all(
      players.map(async (player) => ({
        volume: await player.getVolume().catch(() => null),
        muted: await player.getMute().catch(() => null),
      })),
    );

    return base.map((entry, index) => {
      const group = groupState.get(entry.coordinatorUuid) || groupState.get(entry.uuid) || {};
      return {
        ...entry,
        volume: levels[index].volume,
        muted: levels[index].muted,
        state: group.state ?? null,
        playing: Boolean(group.playing),
        nowPlaying: group.title ? { title: group.title, artist: group.artist, albumArt: group.albumArt } : null,
      };
    });
  }
}

module.exports = { SonosSystem, normalizeName, nameVariants };
