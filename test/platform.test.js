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

// -------------------------------------------------------------- the brand

test('the settings header draws the icon, all of it', async () => {
  // These were two drawings of the same idea, and they drifted twice. First the
  // header had a rounder switch, the knob in a different place, and two sound
  // waves where the icon has three. Then it was given the icon's own mark — but
  // only the mark, so the tile in the settings page and the tile on the plugin
  // page still did not match: one of them said SONOS and the other did not.
  // Both groups are compared here, shape by shape.
  const fs = require('node:fs/promises');
  const path = require('node:path');
  const root = path.join(__dirname, '..');
  const icon = await fs.readFile(path.join(root, 'docs', 'icon.svg'), 'utf8');
  const header = await fs.readFile(path.join(root, 'homebridge-ui', 'public', 'index.html'), 'utf8');
  const mark = header.match(/<span class="sf-brand-mark"[\s\S]*?<\/span>/)?.[0];
  assert.ok(mark, 'the header has no brand mark');

  // The shapes that make the mark what it is, in the icon's own coordinates,
  // and the placement that decides its proportions.
  const shapes = [
    'transform="translate(256 208) scale(0.75280) translate(-286.1 -252.0)"',
    'x="96" y="196" width="212" height="112" rx="56"',
    'cx="252" cy="252" r="38"',
    'M344 212a62 62 0 0 1 0 80',
    'M389 180a112 112 0 0 1 0 144',
    'M434 148a162 162 0 0 1 0 208',
    // and the word underneath: where it sits, and the first and last letters.
    'transform="translate(49.2 438) scale(0.05252)"',
    'M1286 406Q1286 199 1132.5 89.5Q979 -20 682 -20',
    '<path transform="translate(6511 0)"',
  ];
  for (const shape of shapes) {
    assert.ok(icon.includes(shape), `docs/icon.svg no longer contains ${shape}`);
    assert.ok(mark.includes(shape), `the header is missing ${shape}`);
  }

  // Three sound waves and five letters.
  assert.equal((mark.match(/<path /g) || []).length, 8, 'three waves and the five letters of SONOS');
  // The icon's square, so nothing is cropped or stretched.
  assert.ok(mark.includes('viewBox="0 0 512 512"'), 'the header must use the icon\'s own square');
});

// ------------------------------------------- hostile and hand-edited scenes

test('an id that would break out of an HTML attribute is replaced', () => {
  // Ids reach the store from an imported scene file, which is a feature people
  // are told to use. They are then written into data-id attributes. An id with
  // a quote in it truncated the attribute, so the lookup missed and Edit, Run,
  // Delete and the switch all silently did nothing — with no way to remove the
  // scene from the interface. An id with markup in it was worse.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-hostile-'));
  const store = new SceneStore({ storagePath: dir, log: quietLog });
  store.load();
  store.replaceAll([
    { id: 'a"b', name: 'Quote' },
    { id: 'bad" onmouseover="window.x=1" data-y="', name: 'Handler' },
    { id: '<img src=x onerror=alert(1)>', name: 'Markup' },
    { id: 'perfectly-fine_ID.1:2', name: 'Innocent' },
  ]);

  const byName = Object.fromEntries(store.list().map((scene) => [scene.name, scene]));
  assert.equal(byName.Innocent.id, 'perfectly-fine_ID.1:2', 'a sane id is left alone');
  for (const name of ['Quote', 'Handler', 'Markup']) {
    assert.match(byName[name].id, /^[A-Za-z0-9_.:-]+$/, `${name} kept a dangerous id`);
    assert.doesNotMatch(byName[name].id, /["'<>]/);
  }
  // Replaced, not merely stripped — two hostile ids must not collide.
  assert.notEqual(byName.Quote.id, byName.Handler.id);
});

test('a step parameter that should be a number is made one', () => {
  // The interface renders these straight into HTML attributes. A volume of
  // `30"><img src=x onerror=…>` used to become markup the moment the step was
  // expanded — no interaction needed.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-params-'));
  const store = new SceneStore({ storagePath: dir, log: quietLog });
  store.load();
  store.replaceAll([
    {
      name: 'Hostile',
      steps: [
        {
          action: 'setVolume',
          params: {
            volume: '30"><img src=x onerror="window.x=1">',
            delta: '5" autofocus onfocus="window.y=1" x="',
            volumes: { Kitchen: '10" onmouseover="window.z=1" x="', Study: '42', Garage: 'nonsense' },
            // Not a number, and must survive untouched — it is escaped where
            // it is rendered, and it is legitimately a string.
            uri: 'x-rincon-mp3radio://example.com/stream?a="b"',
          },
        },
      ],
    },
  ]);

  const { params } = store.list()[0].steps[0];
  assert.equal(params.volume, undefined, 'an unparseable volume is dropped, not kept as text');
  assert.equal(params.delta, undefined);
  assert.deepEqual(params.volumes, { Study: 42 }, 'only the levels that are numbers survive');
  assert.equal(typeof params.volumes.Study, 'number');
  assert.equal(params.uri, 'x-rincon-mp3radio://example.com/stream?a="b"', 'strings are left alone');
});

test('a level outside 0–100 is clamped rather than trusted', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-clamp-'));
  const store = new SceneStore({ storagePath: dir, log: quietLog });
  store.load();
  store.replaceAll([
    { name: 'Loud', steps: [{ action: 'groupAndPlay', params: { volumes: { A: 900, B: -5, C: 33.7 } } }] },
  ]);
  assert.deepEqual(store.list()[0].steps[0].params.volumes, { A: 100, B: 0, C: 34 });
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

// ------------------------------------------------- the level a step stores

test('a volume step stores the level its slider shows', () => {
  // The editor rendered `value ?? default ?? 10`, inventing a 10 the model
  // never held: the slider read 10, the saved step was `{}`, and the scene card
  // then read "no level set". The catalogue carries the default now, so the
  // control and the stored scene start out agreeing.
  const { actionCatalogue } = require('../src/engine/actions');
  const byId = new Map();
  for (const group of actionCatalogue()) {
    for (const action of group.actions) byId.set(action.id, action);
  }
  for (const [id, key] of [
    ['setVolume', 'volume'],
    ['adjustVolume', 'delta'],
  ]) {
    const param = byId.get(id).params.find((entry) => entry.key === key);
    assert.ok(param, `${id} has no ${key} parameter`);
    assert.equal(typeof param.default, 'number', `${id}.${key} must have a default the editor can show`);
  }
});

test('a whitespace-only volume is refused, not treated as silence', () => {
  // Number(' ') is 0, so a field containing a space used to mute every chosen
  // speaker and report success — the exact answer the code's own comment says
  // must never happen.
  const { clampVolume } = require('../src/sonos/player');
  for (const value of ['', ' ', '\t', '   ', null, undefined, [], false, {}]) {
    assert.throws(() => clampVolume(value), /volume|lydstyrke/i, `clampVolume(${JSON.stringify(value)}) did not throw`);
  }
  assert.equal(clampVolume('0'), 0, 'a real zero is still a real zero');
  assert.equal(clampVolume(0), 0);
  assert.equal(clampVolume('42'), 42);
  assert.equal(clampVolume(120), 100, 'and out of range is clamped');
  assert.equal(clampVolume(-5), 0);
});

// ─────────────────────────────────────────────── what the review turned up
//
// Everything below was found by reading the persistence, Homebridge and
// accessory layers line by line. Each of these tests was confirmed to fail
// against the code as it was before the fix beside it.

test('a scenes.json that cannot be read leaves the scenes alone and refuses to write', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-store-'));
  const store = new SceneStore({ storagePath: dir, log: quietLog });
  store.load();
  store.replaceAll([{ name: 'Morgen' }, { name: 'Aften' }, { name: 'Nat' }]);
  fs.writeFileSync(store.file, JSON.stringify({ scenes: store.list() }));

  const reopened = new SceneStore({ storagePath: dir, log: quietLog });
  reopened.load();
  assert.equal(reopened.list().length, 3);

  // The file is intact; we simply cannot open it — a root-owned file after one
  // sudo, a full descriptor table, a mount that has not come back.
  const realRead = fs.readFileSync;
  fs.readFileSync = (file, ...rest) => {
    if (String(file) === reopened.file) throw Object.assign(new Error('EMFILE'), { code: 'EMFILE' });
    return realRead(file, ...rest);
  };
  try {
    reopened.load();
  } finally {
    fs.readFileSync = realRead;
  }

  assert.equal(reopened.list().length, 3, 'the scenes are still there');
  assert.equal(reopened.degraded, true);
  assert.equal(
    fs.readdirSync(reopened.dir).filter((name) => name.includes('.broken-')).length,
    0,
    'a file we could not open is not a broken file',
  );

  fs.rmSync(dir, { recursive: true, force: true });
});

test('a degraded store refuses to save rather than write an empty list over a good file', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-store-'));
  const store = new SceneStore({ storagePath: dir, log: quietLog });
  store.load();
  store.replaceAll([{ name: 'Morgen' }]);
  await store.save();
  const before = fs.readFileSync(store.file, 'utf8');

  store.degraded = true;
  await assert.rejects(() => store.save());
  assert.equal(fs.readFileSync(store.file, 'utf8'), before, 'the file is untouched');

  fs.rmSync(dir, { recursive: true, force: true });
});

test('the same broken file is quarantined once, however often it is loaded', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-store-'));
  const store = new SceneStore({ storagePath: dir, log: quietLog });
  store.ensureDirs();
  fs.writeFileSync(store.file, '{ this is not json');

  for (let attempt = 0; attempt < 12; attempt += 1) store.load();

  const quarantined = fs.readdirSync(store.dir).filter((name) => name.includes('.broken-'));
  assert.equal(quarantined.length, 1, 'twelve loads of one broken file, one copy of it');

  fs.rmSync(dir, { recursive: true, force: true });
});

test('an afternoon of identical saves does not push out last week', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-store-'));
  const store = new SceneStore({ storagePath: dir, log: quietLog });
  store.load();
  store.replaceAll([{ name: 'Første' }]);
  await store.save();
  store.replaceAll([{ name: 'Anden' }]);
  await store.save();

  // The user drags scenes around: save after save with nothing new in them.
  for (let index = 0; index < 30; index += 1) await store.save();

  const backups = await store.listBackups();
  assert.ok(backups.length <= 3, `no copy per save (${backups.length} kept)`);
  const names = backups.map((entry) =>
    JSON.parse(fs.readFileSync(path.join(store.backupDir, entry.name), 'utf8'))
      .scenes.map((scene) => scene.name)
      .join(','),
  );
  assert.ok(names.includes('Første'), 'and the state before the edit is still reachable');

  fs.rmSync(dir, { recursive: true, force: true });
});

test('a backup that cannot be written is reported, not swallowed', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-store-'));
  const warnings = [];
  const log = { ...quietLog, warn: (message) => warnings.push(message) };
  const store = new SceneStore({ storagePath: dir, log });
  store.load();
  store.replaceAll([{ name: 'Første' }]);
  await store.save();

  store._writeBackup = async () => {
    throw Object.assign(new Error('ENOSPC: no space left on device'), { code: 'ENOSPC' });
  };
  store.replaceAll([{ name: 'Anden' }]);
  await store.save();

  assert.equal(warnings.length, 1, 'the user is told');
  assert.match(store.lastBackupError, /ENOSPC/);

  fs.rmSync(dir, { recursive: true, force: true });
});

test('a save writes what was there when it was asked, not what turns up later', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-store-'));
  const store = new SceneStore({ storagePath: dir, log: quietLog });
  store.load();
  store.replaceAll([{ name: 'Morgen' }, { name: 'Aften' }]);
  await store.save();

  // A save is queued behind one already in flight...
  const busy = store.save();
  store.upsert({ name: 'Nat' });
  const pending = store.save();
  // ...and in that window something reloads the file from disk, which is what
  // the file watcher does when the settings backend writes to it.
  store.replaceAll([{ name: 'Morgen' }, { name: 'Aften' }]);
  await Promise.all([busy, pending]);

  const written = JSON.parse(fs.readFileSync(store.file, 'utf8'));
  assert.ok(
    written.scenes.some((scene) => scene.name === 'Nat'),
    'the scene the user saved is in the file',
  );

  fs.rmSync(dir, { recursive: true, force: true });
});

test('an import with a hole in it does not take the whole import down', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-store-'));
  const store = new SceneStore({ storagePath: dir, log: quietLog });
  store.load();
  store.replaceAll([{ name: 'Findes' }]);

  const added = store.merge([null, { name: 'Ny' }, 'nonsens']);
  assert.equal(store.list().length, 4);
  assert.equal(added.length, 3);

  fs.rmSync(dir, { recursive: true, force: true });
});

test('a scene added after a delete lands last, and a duplicate next to its original', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-store-'));
  const store = new SceneStore({ storagePath: dir, log: quietLog });
  store.load();
  store.replaceAll([{ name: 'Alfa' }, { name: 'Bravo' }, { name: 'Charlie' }]);
  store.remove(store.list()[1].id);
  store.upsert({ name: 'Delta' });

  assert.deepEqual(store.list().map((scene) => scene.name), ['Alfa', 'Charlie', 'Delta']);
  assert.equal(new Set(store.list().map((scene) => scene.order)).size, 3, 'no two share an order');

  store.duplicate(store.list()[0].id);
  assert.equal(new Set(store.list().map((scene) => scene.order)).size, 4);

  fs.rmSync(dir, { recursive: true, force: true });
});

test('reordering with a partial list renumbers the rest instead of colliding with it', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-store-'));
  const store = new SceneStore({ storagePath: dir, log: quietLog });
  store.load();
  store.replaceAll([{ name: 'A' }, { name: 'B' }, { name: 'C' }, { name: 'D' }]);
  const byName = (name) => store.list().find((scene) => scene.name === name).id;

  store.reorder([byName('D'), byName('C')]);
  const orders = store.list().map((scene) => scene.order);
  assert.equal(new Set(orders).size, 4, 'every scene has its own place');
  assert.deepEqual(store.list().slice(0, 2).map((scene) => scene.name), ['D', 'C']);

  fs.rmSync(dir, { recursive: true, force: true });
});

test('restoring a backup brings its settings back with it', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-store-'));
  const store = new SceneStore({ storagePath: dir, log: quietLog });
  store.load();
  store.replaceAll([{ name: 'Gammel' }]);
  store.settings = { theme: 'dark' };
  await store.save();
  store.replaceAll([{ name: 'Ny' }]);
  store.settings = { theme: 'light', tilføjet: 'x' };
  await store.save();

  const backups = await store.listBackups();
  await store.restoreBackup(backups[backups.length - 1].name);

  assert.deepEqual(store.list().map((scene) => scene.name), ['Gammel']);
  assert.deepEqual(store.settings, { theme: 'dark' }, 'not a hybrid of both');

  fs.rmSync(dir, { recursive: true, force: true });
});

test('a scene file from somewhere else cannot make scenes.json enormous', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-store-'));
  const store = new SceneStore({ storagePath: dir, log: quietLog });
  store.load();
  store.replaceAll([
    {
      name: 'x'.repeat(200000),
      description: 'y'.repeat(500000),
      steps: Array.from({ length: 10000 }, () => ({ action: 'pause' })),
    },
  ]);

  const [scene] = store.list();
  assert.ok(scene.name.length <= 64);
  assert.ok(scene.description.length <= 512);
  assert.ok(scene.steps.length <= 200);
  assert.ok(JSON.stringify(store.list()).length < 200000, 'and the file stays a sane size');

  fs.rmSync(dir, { recursive: true, force: true });
});

test('a runtime that is too long to wait for is refused rather than fired instantly', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-store-'));
  const store = new SceneStore({ storagePath: dir, log: quietLog });
  store.load();
  store.replaceAll([{ name: 'Tredive dage', maxRuntimeMs: 2592000000 }, { name: 'Negativ', maxRuntimeMs: -1 }]);

  for (const scene of store.list()) {
    assert.ok(scene.maxRuntimeMs >= 1000 && scene.maxRuntimeMs <= 2 ** 31 - 1, scene.name);
  }

  fs.rmSync(dir, { recursive: true, force: true });
});

test('a duplicate id is written back once instead of changing on every restart', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-store-'));
  const store = new SceneStore({ storagePath: dir, log: quietLog });
  store.ensureDirs();
  fs.writeFileSync(
    store.file,
    JSON.stringify({ scenes: [{ id: 'aften', name: 'Aften' }, { id: 'aften', name: 'Fest' }] }),
  );

  // Loading is all it takes: the new id has to reach the file by itself, or the
  // duplicate stays there and is resolved differently on every restart.
  store.load();
  await new Promise((resolve) => setTimeout(resolve, 50));
  const first = store.list().map((scene) => scene.id);

  const reopened = new SceneStore({ storagePath: dir, log: quietLog });
  reopened.load();
  assert.deepEqual(reopened.list().map((scene) => scene.id), first, 'the ids are stable now');

  fs.rmSync(dir, { recursive: true, force: true });
});

test('switches are registered under the platform name the user actually configured', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-plat-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const api = fakeHomebridge(dir);
  const seen = [];
  api.registerPlatformAccessories = (plugin, platformName, accessories) => {
    seen.push(platformName);
    api.registered.push(...accessories);
  };
  // The two older names this plugin still answers to are exactly the case:
  // Homebridge keys the live platform by whatever is in config.json.
  const platform = new SonosControlPlatform(quietLog, { platform: 'SonosControl' }, api);
  t.after(() => platform.stop());

  platform.store.replaceAll([{ name: 'Aften' }]);
  platform.syncAccessories();

  assert.deepEqual(seen, ['SonosControl']);
});

test('an unreadable store leaves the switches in Apple Home alone', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-plat-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const api = fakeHomebridge(dir);
  const platform = new SonosControlPlatform(quietLog, {}, api);
  t.after(() => platform.stop());

  platform.store.replaceAll([{ name: 'Aften' }, { name: 'Fest' }, { name: 'Godnat' }]);
  platform.syncAccessories();
  assert.equal(api.registered.length, 3);

  platform.store.degraded = true;
  platform.store.scenes = new Map();
  platform.syncAccessories();

  assert.equal(api.unregistered.length, 0, 'nothing is removed on the strength of a file we could not read');
});

test('a stateful switch remembers it was on across a restart', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-plat-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const api = fakeHomebridge(dir);
  const platform = new SonosControlPlatform(quietLog, {}, api);
  t.after(() => platform.stop());
  platform.runner.run = async () => ({ ok: true, sceneName: 'x', steps: [] });

  platform.store.replaceAll([{ name: 'Aftenmusik', switchType: 'stateful', offSteps: [{ action: 'pause' }] }]);
  platform.syncAccessories();
  const scene = platform.store.list()[0];
  const accessory = [...platform.cachedAccessories.values()][0];

  await platform.handlers.get(scene.id)._handleSet(true);
  assert.equal(accessory.context.on, true, 'the position is written where Homebridge keeps it');

  // Homebridge restarts: the accessory comes back from the cache, the handler
  // is built again from it.
  const { SceneSwitch } = require('../src/accessory');
  const revived = new SceneSwitch(platform, accessory, scene);
  assert.equal(revived.state, true, 'and the tile is not lying about the music that is still playing');
});

test('a stateful scene that fails puts its own switch back off', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-plat-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const api = fakeHomebridge(dir);
  const platform = new SonosControlPlatform(quietLog, {}, api);
  t.after(() => platform.stop());

  // The runner reports a failed scene by resolving, not by rejecting.
  platform.runner.run = async () => ({ ok: false, aborted: false, sceneName: 'Aftenmusik', steps: [] });

  platform.store.replaceAll([{ name: 'Aftenmusik', switchType: 'stateful' }]);
  platform.syncAccessories();
  const handler = platform.handlers.get(platform.store.list()[0].id);

  await handler._handleSet(true);
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(handler.state, false, 'the tile does not sit there claiming the music is on');
});

test('a rename tells Homebridge to write its accessory cache', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-plat-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const api = fakeHomebridge(dir);
  const updated = [];
  api.updatePlatformAccessories = (accessories) => updated.push(...accessories);
  const platform = new SonosControlPlatform(quietLog, {}, api);
  t.after(() => platform.stop());

  platform.store.replaceAll([{ name: 'Aften' }]);
  platform.syncAccessories();
  const scene = platform.store.list()[0];

  platform.store.upsert({ ...scene, name: 'Aftenmusik' });
  platform.syncAccessories();

  assert.equal(updated.length, 1);
  assert.equal(updated[0].displayName, 'Aftenmusik');
});

test('adopting a speaker with a level missing changes nothing at all', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-plat-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const api = fakeHomebridge(dir);
  const platform = new SonosControlPlatform(quietLog, {}, api);
  t.after(() => platform.stop());

  platform.system.resolve = (name) => ({ name, uuid: `uuid:${name}` });
  platform.store.replaceAll([
    {
      name: 'Musik',
      steps: [
        {
          action: 'groupAndPlay',
          params: { coordinator: 'Køkken', volumes: { Køkken: 20 } },
        },
      ],
    },
  ]);
  const before = JSON.stringify(platform.store.list());

  await assert.rejects(() => platform.adoptPlayers(['Stue', 'Bad'], { Stue: 30 }));
  assert.equal(JSON.stringify(platform.store.list()), before, 'no half-applied change is left behind');
});
