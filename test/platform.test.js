'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const crypto = require('node:crypto');

const { SceneStore } = require('../src/store');
const { SonosControlPlatform } = require('../src/platform');
const { quietLog } = require('./mock-sonos');
const { setLanguage } = require('../src/i18n');

// Written in Danish, like the engine tests. Pinned so they do not depend on
// what the machine's locale makes the default resolve to.
setLanguage('da');

// ------------------------------------------------------------------ store

test('the store normalises whatever it is handed', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-store-'));
  const store = new SceneStore({ storagePath: dir, log: quietLog });
  store.load();

  store.replaceAll([{ name: 'Uden noget som helst' }, {}]);
  const [first, second] = store.list();

  assert.ok(first.id && second.id, 'ids are generated');
  assert.equal(first.enabled, true);
  assert.equal(first.switchType, 'momentary');
  assert.equal(first.mode, 'parallel');
  assert.deepEqual(first.condition, { type: 'always', params: {} });
  assert.deepEqual(first.steps, []);
  assert.equal(second.name, 'Scene 2');

  fs.rmSync(dir, { recursive: true, force: true });
});

test('saving is atomic and survives a reload', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-store-'));
  const store = new SceneStore({ storagePath: dir, log: quietLog });
  store.load();
  store.replaceAll([{ name: 'Aften', steps: [{ action: 'pause', target: { type: 'all' } }] }]);
  await store.save();

  const reopened = new SceneStore({ storagePath: dir, log: quietLog });
  reopened.load();
  assert.equal(reopened.list().length, 1);
  assert.equal(reopened.list()[0].name, 'Aften');
  assert.equal(reopened.list()[0].steps[0].action, 'pause');

  fs.rmSync(dir, { recursive: true, force: true });
});

test('a corrupt scenes.json is quarantined rather than crashing the bridge', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-store-'));
  const store = new SceneStore({ storagePath: dir, log: quietLog });
  store.ensureDirs();
  fs.writeFileSync(store.file, '{ this is not json');

  const scenes = store.load();
  assert.deepEqual(scenes, []);
  const quarantined = fs.readdirSync(store.dir).filter((name) => name.includes('.broken-'));
  assert.equal(quarantined.length, 1);

  fs.rmSync(dir, { recursive: true, force: true });
});

test('backups accumulate and can be restored', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-store-'));
  const store = new SceneStore({ storagePath: dir, log: quietLog });
  store.load();
  store.replaceAll([{ name: 'Første' }]);
  await store.save();
  store.replaceAll([{ name: 'Anden' }, { name: 'Tredje' }]);
  await store.save();

  const backups = await store.listBackups();
  assert.ok(backups.length >= 1);
  await store.restoreBackup(backups[0].name);
  assert.deepEqual(store.list().map((scene) => scene.name), ['Første']);

  fs.rmSync(dir, { recursive: true, force: true });
});

test('merge keeps existing scenes and de-duplicates names', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-store-'));
  const store = new SceneStore({ storagePath: dir, log: quietLog });
  store.load();
  store.replaceAll([{ name: 'Baggrundsmusik' }]);
  store.merge([{ name: 'Baggrundsmusik' }, { name: 'Ny' }]);

  assert.deepEqual(store.list().map((scene) => scene.name), ['Baggrundsmusik', 'Baggrundsmusik 2', 'Ny']);
  assert.equal(new Set(store.list().map((scene) => scene.id)).size, 3, 'ids stay unique');

  fs.rmSync(dir, { recursive: true, force: true });
});

test('duplicating a scene gives every step a fresh id', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-store-'));
  const store = new SceneStore({ storagePath: dir, log: quietLog });
  store.load();
  store.replaceAll([{ name: 'Kilde', steps: [{ action: 'pause' }, { action: 'play' }] }]);
  const source = store.list()[0];
  const copy = store.duplicate(source.id);

  assert.equal(copy.name, 'Kilde (kopi)');
  assert.notEqual(copy.id, source.id);
  assert.notEqual(copy.steps[0].id, source.steps[0].id);
  assert.equal(copy.steps.length, 2);

  fs.rmSync(dir, { recursive: true, force: true });
});

// --------------------------------------------------------------- platform

/** A Homebridge stand-in that records what the platform asks it to publish. */
function fakeHomebridge(storagePath) {
  const api = new EventEmitter();
  api.registered = [];
  api.unregistered = [];
  api.user = { storagePath: () => storagePath };
  api.hap = {
    uuid: { generate: (value) => crypto.createHash('md5').update(value).digest('hex') },
    Service: {
      AccessoryInformation: 'AccessoryInformation',
      Switch: 'Switch',
    },
    Characteristic: {
      Manufacturer: 'Manufacturer',
      Model: 'Model',
      SerialNumber: 'SerialNumber',
      FirmwareRevision: 'FirmwareRevision',
      Name: 'Name',
      ConfiguredName: 'ConfiguredName',
      On: 'On',
    },
  };
  api.platformAccessory = class {
    constructor(displayName, uuid) {
      this.displayName = displayName;
      this.UUID = uuid;
      this.context = {};
      this.services = new Map();
    }
    getService(type) {
      return this.services.get(type) || null;
    }
    addService(type) {
      const service = {
        type,
        characteristics: new Map(),
        handlers: new Map(),
        setCharacteristic(name, value) {
          this.characteristics.set(name, value);
          return this;
        },
        updateCharacteristic(name, value) {
          this.characteristics.set(name, value);
          return this;
        },
        testCharacteristic() {
          return true;
        },
        addOptionalCharacteristic() {},
        getCharacteristic(name) {
          const holder = this;
          return {
            onGet(fn) {
              holder.handlers.set(`get:${name}`, fn);
              return this;
            },
            onSet(fn) {
              holder.handlers.set(`set:${name}`, fn);
              return this;
            },
          };
        },
      };
      this.services.set(type, service);
      return service;
    }
  };
  api.registerPlatformAccessories = (_plugin, _platform, accessories) => api.registered.push(...accessories);
  api.unregisterPlatformAccessories = (_plugin, _platform, accessories) => api.unregistered.push(...accessories);
  return api;
}

test('accessories are added, renamed and removed as scenes change', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-plat-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const api = fakeHomebridge(dir);
  const platform = new SonosControlPlatform(quietLog, { platform: 'SonosControl' }, api);
  t.after(() => platform.stop());

  platform.store.replaceAll([{ name: 'Aften' }, { name: 'Fest' }]);
  platform.syncAccessories();
  assert.equal(api.registered.length, 2);
  assert.deepEqual(api.registered.map((accessory) => accessory.displayName).sort(), ['Aften', 'Fest']);

  // Rename in place — no re-registration, and Apple Home sees the new name.
  const evening = platform.store.list().find((scene) => scene.name === 'Aften');
  platform.store.upsert({ ...evening, name: 'Aftenmusik' });
  platform.syncAccessories();
  assert.equal(api.registered.length, 2, 'renaming must not create a second accessory');
  const accessory = [...platform.cachedAccessories.values()].find(
    (entry) => entry.context.scene.id === evening.id,
  );
  assert.equal(accessory.displayName, 'Aftenmusik');
  assert.equal(accessory.getService('Switch').characteristics.get('Name'), 'Aftenmusik');

  // Deleting removes exactly one switch.
  platform.store.remove(evening.id);
  platform.syncAccessories();
  assert.equal(api.unregistered.length, 1);
  assert.equal(api.unregistered[0].displayName, 'Aftenmusik');
});

test('a momentary switch turns itself back off; a stateful one does not', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-plat-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const api = fakeHomebridge(dir);
  const platform = new SonosControlPlatform(quietLog, {}, api);
  t.after(() => platform.stop());

  const runs = [];
  platform.runner.run = async (id, options) => {
    runs.push({ id, branch: options.branch });
    return { ok: true, sceneName: 'x', steps: [] };
  };

  platform.store.replaceAll([
    { name: 'Tryk', switchType: 'momentary', autoOffMs: 250 },
    { name: 'Tilfra', switchType: 'stateful', offSteps: [{ action: 'pause' }] },
  ]);
  platform.syncAccessories();

  const momentary = platform.handlers.get(platform.store.list().find((s) => s.name === 'Tryk').id);
  const stateful = platform.handlers.get(platform.store.list().find((s) => s.name === 'Tilfra').id);

  await momentary._handleSet(true);
  assert.equal(momentary.state, true);
  await new Promise((resolve) => setTimeout(resolve, 350));
  assert.equal(momentary.state, false, 'momentary switch resets itself');

  await stateful._handleSet(true);
  assert.equal(stateful.state, true);
  await new Promise((resolve) => setTimeout(resolve, 300));
  assert.equal(stateful.state, true, 'stateful switch stays on');
  await stateful._handleSet(false);
  assert.equal(stateful.state, false);

  assert.deepEqual(runs.map((run) => run.branch), ['on', 'on', 'off']);
});

test('switching a scene from stateful to momentary unsticks the switch', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-plat-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const api = fakeHomebridge(dir);
  const platform = new SonosControlPlatform(quietLog, {}, api);
  t.after(() => platform.stop());
  platform.runner.run = async () => ({ ok: true, sceneName: 'x', steps: [] });

  platform.store.replaceAll([{ name: 'S', switchType: 'stateful' }]);
  platform.syncAccessories();
  const scene = platform.store.list()[0];
  const handler = platform.handlers.get(scene.id);

  await handler._handleSet(true);
  assert.equal(handler.state, true);

  platform.store.upsert({ ...scene, switchType: 'momentary' });
  platform.syncAccessories();
  assert.equal(handler.state, false);
});

// -------------------------------------------------------------- migration

test('scenes and backups are carried over from a folder used under an older name', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-migrate-'));
  const legacy = path.join(dir, 'sonos-control');
  fs.mkdirSync(path.join(legacy, 'backups'), { recursive: true });
  fs.writeFileSync(
    path.join(legacy, 'scenes.json'),
    JSON.stringify({ scenes: [{ id: 'abc', name: 'Gammel scene' }] }),
  );
  fs.writeFileSync(path.join(legacy, 'backups', 'scenes-2026-01-01.json'), '{"scenes":[]}');

  const store = new SceneStore({ storagePath: dir, log: quietLog });
  const scenes = store.load();

  assert.equal(scenes.length, 1);
  assert.equal(scenes[0].name, 'Gammel scene');
  assert.equal(scenes[0].id, 'abc', 'ids survive, so HomeKit keeps the same switches');
  assert.ok(fs.existsSync(path.join(dir, 'sonos-control-pro', 'scenes.json')));
  assert.ok(fs.existsSync(path.join(dir, 'sonos-control-pro', 'backups', 'scenes-2026-01-01.json')));
  assert.ok(fs.existsSync(path.join(legacy, 'scenes.json')), 'the old folder is left alone');

  fs.rmSync(dir, { recursive: true, force: true });
});

test('an existing folder is never overwritten by an older one', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-migrate-'));
  for (const name of ['sonos-flows', 'sonos-control', 'sonos-control-pro']) {
    fs.mkdirSync(path.join(dir, name), { recursive: true });
  }
  fs.writeFileSync(path.join(dir, 'sonos-flows', 'scenes.json'), JSON.stringify({ scenes: [{ name: 'Ældst' }] }));
  fs.writeFileSync(path.join(dir, 'sonos-control', 'scenes.json'), JSON.stringify({ scenes: [{ name: 'Gammel' }] }));
  fs.writeFileSync(path.join(dir, 'sonos-control-pro', 'scenes.json'), JSON.stringify({ scenes: [{ name: 'Ny' }] }));

  const store = new SceneStore({ storagePath: dir, log: quietLog });
  assert.deepEqual(store.load().map((scene) => scene.name), ['Ny']);

  fs.rmSync(dir, { recursive: true, force: true });
});

test('the newest previous name wins when several exist', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-migrate-'));
  for (const name of ['sonos-flows', 'sonos-control']) {
    fs.mkdirSync(path.join(dir, name), { recursive: true });
  }
  fs.writeFileSync(path.join(dir, 'sonos-flows', 'scenes.json'), JSON.stringify({ scenes: [{ name: 'Ældst' }] }));
  fs.writeFileSync(path.join(dir, 'sonos-control', 'scenes.json'), JSON.stringify({ scenes: [{ name: 'Gammel' }] }));

  const store = new SceneStore({ storagePath: dir, log: quietLog });
  assert.deepEqual(store.load().map((scene) => scene.name), ['Gammel']);

  fs.rmSync(dir, { recursive: true, force: true });
});

test('every alias this plugin has ever used is registered', () => {
  const registrations = [];
  require('../index.js')({ registerPlatform: (plugin, alias) => registrations.push({ plugin, alias }) });
  assert.deepEqual(
    registrations.map((entry) => entry.alias),
    ['SonosControlPro', 'SonosControl', 'SonosFlows'],
  );
  assert.ok(registrations.every((entry) => entry.plugin === 'homebridge-sonos-control-pro'));
});

test('the npm name does not collide with the other plugin of the same display name', () => {
  const pkg = require('../package.json');
  assert.equal(pkg.name, 'homebridge-sonos-control-pro');
  assert.notEqual(pkg.name, 'homebridge-sonos-control', 'that name belongs to somebody else on npm');
});

test('renaming the package does not change accessory identity in Apple Home', () => {
  const { ACCESSORY_NAMESPACE, PLUGIN_NAME } = require('../src/settings');
  assert.equal(ACCESSORY_NAMESPACE, 'homebridge-sonos-control');
  assert.notEqual(ACCESSORY_NAMESPACE, PLUGIN_NAME, 'the namespace must survive a package rename');
});

// ─────────────────────────────────────────────────────────────── portability

test('the mock household binds only to 127.0.0.1, on ports the OS picks', async (t) => {
  // Two failures, one test. Linux gives you the whole 127.0.0.0/8 range; macOS
  // configures 127.0.0.1 and nothing else, so a mock spread across 127.0.0.2
  // and friends died with EADDRNOTAVAIL before a single test ran. And a fixed
  // port range collides as soon as two test files run at once, which the test
  // runner does by default on any machine with cores to spare.
  const { MockHousehold } = require('./mock-sonos');
  const household = new MockHousehold(['One', 'Two', 'Three']);
  t.after(() => household.close());
  await household.listen();

  const bound = household.servers.map((server) => server.address());
  assert.equal(bound.length, 3);
  for (const address of bound) assert.equal(address.address, '127.0.0.1');
  // …and each on a port of its own, or they would answer for each other.
  assert.equal(new Set(bound.map((address) => address.port)).size, 3);
  assert.deepEqual(
    household.players.map((player) => player.port).sort(),
    bound.map((address) => address.port).sort(),
  );
  // Nothing fixed: every port was handed out by the operating system.
  for (const player of household.players) assert.ok(player.port > 1024);
});

// ------------------------------------------------------- a house with no Sonos

test('a household with nothing in it says so, rather than throwing', async () => {
  // The very first thing anyone without Sonos hardware sees — a reviewer, or
  // somebody whose network blocks multicast. It used to be a ReferenceError:
  // the empty-handed branch tested a variable that had never existed, and no
  // test covered it because every other test has a mock household answering.
  //
  // The sweep is stubbed, and that is not a convenience. The first version of
  // this test called the real one, and on the author's own Mac fourteen real
  // Sonos speakers answered it and failed the assertion. A test suite has no
  // business broadcasting on the network it happens to be run from.
  const { SonosSystem } = require('../src/sonos/system');
  const warnings = [];
  const log = { ...quietLog, warn: (message) => warnings.push(String(message)) };

  const system = new SonosSystem({
    log,
    // A port nothing is listening on, so describe() fails the honest way.
    seedHosts: ['127.0.0.1:1'],
    discoveryTimeout: 150,
    discoverFn: async () => [],
  });

  const players = await system.discover({ force: true });

  assert.deepEqual(players, [], 'no speakers, no exception');
  assert.equal(system.ready, false);
  assert.equal(warnings.length, 1, `expected one warning, got: ${warnings.join(' | ')}`);
  assert.match(warnings[0], /playerIps/, 'and it must say how to fix it');
  // The address it could not reach, named — silence here was the old bug's twin.
  assert.match(warnings[0], /127\.0\.0\.1/);
  assert.doesNotMatch(warnings[0], /is not defined|undefined/i);
});

test('a household with no seeds at all is the same, quiet, story', async () => {
  const { SonosSystem } = require('../src/sonos/system');
  const warnings = [];
  const log = { ...quietLog, warn: (message) => warnings.push(String(message)) };

  const system = new SonosSystem({
    log,
    seedHosts: [],
    discoveryTimeout: 150,
    discoverFn: async () => [],
  });
  assert.deepEqual(await system.discover({ force: true }), []);
  assert.equal(warnings.length, 1);
});

// --------------------------------------------------- what the verifier checks

test('config.schema.json is the shape Homebridge and the verifier expect', () => {
  // Every one of these was a red cross from the verification bot, and none of
  // them is visible by looking at the settings page — it renders fine either
  // way. So they are asserted rather than remembered.
  const schema = require('../config.schema.json');

  assert.equal(schema.pluginType, 'platform');
  assert.equal(schema.pluginAlias, 'SonosControlPro');
  assert.ok(schema.schema.properties.name, 'a name property is required of every plugin');

  // `required` is an array at the object level, never a boolean on a field.
  // JSON Schema has no boolean `required` on a property; Homebridge tolerates
  // it, the verifier does not, and it never meant anything.
  assert.ok(Array.isArray(schema.schema.required), '`required` must be an array');
  const boolRequired = Object.entries(schema.schema.properties)
    .filter(([, value]) => typeof value.required === 'boolean')
    .map(([key]) => key);
  assert.deepEqual(boolRequired, [], `boolean "required" on: ${boolRequired.join(', ')}`);

  // And everything named as required must actually exist.
  for (const key of schema.schema.required) {
    assert.ok(schema.schema.properties[key], `required names "${key}", which has no property`);
  }
});

test('package.json declares what the verifier needs to see', () => {
  const pkg = require('../package.json');
  assert.ok(pkg.keywords.includes('homebridge-plugin'), 'the keyword the UI searches for');
  // A plugin must say which transport it speaks. This one exposes switches
  // through HAP and does nothing over Matter.
  assert.ok(
    pkg.keywords.includes('supports-hap') || pkg.keywords.includes('supports-matter'),
    'one of supports-hap / supports-matter must be declared',
  );
  for (const field of ['homepage', 'repository', 'bugs', 'license', 'main', 'engines']) {
    assert.ok(pkg[field], `package.json is missing ${field}`);
  }
  for (const script of ['preinstall', 'install', 'postinstall']) {
    assert.equal(pkg.scripts[script], undefined, `${script} must not exist`);
  }
  for (const forbidden of ['homebridge', 'hap-nodejs']) {
    assert.equal(pkg.dependencies?.[forbidden], undefined, `${forbidden} must not be a dependency`);
    assert.equal(pkg.peerDependencies?.[forbidden], undefined, `${forbidden} must not be a peer`);
  }
});

test('the suite never broadcasts on the machine it is running on', async () => {
  // The guard for the guard. Every SonosSystem a test builds hands in its own
  // sweep; if one ever forgets, the default is the real SSDP one and the suite
  // starts talking to whatever Sonos hardware is on the network.
  const { SonosSystem } = require('../src/sonos/system');
  const { discover } = require('../src/sonos/ssdp');
  const fs = require('node:fs/promises');
  const path = require('node:path');

  // The default really is the live sweep — that is what makes forgetting bad.
  assert.equal(new SonosSystem({ log: quietLog }).discoverFn, discover);

  const dir = __dirname;
  const files = (await fs.readdir(dir)).filter((name) => name.endsWith('.test.js'));
  const offenders = [];
  for (const name of files) {
    const source = await fs.readFile(path.join(dir, name), 'utf8');
    // Every construction, and what follows it up to the closing brace.
    for (const match of source.matchAll(/new SonosSystem\(\{[\s\S]*?\n\s*\}\)/g)) {
      if (!match[0].includes('discoverFn')) {
        offenders.push(`${name}: ${match[0].split('\n')[0]}…`);
      }
    }
  }
  assert.deepEqual(offenders, [], `a SonosSystem without a stubbed sweep:\n${offenders.join('\n')}`);
});
