'use strict';

const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { HomebridgePluginUiServer, RequestError } = require('@homebridge/plugin-ui-utils');

const { STATE_DIR, RUNTIME_FILE } = require('../src/settings');
const { SceneStore } = require('../src/store');
const { actionCatalogue } = require('../src/engine/actions');
const { conditionCatalogue } = require('../src/engine/conditions');
const { listPresets, getPreset } = require('../src/presets');
const { targetTypes, targetFilters } = require('../src/api');
const { setLanguage, currentLanguage, dictionaryFor, AVAILABLE, t } = require('../src/i18n');

/**
 * The settings-UI backend.
 *
 * Almost everything is forwarded to the running plugin's loopback control API,
 * because only that process holds the live Sonos connection — that is what
 * makes "Test scene" and the live speaker list work without a restart.
 *
 * If the bridge is not running (stopped, crashed, mid-restart) we fall back to
 * reading and writing scenes.json directly, so the user can always get in and
 * fix a broken scene.
 */
class SonosControlProUiServer extends HomebridgePluginUiServer {
  constructor() {
    super();

    this.stateDir = path.join(this.homebridgeStoragePath, STATE_DIR);
    this.runtimeFile = path.join(this.stateDir, RUNTIME_FILE);
    this.store = new SceneStore({
      storagePath: this.homebridgeStoragePath,
      log: { info() {}, warn() {}, error() {}, debug() {} },
    });

    this.onRequest('/bootstrap', (payload) => this.bootstrap(payload));
    this.onRequest('/call', (payload) => this.call(payload));
    this.onRequest('/catalogue', (payload) => this.catalogue(payload));

    this.ready();
  }

  /** @private Where is the running plugin listening, and with which token? */
  runtime() {
    try {
      const raw = fs.readFileSync(this.runtimeFile, 'utf8');
      const parsed = JSON.parse(raw);
      if (!parsed.port || !parsed.token) return null;
      return parsed;
    } catch {
      return null;
    }
  }

  /** @private One HTTP call into the plugin. Resolves `null` when it is not up. */
  proxy(method, route, body, timeout = 30000) {
    const runtime = this.runtime();
    if (!runtime) return Promise.resolve(null);

    return new Promise((resolve) => {
      const payload = body === undefined ? '' : JSON.stringify(body);
      const request = http.request(
        {
          host: '127.0.0.1',
          port: runtime.port,
          path: route,
          method,
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(payload),
            'x-sf-token': runtime.token,
          },
        },
        (response) => {
          const chunks = [];
          response.on('data', (chunk) => chunks.push(chunk));
          response.on('end', () => {
            clearTimeout(timer);
            const text = Buffer.concat(chunks).toString('utf8');
            let parsed = null;
            try {
              parsed = text ? JSON.parse(text) : {};
            } catch {
              parsed = { error: text.slice(0, 400) };
            }
            resolve({ status: response.statusCode, body: parsed });
          });
        },
      );
      const timer = setTimeout(() => {
        request.destroy();
        resolve({ status: 504, body: { error: t('error.pluginSlow') } });
      }, timeout);
      request.on('error', () => {
        clearTimeout(timer);
        resolve(null);
      });
      request.end(payload);
    });
  }

  /**
   * Static data that never needs the bridge to be running.
   * @param {{language?: string}} [payload]
   */
  catalogue(payload = {}) {
    setLanguage(payload?.language);
    return {
      actions: actionCatalogue(),
      conditions: conditionCatalogue(),
      targetTypes: targetTypes(),
      filters: targetFilters(),
      presets: listPresets(),
      language: currentLanguage(),
      languages: AVAILABLE,
      dictionary: dictionaryFor(currentLanguage()),
    };
  }

  /**
   * Everything the front-end needs for a first paint, in one round trip.
   * @param {{language?: string}} [payload]
   */
  async bootstrap(payload = {}) {
    const runtime = this.runtime();
    const base = {
      ...this.catalogue(payload),
      connected: Boolean(runtime),
      runtimeVersion: runtime?.version || null,
    };

    if (!runtime) {
      this.store.load();
      return {
        ...base,
        status: null,
        scenes: this.store.list(),
        players: [],
        groups: [],
        library: { favorites: [], playlists: [], radio: [] },
        offlineReason: t('ui.status.offline'),
      };
    }

    const [status, scenes, players, library] = await Promise.all([
      this.proxy('GET', '/status'),
      this.proxy('GET', '/scenes'),
      this.proxy('GET', '/players?state=1'),
      this.proxy('GET', '/library'),
    ]);

    if (!status) {
      this.store.load();
      return { ...base, connected: false, scenes: this.store.list(), players: [], groups: [], library: { favorites: [], playlists: [], radio: [] } };
    }

    return {
      ...base,
      status: status.body,
      scenes: scenes?.body?.scenes || [],
      players: players?.body?.players || [],
      groups: players?.body?.groups || [],
      library: library?.body || { favorites: [], playlists: [], radio: [] },
    };
  }

  /**
   * Generic bridge to the plugin's control API.
   * @param {{method: string, path: string, body?: object}} payload
   */
  async call(payload = {}) {
    const method = String(payload.method || 'GET').toUpperCase();
    const route = String(payload.path || '');
    if (!route.startsWith('/')) throw new RequestError(t('error.badPath'), { status: 400 });

    const result = await this.proxy(method, route, payload.body, payload.timeout || 60000);

    if (!result) {
      // Bridge is down: serve what we can straight from disk.
      const offline = this.offlineFallback(method, route, payload.body);
      if (offline) return offline;
      throw new RequestError(t('error.bridgeDown'), { status: 503 });
    }

    if (result.status >= 400) {
      throw new RequestError(result.body?.error || t('error.httpStatus', { status: result.status }), {
        status: result.status,
      });
    }
    return result.body;
  }

  /** @private Scene CRUD still works with the bridge stopped. */
  offlineFallback(method, route, body) {
    const routes = {
      'GET /scenes': () => {
        this.store.load();
        return { scenes: this.store.list(), settings: this.store.settings, offline: true };
      },
      'POST /scenes': async () => {
        this.store.load();
        const scene = this.store.upsert(body?.scene || {});
        await this.store.save();
        return { scene, offline: true };
      },
      'PUT /scenes': async () => {
        this.store.load();
        this.store.replaceAll(body?.scenes || []);
        await this.store.save();
        return { scenes: this.store.list(), offline: true };
      },
      'POST /scenes/delete': async () => {
        this.store.load();
        this.store.remove(body?.id);
        await this.store.save();
        return { scenes: this.store.list(), offline: true };
      },
      'POST /scenes/duplicate': async () => {
        this.store.load();
        const scene = this.store.duplicate(body?.id);
        await this.store.save();
        return { scene, offline: true };
      },
      'POST /scenes/reorder': async () => {
        this.store.load();
        this.store.reorder(body?.ids || []);
        await this.store.save();
        return { scenes: this.store.list(), offline: true };
      },
      'POST /scenes/import': async () => {
        this.store.load();
        if (body?.mode === 'replace') this.store.replaceAll(body.scenes || []);
        else this.store.merge(body?.scenes || []);
        await this.store.save();
        return { scenes: this.store.list(), offline: true };
      },
      'POST /presets/apply': async () => {
        const preset = getPreset(body?.id);
        if (!preset) throw new RequestError(t('error.unknownPreset', { id: body?.id }), { status: 400 });
        this.store.load();
        const scenes = JSON.parse(JSON.stringify(preset.scenes));
        // No bridge means no speaker list, so the leader is left for the user
        // to pick — the editor points at it.
        preset.hydrate?.(scenes, null);
        if (body?.mode === 'replace') this.store.replaceAll(scenes);
        else this.store.merge(scenes);
        await this.store.save();
        return {
          scenes: this.store.list(),
          applied: scenes.length,
          validation: { missingRooms: [], missingFavorites: [], extraRooms: [] },
          offline: true,
        };
      },
      'GET /presets': () => ({ presets: listPresets() }),
    };

    const handler = routes[`${method} ${route}`];
    return handler ? handler() : null;
  }
}

(() => new SonosControlProUiServer())();
