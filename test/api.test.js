'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');

const { MockHousehold, quietLog } = require('./mock-sonos');
const { SonosSystem } = require('../src/sonos/system');
const { SceneRunner } = require('../src/engine/runner');
const { SceneStore } = require('../src/store');
const { ControlApi } = require('../src/api');
const { RUNTIME_FILE, STATE_DIR } = require('../src/settings');
const preset = require('../src/presets/starter');
const fixture = require('./fixtures/household');

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
    async close() {
      control.stop();
      runner.cancelAll();
      system.stop();
      await household.close();
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

test('the control API rejects a request without the token', async (t) => {
  const h = await apiHarness();
  t.after(() => h.close());

  const status = await new Promise((resolve) => {
    const request = http.request(
      { host: '127.0.0.1', port: h.control.actualPort, path: '/status', method: 'GET' },
      (response) => {
        response.resume();
        resolve(response.statusCode);
      },
    );
    request.end();
  });
  assert.equal(status, 401);
});

test('runtime.json is written so the settings UI can find the bridge', async (t) => {
  const h = await apiHarness();
  t.after(() => h.close());

  const runtime = JSON.parse(fs.readFileSync(path.join(h.dir, STATE_DIR, RUNTIME_FILE), 'utf8'));
  assert.equal(runtime.port, h.control.actualPort);
  assert.ok(runtime.token.length >= 32);
  assert.equal(fs.statSync(path.join(h.dir, STATE_DIR, RUNTIME_FILE)).mode & 0o077, 0, 'not readable by others');
});

test('status, players and library come back in the shape the UI expects', async (t) => {
  const h = await apiHarness();
  t.after(() => h.close());

  const status = await h.call('GET', '/status');
  assert.equal(status.status, 200);
  assert.equal(status.body.playerCount, ROOMS.length);

  const players = await h.call('GET', '/players?state=1');
  assert.equal(players.body.players.length, ROOMS.length);
  assert.ok(typeof players.body.players[0].volume === 'number');
  assert.ok(Array.isArray(players.body.groups));

  const library = await h.call('GET', '/library');
  assert.equal(library.body.favorites[0].title, 'City Radio');
  assert.equal(library.body.favorites[0].metadata, undefined, 'DIDL is stripped before it reaches the browser');
});

test('the catalogue exposes every action with its parameter descriptors', async (t) => {
  const h = await apiHarness();
  t.after(() => h.close());

  const { body } = await h.call('GET', '/catalogue');
  const ids = body.actions.flatMap((group) => group.actions.map((action) => action.id));
  for (const expected of ['groupAndPlay', 'playFavorite', 'adjustVolume', 'pause', 'joinGroup', 'snapshot']) {
    assert.ok(ids.includes(expected), `${expected} should be offered in the editor`);
  }
  const musicScene = body.actions.flatMap((group) => group.actions).find((action) => action.id === 'groupAndPlay');
  assert.equal(musicScene.composite, true);
  assert.ok(musicScene.params.some((param) => param.key === 'leave'));
  assert.ok(musicScene.params.some((param) => param.key === 'groupDelayMs'));
  assert.ok(body.filters.some((filter) => filter.value === 'playing'));
});

test('scenes can be created, run and deleted over the API', async (t) => {
  const h = await apiHarness();
  t.after(() => h.close());

  const created = await h.call('POST', '/scenes', {
    scene: {
      name: 'Test',
      steps: [{ action: 'setVolume', target: { type: 'players', names: ['Study'] }, params: { volume: 44 } }],
    },
  });
  assert.equal(created.status, 200);
  const sceneId = created.body.scene.id;
  assert.ok(h.platform.syncCount >= 1, 'HomeKit is resynced when a scene is saved');

  const run = await h.call('POST', '/scenes/run', { id: sceneId });
  assert.equal(run.body.result.ok, true);
  assert.equal(h.household.byName('Study').volume, 44);

  const removed = await h.call('POST', '/scenes/delete', { id: sceneId });
  assert.equal(removed.body.scenes.length, 0);
});

test('a single step can be tested without saving anything', async (t) => {
  const h = await apiHarness();
  t.after(() => h.close());

  const result = await h.call('POST', '/step/test', {
    step: { action: 'setVolume', target: { type: 'players', names: ['Living Room'] }, params: { volume: 7 } },
  });
  assert.equal(result.body.ok, true);
  assert.equal(h.household.byName('Living Room').volume, 7);
  assert.equal(h.store.scenes.size, 0, 'nothing was persisted');
});

test('the target preview tells you exactly which speakers would be hit', async (t) => {
  const h = await apiHarness();
  t.after(() => h.close());

  h.household.byName('Kitchen').transportState = 'PLAYING';
  await h.system.refreshTopology();

  const preview = await h.call('POST', '/target/preview', { target: { type: 'all', filter: 'playing' } });
  assert.deepEqual(preview.body.players, ['Kitchen']);
  assert.equal(preview.body.skipped.length, ROOMS.length - 1);
});

test('the starter preset loads through the API and fills in the group leader', async (t) => {
  const h = await apiHarness();
  t.after(() => h.close());

  const applied = await h.call('POST', '/presets/apply', { id: preset.id, mode: 'replace' });
  assert.equal(applied.body.applied, 4);
  const names = applied.body.scenes.map((scene) => scene.name);
  assert.deepEqual(names, preset.scenes.map((scene) => scene.name));

  // The one value a preset cannot know in advance is taken from the household
  // that is actually there, so all four scenes work without any editing.
  const music = applied.body.scenes.find((scene) => scene.steps[0]?.action === 'groupAndPlay');
  assert.equal(music.steps[0].params.coordinator, h.system.list()[0].name);
});

test('the starter preset names itself in the chosen language', async (t) => {
  const { setLanguage } = require('../src/i18n');
  t.after(() => setLanguage('da'));

  setLanguage('en');
  assert.equal(preset.name, 'Getting started');
  assert.equal(preset.scenes[0].name, 'Music everywhere');
  setLanguage('da');
  assert.equal(preset.name, 'Kom godt i gang');
  assert.equal(preset.scenes[0].name, 'Musik i hele huset');
});

test('the status report names speakers that have no level in any scene', async (t) => {
  const h = await apiHarness();
  t.after(() => h.close());

  await h.call('PUT', '/scenes', { scenes: fixture.SCENES });
  const status = await h.call('GET', '/status');
  assert.ok(Array.isArray(status.body.unconfigured));
  assert.equal(status.body.unconfigured.includes('Kitchen'), false, 'the leader has a level');
});

test('adopting a new speaker gives it a level in every music scene', async (t) => {
  const h = await apiHarness();
  t.after(() => h.close());

  await h.call('PUT', '/scenes', { scenes: fixture.SCENES });
  await h.household.addPlayer('Terrasse');
  await h.system.refreshTopology();

  const before = await h.call('GET', '/status');
  assert.ok(before.body.unconfigured.includes('Terrasse'), 'it is flagged as unconfigured');

  const adopted = await h.call('POST', '/players/adopt', { names: ['Terrasse'], volume: 15 });
  assert.deepEqual(adopted.body.rooms, ['Terrasse']);
  assert.ok(adopted.body.scenes.length >= 3, 'all three music scenes were updated');

  const scene = adopted.body.scenesList.find((entry) => entry.name === 'Party mode');
  assert.equal(scene.steps[0].params.volumes.Terrasse, 15);

  const after = await h.call('GET', '/status');
  assert.equal(after.body.unconfigured.includes('Terrasse'), false);
});

test('an unknown route answers 404 rather than hanging', async (t) => {
  const h = await apiHarness();
  t.after(() => h.close());
  const result = await h.call('GET', '/nope');
  assert.equal(result.status, 404);
});
