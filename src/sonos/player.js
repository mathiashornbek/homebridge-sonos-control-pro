'use strict';

const { soapRequest, httpGet, SONOS_PORT } = require('./soap');
const { parseXml, find, text } = require('./xml');
const { parseDidl, buildDidl, classify, isFavoriteWrapper } = require('./didl');
const { t } = require('../i18n');

const PLAY_MODES = {
  normal: 'NORMAL',
  repeatAll: 'REPEAT_ALL',
  repeatOne: 'REPEAT_ONE',
  shuffleNoRepeat: 'SHUFFLE_NOREPEAT',
  shuffleRepeatAll: 'SHUFFLE',
  shuffleRepeatOne: 'SHUFFLE_REPEAT_ONE',
};

/** Split a Sonos PlayMode string into the two independent switches it encodes. */
function decodePlayMode(mode) {
  switch (mode) {
    case 'REPEAT_ALL':
      return { shuffle: false, repeat: 'all' };
    case 'REPEAT_ONE':
      return { shuffle: false, repeat: 'one' };
    case 'SHUFFLE_NOREPEAT':
      return { shuffle: true, repeat: 'none' };
    case 'SHUFFLE':
      return { shuffle: true, repeat: 'all' };
    case 'SHUFFLE_REPEAT_ONE':
      return { shuffle: true, repeat: 'one' };
    default:
      return { shuffle: false, repeat: 'none' };
  }
}

/** Inverse of {@link decodePlayMode}. */
function encodePlayMode(shuffle, repeat) {
  if (shuffle) {
    if (repeat === 'all') return PLAY_MODES.shuffleRepeatAll;
    if (repeat === 'one') return PLAY_MODES.shuffleRepeatOne;
    return PLAY_MODES.shuffleNoRepeat;
  }
  if (repeat === 'all') return PLAY_MODES.repeatAll;
  if (repeat === 'one') return PLAY_MODES.repeatOne;
  return PLAY_MODES.normal;
}

/**
 * Volumes must be a real number. Silently coercing a blank field to 0 would
 * mute the whole house and report success, which is the worst possible answer.
 */
function clampVolume(value) {
  // `Number(' ')`, `Number([])` and `Number(false)` are all 0, so a
  // whitespace-only field used to sail through as "mute the whole house, and
  // report success" — the exact answer the paragraph above says must never
  // happen. Only a string or a number is a volume at all, and a string has to
  // have something in it.
  const blank =
    value === null ||
    value === undefined ||
    (typeof value === 'string' && value.trim() === '') ||
    (typeof value !== 'string' && typeof value !== 'number');
  if (blank) {
    throw new Error(t('error.noVolume'));
  }
  const number = Math.round(Number(value));
  if (!Number.isFinite(number)) {
    throw new Error(t('error.invalidVolume', { value }));
  }
  return Math.min(100, Math.max(0, number));
}

/**
 * One Sonos speaker, addressed directly over the local network.
 *
 * Every method is a thin, well-named wrapper over a single SOAP action so that
 * failures point at exactly one thing that went wrong.
 */
class SonosPlayer {
  /**
   * @param {object} options
   * @param {string} options.host
   * @param {string} [options.uuid]
   * @param {string} [options.name]
   */
  constructor({ host, uuid = '', name = '', model = '', icon = '', port = SONOS_PORT }) {
    this.host = host;
    this.port = port;
    this.uuid = uuid;
    this.name = name;
    this.model = model;
    this.icon = icon;
    /** Set by the system when topology is refreshed. */
    this.coordinatorUuid = uuid;
    this.groupId = '';
    this.invisible = false;
  }

  get isCoordinator() {
    return !this.coordinatorUuid || this.coordinatorUuid === this.uuid;
  }

  /**
   * A view of this player whose requests are cancelled when `signal` aborts.
   *
   * Prototype delegation rather than a copy: every method, and every later
   * change to the underlying player, still applies — only the signal is added.
   *
   * @param {AbortSignal} [signal]
   * @returns {SonosPlayer}
   */
  withSignal(signal) {
    if (!signal) return this;
    const bound = Object.create(this);
    bound._signal = signal;
    return bound;
  }

  /** @private */
  _call(service, action, args, options = {}) {
    return soapRequest({
      host: this.host,
      port: this.port,
      signal: this._signal,
      service,
      action,
      args,
      ...options,
    });
  }

  // ---------------------------------------------------------------- identity

  /** Read `/xml/device_description.xml` to learn the UUID, name and model. */
  async describe(timeout = 3000) {
    const xml = await httpGet(this.host, '/xml/device_description.xml', timeout, this.port);
    const document = parseXml(xml);
    const device = find(document, 'device');
    const udn = text(device, 'UDN', '');
    this.uuid = udn.replace(/^uuid:/, '') || this.uuid;
    this.name = text(device, 'roomName', '') || this.name;
    this.model = text(device, 'modelName', '') || this.model;
    this.icon = text(device, 'modelNumber', '') || this.icon;
    this.serialNumber = text(device, 'serialNum', '');
    this.softwareVersion = text(device, 'softwareVersion', '');
    this.macAddress = text(device, 'MACAddress', '');
    return this;
  }

  async getZoneName() {
    const response = await this._call('DeviceProperties', 'GetZoneAttributes', {});
    return text(response, 'CurrentZoneName', this.name);
  }

  // ---------------------------------------------------------------- playback

  play() {
    return this._call('AVTransport', 'Play', { InstanceID: 0, Speed: 1 });
  }

  pause() {
    return this._call('AVTransport', 'Pause', { InstanceID: 0 });
  }

  stop() {
    return this._call('AVTransport', 'Stop', { InstanceID: 0 });
  }

  next() {
    return this._call('AVTransport', 'Next', { InstanceID: 0 });
  }

  previous() {
    return this._call('AVTransport', 'Previous', { InstanceID: 0 });
  }

  /**
   * @returns {Promise<{state: string, status: string}>} `state` is one of
   * PLAYING / PAUSED_PLAYBACK / STOPPED / TRANSITIONING.
   */
  async getTransportInfo() {
    const response = await this._call('AVTransport', 'GetTransportInfo', { InstanceID: 0 });
    return {
      state: text(response, 'CurrentTransportState', 'STOPPED'),
      status: text(response, 'CurrentTransportStatus', ''),
      speed: text(response, 'CurrentSpeed', '1'),
    };
  }

  async isPlaying() {
    const info = await this.getTransportInfo();
    return info.state === 'PLAYING' || info.state === 'TRANSITIONING';
  }

  async getMediaInfo() {
    const response = await this._call('AVTransport', 'GetMediaInfo', { InstanceID: 0 });
    return {
      uri: text(response, 'CurrentURI', ''),
      metadata: text(response, 'CurrentURIMetaData', ''),
      trackCount: Number(text(response, 'NrTracks', '0')) || 0,
    };
  }

  async getPositionInfo() {
    const response = await this._call('AVTransport', 'GetPositionInfo', { InstanceID: 0 });
    const metadata = text(response, 'TrackMetaData', '');
    const [item] = metadata && metadata !== 'NOT_IMPLEMENTED' ? parseDidl(metadata) : [];
    return {
      track: Number(text(response, 'Track', '0')) || 0,
      duration: text(response, 'TrackDuration', ''),
      position: text(response, 'RelTime', ''),
      uri: text(response, 'TrackURI', ''),
      title: item?.title || '',
      artist: item?.creator || '',
      album: item?.album || '',
      albumArt: item?.albumArt || '',
    };
  }

  setAVTransportURI(uri, metadata = '') {
    return this._call('AVTransport', 'SetAVTransportURI', {
      InstanceID: 0,
      CurrentURI: uri,
      CurrentURIMetaData: metadata,
    });
  }

  clearQueue() {
    return this._call('AVTransport', 'RemoveAllTracksFromQueue', { InstanceID: 0 });
  }

  addToQueue(uri, metadata = '', { asNext = false, position = 0 } = {}) {
    return this._call('AVTransport', 'AddURIToQueue', {
      InstanceID: 0,
      EnqueuedURI: uri,
      EnqueuedURIMetaData: metadata,
      DesiredFirstTrackNumberEnqueued: position,
      EnqueueAsNext: asNext ? 1 : 0,
    });
  }

  /** Point transport at this player's own queue and start at `track`. */
  playQueue(track = 1) {
    return this.setAVTransportURI(`x-rincon-queue:${this.uuid}#0`, '').then(() =>
      track > 1 ? this.seekTrack(track) : undefined,
    );
  }

  seekTrack(track) {
    return this._call('AVTransport', 'Seek', { InstanceID: 0, Unit: 'TRACK_NR', Target: track });
  }

  seekTime(hhmmss) {
    return this._call('AVTransport', 'Seek', { InstanceID: 0, Unit: 'REL_TIME', Target: hhmmss });
  }

  /**
   * Play anything: a favourite, a playlist, a radio stream or a raw URI.
   * Containers are queued; streams are set directly. This mirrors what the
   * Sonos app itself does.
   *
   * @param {{uri: string, metadata?: string, isContainer?: boolean, title?: string}} playable
   */
  async playItem(playable) {
    const { uri } = playable;
    if (!uri) throw new Error(t('error.nothingToPlay'));

    // Ask the URI, do not merely believe the caller.
    //
    // `classify()` exists for exactly this decision and was called only when
    // parsing a favourite — never here. The raw-URI action hardcodes
    // `isContainer: false`, so pasting an `x-rincon-cpcontainer:` URI sent
    // SetAVTransportURI where the player needed a queue, and answered 714 or
    // simply nothing. The caller's flag still wins when the URI says nothing
    // either way, because a favourite's own metadata knows best.
    const derived = classify(uri, playable.upnpClass);
    const isContainer = derived.isStream
      ? false
      : derived.isContainer || Boolean(playable.isContainer);

    // Saved Sonos queues carry no `r:resMD` at all and must be enqueued with
    // empty metadata; inventing some makes the player reject them.
    const isSavedQueue = String(uri).startsWith('file:///jffs/settings/savedqueues.rsq');
    const metadata =
      playable.metadata ||
      (isSavedQueue
        ? ''
        : buildDidl({
            title: playable.title || 'Stream',
            uri,
            isContainer,
            // A favourites-list wrapper class is what the item is filed as,
            // not what it is, and a player refuses it.
            upnpClass: isFavoriteWrapper(playable.upnpClass) ? '' : playable.upnpClass,
          }));

    if (isContainer) {
      await this.clearQueue();
      await this.addToQueue(uri, metadata, { position: 0 });
      await this.setAVTransportURI(`x-rincon-queue:${this.uuid}#0`, '');
    } else {
      await this.setAVTransportURI(uri, metadata);
    }
    await this.play();
  }

  // ------------------------------------------------------------------ volume

  async getVolume() {
    const response = await this._call('RenderingControl', 'GetVolume', {
      InstanceID: 0,
      Channel: 'Master',
    });
    return Number(text(response, 'CurrentVolume', '0')) || 0;
  }

  setVolume(volume) {
    return this._call('RenderingControl', 'SetVolume', {
      InstanceID: 0,
      Channel: 'Master',
      DesiredVolume: clampVolume(volume),
    });
  }

  /**
   * Nudge the volume by `adjustment` percentage points. Sonos clamps for us.
   * @param {number} adjustment -100..100
   * @returns {Promise<number>} The resulting volume.
   */
  async setRelativeVolume(adjustment) {
    const delta = Math.max(-100, Math.min(100, Math.round(Number(adjustment) || 0)));
    const response = await this._call('RenderingControl', 'SetRelativeVolume', {
      InstanceID: 0,
      Channel: 'Master',
      Adjustment: delta,
    });
    return Number(text(response, 'NewVolume', '0')) || 0;
  }

  async getMute() {
    const response = await this._call('RenderingControl', 'GetMute', {
      InstanceID: 0,
      Channel: 'Master',
    });
    return text(response, 'CurrentMute', '0') === '1';
  }

  setMute(muted) {
    return this._call('RenderingControl', 'SetMute', {
      InstanceID: 0,
      Channel: 'Master',
      DesiredMute: muted ? 1 : 0,
    });
  }

  setBass(level) {
    return this._call('RenderingControl', 'SetBass', {
      InstanceID: 0,
      DesiredBass: Math.max(-10, Math.min(10, Math.round(Number(level) || 0))),
    });
  }

  setTreble(level) {
    return this._call('RenderingControl', 'SetTreble', {
      InstanceID: 0,
      DesiredTreble: Math.max(-10, Math.min(10, Math.round(Number(level) || 0))),
    });
  }

  setLoudness(enabled) {
    return this._call('RenderingControl', 'SetLoudness', {
      InstanceID: 0,
      Channel: 'Master',
      DesiredLoudness: enabled ? 1 : 0,
    });
  }

  // Group volume acts on the whole group at once and keeps the relative mix.
  async getGroupVolume() {
    const response = await this._call('GroupRenderingControl', 'GetGroupVolume', { InstanceID: 0 });
    return Number(text(response, 'CurrentVolume', '0')) || 0;
  }

  setGroupVolume(volume) {
    return this._call('GroupRenderingControl', 'SetGroupVolume', {
      InstanceID: 0,
      DesiredVolume: clampVolume(volume),
    });
  }

  setRelativeGroupVolume(adjustment) {
    return this._call('GroupRenderingControl', 'SetRelativeGroupVolume', {
      InstanceID: 0,
      Adjustment: Math.max(-100, Math.min(100, Math.round(Number(adjustment) || 0))),
    });
  }

  setGroupMute(muted) {
    return this._call('GroupRenderingControl', 'SetGroupMute', {
      InstanceID: 0,
      DesiredMute: muted ? 1 : 0,
    });
  }

  // ----------------------------------------------------------------- grouping

  /** Make this player follow `coordinatorUuid`'s group. */
  joinGroup(coordinatorUuid) {
    if (!coordinatorUuid) throw new Error('joinGroup needs the coordinator UUID');
    return this.setAVTransportURI(`x-rincon:${coordinatorUuid}`, '');
  }

  /** Break this player out into a group of its own. */
  leaveGroup() {
    return this._call('AVTransport', 'BecomeCoordinatorOfStandaloneGroup', { InstanceID: 0 });
  }

  // ------------------------------------------------------------------- modes

  async getPlayMode() {
    const response = await this._call('AVTransport', 'GetTransportSettings', { InstanceID: 0 });
    return decodePlayMode(text(response, 'PlayMode', 'NORMAL'));
  }

  async setShuffle(enabled) {
    const current = await this.getPlayMode();
    return this._call('AVTransport', 'SetPlayMode', {
      InstanceID: 0,
      NewPlayMode: encodePlayMode(Boolean(enabled), current.repeat),
    });
  }

  async setRepeat(mode) {
    const current = await this.getPlayMode();
    const repeat = ['none', 'one', 'all'].includes(mode) ? mode : 'none';
    return this._call('AVTransport', 'SetPlayMode', {
      InstanceID: 0,
      NewPlayMode: encodePlayMode(current.shuffle, repeat),
    });
  }

  setPlayMode(shuffle, repeat) {
    return this._call('AVTransport', 'SetPlayMode', {
      InstanceID: 0,
      NewPlayMode: encodePlayMode(Boolean(shuffle), repeat || 'none'),
    });
  }

  setCrossfade(enabled) {
    return this._call('AVTransport', 'SetCrossfadeMode', {
      InstanceID: 0,
      CrossfadeMode: enabled ? 1 : 0,
    });
  }

  async getCrossfade() {
    const response = await this._call('AVTransport', 'GetCrossfadeMode', { InstanceID: 0 });
    return text(response, 'CrossfadeMode', '0') === '1';
  }

  /** Switch a soundbar to its TV input. */
  playTVInput() {
    return this.setAVTransportURI(`x-sonos-htastream:${this.uuid}:spdif`, '');
  }

  /** Switch a Play:5 / Amp / Port to its analogue line-in. */
  playLineIn() {
    return this.setAVTransportURI(`x-rincon-stream:${this.uuid}`, '');
  }

  // ------------------------------------------------------------------ browse

  /**
   * Browse a ContentDirectory object, following pagination to the end.
   * @param {string} objectId `FV:2` favourites, `SQ:` playlists, `R:0/0` radio, `Q:0` queue.
   * @param {number} [pageSize]
   */
  async browse(objectId, pageSize = 500) {
    const items = [];
    let startIndex = 0;
    // Hard stop so a misbehaving player can never spin us forever.
    for (let page = 0; page < 40; page += 1) {
      const response = await this._call('ContentDirectory', 'Browse', {
        ObjectID: objectId,
        BrowseFlag: 'BrowseDirectChildren',
        Filter: '*',
        StartingIndex: startIndex,
        RequestedCount: pageSize,
        SortCriteria: '',
      });
      const result = text(response, 'Result', '');
      const returned = Number(text(response, 'NumberReturned', '0')) || 0;
      const total = Number(text(response, 'TotalMatches', '0')) || 0;
      items.push(...parseDidl(result));
      startIndex += returned;
      if (returned === 0 || startIndex >= total) break;
    }
    return items;
  }

  getFavorites() {
    return this.browse('FV:2');
  }

  getPlaylists() {
    return this.browse('SQ:');
  }

  getRadioStations() {
    return this.browse('R:0/0');
  }

  getQueue() {
    return this.browse('Q:0');
  }

  /**
   * Cheap fingerprint of the current queue.
   *
   * `UpdateID` changes whenever the queue is touched — by us, by the Sonos app,
   * by anyone. Comparing it is how we can tell that a playlist we loaded
   * earlier is still the one sitting there, without re-fetching it.
   *
   * @returns {Promise<{updateId: string, total: number}>}
   */
  async getQueueInfo() {
    const response = await this._call('ContentDirectory', 'Browse', {
      ObjectID: 'Q:0',
      BrowseFlag: 'BrowseDirectChildren',
      Filter: 'dc:title',
      StartingIndex: 0,
      RequestedCount: 1,
      SortCriteria: '',
    });
    return {
      updateId: text(response, 'UpdateID', ''),
      total: Number(text(response, 'TotalMatches', '0')) || 0,
    };
  }

  // ---------------------------------------------------------------- topology

  /** Raw `ZoneGroupState` XML, as reported by this player. */
  async getZoneGroupState() {
    const response = await this._call('ZoneGroupTopology', 'GetZoneGroupState', {});
    return text(response, 'ZoneGroupState', '');
  }

  toJSON() {
    return {
      uuid: this.uuid,
      name: this.name,
      host: this.host,
      model: this.model,
      coordinatorUuid: this.coordinatorUuid,
      groupId: this.groupId,
      isCoordinator: this.isCoordinator,
    };
  }
}

module.exports = { SonosPlayer, decodePlayMode, encodePlayMode, clampVolume, PLAY_MODES };
