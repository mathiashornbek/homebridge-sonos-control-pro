'use strict';

/**
 * A running control API on a mock household, for tests that talk to the bridge
 * the way the settings page does. Shared between the API tests and the tests
 * of the settings-UI server that sits in front of it.
 */

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');

const { MockHousehold, quietLog } = require('./mock-sonos');
const { SonosSystem } = require('../src/sonos/system');
const { SceneRunner } = require('../src/engine/runner');
const { SceneStore } = require('../src/store');
const { ControlApi } = require('../src/api');

const ROOMS = ['Kitchen', 'Pantry', 'Living Room', 'Study'];

async function apiHarness() {
  const household = new MockHousehold(ROOMS);
  household.favorites = [{ title: 'City Radio', description: 'DR LYD', uri: 'x-sonosapi-hls:city-radio', container: false }];
  await household.listen();

  const system = new SonosSystem({
    log: quietLog,
    // Each mock player answers on its own port on 127.0.0.1, so the seed
    // has to name the port — the same "host:port" form a real config accepts.
    seedHosts: household.players.map((player) => `${player.host}:${player.port}`),
    discoveryTimeout: 150,
    // An address nobody answers on is part of two tests here. Four seconds of
    // waiting for it, twice, is not.
    describeTimeoutMs: 300,
    // The mock household only, never the machine's real network. See engine.test.js.
    discoverFn: async () => [],
  });
  await system.discover({ force: true });

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-api-'));
  const store = new SceneStore({ storagePath: dir, log: quietLog });
  store.load();
  const runner = new SceneRunner({ system, log: quietLog, getScenes: () => store.scenes });

  const platform = {
    version: '1.0.0-test',
    startedAt: Date.now(),
    system,
    store,
    runner,
    syncAccessories() {
      platform.syncCount = (platform.syncCount || 0) + 1;
    },
    testContext: () => ({
      system,
      log: quietLog,
      signal: new AbortController().signal,
      snapshots: runner.snapshots,
      sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      runScene: async () => 'x',
    }),
    unconfiguredPlayers() {
      const known = new Set();
      for (const scene of store.list()) {
        for (const step of scene.steps || []) {
          for (const name of Object.keys(step.params?.volumes || {})) known.add(name);
          for (const name of step.target?.names || []) known.add(name);
        }
      }
      return system.list().map((player) => player.name).filter((name) => !known.has(name));
    },
    async adoptPlayers(names, volume) {
      const rooms = names.map((name) => system.resolve(name)?.name).filter(Boolean);
      const touched = [];
      for (const scene of store.list()) {
        let changed = false;
        for (const step of scene.steps || []) {
          if (step.action !== 'groupAndPlay') continue;
          if (Object.keys(step.params.volumes || {}).length === 0) continue;
          for (const room of rooms) {
            if (room === step.params.coordinator) continue;
            step.params.volumes = { ...step.params.volumes, [room]: Number(volume) };
            changed = true;
          }
        }
        if (changed) {
          store.upsert(scene);
          touched.push(scene.name);
        }
      }
      await store.save();
      return { rooms, scenes: touched, scenesList: store.list() };
    },
    config: {},
    async setPlayerIps(value) {
      const hosts = String(value || '')
        .split(/[\s,;]+/)
        .map((entry) => entry.trim())
        .filter(Boolean);
      platform.config.playerIps = hosts.join(', ');
      system.seedHosts = hosts;
      await system.discover({ force: true });
      return { hosts, found: system.list().length };
    },
    listPresets: () => require('../src/presets').listPresets(),
    applyPreset: async (id, options) => {
      const found = require('../src/presets').getPreset(id);
      const scenes = JSON.parse(JSON.stringify(found.scenes));
      found.hydrate?.(scenes, system);
      if (options.mode === 'replace') store.replaceAll(scenes);
      else store.merge(scenes);
      await store.save();
      return { scenes: store.list(), applied: scenes.length, validation: {} };
    },
  };

  const control = new ControlApi({ platform, storagePath: dir, port: 0, log: quietLog });
  await control.start();

  const call = (method, route, body) =>
    new Promise((resolve, reject) => {
      const payload = body === undefined ? '' : JSON.stringify(body);
      const request = http.request(
        {
          host: '127.0.0.1',
          port: control.actualPort,
          path: route,
          method,
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(payload),
            'x-sf-token': control.token,
          },
        },
        (response) => {
          const chunks = [];
          response.on('data', (chunk) => chunks.push(chunk));
          response.on('end', () =>
            resolve({ status: response.statusCode, body: JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') }),
          );
        },
      );
      request.on('error', reject);
      request.end(payload);
    });

  return {
    household,
    system,
    store,
    platform,
    control,
    call,
    dir,
    /**
     * Stop the bridge but keep its storage folder — the state a settings page
     * finds when Homebridge is down: scenes.json on disk, no runtime.json.
     */
    async stopBridge() {
      control.stop();
      runner.cancelAll();
      system.stop();
      await household.close();
    },
    async close() {
      await this.stopBridge();
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

module.exports = { apiHarness, ROOMS };
