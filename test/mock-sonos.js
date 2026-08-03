'use strict';

const http = require('node:http');
const { parseXml, find, text, escapeXml } = require('../src/sonos/xml');
const { agent } = require('../src/sonos/soap');

/**
 * A fake Sonos household for the test suite.
 *
 * Every player is a real HTTP server answering real SOAP, so the transport is
 * exercised end to end — which is exactly where protocol bugs hide.
 *
 * Each one listens on 127.0.0.1 at its own port rather than on its own loopback
 * *address*. Linux hands you the whole 127.0.0.0/8 range, so 127.0.0.2 and
 * friends work there; macOS configures only 127.0.0.1, and binding to anything
 * else fails with EADDRNOTAVAIL before a single test runs. Ports are available
 * everywhere, and the players announce theirs in the LOCATION header exactly as
 * a real device does.
 */

const PORT = 14400;

class MockPlayer {
  constructor(household, { name, uuid, host, port }) {
    this.household = household;
    this.name = name;
    this.uuid = uuid;
    this.port = port;
    this.host = host;
    this.volume = 20;
    this.muted = false;
    this.transportState = 'STOPPED';
    this.currentUri = '';
    this.currentMetadata = '';
    this.playMode = 'NORMAL';
    this.crossfade = false;
    this.queue = [];
    /** Bumped on every queue change, exactly as a real player does. */
    this.queueUpdateId = 1;
    /** Everything the tests want to assert on, in order. */
    this.calls = [];
  }

  get coordinator() {
    return this.household.coordinatorOf(this.uuid);
  }
}

class MockHousehold {
  constructor(names) {
    this.players = names.map(
      (name, index) =>
        new MockPlayer(this, {
          name,
          uuid: `RINCON_MOCK${String(index + 1).padStart(4, '0')}`,
          host: '127.0.0.1',
          port: PORT + index,
        }),
    );
    /** uuid → coordinator uuid */
    this.grouping = new Map(this.players.map((player) => [player.uuid, player.uuid]));
    this.favorites = [];
    this.playlists = [];
    this.radio = [];
    this.servers = [];
    this.failures = new Map();
    /**
     * Simulated network delay. Zero by default so the suite stays fast, but a
     * test that is about ordering needs it: with instant replies, a cancelled
     * scene's commands finish before the cancel is even noticed.
     */
    this.latencyMs = 0;
    /** Per-action overrides, e.g. a slow Spotify enqueue. */
    this.actionLatencyMs = {};
  }

  byUuid(uuid) {
    return this.players.find((player) => player.uuid === uuid) || null;
  }

  /** Which player answers on this port? The host is always 127.0.0.1. */
  byPort(port) {
    return this.players.find((player) => player.port === Number(port)) || null;
  }

  byName(name) {
    return this.players.find((player) => player.name === name) || null;
  }

  coordinatorOf(uuid) {
    return this.grouping.get(uuid) || uuid;
  }

  membersOf(coordinatorUuid) {
    return this.players.filter((player) => this.coordinatorOf(player.uuid) === coordinatorUuid);
  }

  /** Make one action on one player fail, to test error handling. */
  failOn(playerName, action, upnpErrorCode = 501) {
    this.failures.set(`${playerName}:${action}`, upnpErrorCode);
  }

  async listen() {
    await Promise.all(this.players.map((player) => this._serve(player)));
    return this;
  }

  /** @private Bring one player online on its own port. */
  _serve(player) {
    return new Promise((resolve, reject) => {
      const server = http.createServer((request, response) => this.handle(player, request, response));
      server.on('error', reject);
      server.listen(player.port, player.host, () => resolve());
      this.servers.push(server);
    });
  }

  /**
   * Plug a brand new speaker into the household, exactly as buying one does:
   * it appears in the topology and starts answering on the network.
   * @param {string} name
   */
  async addPlayer(name) {
    const index = this.players.length;
    const player = new MockPlayer(this, {
      name,
      uuid: `RINCON_MOCK${String(index + 1).padStart(4, '0')}`,
      host: '127.0.0.1',
      port: PORT + index,
    });
    this.players.push(player);
    this.grouping.set(player.uuid, player.uuid);
    await this._serve(player);
    return player;
  }

  async close() {
    // The plugin keeps a pooled keep-alive agent, so sockets to these servers
    // are still open when a test ends. `server.close()` waits for them, which
    // can hang a whole file — and on the next test the ports are still taken.
    // Hang up on our side first, then wait for the listeners to let go.
    agent.destroy();
    await Promise.all(
      this.servers.map(
        (server) =>
          new Promise((resolve) => {
            server.closeAllConnections?.();
            server.close(resolve);
          }),
      ),
    );
    this.servers = [];
  }

  /** @private */
  handle(player, request, response) {
    const chunks = [];
    request.on('data', (chunk) => chunks.push(chunk));
    request.on('end', () => {
      const body = Buffer.concat(chunks).toString('utf8');
      const soapActionName =
        String(request.headers.soapaction || '').replace(/"/g, '').split('#')[1] || '';
      const delay = this.actionLatencyMs[soapActionName] ?? this.latencyMs;
      if (delay > 0) {
        setTimeout(() => this._respond(player, request, response, body), delay);
        return;
      }
      this._respond(player, request, response, body);
    });
  }

  /** @private */
  _respond(player, request, response, body) {
    {

      if (request.method === 'GET' && request.url === '/xml/device_description.xml') {
        return send(
          response,
          200,
          `<?xml version="1.0"?><root xmlns="urn:schemas-upnp-org:device-1-0"><device>` +
            `<UDN>uuid:${player.uuid}</UDN><roomName>${escapeXml(player.name)}</roomName>` +
            `<modelName>Sonos Mock</modelName><serialNum>SN-${player.uuid}</serialNum>` +
            `<softwareVersion>99.9</softwareVersion></device></root>`,
        );
      }

      const soapAction = String(request.headers.soapaction || '').replace(/"/g, '');
      const action = soapAction.split('#')[1] || '';
      const document = parseXml(body);
      const args = {};
      const actionNode = find(document, action);
      for (const child of actionNode?.children || []) args[child.local] = child.text;

      player.calls.push({ action, args: { ...args } });

      const failure = this.failures.get(`${player.name}:${action}`);
      if (failure) {
        return send(
          response,
          500,
          `<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body><s:Fault>` +
            `<faultstring>UPnPError</faultstring><detail><UPnPError xmlns="urn:schemas-upnp-org:control-1-0">` +
            `<errorCode>${failure}</errorCode></UPnPError></detail></s:Fault></s:Body></s:Envelope>`,
        );
      }

      const result = this.execute(player, action, args);
      if (result === undefined) return send(response, 500, fault(401));

      return send(
        response,
        200,
        `<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body>` +
          `<u:${action}Response xmlns:u="urn:schemas-upnp-org:service:Mock:1">${result}</u:${action}Response>` +
          `</s:Body></s:Envelope>`,
      );
    }
  }

  /** @private The behaviour under test. */
  execute(player, action, args) {
    switch (action) {
      case 'Play':
        player.transportState = 'PLAYING';
        return '';
      case 'Pause':
        if (player.transportState !== 'PLAYING') return undefined; // matches a real player
        player.transportState = 'PAUSED_PLAYBACK';
        return '';
      case 'Stop':
        player.transportState = 'STOPPED';
        return '';
      case 'Next':
      case 'Previous':
        return '';
      case 'GetTransportInfo': {
        const coordinator = this.byUuid(this.coordinatorOf(player.uuid)) || player;
        return `<CurrentTransportState>${coordinator.transportState}</CurrentTransportState><CurrentTransportStatus>OK</CurrentTransportStatus><CurrentSpeed>1</CurrentSpeed>`;
      }
      case 'GetMediaInfo':
        return `<CurrentURI>${escapeXml(player.currentUri)}</CurrentURI><CurrentURIMetaData>${escapeXml(player.currentMetadata)}</CurrentURIMetaData><NrTracks>${player.queue.length}</NrTracks>`;
      case 'GetPositionInfo':
        return `<Track>1</Track><TrackDuration>0:03:00</TrackDuration><RelTime>0:00:10</RelTime><TrackURI>${escapeXml(player.currentUri)}</TrackURI><TrackMetaData></TrackMetaData>`;
      case 'SetAVTransportURI': {
        const uri = args.CurrentURI || '';
        player.currentUri = uri;
        player.currentMetadata = args.CurrentURIMetaData || '';
        const join = /^x-rincon:(.+)$/.exec(uri);
        if (join) this.grouping.set(player.uuid, join[1]);
        return '';
      }
      case 'BecomeCoordinatorOfStandaloneGroup':
        this.grouping.set(player.uuid, player.uuid);
        return '';
      case 'RemoveAllTracksFromQueue':
        player.queue = [];
        player.queueUpdateId += 1;
        return '';
      case 'AddURIToQueue':
        player.queue.push(args.EnqueuedURI);
        player.queueUpdateId += 1;
        return `<FirstTrackNumberEnqueued>1</FirstTrackNumberEnqueued><NumTracksAdded>1</NumTracksAdded><NewQueueLength>${player.queue.length}</NewQueueLength>`;
      case 'Seek':
        return '';
      case 'GetVolume':
        return `<CurrentVolume>${player.volume}</CurrentVolume>`;
      case 'SetVolume':
        player.volume = Math.max(0, Math.min(100, Number(args.DesiredVolume)));
        return '';
      case 'SetRelativeVolume':
        player.volume = Math.max(0, Math.min(100, player.volume + Number(args.Adjustment)));
        return `<NewVolume>${player.volume}</NewVolume>`;
      case 'GetMute':
        return `<CurrentMute>${player.muted ? 1 : 0}</CurrentMute>`;
      case 'SetMute':
        player.muted = args.DesiredMute === '1';
        return '';
      case 'SetBass':
      case 'SetTreble':
      case 'SetLoudness':
        return '';
      case 'GetGroupVolume':
        return `<CurrentVolume>${player.volume}</CurrentVolume>`;
      case 'SetGroupVolume':
      case 'SetRelativeGroupVolume':
      case 'SetGroupMute':
        return '';
      case 'GetTransportSettings':
        return `<PlayMode>${player.playMode}</PlayMode><RecQualityMode>NOT_IMPLEMENTED</RecQualityMode>`;
      case 'SetPlayMode':
        player.playMode = args.NewPlayMode;
        return '';
      case 'SetCrossfadeMode':
        player.crossfade = args.CrossfadeMode === '1';
        return '';
      case 'GetCrossfadeMode':
        return `<CrossfadeMode>${player.crossfade ? 1 : 0}</CrossfadeMode>`;
      case 'GetZoneAttributes':
        return `<CurrentZoneName>${escapeXml(player.name)}</CurrentZoneName>`;
      case 'Browse':
        if (args.ObjectID === 'Q:0') return this.browseQueue(player, args);
        return this.browse(args);
      case 'GetZoneGroupState':
        return `<ZoneGroupState>${escapeXml(this.topologyXml())}</ZoneGroupState>`;
      default:
        return undefined;
    }
  }

  /** @private The player's own queue, with a real update id. */
  browseQueue(player, args) {
    const start = Number(args.StartingIndex) || 0;
    const slice = player.queue.slice(start, start + (Number(args.RequestedCount) || 100));
    const didl =
      `<DIDL-Lite xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns="urn:schemas-upnp-org:metadata-1-0/DIDL-Lite/">` +
      slice
        .map(
          (uri, index) =>
            `<item id="Q:0/${start + index}" parentID="Q:0"><dc:title>Nummer ${start + index + 1}</dc:title>` +
            `<res protocolInfo="x">${escapeXml(uri)}</res></item>`,
        )
        .join('') +
      `</DIDL-Lite>`;
    return (
      `<Result>${escapeXml(didl)}</Result><NumberReturned>${slice.length}</NumberReturned>` +
      `<TotalMatches>${player.queue.length}</TotalMatches><UpdateID>${player.queueUpdateId}</UpdateID>`
    );
  }

  /** @private */
  browse(args) {
    const source =
      args.ObjectID === 'FV:2'
        ? this.favorites
        : args.ObjectID === 'SQ:'
          ? this.playlists
          : args.ObjectID === 'R:0/0'
            ? this.radio
            : [];
    const startIndex = Number(args.StartingIndex) || 0;
    const slice = source.slice(startIndex, startIndex + (Number(args.RequestedCount) || 100));
    const didl =
      `<DIDL-Lite xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:upnp="urn:schemas-upnp-org:metadata-1-0/upnp/" ` +
      `xmlns:r="urn:schemas-rinconnetworks-com:metadata-1-0/" xmlns="urn:schemas-upnp-org:metadata-1-0/DIDL-Lite/">` +
      slice
        .map(
          (item, index) =>
            `<item id="${args.ObjectID}/${startIndex + index}" parentID="${args.ObjectID}" restricted="false">` +
            `<dc:title>${escapeXml(item.title)}</dc:title>` +
            `<r:description>${escapeXml(item.description || '')}</r:description>` +
            `<res protocolInfo="x-rincon-mock:*:*:*">${escapeXml(item.uri)}</res>` +
            // Only favourites carry r:resMD on a real player; saved queues and
            // radio station lists do not.
            (args.ObjectID === 'FV:2'
              ? `<r:resMD>${escapeXml(
                  `<DIDL-Lite xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:upnp="urn:schemas-upnp-org:metadata-1-0/upnp/" xmlns="urn:schemas-upnp-org:metadata-1-0/DIDL-Lite/"><item id="x" parentID="y" restricted="true"><dc:title>${item.title}</dc:title><upnp:class>${item.container ? 'object.container.playlistContainer' : 'object.item.audioItem.audioBroadcast'}</upnp:class></item></DIDL-Lite>`,
                )}</r:resMD>`
              : '') +
            `<upnp:class>${
              args.ObjectID === 'FV:2'
                ? 'object.itemobject.item.sonos-favorite'
                : item.container
                  ? 'object.container.playlistContainer'
                  : 'object.item.audioItem.audioBroadcast'
            }</upnp:class></item>`,
        )
        .join('') +
      `</DIDL-Lite>`;
    return `<Result>${escapeXml(didl)}</Result><NumberReturned>${slice.length}</NumberReturned><TotalMatches>${source.length}</TotalMatches><UpdateID>1</UpdateID>`;
  }

  /** @private */
  topologyXml() {
    const groups = new Map();
    for (const player of this.players) {
      const coordinator = this.coordinatorOf(player.uuid);
      if (!groups.has(coordinator)) groups.set(coordinator, []);
      groups.get(coordinator).push(player);
    }
    return (
      `<ZoneGroupState><ZoneGroups>` +
      [...groups.entries()]
        .map(
          ([coordinator, members]) =>
            `<ZoneGroup Coordinator="${coordinator}" ID="${coordinator}:1">` +
            members
              .map(
                (member) =>
                  `<ZoneGroupMember UUID="${member.uuid}" Location="http://${member.host}:${member.port}/xml/device_description.xml" ` +
                  `ZoneName="${escapeXml(member.name)}" Invisible="0" IsZoneBridge="0"/>`,
              )
              .join('') +
            `</ZoneGroup>`,
        )
        .join('') +
      `</ZoneGroups><VanishedDevices/></ZoneGroupState>`
    );
  }
}

function fault(code) {
  return (
    `<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body><s:Fault>` +
    `<faultstring>UPnPError</faultstring><detail><UPnPError xmlns="urn:schemas-upnp-org:control-1-0">` +
    `<errorCode>${code}</errorCode></UPnPError></detail></s:Fault></s:Body></s:Envelope>`
  );
}

function send(response, status, body) {
  response.writeHead(status, {
    'Content-Type': 'text/xml; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  });
  response.end(body);
}

/** Silent logger for tests. */
const quietLog = { info() {}, warn() {}, error() {}, debug() {} };

module.exports = { MockHousehold, MockPlayer, PORT, quietLog };
