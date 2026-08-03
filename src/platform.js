'use strict';

const { PLATFORM_NAME, PLUGIN_NAME, ACCESSORY_NAMESPACE } = require('./settings');
const { SceneStore } = require('./store');
const { SonosSystem } = require('./sonos/system');
const { SceneRunner } = require('./engine/runner');
const { SceneSwitch } = require('./accessory');
const { ControlApi } = require('./api');
const { listPresets, getPreset, validatePreset } = require('./presets');
const { agent } = require('./sonos/soap');
const { setLanguage, t, currentLanguage } = require('./i18n');

const VERSION = require('../package.json').version;

/**
 * The Homebridge platform.
 *
 * Job list, in order:
 *   1. load the scenes from disk
 *   2. find the Sonos household on the local network
 *   3. publish one HomeKit switch per scene
 *   4. open a loopback control API so the settings UI can drive all of it live
 */
class SonosControlPlatform {
  constructor(log, config, api) {
    this.log = log;
    this.config = config || {};
    this.api = api;
    this.version = VERSION;
    this.startedAt = Date.now();
    // Settled before anything else: every message from here on — including the
    // ones thrown from deep inside an action — is looked up in this language.
    this.language = setLanguage(this.config.language);

    /** @type {Map<string, object>} accessory UUID → cached PlatformAccessory */
    this.cachedAccessories = new Map();
    /** @type {Map<string, SceneSwitch>} scene id → handler */
    this.handlers = new Map();

    if (!api) {
      this.log.error(t('error.apiMissing'));
      return;
    }

    this.store = new SceneStore({ storagePath: api.user.storagePath(), log });
    this.system = new SonosSystem({
      log,
      seedHosts: parseHosts(this.config.playerIps),
      discoveryTimeout: clampNumber(this.config.discoveryTimeoutMs, 1000, 15000, 4000),
      topologyIntervalMs: clampNumber(this.config.topologyIntervalMs, 5000, 600000, 30000),
      libraryTtlMs: clampNumber(this.config.libraryTtlMs, 10000, 3600000, 300000),
    });
    this.runner = new SceneRunner({
      system: this.system,
      log,
      getScenes: () => this.store.scenes,
    });

    this.api.on('didFinishLaunching', () => {
      this.start().catch((error) => {
        this.log.error(t('log.startFailed', { message: error.stack || error.message }));
      });
    });

    // Six teardown calls, any of which could throw on a half-started plugin.
    // A shutdown handler that throws takes the whole bridge down with it, and
    // there is nothing left to save by then anyway.
    this.api.on('shutdown', () => {
      try {
        this.stop();
      } catch (error) {
        this.log.warn(t('log.stopFailed', { message: error.message || String(error) }));
      }
    });
  }

  /**
   * Change the language of everything this process says, without a restart.
   *
   * The settings UI writes the choice to config.json for next time and calls
   * this so the log, the step descriptions and the error messages follow along
   * immediately — otherwise picking English would leave every scene run still
   * reporting itself in Danish until the bridge was restarted.
   *
   * @param {string} language `auto`, `da`, `en`, or empty for the default.
   */
  setLanguage(language) {
    this.config.language = language;
    this.language = setLanguage(language);
    // The accessory model string is language-dependent; re-stamp it so Apple
    // Home does not keep showing yesterday's wording.
    for (const [id, handler] of this.handlers) {
      const scene = this.store.get(id);
      if (scene) handler.update(scene);
    }
    this.log.debug?.(t('log.language', { language: this.language }));
    return this.language;
  }

  /** Homebridge hands back every accessory it restored from its cache. */
  configureAccessory(accessory) {
    this.cachedAccessories.set(accessory.UUID, accessory);
  }

  async start() {
    this.store.load();
    const count = this.store.scenes.size;
    this.log.info(
      t(count === 1 ? 'log.loadedOne' : 'log.loaded', { name: t('app.name'), version: VERSION, count }),
    );
    this.log.debug?.(t('log.language', { language: currentLanguage() }));

    // Publish switches immediately from the stored scenes: HomeKit should not
    // wait for the network sweep, and a scene pressed early simply discovers
    // the speakers on demand.
    this.syncAccessories();

    this.api_ = new ControlApi({
      platform: this,
      storagePath: this.api.user.storagePath(),
      port: clampNumber(this.config.controlPort, 0, 65535, 0),
      log: this.log,
    });
    try {
      await this.api_.start();
    } catch (error) {
      this.log.warn(t('log.apiFailed', { message: error.message }));
    }

    this.store.watch(() => {
      this.log.debug?.(t('log.scenesChanged'));
      this.syncAccessories();
    });

    try {
      const players = await this.system.discover();
      if (players.length > 0) {
        this.log.info(
          t('log.foundPlayers', {
            count: players.length,
            names: players.map((player) => player.name).join(', '),
          }),
        );
        this.system.startTopologyWatch();
        // Sweep now and then so a speaker you set up this afternoon is simply
        // there, without a restart or a button.
        this.system.startDiscoveryWatch(clampNumber(this.config.rediscoverIntervalMs, 60000, 3600000, 300000));
        this.system
          .getLibrary()
          .then((library) =>
            this.log.debug?.(
              t('log.libraryLoaded', {
                favorites: library.favorites.length,
                playlists: library.playlists.length,
                radio: library.radio.length,
              }),
            ),
          )
          .catch(() => {});
      }
    } catch (error) {
      this.log.warn(t('log.discoveryFailed', { message: error.message }));
    }
  }

  /**
   * Which rooms have no explicit level in any music scene.
   *
   * A speaker that nobody has given a volume is almost always one that was
   * added after the scenes were built — surfacing it is how "add a speaker"
   * stays a ten-second job.
   */
  unconfiguredPlayers() {
    const known = new Set();
    for (const scene of this.store.list()) {
      for (const list of ['steps', 'elseSteps', 'offSteps']) {
        for (const step of scene[list] || []) {
          for (const name of Object.keys(step.params?.volumes || {})) known.add(name);
          for (const name of step.params?.members || []) known.add(name);
          for (const name of step.params?.leave || []) known.add(name);
          for (const name of step.target?.names || []) known.add(name);
        }
      }
    }
    return this.system
      .list()
      .map((player) => player.name)
      .filter((name) => !known.has(name));
  }

  /**
   * Give one or more rooms a level in every music scene that has levels.
   * Scenes set to "everyone except…" already include them; this just stops
   * them playing at whatever volume they happened to be left on.
   *
   * @param {string[]} names
   * @param {number|Record<string, number>} volume Either one level for all, or per room.
   */
  async adoptPlayers(names, volume) {
    const rooms = (names || []).map((name) => this.system.resolve(name)?.name).filter(Boolean);
    if (rooms.length === 0) throw new Error(t('error.noKnownSpeakers'));

    const levelFor = (room) => {
      const value = typeof volume === 'object' && volume !== null ? volume[room] : volume;
      const number = Number(value);
      if (!Number.isFinite(number)) throw new Error(t('error.invalidVolumeFor', { room }));
      return Math.min(100, Math.max(0, Math.round(number)));
    };

    const touched = [];
    for (const scene of this.store.list()) {
      let changed = false;
      for (const list of ['steps', 'elseSteps', 'offSteps']) {
        for (const step of scene[list] || []) {
          if (step.action !== 'groupAndPlay') continue;
          const params = step.params || {};
          // A scene that sets no levels at all is deliberately hands-off.
          if (Object.keys(params.volumes || {}).length === 0) continue;
          for (const room of rooms) {
            if (room === params.coordinator) continue;
            if ((params.leave || []).includes(room)) continue;
            params.volumes = { ...(params.volumes || {}), [room]: levelFor(room) };
            if ((params.membersMode || 'all') === 'list' && !(params.members || []).includes(room)) {
              params.members = [...(params.members || []), room];
            }
            changed = true;
          }
        }
      }
      if (changed) {
        this.store.upsert(scene);
        touched.push(scene.name);
      }
    }

    await this.store.save();
    this.syncAccessories();
    return { rooms, scenes: touched, scenesList: this.store.list() };
  }

  stop() {
    this.runner.cancelAll();
    this.store.unwatch();
    this.system.stop();
    this.api_?.stop();
    for (const handler of this.handlers.values()) handler.dispose();
    // Keep-alive sockets would otherwise hold the process open past shutdown.
    agent.destroy();
  }

  // ------------------------------------------------------------- accessories

  /** Bring the published accessories in line with the current scene list. */
  syncAccessories() {
    const scenes = this.store.list().filter((scene) => !scene.hidden);
    const wanted = new Map();
    for (const scene of scenes) {
      // The namespace is fixed, not the package name: renaming the plugin must
      // not hand every switch a new identity in Apple Home.
      wanted.set(this.api.hap.uuid.generate(`${ACCESSORY_NAMESPACE}:${scene.id}`), scene);
    }

    const toRegister = [];
    for (const [uuid, scene] of wanted) {
      const cached = this.cachedAccessories.get(uuid);
      if (cached) {
        cached.context.scene = { id: scene.id, name: scene.name };
        const handler = this.handlers.get(scene.id);
        if (handler) handler.update(scene);
        else this.handlers.set(scene.id, new SceneSwitch(this, cached, scene));
        continue;
      }
      const accessory = new this.api.platformAccessory(scene.name, uuid);
      accessory.context.scene = { id: scene.id, name: scene.name };
      this.handlers.set(scene.id, new SceneSwitch(this, accessory, scene));
      this.cachedAccessories.set(uuid, accessory);
      toRegister.push(accessory);
      this.log.info(t('log.accessoryAdded', { name: scene.name }));
    }

    const toRemove = [];
    for (const [uuid, accessory] of this.cachedAccessories) {
      if (wanted.has(uuid)) continue;
      toRemove.push(accessory);
      this.cachedAccessories.delete(uuid);
      const sceneId = accessory.context?.scene?.id;
      if (sceneId) {
        this.handlers.get(sceneId)?.dispose();
        this.handlers.delete(sceneId);
      }
      this.log.info(t('log.accessoryRemoved', { name: accessory.displayName }));
    }

    if (toRegister.length) {
      this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, toRegister);
    }
    if (toRemove.length) {
      this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, toRemove);
    }
  }

  /** Execution context for one-off step tests from the settings UI. */
  testContext() {
    const controller = new AbortController();
    return {
      system: this.system,
      log: this.log,
      signal: controller.signal,
      snapshots: this.runner.snapshots,
      sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      runScene: async (id) => {
        const result = await this.runner.run(id, { trigger: t('trigger.uiTest') });
        if (!result.ok) {
          throw new Error(result.error || t('error.sceneFailedNested', { name: result.sceneName }));
        }
        return result.sceneName;
      },
    };
  }

  // ----------------------------------------------------------------- presets

  listPresets() {
    return listPresets();
  }

  /**
   * Load a preset. `replace` wipes what is there; `merge` adds alongside.
   * The household is validated first so the user is told about a renamed room
   * before they wonder why one speaker stays silent.
   */
  async applyPreset(id, { mode = 'merge' } = {}) {
    const preset = getPreset(id);
    if (!preset) throw new Error(t('error.unknownPreset', { id }));

    if (this.system.list().length === 0) {
      await this.system.discover({ force: true }).catch(() => {});
    }
    const validation = await validatePreset(preset, this.system);

    const scenes = JSON.parse(JSON.stringify(preset.scenes));
    // A preset may leave a blank where only the live household can answer —
    // which speaker leads the group, for instance.
    preset.hydrate?.(scenes, this.system);
    if (mode === 'replace') this.store.replaceAll(scenes);
    else this.store.merge(scenes);
    await this.store.save();
    this.syncAccessories();

    if (validation.missingRooms.length) {
      this.log.warn(t('log.presetMissingRooms', { names: validation.missingRooms.join(', ') }));
    }
    if (validation.missingFavorites.length) {
      this.log.warn(t('log.presetMissingFavorites', { names: validation.missingFavorites.join(', ') }));
    }

    return {
      scenes: this.store.list(),
      applied: scenes.length,
      validation,
    };
  }
}

function parseHosts(value) {
  if (!value) return [];
  const list = Array.isArray(value) ? value : String(value).split(/[\s,;]+/);
  return list.map((entry) => String(entry).trim()).filter(Boolean);
}

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

module.exports = { SonosControlPlatform };
