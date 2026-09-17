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
   * @param {number} [options.describeTimeoutMs] How long to wait for one
   *   speaker's device description during discovery. A speaker that is off
   *   costs this much on every sweep; the suite sets it low.
   */
  constructor({
    log,
    seedHosts = [],
    discoveryTimeout = 4000,
    topologyIntervalMs = 30000,
    libraryTtlMs = 300000,
    describeTimeoutMs = 4000,
    port,
    discoverFn = discover,
  } = {}) {
    super();
    this.log = log;
    this.seedHosts = seedHosts.filter(Boolean);
    /** Overridable only so the test suite can run fake players on loopback. */
    this.port = port;
    /**
     * The SSDP sweep, overridable for the same reason — and for a sharper one:
     * a test that calls the real one broadcasts on whatever network the machine
     * is plugged into. Run the suite in a house that owns Sonos speakers and
     * they answer, join the fixture, and are then a candidate for whatever the
     * test was about to do. The suite hands in a sweep that finds nothing.
     */
    this.discoverFn = discoverFn;
    this.discoveryTimeout = discoveryTimeout;
    this.topologyIntervalMs = topologyIntervalMs;
    this.libraryTtlMs = libraryTtlMs;
    this.describeTimeoutMs = describeTimeoutMs;

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
    /**
     * Players absent from the last topology reply but not yet given up on.
     * One missing sighting is a rebooting speaker; two is a speaker that has
     * gone.
     * @type {Set<string>}
     */
    this._missing = new Set();
    this._topologyTimer = null;
    this._rediscoverTimer = null;
    this._discovering = null;
    this.lastDiscoveryAt = 0;
    this.lastTopologyAt = 0;
    this.ready = false;
    /** Rooms seen for the first time since the plugin started, newest first. */
    this.recentlyAdded = [];
    /**
     * Every uuid this process has ever had in `players`, so a speaker that is
     * forgotten and found again is not announced as new a second time.
     * @type {Set<string>}
     */
    this._everSeen = new Set();
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
        const hits = await this.discoverFn({
          timeout: this.discoveryTimeout,
          stopAfterFirst: true,
        });
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
          await player.describe(this.describeTimeoutMs);
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
        // Two different silences, and telling them apart is the whole value of
        // the message: nothing on the network answered at all, or the addresses
        // we were handed did not answer. The second case used to say nothing —
        // and the first threw a ReferenceError instead of the sentence below.
        const hosts = [...targets.values()].map((target) => target.host).join(', ');
        this.log.warn(hosts ? t('log.noPlayersAnswered', { hosts }) : t('log.noPlayers'));
        return [];
      }

      await this.refreshTopology(seed);
      this.lastDiscoveryAt = Date.now();
      this.ready = this.players.size > 0;

      // Topology is what really reveals the household, so compare afterwards.
      //
      // "Not known when this sweep started" is not the same as new. A player
      // can leave our map and come back — a speaker that misses two topology
      // replies is forgotten on purpose, and anything that answers SSDP is
      // found again on the next sweep. Comparing against this sweep alone
      // called that a new speaker, over and over. So a player has to be one we
      // have never seen at all.
      const appeared = this.list().filter(
        (player) => !this._knownBefore.has(player.uuid) && !this._everSeen.has(player.uuid),
      );
      for (const uuid of this.players.keys()) this._everSeen.add(uuid);

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
      // The port travels with the host or the two disagree. Rediscovery used
      // to keep the old port while the topology refresh updated it, so the two
      // paths described the same speaker differently.
      if (player.port) existing.port = player.port;
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
        // Record the attempt even though it failed. Without this the freshness
        // guard never suppressed anything, so a household where nothing answers
        // paid the full fan-out on *every* call — a speakers view that took
        // 25 seconds and then did it again on the next refresh.
        this.lastTopologyAt = Date.now();
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

      /**
       * Take one speaker out of the topology and bring our copy up to date.
       * @param {object} node
       * @param {boolean} [bonded] A satellite is never a room, whatever it says.
       * @returns {{uuid: string, invisible: boolean}|null}
       */
      const register = (node, bonded = false) => {
        const uuid = node.attrs.UUID;
        if (!uuid) return null;

        const invisible =
          bonded || node.attrs.Invisible === '1' || node.attrs.IsZoneBridge === '1';
        const locationMatch = /^https?:\/\/([^:/]+)(?::(\d+))?/.exec(node.attrs.Location || '');
        const host = locationMatch ? locationMatch[1] : '';
        const port = locationMatch?.[2] ? Number(locationMatch[2]) : this.port;

        let player = this.players.get(uuid);
        if (!player) {
          player = new SonosPlayer({ uuid, host, name: node.attrs.ZoneName || '', port });
          this.players.set(uuid, player);
        }
        if (host) player.host = host;
        if (port) player.port = port;
        if (node.attrs.ZoneName) player.name = node.attrs.ZoneName;
        player.invisible = invisible;
        player.coordinatorUuid = coordinatorUuid || uuid;
        player.groupId = groupNode.attrs.ID || '';
        seen.add(uuid);
        return { uuid, invisible };
      };

      for (const memberNode of groupNode.children) {
        if (memberNode.local !== 'ZoneGroupMember') continue;
        const member = register(memberNode);
        if (!member) continue;
        if (!member.invisible) memberUuids.push(member.uuid);

        // A bonded speaker — the second half of a stereo pair, a Sub, a Sub
        // Mini — is reported *inside* the member it belongs to, as a
        // `<Satellite>`, never as a member of its own. Reading only the members
        // meant these were absent from every topology reply, so the rule below
        // forgot them; SSDP then found them again, because they are real
        // devices on the network with their own address, and each rediscovery
        // announced them as new speakers. Every five minutes, indefinitely.
        //
        // They are marked invisible whatever the attribute says. Sonos does set
        // it, but a satellite is not a room by definition, and one firmware
        // that omitted the flag would put the same speaker in the room list
        // twice under the same name.
        for (const satelliteNode of memberNode.children) {
          if (satelliteNode.local !== 'Satellite') continue;
          register(satelliteNode, true);
        }
      }

      if (memberUuids.length > 0) {
        // Coordinator first — callers rely on that ordering.
        memberUuids.sort((a, b) => (a === coordinatorUuid ? -1 : b === coordinatorUuid ? 1 : 0));
        groups.push({ coordinatorUuid, id: groupNode.attrs.ID || coordinatorUuid, memberUuids });
      }
    }

    // Drop players the household no longer reports — but not on one answer.
    //
    // This whole picture comes from a single speaker, and a speaker that has
    // just rebooted reports only itself for a few seconds. So does one on the
    // wrong side of a VLAN, or in a household that has briefly split. Deleting
    // on the first sighting meant every scene in that window failed with "room
    // not found" — and worse, it removed the very players the next refresh
    // would have asked for a second opinion, so nothing was left to recover
    // from.
    //
    // A player has to be absent from two consecutive replies to be forgotten.
    // The first absence is recorded and nothing else happens.
    for (const uuid of [...this.players.keys()]) {
      if (seen.has(uuid)) {
        this._missing.delete(uuid);
        continue;
      }
      if (this._missing.has(uuid)) {
        this.players.delete(uuid);
        this._missing.delete(uuid);
        // Nothing should outlive the player it describes.
        this._queueMemo.delete(uuid);
        this._playModeMemo.delete(uuid);
      } else {
        this._missing.add(uuid);
        this.log.debug?.(`${this.players.get(uuid)?.name || uuid} missing from this topology reply`);
      }
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
   *
   * A copy that has gone past its time is still handed back at once, and a
   * fresh one fetched behind it. Waiting instead meant the settings page could
   * not open until three Browse calls had come back — a few hundred
   * milliseconds when the speaker asked is awake, and nine and a half seconds
   * when it is not — for a list that had not changed since last time. Nobody
   * adds a favourite in the five minutes between two visits and needs to see
   * it before the page appears; they see it on the next refresh.
   *
   * `force` still waits: that is the refresh button, and "I asked for a new
   * list" should mean the list that comes back is new. `wait: false` never
   * does, not even before the first fetch has finished — it hands back what
   * there is, starts the fetch, and lets the caller ask again.
   *
   * @param {{force?: boolean, wait?: boolean}} [options]
   */
  async getLibrary({ force = false, wait = true } = {}) {
    const fresh = Date.now() - this._library.fetchedAt < this.libraryTtlMs;
    // Gate on "have we loaded it", not "did it contain favourites" — a house
    // that only uses playlists would otherwise re-browse everything every time.
    if (!force && fresh && this._library.loaded) return this._library;
    if (!force && (this._library.loaded || !wait)) {
      this._fetchLibrary().catch(() => {});
      return this._library;
    }
    return this._fetchLibrary();
  }

  /** @private Browse the household once, sharing one request between callers. */
  _fetchLibrary() {
    if (this._libraryPromise) return this._libraryPromise;
    this._libraryPromise = (async () => {
      // Ask whoever answered the topology last. The first speaker by name was
      // asked before, and when that one is asleep every library fetch waited
      // out its timeout — while thirteen others would have answered at once.
      const source =
        (this._topologySource && this.players.get(this._topologySource.uuid)) || this.list()[0];
      if (!source) return this._library;

      // A Browse that fails hands back *nothing*, and nothing must not replace
      // something. This used to be `.catch(() => [])`: one speaker answering
      // one Browse with an error — mid-reboot, a music service re-authenticating
      // — wrote an empty list over a good one and stamped it fresh. For the
      // next five minutes every scene said the favourite "no longer exists",
      // and the log showed a scene that had worked at 06:30:02 failing that way
      // at 06:31:20. Each list that fails keeps what it had.
      const previous = this._library;
      const settled = await Promise.allSettled([
        source.getFavorites(),
        source.getPlaylists(),
        source.getRadioStations(),
      ]);
      const [favorites, playlists, radio] = settled.map((outcome, index) =>
        outcome.status === 'fulfilled'
          ? outcome.value
          : [previous.favorites, previous.playlists, previous.radio][index],
      );
      const anyFailed = settled.some((outcome) => outcome.status === 'rejected');
      if (anyFailed) {
        this.log.debug?.(
          `library: ${source.name} did not answer every Browse — keeping the previous list where it did not`,
        );
      }
      // Nothing answered and nothing was known before: the library is still
      // unloaded, so the next call asks again instead of serving an empty list
      // as though it were the answer.
      const loaded = previous.loaded || settled.some((outcome) => outcome.status === 'fulfilled');
      this._library = { favorites, playlists, radio, fetchedAt: Date.now(), loaded };
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
  findFavorite(name) {
    return this._lookup('favorites', name);
  }

  findPlaylist(name) {
    return this._lookup('playlists', name);
  }

  findRadio(name) {
    return this._lookup('radio', name);
  }

  /**
   * @private Look a name up in the cached list — and, before saying it is not
   * there, in a fresh one.
   *
   * "That favourite no longer exists" is a strong claim to make from a list
   * that may be five minutes old, or that a failed Browse has just emptied.
   * A miss is rare, so the Browse it costs is paid almost never; a false
   * "gone" is paid by a scene that does nothing at 06:30.
   */
  async _lookup(kind, name) {
    const cached = await this.getLibrary();
    const found = this._pick(cached[kind], name);
    if (found) return found;
    const fresh = await this._fetchLibrary().catch(() => cached);
    return this._pick(fresh[kind], name);
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

    // This is a glance, not a command. A speaker that is there answers in tens
    // of milliseconds; one that has not answered in over a second is asleep or
    // unplugged, and a second attempt would only make the page wait for it
    // twice. Scenes keep the patient timeouts — they are trying to make
    // something happen. A status read is not.
    const glance = { timeout: 1200, retry: false };

    // One transport read per group.
    const coordinators = new Map();
    for (const player of this.list()) {
      const coordinator = this.coordinatorFor(player) || player;
      if (!coordinators.has(coordinator.uuid)) coordinators.set(coordinator.uuid, coordinator);
    }

    // Group state and per-speaker levels have nothing to do with each other,
    // so they are asked for at the same time. One after the other, a sleeping
    // speaker held the page for two full waits rather than one.
    const groupState = new Map();
    const [, levels] = await Promise.all([
      Promise.all(
        [...coordinators.values()].map(async (coordinator) => {
          const [transport, position] = await Promise.all([
            coordinator.getTransportInfo(glance).catch(() => null),
            coordinator.getPositionInfo(glance).catch(() => null),
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
      ),
      // Volume and mute are genuinely per speaker — and genuinely independent
      // of each other, so they go out together. Awaiting them one after the
      // other inside an object literal looks parallel and is not: an
      // unreachable speaker used to cost two timeouts instead of one.
      Promise.all(
        players.map(async (player) => {
          const [volume, muted] = await Promise.all([
            player.getVolume(glance).catch(() => null),
            player.getMute(glance).catch(() => null),
          ]);
          return { volume, muted };
        }),
      ),
    ]);

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
