'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { STATE_DIR, RUNTIME_FILE } = require('./settings');
const { actionCatalogue, ACTIONS, describeStep } = require('./engine/actions');
const { conditionCatalogue } = require('./engine/conditions');
const { resolveTargets } = require('./engine/targets');
const { normalizeStep } = require('./store');
const { t, dictionaryFor, currentLanguage, AVAILABLE } = require('./i18n');

/**
 * A tiny control API bound to 127.0.0.1 that the plugin's settings UI talks to.
 *
 * It exists because the Homebridge UI runs in a different process from the
 * bridge: without it, "Test scene" could not reach the live Sonos connection,
 * and saving a scene would only take effect after a restart. With it, the UI
 * is a real remote control for the running plugin.
 *
 * Security: loopback only, plus a random per-start token written to a
 * 0600 file that only the local Homebridge user can read.
 */
class ControlApi {
  /**
   * @param {object} options
   * @param {object} options.platform  The Homebridge platform instance.
   * @param {string} options.storagePath
   * @param {number} [options.port]    0 picks a free port (recommended).
   * @param {object} options.log
   */
  constructor({ platform, storagePath, port = 0, log }) {
    this.platform = platform;
    this.log = log;
    this.port = port;
    this.token = crypto.randomBytes(24).toString('hex');
    this.dir = path.join(storagePath, STATE_DIR);
    this.runtimeFile = path.join(this.dir, RUNTIME_FILE);
    this.server = null;
    this.actualPort = null;
  }

  async start() {
    // A runtime file left behind by a bridge that was killed rather than shut
    // down still names a port and a live-looking token. If the bind below then
    // fails because something else has taken that port, the settings UI reads
    // the stale file and hands our token to whatever is listening there now.
    try {
      fs.unlinkSync(this.runtimeFile);
    } catch {
      /* nothing to clear */
    }

    this.server = http.createServer((request, response) => {
      this._handle(request, response).catch((error) => {
        // Anything thrown in here is an unhandled rejection, and Node ends the
        // process for those. Nothing reaches it today — every route sends and
        // returns — but it costs one line to make sure it stays that way.
        try {
          if (response.headersSent || response.writableEnded) {
            response.destroy();
            return;
          }
          this._send(response, error?.status || 500, {
            error: error?.message || String(error) || 'Internal error',
          });
        } catch {
          response.destroy?.();
        }
      });
    });
    // Without this a client that opens a chunked request and never finishes it
    // parks a handler, holding whatever it has buffered, for five minutes.
    this.server.requestTimeout = 15000;

    await new Promise((resolve, reject) => {
      const onError = (error) => {
        this.server.removeListener('listening', onListening);
        reject(error);
      };
      const onListening = () => {
        this.server.removeListener('error', onError);
        resolve();
      };
      this.server.once('error', onError);
      this.server.once('listening', onListening);
      this.server.listen(this.port, '127.0.0.1');
    });

    // The listener above only guards the bind. Once the server is up, an error
    // on it — accept() hitting the file-descriptor ceiling on a busy Pi, say —
    // has nowhere to go, and an EventEmitter with no 'error' listener throws
    // the process down. The loopback control API is a convenience; it is never
    // worth taking Homebridge with it.
    this.server.on('error', (error) => {
      this.log.warn?.(t('log.controlApiError', { message: error.message }));
    });

    this.actualPort = this.server.address().port;
    fs.mkdirSync(this.dir, { recursive: true, mode: 0o700 });
    fs.writeFileSync(
      this.runtimeFile,
      JSON.stringify(
        {
          port: this.actualPort,
          token: this.token,
          pid: process.pid,
          startedAt: new Date().toISOString(),
          version: this.platform.version,
        },
        null,
        2,
      ),
      { mode: 0o600 },
    );
    // `mode` on writeFileSync only applies when the file is *created*. On an
    // existing one it is ignored — so a runtime.json that came back 0644 from a
    // backup, a copy without -p, or a trip through a filesystem with no modes
    // stayed 0644 for every start after that, with a live token in it. The test
    // that was meant to cover this wrote a fresh file every time, which is the
    // one case that already worked.
    try {
      fs.chmodSync(this.runtimeFile, 0o600);
    } catch {
      /* a filesystem without modes: nothing to do */
    }
    this.log.debug?.(t('log.apiListening', { port: this.actualPort }));
    return this.actualPort;
  }

  stop() {
    if (this.server) {
      this.server.close();
      this.server = null;
    }
    try {
      fs.unlinkSync(this.runtimeFile);
    } catch {
      /* already gone */
    }
  }

  /** @private */
  _send(response, status, body) {
    const payload = JSON.stringify(body ?? {});
    response.writeHead(status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Length': Buffer.byteLength(payload),
      'Cache-Control': 'no-store',
    });
    response.end(payload);
  }

  /** @private */
  async _readBody(request) {
    const chunks = [];
    let size = 0;
    for await (const chunk of request) {
      size += chunk.length;
      if (size > 8 * 1024 * 1024) throw Object.assign(new Error(t('error.tooLarge')), { status: 413 });
      chunks.push(chunk);
    }
    if (chunks.length === 0) return {};
    const raw = Buffer.concat(chunks).toString('utf8');
    if (!raw.trim()) return {};
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      // A malformed body is the client's mistake, not ours. Reported as a 500
      // it read as "the bridge is broken" in the settings page.
      throw Object.assign(new Error(error.message), { status: 400 });
    }
    // `null`, a number or a string are all valid JSON and none of them is a
    // request. Every handler does a bare property read on this: `null` gave a
    // 500 with an internal expression in it, and `123` quietly created an empty
    // scene and pushed it to Apple Home with a 200.
    return parsed !== null && typeof parsed === 'object' ? parsed : {};
  }

  /** @private */
  async _handle(request, response) {
    const url = new URL(request.url, 'http://127.0.0.1');
    const route = `${request.method} ${url.pathname}`;

    if (request.method === 'OPTIONS') {
      response.writeHead(204).end();
      return;
    }

    const presented = request.headers['x-sf-token'];
    const expected = Buffer.from(this.token);
    const supplied = Buffer.from(String(presented || ''));
    const authorised =
      supplied.length === expected.length && crypto.timingSafeEqual(supplied, expected);
    if (!authorised) {
      this._send(response, 401, { error: t('error.badToken') });
      return;
    }

    const platform = this.platform;
    const system = platform.system;
    const body = request.method === 'GET' ? {} : await this._readBody(request);

    // ---------------------------------------------------------------- status
    if (route === 'GET /status') {
      this._send(response, 200, {
        ok: true,
        version: platform.version,
        ready: system.ready,
        playerCount: system.list().length,
        groupCount: system.groups.length,
        lastDiscoveryAt: system.lastDiscoveryAt,
        lastTopologyAt: system.lastTopologyAt,
        sceneCount: platform.store.scenes.size,
        running: platform.runner.runningSceneIds(),
        uptimeMs: Date.now() - platform.startedAt,
        recentlyAdded: system.recentlyAdded,
        unconfigured: platform.unconfiguredPlayers(),
        language: currentLanguage(),
      });
      return;
    }

    if (route === 'POST /language') {
      const applied = platform.setLanguage(body.language);
      this._send(response, 200, { language: applied, dictionary: dictionaryFor(applied) });
      return;
    }

    // ------------------------------------------------------------- language
    // The dictionary travels with the catalogue so the settings UI never has
    // to guess: whatever the running plugin speaks, the browser speaks too.
    if (route === 'GET /language') {
      this._send(response, 200, {
        language: currentLanguage(),
        configured: platform.config?.language || '',
        available: AVAILABLE,
        dictionary: dictionaryFor(currentLanguage()),
      });
      return;
    }

    // --------------------------------------------------------------- players
    if (route === 'GET /players') {
      const withState = url.searchParams.get('state') === '1';
      this._send(response, 200, {
        players: await system.snapshot({ withState }),
        groups: system.groups.map((group) => ({
          ...group,
          coordinatorName: system.players.get(group.coordinatorUuid)?.name || '',
          memberNames: group.memberUuids.map((uuid) => system.players.get(uuid)?.name || uuid),
        })),
      });
      return;
    }

    // ------------------------------------------------------- manual addresses
    if (route === 'POST /playerIps') {
      const result = await platform.setPlayerIps(body.playerIps);
      this._send(response, 200, {
        ...result,
        players: await system.snapshot({ withState: false }),
      });
      return;
    }

    if (route === 'GET /playerIps') {
      this._send(response, 200, { playerIps: platform.config?.playerIps || '' });
      return;
    }

    if (route === 'POST /discover') {
      await system.discover({ force: true });
      await system.getLibrary({ force: true }).catch(() => {});
      this._send(response, 200, {
        players: await system.snapshot({ withState: false }),
        found: system.list().length,
      });
      return;
    }

    if (route === 'POST /players/adopt') {
      const result = await platform.adoptPlayers(body.names || [], body.volume);
      this._send(response, 200, {
        rooms: result.rooms,
        scenes: result.scenes,
        scenesList: result.scenesList,
      });
      return;
    }

    if (route === 'POST /player/volume') {
      const player = system.resolve(body.player);
      if (!player) throw new Error(t('error.playerMissing'));
      await player.setVolume(Number(body.volume));
      this._send(response, 200, { ok: true, volume: Number(body.volume) });
      return;
    }

    if (route === 'POST /player/transport') {
      const player = system.resolve(body.player);
      if (!player) throw new Error(t('error.playerMissing'));
      const coordinator = system.coordinatorFor(player);
      if (body.command === 'play') await coordinator.play();
      else if (body.command === 'pause') await coordinator.pause();
      else if (body.command === 'next') await coordinator.next();
      else if (body.command === 'previous') await coordinator.previous();
      else throw new Error(t('error.unknownCommand', { command: body.command }));
      this._send(response, 200, { ok: true });
      return;
    }

    // --------------------------------------------------------------- library
    if (route === 'GET /library') {
      const library = await system.getLibrary({ force: url.searchParams.get('force') === '1' });
      this._send(response, 200, {
        favorites: library.favorites.map(trimItem),
        playlists: library.playlists.map(trimItem),
        radio: library.radio.map(trimItem),
        fetchedAt: library.fetchedAt,
      });
      return;
    }

    // ------------------------------------------------------------- catalogue
    if (route === 'GET /catalogue') {
      this._send(response, 200, {
        actions: actionCatalogue(),
        conditions: conditionCatalogue(),
        targetTypes: targetTypes(),
        filters: targetFilters(),
        language: currentLanguage(),
        dictionary: dictionaryFor(currentLanguage()),
      });
      return;
    }

    // ---------------------------------------------------------------- scenes
    if (route === 'GET /scenes') {
      this._send(response, 200, { scenes: platform.store.list(), settings: platform.store.settings });
      return;
    }

    if (route === 'PUT /scenes') {
      // `body.scenes || []` turned a missing key into "delete everything". A
      // client saving only its settings, or one that misspelled the key, wiped
      // every scene and unregistered every switch — with a 200 in reply. Note
      // that a *wrong type* already failed closed inside replaceAll; it was
      // only the falsy case that quietly escalated.
      if (!Array.isArray(body.scenes)) {
        this._send(response, 400, { error: t('error.scenesNotAList') });
        return;
      }
      platform.store.replaceAll(body.scenes);
      if (body.settings && typeof body.settings === 'object' && !Array.isArray(body.settings)) {
        platform.store.settings = body.settings;
      }
      await platform.store.save();
      platform.syncAccessories();
      this._send(response, 200, { scenes: platform.store.list() });
      return;
    }

    if (route === 'POST /scenes') {
      // Saving a scene means sending one. Defaulting to `{}` meant a body that
      // was not a request at all — a bare number, an empty object — quietly
      // created a blank scene and pushed a switch for it into Apple Home, with
      // a 200 in reply.
      if (!body.scene || typeof body.scene !== 'object' || Array.isArray(body.scene)) {
        this._send(response, 400, { error: t('error.sceneMissing') });
        return;
      }
      const scene = platform.store.upsert(body.scene);
      await platform.store.save();
      platform.syncAccessories();
      this._send(response, 200, { scene });
      return;
    }

    if (route === 'POST /scenes/delete') {
      platform.store.remove(body.id);
      await platform.store.save();
      platform.syncAccessories();
      this._send(response, 200, { scenes: platform.store.list() });
      return;
    }

    if (route === 'POST /scenes/duplicate') {
      const scene = platform.store.duplicate(body.id);
      await platform.store.save();
      platform.syncAccessories();
      this._send(response, 200, { scene });
      return;
    }

    if (route === 'POST /scenes/reorder') {
      platform.store.reorder(body.ids || []);
      await platform.store.save();
      this._send(response, 200, { scenes: platform.store.list() });
      return;
    }

    if (route === 'POST /scenes/import') {
      if (!Array.isArray(body.scenes)) {
        this._send(response, 400, { error: t('error.scenesNotAList') });
        return;
      }
      const added =
        body.mode === 'replace'
          ? platform.store.replaceAll(body.scenes)
          : platform.store.merge(body.scenes);
      await platform.store.save();
      platform.syncAccessories();
      this._send(response, 200, {
        scenes: platform.store.list(),
        added: Array.isArray(added) ? added.length : 0,
      });
      return;
    }

    // ------------------------------------------------------------------ runs
    if (route === 'POST /scenes/run') {
      const result = await platform.runner.run(body.id, {
        branch: body.branch === 'off' ? 'off' : 'on',
        trigger: t('trigger.ui'),
      });
      this._send(response, 200, { result });
      return;
    }

    if (route === 'POST /scenes/stop') {
      const stopped = platform.runner.cancel(body.id, t('reason.stoppedFromUi'));
      this._send(response, 200, { stopped });
      return;
    }

    if (route === 'POST /step/test') {
      const step = normalizeStep(body.step || {});
      const definition = ACTIONS[step.action];
      if (!definition) throw new Error(t('error.unknownAction', { action: step.action }));
      const context = platform.testContext();
      const resolved =
        definition.targets === 'none'
          ? { players: [], missing: [], skipped: [] }
          : await resolveTargets(system, step.target);
      const players = definition.targets === 'single' ? resolved.players.slice(0, 1) : resolved.players;
      if (definition.targets !== 'none' && players.length === 0) {
        this._send(response, 200, {
          ok: true,
          skipped: true,
          detail:
            resolved.skipped.length > 0
              ? t('result.noneWerePlaying', { count: resolved.skipped.length })
              : t('result.nothingMatched'),
          description: describeStep(step),
        });
        return;
      }
      const detail = await definition.run(context, { ...step, _skipped: resolved.skipped }, players);
      this._send(response, 200, { ok: true, detail, description: describeStep(step), missing: resolved.missing });
      return;
    }

    if (route === 'POST /target/preview') {
      const resolved = await resolveTargets(system, body.target || {});
      this._send(response, 200, {
        players: resolved.players.map((player) => player.name),
        missing: resolved.missing,
        skipped: resolved.skipped,
      });
      return;
    }

    if (route === 'GET /history') {
      this._send(response, 200, { history: platform.runner.history });
      return;
    }

    // --------------------------------------------------------------- backups
    if (route === 'GET /backups') {
      this._send(response, 200, { backups: await platform.store.listBackups() });
      return;
    }

    if (route === 'POST /backups/restore') {
      await platform.store.restoreBackup(body.name);
      platform.syncAccessories();
      this._send(response, 200, { scenes: platform.store.list() });
      return;
    }

    // --------------------------------------------------------------- presets
    if (route === 'GET /presets') {
      this._send(response, 200, { presets: platform.listPresets() });
      return;
    }

    if (route === 'POST /presets/apply') {
      const result = await platform.applyPreset(body.id, { mode: body.mode || 'merge' });
      this._send(response, 200, result);
      return;
    }

    this._send(response, 404, { error: t('error.unknownRoute', { route }) });
  }
}

/** Strip the DIDL payload before sending library items to the browser. */
function trimItem(item) {
  return {
    title: item.title,
    description: item.description,
    albumArt: item.albumArt,
    isContainer: item.isContainer,
    isStream: item.isStream,
  };
}

/** The target kinds the editor offers, in the active language. */
function targetTypes() {
  return [
    { value: 'all', label: t('target.all'), needs: null },
    { value: 'players', label: t('target.players'), needs: 'names' },
    { value: 'allExcept', label: t('target.allExcept'), needs: 'names' },
    { value: 'group', label: t('target.group'), needs: 'coordinator' },
    { value: 'coordinator', label: t('target.coordinator'), needs: 'coordinator' },
  ];
}

/** The "which of them" filter, in the active language. */
function targetFilters() {
  return [
    { value: 'any', label: t('target.filter.any') },
    { value: 'playing', label: t('target.filter.playing') },
    { value: 'notPlaying', label: t('target.filter.notPlaying') },
    { value: 'coordinators', label: t('target.filter.coordinators') },
  ];
}

module.exports = { ControlApi, targetTypes, targetFilters };
