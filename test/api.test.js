'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');

const { quietLog } = require('./mock-sonos');
const { SceneStore } = require('../src/store');
const { ControlApi } = require('../src/api');
const { RUNTIME_FILE, STATE_DIR } = require('../src/settings');
const preset = require('../src/presets/starter');
const fixture = require('./fixtures/household');
const { apiHarness, ROOMS } = require('./api-harness');

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

test('a reorder with no list is refused, and one with a stale id still works', async (t) => {
  const h = await apiHarness();
  t.after(() => h.close());

  await h.call('POST', '/scenes', { scene: { name: 'A' } });
  await h.call('POST', '/scenes', { scene: { name: 'B' } });
  const [a, b] = (await h.call('GET', '/scenes')).body.scenes;

  // `body.ids || []` used to accept a request that said nothing, renumber the
  // scenes in the order they already had, and write the file — a save and a
  // backup for a request that was not one.
  for (const body of [{}, { ids: 'a,b' }, { ids: null }]) {
    const answer = await h.call('POST', '/scenes/reorder', body);
    assert.equal(answer.status, 400, JSON.stringify(body));
  }

  // But an id the store does not know is skipped, not refused. The page that
  // dragged the list a moment before somebody else deleted a scene should still
  // get the rest in the order it asked for.
  const reordered = await h.call('POST', '/scenes/reorder', { ids: [b.id, 'gone', a.id] });
  assert.equal(reordered.status, 200);
  assert.deepEqual(
    reordered.body.scenes.map((scene) => scene.name),
    ['B', 'A'],
  );
});

// These four read `body.id` and did nothing with it. A request that named no
// scene reported success having done nothing, and an id for a scene deleted in
// another tab came back as a 500 — which the settings page reads as "the bridge
// is broken" rather than "that one is gone, reload".
test('a scene route with no id is a bad request, and an unknown one a 404', async (t) => {
  const h = await apiHarness();
  t.after(() => h.close());

  const created = await h.call('POST', '/scenes', { scene: { name: 'Findes' } });
  const realId = created.body.scene.id;

  for (const route of ['/scenes/delete', '/scenes/duplicate', '/scenes/run', '/scenes/stop']) {
    const missing = await h.call('POST', route, {});
    assert.equal(missing.status, 400, `${route} with no id`);
    assert.ok(missing.body.error, `${route} says why`);

    const blank = await h.call('POST', route, { id: '   ' });
    assert.equal(blank.status, 400, `${route} with a blank id`);

    const wrongType = await h.call('POST', route, { id: 42 });
    assert.equal(wrongType.status, 400, `${route} with an id that is not a string`);

    const unknown = await h.call('POST', route, { id: 'scene-der-blev-slettet' });
    assert.equal(unknown.status, 404, `${route} with an id nobody knows`);
    assert.ok(unknown.body.error.includes('scene-der-blev-slettet'), `${route} names it`);
  }

  // And the scene that does exist is still reachable through all of them.
  assert.equal((await h.call('POST', '/scenes/run', { id: realId })).status, 200);
  assert.equal((await h.call('POST', '/scenes/stop', { id: realId })).status, 200);
  assert.equal((await h.call('POST', '/scenes/duplicate', { id: realId })).status, 200);
  assert.equal((await h.call('POST', '/scenes/delete', { id: realId })).status, 200);
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
  assert.equal(applied.body.applied, preset.scenes.length);
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

test('manual addresses can be set from the settings page and take effect at once', async (t) => {
  // The setting somebody on a segmented network actually needs, and the one
  // they could not reach: a custom UI replaces Homebridge's form, so playerIps
  // used to mean hand-editing config.json — a poor answer for exactly the
  // people whose speakers are not being found.
  const h = await apiHarness();
  t.after(() => h.close());

  const before = await h.call('GET', '/playerIps');
  assert.equal(before.status, 200);
  assert.equal(before.body.playerIps, '');

  const addresses = h.household.players
    .slice(0, 2)
    .map((player) => `${player.host}:${player.port}`)
    .join(', ');

  const saved = await h.call('POST', '/playerIps', { playerIps: addresses });
  assert.equal(saved.status, 200);
  assert.equal(saved.body.hosts.length, 2);
  assert.ok(saved.body.found > 0, 'the addresses were tried immediately, not at the next restart');
  assert.ok(Array.isArray(saved.body.players) && saved.body.players.length > 0);

  // …and it is readable again, so the field is filled in on the next visit.
  const after = await h.call('GET', '/playerIps');
  assert.equal(after.body.playerIps, addresses);
});

test('clearing the manual addresses is allowed, and empties them', async (t) => {
  const h = await apiHarness();
  t.after(() => h.close());
  await h.call('POST', '/playerIps', { playerIps: '10.0.0.9' });
  const cleared = await h.call('POST', '/playerIps', { playerIps: '' });
  assert.equal(cleared.status, 200);
  assert.deepEqual(cleared.body.hosts, []);
  assert.equal((await h.call('GET', '/playerIps')).body.playerIps, '');
});

test('an unknown route answers 404 rather than hanging', async (t) => {
  const h = await apiHarness();
  t.after(() => h.close());
  const result = await h.call('GET', '/nope');
  assert.equal(result.status, 404);
});

// ─────────────────────────────────────────────── what the review turned up

test('runtime.json is tightened even when it was already there and world-readable', async (t) => {
  // The mode on writeFileSync only applies when the file is created. This is
  // the case the old assertion could not see, because it made the file fresh
  // every time — which is the one case that already worked.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-api-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const stateDir = path.join(dir, STATE_DIR);
  fs.mkdirSync(stateDir, { recursive: true });
  const runtimeFile = path.join(stateDir, RUNTIME_FILE);
  fs.writeFileSync(runtimeFile, '{"port":1,"token":"gammel"}', { mode: 0o644 });
  fs.chmodSync(runtimeFile, 0o644);

  const control = new ControlApi({
    platform: { version: 'test' },
    storagePath: dir,
    port: 0,
    log: quietLog,
  });
  await control.start();
  t.after(() => control.stop());

  const mode = fs.statSync(runtimeFile).mode & 0o777;
  assert.equal(mode & 0o077, 0, `a live token must not be readable by anyone else (mode ${mode.toString(8)})`);
});

test('a stale runtime.json is cleared before the bridge tries to bind', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-api-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const stateDir = path.join(dir, STATE_DIR);
  fs.mkdirSync(stateDir, { recursive: true });
  const runtimeFile = path.join(stateDir, RUNTIME_FILE);
  fs.writeFileSync(runtimeFile, JSON.stringify({ port: 1, token: 'ET-GAMMELT-TOKEN' }));

  // Something else already owns the port the user pinned, so the bind fails.
  const squatter = http.createServer(() => {});
  await new Promise((resolve) => squatter.listen(0, '127.0.0.1', resolve));
  t.after(() => squatter.close());

  const control = new ControlApi({
    platform: { version: 'test' },
    storagePath: dir,
    port: squatter.address().port,
    log: quietLog,
  });
  await assert.rejects(() => control.start());

  assert.equal(
    fs.existsSync(runtimeFile),
    false,
    'the settings page must not be pointed at a port we do not own, with our token',
  );
});

test('saving without a scene list is refused rather than read as "delete everything"', async (t) => {
  const h = await apiHarness();
  t.after(() => h.close());

  h.store.replaceAll([{ name: 'Morgen' }, { name: 'Aften' }, { name: 'Fest' }]);
  await h.store.save();

  const put = await h.call('PUT', '/scenes', { settings: { theme: 'dark' } });
  assert.equal(put.status, 400);
  assert.equal(h.store.list().length, 3, 'every scene is still there');

  const imported = await h.call('POST', '/scenes/import', { mode: 'replace' });
  assert.equal(imported.status, 400);
  assert.equal(h.store.list().length, 3);
});

test('a body that is valid JSON but is not a request does not create anything', async (t) => {
  const h = await apiHarness();
  t.after(() => h.close());

  h.store.replaceAll([{ name: 'Morgen' }]);

  const number = await h.call('POST', '/scenes', 123);
  assert.equal(h.store.list().length, 1, 'a bare number must not become an empty scene');
  assert.equal(number.status, 400);

  const nothing = await h.call('POST', '/scenes', null);
  assert.equal(h.store.list().length, 1);
  assert.equal(nothing.status, 400, 'and it is certainly not our internal error');
});

test('a malformed body is the client’s mistake, and says so', async (t) => {
  const h = await apiHarness();
  t.after(() => h.close());

  const status = await new Promise((resolve, reject) => {
    const request = http.request(
      {
        host: '127.0.0.1',
        port: h.control.actualPort,
        path: '/scenes',
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-sf-token': h.control.token },
      },
      (response) => {
        response.resume();
        resolve(response.statusCode);
      },
    );
    request.on('error', reject);
    request.end('{');
  });

  assert.equal(status, 400, 'a 500 reads as "the bridge is broken"');
});

test('settings of the wrong shape are not persisted', async (t) => {
  const h = await apiHarness();
  t.after(() => h.close());

  await h.call('PUT', '/scenes', { scenes: [{ name: 'Morgen' }], settings: 'boom' });
  assert.equal(typeof h.store.settings, 'object');
  assert.notEqual(h.store.settings, 'boom');
});
