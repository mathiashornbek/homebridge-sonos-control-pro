'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const { MockHousehold, quietLog } = require('./mock-sonos');
const { SonosSystem } = require('../src/sonos/system');
const { SceneRunner } = require('../src/engine/runner');
const { SceneStore } = require('../src/store');
const { resolveTargets } = require('../src/engine/targets');
const fixture = require('./fixtures/household');

const ROOMS = fixture.ROOMS;

/** Spin up a household, a system pointed at it, a store and a runner. */
async function harness({ scenes = fixture.SCENES, fast = true } = {}) {
  const household = new MockHousehold(ROOMS);
  household.favorites = fixture.FAVORITES;
  household.playlists = fixture.PLAYLISTS;
  await household.listen();

  const system = new SonosSystem({
    log: quietLog,
    // Each mock player answers on its own port on 127.0.0.1, so the seed
    // has to name the port — the same "host:port" form a real config accepts.
    seedHosts: household.players.map((player) => `${player.host}:${player.port}`),
    discoveryTimeout: 200,
  });
  await system.discover({ force: true });

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sonos-control-'));
  const store = new SceneStore({ storagePath: dir, log: quietLog });
  store.load();
  store.replaceAll(JSON.parse(JSON.stringify(scenes)));

  if (fast) {
    // Same shape, a tenth of the wall-clock.
    for (const scene of store.scenes.values()) {
      for (const step of scene.steps) {
        step.delayMs = Math.round(step.delayMs / 10);
        if (step.params.volumeDelayMs) step.params.volumeDelayMs = Math.round(step.params.volumeDelayMs / 10);
        if (step.params.groupDelayMs) step.params.groupDelayMs = Math.round(step.params.groupDelayMs / 10);
        if (step.params.modeDelayMs) step.params.modeDelayMs = Math.round(step.params.modeDelayMs / 10);
      }
    }
  }

  const runner = new SceneRunner({ system, log: quietLog, getScenes: () => store.scenes });
  const sceneByName = (name) => [...store.scenes.values()].find((scene) => scene.name === name);

  return {
    household,
    system,
    store,
    runner,
    sceneByName,
    dir,
    async close() {
      runner.cancelAll();
      system.stop();
      await household.close();
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

test('a room name with an accent resolves without one', async (t) => {
  // Sonos room names are whatever the user typed; a scene referring to
  // "Garden Cafe" must still find "Garden Café", or the step silently skips it.
  const h = await harness();
  t.after(() => h.close());

  await h.household.addPlayer('Garden Café');
  await h.system.discover({ force: true });

  assert.equal(h.system.resolve('Garden Café')?.name, 'Garden Café');
  assert.equal(h.system.resolve('garden cafe')?.name, 'Garden Café');
  assert.equal(h.system.resolve('GARDEN CAFÉ')?.name, 'Garden Café');
  assert.equal(h.system.resolve('Garden Cafe '), h.system.resolve('Garden Café'));
});

test('discovery finds every room and reports the topology', async (t) => {
  const h = await harness();
  t.after(() => h.close());

  assert.equal(h.system.list().length, ROOMS.length);
  for (const room of ROOMS) {
    assert.ok(h.system.resolve(room), `${room} should resolve`);
  }
  // Case and punctuation drift should still resolve.
  assert.equal(h.system.resolve('UPSTAIRS LOUNGE')?.name, 'Upstairs Lounge');
  assert.equal(h.system.resolve('upstairs  lounge')?.name, 'Upstairs Lounge');
  assert.equal(h.system.resolve('Findes Ikke'), null);
});

test('"Play City Radio" streams to the leader, drops Living Room and Garage, groups the rest', async (t) => {
  const h = await harness();
  t.after(() => h.close());

  const result = await h.runner.run(h.sceneByName('Play City Radio').id, { trigger: 'test' });
  assert.equal(result.ok, true, result.error || 'scene should succeed');

  const kitchen = h.household.byName('Kitchen');
  // A radio favourite is set directly, never queued.
  assert.equal(kitchen.currentUri, 'x-sonosapi-hls:city-radio');
  assert.equal(kitchen.queue.length, 0);
  assert.equal(kitchen.transportState, 'PLAYING');

  // Living Room and Garage stay out of the group.
  const members = h.household.membersOf(kitchen.uuid).map((player) => player.name).sort();
  assert.equal(members.includes('Living Room'), false);
  assert.equal(members.includes('Garage'), false);
  assert.equal(members.length, 12, 'leader plus eleven rooms');

  // Volumes match the fixture exactly.
  assert.equal(h.household.byName('Pantry').volume, 8);
  assert.equal(h.household.byName('Kitchen').volume, 8);
  assert.equal(h.household.byName('Utility Room').volume, 12);
  assert.equal(h.household.byName('Guest Room').volume, 13);
  assert.equal(h.household.byName('Bedroom').volume, 14);
  assert.equal(h.household.byName('Playroom').volume, 13);
  assert.equal(h.household.byName('Upstairs Lounge').volume, 10);
  // Rooms that left the group keep whatever they had.
  assert.equal(h.household.byName('Living Room').volume, 20);
  assert.equal(h.household.byName('Garage').volume, 20);
});

test('volume is set before the group forms, so each room keeps its own level', async (t) => {
  const h = await harness();
  t.after(() => h.close());

  await h.runner.run(h.sceneByName('Play City Radio').id, { trigger: 'test' });

  const bryggers = h.household.byName('Utility Room');
  const setVolumeAt = bryggers.calls.findIndex((call) => call.action === 'SetVolume');
  const joinAt = bryggers.calls.findIndex(
    (call) => call.action === 'SetAVTransportURI' && String(call.args.CurrentURI).startsWith('x-rincon:'),
  );
  assert.ok(setVolumeAt !== -1 && joinAt !== -1, 'both operations must have happened');
  assert.ok(setVolumeAt < joinAt, 'volume must be set before joining');
});

test('"Background music" queues the Spotify container and turns shuffle on', async (t) => {
  const h = await harness();
  t.after(() => h.close());

  const result = await h.runner.run(h.sceneByName('Background music').id, { trigger: 'test' });
  assert.equal(result.ok, true, result.error || '');

  const kitchen = h.household.byName('Kitchen');
  // A container favourite goes through the queue.
  assert.deepEqual(kitchen.queue, ['x-rincon-cpcontainer:1006206cjazz']);
  assert.equal(kitchen.currentUri, `x-rincon-queue:${kitchen.uuid}#0`);
  assert.equal(kitchen.playMode, 'SHUFFLE_NOREPEAT');
  assert.equal(h.household.byName('Pantry').volume, 9, 'Pantry has its own level in this flow');
});

test('"Party mode" pulls in every room, including Living Room and Garage', async (t) => {
  const h = await harness();
  t.after(() => h.close());

  const result = await h.runner.run(h.sceneByName('Party mode').id, { trigger: 'test' });
  assert.equal(result.ok, true, result.error || '');

  const kitchen = h.household.byName('Kitchen');
  const members = h.household.membersOf(kitchen.uuid);
  assert.equal(members.length, ROOMS.length, 'the whole household is one group');
  assert.equal(h.household.byName('Living Room').volume, 40);
  assert.equal(h.household.byName('Garage').volume, 40);
  assert.equal(h.household.byName('Bedroom').volume, 46);
  assert.equal(h.household.byName('Pantry').volume, 39);
});

test('"Pause everything" pauses what is playing and ignores what is not', async (t) => {
  const h = await harness();
  t.after(() => h.close());

  await h.runner.run(h.sceneByName('Party mode').id, { trigger: 'test' });
  const result = await h.runner.run(h.sceneByName('Pause everything').id, { trigger: 'test' });

  assert.equal(result.ok, true, 'idle speakers answering 701 must not fail the scene');
  assert.equal(h.household.byName('Kitchen').transportState, 'PAUSED_PLAYBACK');
});

test('volume up only touches speakers that are actually playing', async (t) => {
  const h = await harness();
  t.after(() => h.close());

  // Two groups: the kitchen trio is playing, everything else is silent.
  const kitchen = h.household.byName('Kitchen');
  for (const name of ['Pantry', 'Dining Room']) {
    h.household.grouping.set(h.household.byName(name).uuid, kitchen.uuid);
  }
  kitchen.transportState = 'PLAYING';
  for (const player of h.household.players) player.volume = 30;
  await h.system.refreshTopology();

  const result = await h.runner.run(h.sceneByName('Volume up').id, { trigger: 'test' });
  assert.equal(result.ok, true, result.error || '');

  assert.equal(h.household.byName('Kitchen').volume, 35);
  assert.equal(h.household.byName('Pantry').volume, 35);
  assert.equal(h.household.byName('Dining Room').volume, 35);
  for (const name of ROOMS.filter((room) => !['Kitchen', 'Pantry', 'Dining Room'].includes(room))) {
    assert.equal(h.household.byName(name).volume, 30, `${name} was silent and must not change`);
  }
});

test('volume down mirrors volume up, and never wakes a silent room', async (t) => {
  const h = await harness();
  t.after(() => h.close());

  const office = h.household.byName('Study');
  office.transportState = 'PLAYING';
  for (const player of h.household.players) player.volume = 25;
  await h.system.refreshTopology();

  await h.runner.run(h.sceneByName('Volume down').id, { trigger: 'test' });
  assert.equal(h.household.byName('Study').volume, 20);
  assert.equal(h.household.byName('Living Room').volume, 25);
  assert.equal(h.household.byName('Kitchen').volume, 25);
});

test('when nothing is playing, volume up does nothing at all', async (t) => {
  const h = await harness();
  t.after(() => h.close());

  for (const player of h.household.players) player.volume = 42;
  const result = await h.runner.run(h.sceneByName('Volume up').id, { trigger: 'test' });

  assert.equal(result.ok, true);
  assert.equal(result.steps[0].skipped, true);
  for (const room of ROOMS) assert.equal(h.household.byName(room).volume, 42);
});

test('"Join the living room" groups exactly one room', async (t) => {
  const h = await harness();
  t.after(() => h.close());

  const result = await h.runner.run(h.sceneByName('Join the living room').id, { trigger: 'test' });
  assert.equal(result.ok, true, result.error || '');

  const kitchen = h.household.byName('Kitchen');
  assert.equal(h.household.coordinatorOf(h.household.byName('Living Room').uuid), kitchen.uuid);
  assert.equal(h.household.membersOf(kitchen.uuid).length, 2);
});

test('one unreachable speaker does not take the scene down with it', async (t) => {
  const h = await harness();
  t.after(() => h.close());

  h.household.failOn('Utility Room', 'SetVolume', 501);
  const result = await h.runner.run(h.sceneByName('Play City Radio').id, { trigger: 'test' });

  assert.equal(result.ok, true, 'the scene still reports success');
  assert.equal(h.household.byName('Guest Room').volume, 13, 'other rooms are unaffected');
  assert.equal(
    h.household.membersOf(h.household.byName('Kitchen').uuid).length,
    12,
    'grouping still completes',
  );
});

test('a scene referencing a room that no longer exists still runs the rest', async (t) => {
  const h = await harness({
    scenes: [
      {
        name: 'Delvist ukendt',
        steps: [
          {
            action: 'setVolume',
            target: { type: 'players', names: ['Study', 'Findes Ikke'], filter: 'any' },
            params: { volume: 33 },
          },
        ],
      },
    ],
  });
  t.after(() => h.close());

  const result = await h.runner.run(h.sceneByName('Delvist ukendt').id, { trigger: 'test' });
  assert.equal(result.ok, true);
  assert.equal(h.household.byName('Study').volume, 33);
});

test('re-triggering an on/off scene the other way abandons the first direction', async (t) => {
  const h = await harness({
    scenes: [
      {
        name: 'Musik til/fra',
        switchType: 'stateful',
        steps: [
          { action: 'joinGroup', target: { type: 'all' }, params: { coordinator: 'Kitchen' }, delayMs: 0 },
          { action: 'setVolume', target: { type: 'all' }, params: { volume: 99 }, delayMs: 800 },
        ],
        offSteps: [{ action: 'pause', target: { type: 'all' } }],
      },
    ],
    fast: false,
  });
  t.after(() => h.close());

  const scene = h.sceneByName('Musik til/fra');
  const first = h.runner.run(scene.id, { branch: 'on', trigger: 'test' });
  await new Promise((resolve) => setTimeout(resolve, 150));
  const second = h.runner.run(scene.id, { branch: 'off', trigger: 'test' });

  const [a, b] = await Promise.all([first, second]);
  assert.equal(b.ok, true, 'turning it off completes normally');
  assert.equal(a.ok, false, 'an abandoned run is not reported as a success');
  assert.ok(
    a.steps.some((step) => step.aborted),
    "the first run's pending step was dropped rather than firing late",
  );
  assert.notEqual(h.household.byName('Study').volume, 99, 'and it never reached the late step');
});

test('two runs of a volume scene both land — neither cancels the other', async (t) => {
  const h = await harness({ fast: false });
  t.after(() => h.close());

  const kitchen = h.household.byName('Kitchen');
  kitchen.transportState = 'PLAYING';
  for (const player of h.household.players) player.volume = 30;
  await h.system.refreshTopology();

  const scene = h.sceneByName('Volume up');
  const [a, b] = await Promise.all([
    h.runner.run(scene.id, { trigger: 'HomeKit' }),
    h.runner.run(scene.id, { trigger: 'HomeKit' }),
  ]);

  assert.equal(a.ok, true);
  assert.equal(b.ok, true);
  assert.equal(kitchen.volume, 40, 'two presses of +5 % really is +10 %');
  assert.equal(
    a.steps.concat(b.steps).some((step) => step.detail.includes('fejlede')),
    false,
    'and neither run reports a speaker as failed',
  );
});

test('a chained scene does not shoot the scene that called it', async (t) => {
  const h = await harness({
    scenes: [
      {
        name: 'Barn',
        steps: [{ action: 'joinGroup', target: { type: 'players', names: ['Living Room'] }, params: { coordinator: 'Kitchen' } }],
      },
      {
        name: 'Forælder',
        steps: [
          { action: 'runScene', params: { sceneId: 'PLACEHOLDER' }, delayMs: 0 },
          { action: 'setVolume', target: { type: 'players', names: ['Bedroom'] }, params: { volume: 42 }, delayMs: 120 },
        ],
      },
    ],
    fast: false,
  });
  t.after(() => h.close());

  const child = h.sceneByName('Barn');
  const parent = h.sceneByName('Forælder');
  parent.steps[0].params.sceneId = child.id;

  const result = await h.runner.run(parent.id, { trigger: 'test' });

  assert.equal(result.ok, true, result.steps.map((s) => s.detail).join(' | '));
  assert.equal(
    result.steps.every((step) => !step.aborted),
    true,
    'the parent survived its own child',
  );
  assert.equal(h.household.byName('Bedroom').volume, 42, 'the step after the chain still ran');
});

test('target filters resolve against live grouping', async (t) => {
  const h = await harness();
  t.after(() => h.close());

  const kitchen = h.household.byName('Kitchen');
  h.household.grouping.set(h.household.byName('Pantry').uuid, kitchen.uuid);
  kitchen.transportState = 'PLAYING';
  await h.system.refreshTopology();

  const playing = await resolveTargets(h.system, { type: 'all', filter: 'playing' });
  assert.deepEqual(playing.players.map((player) => player.name).sort(), ['Kitchen', 'Pantry']);

  const group = await resolveTargets(h.system, { type: 'group', coordinator: 'Pantry' });
  assert.deepEqual(group.players.map((player) => player.name).sort(), ['Kitchen', 'Pantry']);

  const except = await resolveTargets(h.system, { type: 'allExcept', names: ['Living Room', 'Study'] });
  assert.equal(except.players.length, ROOMS.length - 2);
  assert.equal(except.players.some((player) => player.name === 'Living Room'), false);

  const one = await resolveTargets(h.system, { type: 'coordinator', coordinator: 'Pantry' });
  assert.deepEqual(one.players.map((player) => player.name), ['Kitchen']);
});

test('a disabled scene is skipped, and a disabled step is left out', async (t) => {
  const h = await harness();
  t.after(() => h.close());

  const scene = h.sceneByName('Join the living room');
  scene.enabled = false;
  const skipped = await h.runner.run(scene.id, { trigger: 'test' });
  assert.equal(skipped.skipped, true);
  assert.equal(h.household.coordinatorOf(h.household.byName('Living Room').uuid), h.household.byName('Living Room').uuid);

  scene.enabled = true;
  scene.steps[0].enabled = false;
  const empty = await h.runner.run(scene.id, { trigger: 'test' });
  assert.equal(empty.steps.length, 0);
});

test('a missing favourite fails loudly with a useful message', async (t) => {
  const h = await harness({
    scenes: [
      {
        name: 'Mangler favorit',
        steps: [{ action: 'playFavorite', target: { type: 'players', names: ['Study'] }, params: { favorite: 'Findes Ikke' } }],
      },
    ],
  });
  t.after(() => h.close());

  const result = await h.runner.run(h.sceneByName('Mangler favorit').id, { trigger: 'test' });
  assert.equal(result.ok, false);
  assert.match(result.steps[0].detail, /findes ikke i Sonos/i);
});

test('snapshot and restore put grouping, volume and playback back', async (t) => {
  const h = await harness({
    scenes: [
      {
        name: 'Gem',
        steps: [{ action: 'snapshot', target: { type: 'all' }, params: { slot: 'test' } }],
      },
      {
        name: 'Gendan',
        steps: [{ action: 'restore', params: { slot: 'test', restoreVolume: true, restorePlayback: true } }],
      },
    ],
  });
  t.after(() => h.close());

  for (const player of h.household.players) player.volume = 17;
  const kitchen = h.household.byName('Kitchen');
  h.household.grouping.set(h.household.byName('Pantry').uuid, kitchen.uuid);
  await h.system.refreshTopology();

  await h.runner.run(h.sceneByName('Gem').id, { trigger: 'test' });

  // Wreck it.
  for (const player of h.household.players) player.volume = 90;
  h.household.grouping.set(h.household.byName('Pantry').uuid, h.household.byName('Pantry').uuid);
  await h.system.refreshTopology();

  await h.runner.run(h.sceneByName('Gendan').id, { trigger: 'test' });
  assert.equal(h.household.byName('Study').volume, 17);
  assert.equal(h.household.coordinatorOf(h.household.byName('Pantry').uuid), kitchen.uuid);
});

test('a scene that calls itself is stopped rather than looping forever', async (t) => {
  const h = await harness({ scenes: [{ name: 'Sløjfe', steps: [] }] });
  t.after(() => h.close());

  const scene = h.sceneByName('Sløjfe');
  scene.steps = [{ id: 's1', action: 'runScene', enabled: true, delayMs: 0, params: { sceneId: scene.id }, target: {} }];

  const result = await h.runner.run(scene.id, { trigger: 'test' });
  assert.equal(result.steps[0].ok, false);
  assert.match(result.steps[0].detail, /sløjfe/i);
});

test('transport commands are sent to coordinators, not to every follower', async (t) => {
  const h = await harness({
    scenes: [{ name: 'Pause', steps: [{ action: 'pause', target: { type: 'all' } }] }],
  });
  t.after(() => h.close());

  // Put the whole house in one group and start it.
  const kitchen = h.household.byName('Kitchen');
  for (const player of h.household.players) {
    if (player !== kitchen) h.household.grouping.set(player.uuid, kitchen.uuid);
  }
  kitchen.transportState = 'PLAYING';
  await h.system.refreshTopology();
  for (const player of h.household.players) player.calls.length = 0;

  const result = await h.runner.run(h.sceneByName('Pause').id, { trigger: 'test' });
  assert.equal(result.ok, true);
  assert.equal(kitchen.transportState, 'PAUSED_PLAYBACK');

  const pauseCalls = h.household.players.flatMap((player) =>
    player.calls.filter((call) => call.action === 'Pause').map(() => player.name),
  );
  assert.deepEqual(pauseCalls, ['Kitchen'], 'exactly one request for the whole group');
});

test('playing a favourite on a grouped room plays it for that group', async (t) => {
  const h = await harness({
    scenes: [
      {
        name: 'Favorit i gruppe',
        steps: [
          {
            action: 'playFavorite',
            target: { type: 'players', names: ['Pantry'] },
            params: { favorite: 'City Radio' },
          },
        ],
      },
    ],
  });
  t.after(() => h.close());

  const kitchen = h.household.byName('Kitchen');
  h.household.grouping.set(h.household.byName('Pantry').uuid, kitchen.uuid);
  await h.system.refreshTopology();

  const result = await h.runner.run(h.sceneByName('Favorit i gruppe').id, { trigger: 'test' });
  assert.equal(result.ok, true, result.steps[0]?.detail);
  assert.equal(kitchen.currentUri, 'x-sonosapi-hls:city-radio', 'the coordinator got the stream');
  assert.equal(h.household.byName('Pantry').currentUri, '', 'the follower was left alone');
  assert.equal(
    h.household.coordinatorOf(h.household.byName('Pantry').uuid),
    kitchen.uuid,
    'the group is intact',
  );
});

test('a music scene whose leader is following someone else breaks it out first', async (t) => {
  const h = await harness();
  t.after(() => h.close());

  // Kitchen is currently a follower of Living Room.
  const stue = h.household.byName('Living Room');
  const kitchen = h.household.byName('Kitchen');
  h.household.grouping.set(kitchen.uuid, stue.uuid);
  await h.system.refreshTopology();

  const result = await h.runner.run(h.sceneByName('Play City Radio').id, { trigger: 'test' });
  assert.equal(result.ok, true, result.error || '');

  assert.equal(h.household.coordinatorOf(kitchen.uuid), kitchen.uuid, 'the leader owns its transport');
  assert.equal(kitchen.currentUri, 'x-sonosapi-hls:city-radio');
  assert.equal(h.household.membersOf(kitchen.uuid).length, 12);
});

// ---------------------------------------------------- regressions & speed

test('a stereo pair resolves to the primary, never to the invisible satellite', async (t) => {
  const h = await harness({ scenes: [{ name: 'Tom', steps: [] }] });
  t.after(() => h.close());

  // Turn Dining Room into an invisible satellite of Pantry, as a bonded pair looks.
  const satellite = h.system.list().find((player) => player.name === 'Dining Room');
  const primary = h.system.resolve('Pantry');
  satellite.name = 'Pantry';
  satellite.invisible = true;
  satellite.coordinatorUuid = primary.uuid;

  const resolved = h.system.resolve('Pantry');
  assert.equal(resolved.uuid, primary.uuid, 'the addressable room wins');
  assert.equal(resolved.invisible, false);
  assert.equal(h.system.list().some((player) => player.invisible), false, 'satellites stay out of the list');
});

test('a step with a blank volume fails loudly instead of muting the house', async (t) => {
  const h = await harness({
    scenes: [
      { name: 'Tom volumen', steps: [{ action: 'setVolume', target: { type: 'all' }, params: {} }] },
    ],
  });
  t.after(() => h.close());

  for (const player of h.household.players) player.volume = 30;
  const result = await h.runner.run(h.sceneByName('Tom volumen').id, { trigger: 'test' });

  assert.equal(result.ok, false);
  assert.match(result.steps[0].detail, /mangler en lydstyrke/i);
  for (const player of h.household.players) {
    assert.equal(player.volume, 30, 'nothing was changed');
  }
});

test('joining a room that is itself a follower targets the real coordinator', async (t) => {
  const h = await harness({
    scenes: [
      {
        name: 'Tilslut',
        steps: [
          {
            action: 'joinGroup',
            target: { type: 'players', names: ['Study'] },
            params: { coordinator: 'Pantry' },
          },
        ],
      },
    ],
  });
  t.after(() => h.close());

  // Pantry currently follows Kitchen.
  const kitchen = h.household.byName('Kitchen');
  h.household.grouping.set(h.household.byName('Pantry').uuid, kitchen.uuid);
  await h.system.refreshTopology();

  const result = await h.runner.run(h.sceneByName('Tilslut').id, { trigger: 'test' });
  assert.equal(result.ok, true, result.steps[0]?.detail);
  assert.equal(
    h.household.coordinatorOf(h.household.byName('Study').uuid),
    kitchen.uuid,
    'Study joined the coordinator, not the follower',
  );
});

test('a saved Sonos playlist is enqueued with empty metadata', async (t) => {
  const h = await harness({
    scenes: [
      {
        name: 'Playliste',
        steps: [
          {
            action: 'playPlaylist',
            target: { type: 'players', names: ['Study'] },
            params: { playlist: 'Saved Queue' },
          },
        ],
      },
    ],
  });
  t.after(() => h.close());

  const result = await h.runner.run(h.sceneByName('Playliste').id, { trigger: 'test' });
  assert.equal(result.ok, true, result.steps[0]?.detail);

  const office = h.household.byName('Study');
  const enqueue = office.calls.find((call) => call.action === 'AddURIToQueue');
  assert.ok(enqueue, 'the playlist went through the queue');
  assert.equal(enqueue.args.EnqueuedURI, 'file:///jffs/settings/savedqueues.rsq#1');
  assert.equal(enqueue.args.EnqueuedURIMetaData, '', 'no invented metadata for a saved queue');
});

test('automatic timing finishes a full-house scene without artificial waits', async (t) => {
  const h = await harness({ fast: false });
  t.after(() => h.close());

  const startedAt = Date.now();
  const result = await h.runner.run(h.sceneByName('Party mode').id, { trigger: 'test' });
  const elapsed = Date.now() - startedAt;

  assert.equal(result.ok, true, result.error || '');
  assert.ok(elapsed < 1500, `expected well under a second and a half, took ${elapsed} ms`);
  assert.equal(h.household.membersOf(h.household.byName('Kitchen').uuid).length, ROOMS.length);
  assert.equal(h.household.byName('Bedroom').volume, 46);
  assert.equal(h.household.byName('Kitchen').playMode, 'SHUFFLE_NOREPEAT');
});

test('fixed timing places each phase at its offset from the scene start', async (t) => {
  const h = await harness({ fast: false });
  t.after(() => h.close());

  const scene = h.sceneByName('Play City Radio');
  scene.steps[0].params.timing = 'fixed';
  scene.steps[0].params.volumeDelayMs = 300;
  scene.steps[0].params.groupDelayMs = 600;

  const startedAt = Date.now();
  const marks = {};
  const bryggers = h.household.byName('Utility Room');
  const originalExecute = h.household.execute.bind(h.household);
  h.household.execute = (player, action, args) => {
    if (player === bryggers && action === 'SetVolume' && !marks.volume) marks.volume = Date.now() - startedAt;
    if (player === bryggers && action === 'SetAVTransportURI' && String(args.CurrentURI).startsWith('x-rincon:')) {
      marks.join = marks.join || Date.now() - startedAt;
    }
    return originalExecute(player, action, args);
  };

  await h.runner.run(scene.id, { trigger: 'test' });

  assert.ok(marks.volume >= 280, `volume phase should wait ~300 ms, saw ${marks.volume}`);
  assert.ok(marks.join >= 580, `group phase should wait ~600 ms, saw ${marks.join}`);
  assert.ok(marks.join < 1200, `phases are measured from the start, not stacked (saw ${marks.join})`);
});

test('a newly added speaker joins the music scenes on its own', async (t) => {
  const h = await harness();
  t.after(() => h.close());

  await h.runner.run(h.sceneByName('Party mode').id, { trigger: 'test' });
  const before = h.household.membersOf(h.household.byName('Kitchen').uuid).length;

  // A new speaker is set up and appears on the network.
  await h.household.addPlayer('Terrasse');
  await h.system.refreshTopology();

  assert.ok(h.system.resolve('Terrasse'), 'the new room is known');

  await h.runner.run(h.sceneByName('Party mode').id, { trigger: 'test' });
  const after = h.household.membersOf(h.household.byName('Kitchen').uuid).length;
  assert.equal(after, before + 1, 'no editing was needed for it to join');
});

test('a grouped speaker reports the group\'s playback state, not its own', async (t) => {
  const h = await harness({ scenes: [{ name: 'Tom', steps: [] }] });
  t.after(() => h.close());

  // The whole house follows Kitchen, which is playing.
  const kitchen = h.household.byName('Kitchen');
  for (const player of h.household.players) {
    if (player !== kitchen) h.household.grouping.set(player.uuid, kitchen.uuid);
  }
  kitchen.transportState = 'PLAYING';
  await h.system.refreshTopology();
  for (const player of h.household.players) player.calls.length = 0;

  const snapshot = await h.system.snapshot({ withState: true });

  assert.equal(snapshot.length, ROOMS.length);
  for (const entry of snapshot) {
    assert.equal(entry.playing, true, `${entry.name} is in a playing group`);
    assert.equal(entry.state, 'PLAYING');
  }

  // And it cost one transport read for the whole group, not fourteen.
  const transportCalls = h.household.players.flatMap((player) =>
    player.calls.filter((call) => call.action === 'GetTransportInfo').map(() => player.name),
  );
  assert.deepEqual(transportCalls, ['Kitchen']);
});

test('an idle household reports every speaker as not playing', async (t) => {
  const h = await harness({ scenes: [{ name: 'Tom', steps: [] }] });
  t.after(() => h.close());

  const snapshot = await h.system.snapshot({ withState: true });
  assert.equal(snapshot.every((entry) => entry.playing === false), true);
  assert.equal(snapshot.every((entry) => entry.nowPlaying === null), true);
});

test('two groups report independently', async (t) => {
  const h = await harness({ scenes: [{ name: 'Tom', steps: [] }] });
  t.after(() => h.close());

  const kitchen = h.household.byName('Kitchen');
  const office = h.household.byName('Study');
  h.household.grouping.set(h.household.byName('Pantry').uuid, kitchen.uuid);
  kitchen.transportState = 'PLAYING';
  office.transportState = 'STOPPED';
  await h.system.refreshTopology();

  const byName = new Map((await h.system.snapshot({ withState: true })).map((e) => [e.name, e]));
  assert.equal(byName.get('Kitchen').playing, true);
  assert.equal(byName.get('Pantry').playing, true, 'a follower of a playing group is playing');
  assert.equal(byName.get('Study').playing, false);
  assert.equal(byName.get('Living Room').playing, false);
});

test('volume and mute stay per speaker even inside one group', async (t) => {
  const h = await harness({ scenes: [{ name: 'Tom', steps: [] }] });
  t.after(() => h.close());

  const kitchen = h.household.byName('Kitchen');
  h.household.grouping.set(h.household.byName('Pantry').uuid, kitchen.uuid);
  kitchen.volume = 8;
  h.household.byName('Pantry').volume = 9;
  h.household.byName('Pantry').muted = true;
  await h.system.refreshTopology();

  const byName = new Map((await h.system.snapshot({ withState: true })).map((e) => [e.name, e]));
  assert.equal(byName.get('Kitchen').volume, 8);
  assert.equal(byName.get('Pantry').volume, 9);
  assert.equal(byName.get('Pantry').muted, true);
  assert.equal(byName.get('Kitchen').muted, false);
});

// -------------------------------------------------- queue reuse & timing

test('re-running a playlist scene reuses the queue instead of re-fetching it', async (t) => {
  const h = await harness();
  t.after(() => h.close());

  const scene = h.sceneByName('Background music');
  await h.runner.run(scene.id, { trigger: 'test' });

  const kitchen = h.household.byName('Kitchen');
  assert.deepEqual(kitchen.queue, ['x-rincon-cpcontainer:1006206cjazz']);
  const firstUpdateId = kitchen.queueUpdateId;
  kitchen.calls.length = 0;

  const second = await h.runner.run(scene.id, { trigger: 'test' });
  assert.equal(second.ok, true, second.error || '');
  assert.match(second.steps[0].detail, /fortsatte/i, 'the log says it continued rather than reloaded');

  assert.equal(
    kitchen.calls.some((call) => call.action === 'AddURIToQueue'),
    false,
    'Spotify was not asked for the playlist a second time',
  );
  assert.equal(
    kitchen.calls.some((call) => call.action === 'RemoveAllTracksFromQueue'),
    false,
    'the queue was not cleared',
  );
  assert.equal(kitchen.queueUpdateId, firstUpdateId, 'the queue is untouched');
  assert.equal(kitchen.transportState, 'PLAYING');
});

test('a queue changed from the Sonos app is reloaded, not reused', async (t) => {
  const h = await harness();
  t.after(() => h.close());

  const scene = h.sceneByName('Background music');
  await h.runner.run(scene.id, { trigger: 'test' });

  // Somebody queues something else from the Sonos app.
  const kitchen = h.household.byName('Kitchen');
  kitchen.queue.push('x-sonos-spotify:something-else');
  kitchen.queueUpdateId += 1;
  kitchen.calls.length = 0;

  await h.runner.run(scene.id, { trigger: 'test' });
  assert.equal(
    kitchen.calls.some((call) => call.action === 'AddURIToQueue'),
    true,
    'the scene reloaded its own playlist',
  );
  assert.deepEqual(kitchen.queue, ['x-rincon-cpcontainer:1006206cjazz']);
});

test('switching the source away and back reloads the playlist', async (t) => {
  const h = await harness();
  t.after(() => h.close());

  await h.runner.run(h.sceneByName('Background music').id, { trigger: 'test' });
  await h.runner.run(h.sceneByName('Play City Radio').id, { trigger: 'test' });

  const kitchen = h.household.byName('Kitchen');
  assert.equal(kitchen.currentUri, 'x-sonosapi-hls:city-radio');
  kitchen.calls.length = 0;

  await h.runner.run(h.sceneByName('Background music').id, { trigger: 'test' });
  assert.equal(
    kitchen.calls.some((call) => call.action === 'AddURIToQueue'),
    true,
    'the transport had moved away from the queue, so it is loaded again',
  );
  assert.equal(kitchen.currentUri, `x-rincon-queue:${kitchen.uuid}#0`);
});

test('a radio scene never claims to reuse a queue', async (t) => {
  const h = await harness();
  t.after(() => h.close());

  await h.runner.run(h.sceneByName('Play City Radio').id, { trigger: 'test' });
  const second = await h.runner.run(h.sceneByName('Play City Radio').id, { trigger: 'test' });
  assert.match(second.steps[0].detail, /spiller "City Radio"/i);
  assert.equal(h.household.byName('Kitchen').queue.length, 0);
});

test('volume is applied alongside loading the source, not after it', async (t) => {
  const h = await harness();
  t.after(() => h.close());

  // Make the leader slow to load, the way a real Spotify fetch is.
  const kitchen = h.household.byName('Kitchen');
  const originalExecute = h.household.execute.bind(h.household);
  const marks = {};
  const startedAt = Date.now();
  h.household.execute = (player, action, args) => {
    if (player === kitchen && action === 'AddURIToQueue') marks.enqueue = Date.now() - startedAt;
    if (player.name === 'Utility Room' && action === 'SetVolume') marks.volume = Date.now() - startedAt;
    return originalExecute(player, action, args);
  };

  await h.runner.run(h.sceneByName('Background music').id, { trigger: 'test' });

  assert.ok(marks.enqueue !== undefined && marks.volume !== undefined, 'both happened');
  // They overlap: the volume phase does not queue up behind the source load.
  assert.ok(
    Math.abs(marks.volume - marks.enqueue) < 120,
    `volume at ${marks.volume} ms, enqueue at ${marks.enqueue} ms — these should run together`,
  );
});

// ------------------------------------------- concurrency & wasted calls

test('starting a second music scene cancels the first instead of racing it', async (t) => {
  const h = await harness();
  t.after(() => h.close());

  const background = h.sceneByName('Background music');
  const radio = h.sceneByName('Play City Radio');

  const first = h.runner.run(background.id, { trigger: 'test' });
  await new Promise((resolve) => setTimeout(resolve, 5));
  const second = h.runner.run(radio.id, { trigger: 'test' });

  const [a, b] = await Promise.all([first, second]);
  assert.equal(b.ok, true, 'the newest press wins and completes');
  assert.equal(h.runner.running.size, 0, 'nothing is left running');
  assert.ok(a.ok === false || a.steps.some((step) => step.skipped), 'the first was interrupted');
  assert.equal(h.household.byName('Kitchen').currentUri, 'x-sonosapi-hls:city-radio');
});

test('a volume scene runs happily alongside a music scene', async (t) => {
  const h = await harness({ fast: false });
  t.after(() => h.close());

  // Something is playing, so the volume filter has work to do.
  const kitchen = h.household.byName('Kitchen');
  kitchen.transportState = 'PLAYING';
  await h.system.refreshTopology();

  const music = h.runner.run(h.sceneByName('Background music').id, { trigger: 'test' });
  const volume = await h.runner.run(h.sceneByName('Volume up').id, { trigger: 'test' });
  const musicResult = await music;

  assert.equal(volume.ok, true, 'the volume nudge completed');
  assert.equal(musicResult.ok, true, 'and did not cancel the music scene');
});

test('a repeat press does not re-issue grouping that is already in place', async (t) => {
  const h = await harness();
  t.after(() => h.close());

  const scene = h.sceneByName('Party mode');
  await h.runner.run(scene.id, { trigger: 'test' });
  const groupedBefore = h.household.membersOf(h.household.byName('Kitchen').uuid).length;
  for (const player of h.household.players) player.calls.length = 0;

  const second = await h.runner.run(scene.id, { trigger: 'test' });
  assert.equal(second.ok, true);
  assert.match(second.steps[0].detail, /allerede på plads/);

  const joins = h.household.players.flatMap((player) =>
    player.calls.filter(
      (call) => call.action === 'SetAVTransportURI' && String(call.args.CurrentURI).startsWith('x-rincon:'),
    ),
  );
  assert.equal(joins.length, 0, 'nobody was told to join a group they were already in');
  assert.equal(
    h.household.membersOf(h.household.byName('Kitchen').uuid).length,
    groupedBefore,
    'the group is unchanged',
  );
});

test('a speaker that has drifted out of the group is pulled back in', async (t) => {
  const h = await harness();
  t.after(() => h.close());

  const scene = h.sceneByName('Party mode');
  await h.runner.run(scene.id, { trigger: 'test' });

  // Somebody pulls Study out from the Sonos app.
  const office = h.household.byName('Study');
  h.household.grouping.set(office.uuid, office.uuid);
  await h.system.refreshTopology();
  for (const player of h.household.players) player.calls.length = 0;

  await h.runner.run(scene.id, { trigger: 'test' });
  assert.equal(
    h.household.coordinatorOf(office.uuid),
    h.household.byName('Kitchen').uuid,
    'Study is back in the group',
  );
  const joins = office.calls.filter(
    (call) => call.action === 'SetAVTransportURI' && String(call.args.CurrentURI).startsWith('x-rincon:'),
  );
  assert.equal(joins.length, 1, 'exactly the speaker that needed it was told to join');
});

test('the play mode is set without reading it back every time', async (t) => {
  const h = await harness();
  t.after(() => h.close());

  const scene = h.sceneByName('Background music');
  await h.runner.run(scene.id, { trigger: 'test' });
  const kitchen = h.household.byName('Kitchen');
  assert.equal(kitchen.playMode, 'SHUFFLE_NOREPEAT');
  kitchen.calls.length = 0;

  await h.runner.run(scene.id, { trigger: 'test' });
  assert.equal(
    kitchen.calls.filter((call) => call.action === 'GetTransportSettings').length,
    0,
    'the current mode was remembered, not re-read',
  );
  assert.equal(kitchen.playMode, 'SHUFFLE_NOREPEAT');
});

test('"Join the living room" is a no-op once Living Room is already grouped', async (t) => {
  const h = await harness();
  t.after(() => h.close());

  const scene = h.sceneByName('Join the living room');
  await h.runner.run(scene.id, { trigger: 'test' });
  const stue = h.household.byName('Living Room');
  stue.calls.length = 0;

  const second = await h.runner.run(scene.id, { trigger: 'test' });
  assert.match(second.steps[0].detail, /allerede med/i);
  assert.equal(
    stue.calls.filter((call) => call.action === 'SetAVTransportURI').length,
    0,
    'no pointless regrouping',
  );
});

// ---------------------------------------- timeouts, retries and batching

test('a player that misses one reply is retried rather than written off', async (t) => {
  const h = await harness({
    scenes: [
      { name: 'Lydstyrke', steps: [{ action: 'setVolume', target: { type: 'all' }, params: { volume: 12 } }] },
    ],
  });
  t.after(() => h.close());

  // Utility Room swallows its first SetVolume, then behaves.
  const bryggers = h.household.byName('Utility Room');
  let swallowed = false;
  const realExecute = h.household.execute.bind(h.household);
  h.household.handle = function (player, request, response) {
    const chunks = [];
    request.on('data', (chunk) => chunks.push(chunk));
    request.on('end', () => {
      const action = String(request.headers.soapaction || '').replace(/"/g, '').split('#')[1] || '';
      if (player === bryggers && action === 'SetVolume' && !swallowed) {
        swallowed = true;
        response.destroy(); // the reply never arrives
        return;
      }
      const body = Buffer.concat(chunks).toString('utf8');
      require('./mock-sonos').MockHousehold.prototype.handle.call(
        h.household,
        player,
        { headers: request.headers, on: (event, fn) => { if (event === 'data') fn(Buffer.from(body)); if (event === 'end') fn(); } },
        response,
      );
    });
  };

  const result = await h.runner.run(h.sceneByName('Lydstyrke').id, { trigger: 'test' });
  assert.equal(swallowed, true, 'the first attempt really was dropped');
  assert.equal(result.ok, true);
  assert.equal(bryggers.volume, 12, 'the retry got through');
  assert.equal(h.household.byName('Study').volume, 12);
  void realExecute;
});

test('a relative volume change is never sent twice', async () => {
  const { RETRYABLE } = require('../src/sonos/soap');
  // Retrying these would double the change or duplicate the playlist.
  for (const action of ['SetRelativeVolume', 'SetRelativeGroupVolume', 'AddURIToQueue', 'Next', 'Previous', 'Seek']) {
    assert.equal(RETRYABLE.has(action), false, `${action} must not be retried`);
  }
  for (const action of ['GetTransportInfo', 'SetVolume', 'SetAVTransportURI', 'BecomeCoordinatorOfStandaloneGroup']) {
    assert.equal(RETRYABLE.has(action), true, `${action} is safe to retry`);
  }
});

test('a UPnP fault is taken at face value, not retried', async (t) => {
  const h = await harness({
    scenes: [
      {
        name: 'Fejl',
        steps: [{ action: 'setVolume', target: { type: 'players', names: ['Study'] }, params: { volume: 12 } }],
      },
    ],
  });
  t.after(() => h.close());

  h.household.failOn('Study', 'SetVolume', 402);
  await h.runner.run(h.sceneByName('Fejl').id, { trigger: 'test' });

  const attempts = h.household.byName('Study').calls.filter((call) => call.action === 'SetVolume');
  assert.equal(attempts.length, 1, 'the player said no once; asking again would be rude and pointless');
});

test('rebuilding a group from scratch still reaches every speaker', async (t) => {
  const h = await harness();
  t.after(() => h.close());

  // Exactly the situation from the log: everything pulled apart by hand.
  for (const player of h.household.players) h.household.grouping.set(player.uuid, player.uuid);
  await h.system.refreshTopology();

  const startedAt = Date.now();
  const result = await h.runner.run(h.sceneByName('Play City Radio').id, { trigger: 'test' });
  const elapsed = Date.now() - startedAt;

  assert.equal(result.ok, true, result.error || '');
  assert.equal(h.household.membersOf(h.household.byName('Kitchen').uuid).length, 12);
  assert.ok(elapsed < 3000, `rebuilding from nothing took ${elapsed} ms`);
});

test('grouping commands go out in batches rather than all at once', async (t) => {
  const { inBatches } = require('../src/engine/actions');
  let peak = 0;
  let live = 0;
  const items = Array.from({ length: 11 }, (_, index) => index);

  await inBatches(
    items,
    async () => {
      live += 1;
      peak = Math.max(peak, live);
      await new Promise((resolve) => setTimeout(resolve, 10));
      live -= 1;
    },
    6,
  );

  assert.ok(peak <= 6, `at most six at a time, saw ${peak}`);
  void t;
});

// ================================================ impatient fingers

test('tapping the same scene five times in a row runs it once', async (t) => {
  const h = await harness({ fast: false });
  t.after(() => h.close());

  const scene = h.sceneByName('Background music');
  const results = await Promise.all(
    Array.from({ length: 5 }, () => h.runner.run(scene.id, { trigger: 'HomeKit' })),
  );

  assert.equal(results.every((result) => result.ok), true, 'every caller got a clean answer');
  const kitchen = h.household.byName('Kitchen');
  const enqueues = kitchen.calls.filter((call) => call.action === 'AddURIToQueue');
  assert.equal(enqueues.length, 1, 'the playlist was loaded exactly once');
  assert.deepEqual(kitchen.queue, ['x-rincon-cpcontainer:1006206cjazz']);
  assert.equal(h.household.membersOf(kitchen.uuid).length, 12);
  assert.equal(h.runner.running.size, 0, 'nothing left running');
});

test('hammering two different music scenes leaves a consistent household', async (t) => {
  const h = await harness({ fast: false });
  t.after(() => h.close());

  const background = h.sceneByName('Background music');
  const radio = h.sceneByName('Play City Radio');

  // Alternate as fast as the event loop allows.
  const runs = [];
  for (let index = 0; index < 8; index += 1) {
    runs.push(h.runner.run(index % 2 === 0 ? background.id : radio.id, { trigger: 'HomeKit' }));
    await new Promise((resolve) => setTimeout(resolve, 3));
  }
  await Promise.all(runs);
  await new Promise((resolve) => setTimeout(resolve, 300));

  const kitchen = h.household.byName('Kitchen');
  assert.equal(h.runner.running.size, 0, 'no run is stuck');
  // The last press was the radio, so that is what must be playing.
  assert.equal(kitchen.currentUri, 'x-sonosapi-hls:city-radio');
  assert.equal(kitchen.transportState, 'PLAYING');
  // And every follower really follows the leader, not some half-formed group.
  const members = h.household.membersOf(kitchen.uuid).map((player) => player.name);
  assert.ok(members.includes('Pantry') && members.includes('Utility Room'), members.join(', '));
  assert.equal(members.includes('Living Room'), false, 'the losing scene did not leave Living Room attached');
});

test('a stateful switch flicked on and off ends in the state it was left', async (t) => {
  const h = await harness({
    scenes: [
      {
        name: 'Musik til/fra',
        switchType: 'stateful',
        steps: [
          {
            action: 'groupAndPlay',
            params: {
              coordinator: 'Kitchen',
              source: { type: 'favorite', value: 'City Radio' },
              membersMode: 'all',
              leave: [],
              volumes: {},
              timing: 'auto',
            },
          },
        ],
        offSteps: [{ action: 'pause', target: { type: 'all' } }],
      },
    ],
    fast: false,
  });
  t.after(() => h.close());

  const scene = h.sceneByName('Musik til/fra');
  const runs = [];
  for (const branch of ['on', 'off', 'on', 'off', 'on']) {
    runs.push(h.runner.run(scene.id, { branch, trigger: 'HomeKit' }));
    await new Promise((resolve) => setTimeout(resolve, 4));
  }
  await Promise.all(runs);
  await new Promise((resolve) => setTimeout(resolve, 300));

  assert.equal(h.runner.running.size, 0);
  assert.equal(h.household.byName('Kitchen').transportState, 'PLAYING', 'it was left on');
});

test('volume presses are additive — three taps really is three steps', async (t) => {
  const h = await harness();
  t.after(() => h.close());

  const kitchen = h.household.byName('Kitchen');
  kitchen.transportState = 'PLAYING';
  for (const player of h.household.players) player.volume = 30;
  await h.system.refreshTopology();

  const scene = h.sceneByName('Volume up');
  for (let index = 0; index < 3; index += 1) {
    await h.runner.run(scene.id, { trigger: 'HomeKit' });
  }
  assert.equal(kitchen.volume, 45, 'three presses of +5 %');
});

test('a scene interrupted mid-flight never leaves a run registered', async (t) => {
  const h = await harness({
    scenes: [
      {
        name: 'Langsom',
        steps: [
          { action: 'setVolume', target: { type: 'all' }, params: { volume: 11 }, delayMs: 0 },
          { action: 'setVolume', target: { type: 'all' }, params: { volume: 99 }, delayMs: 900 },
        ],
      },
    ],
    fast: false,
  });
  t.after(() => h.close());

  const first = h.runner.run(h.sceneByName('Langsom').id, { trigger: 'test' });
  await new Promise((resolve) => setTimeout(resolve, 100));
  h.runner.cancelAll();
  const result = await first;

  assert.equal(h.runner.running.size, 0, 'no run is left registered');
  assert.ok(
    result.steps.some((step) => step.skipped),
    'the pending step was dropped rather than firing after the cancel',
  );
  assert.equal(h.household.byName('Study').volume, 11, 'and it never reached 99');
  assert.equal(h.runner.history[0].sceneName, 'Langsom');
});

test('every unreachable speaker at once still completes the scene', async (t) => {
  const h = await harness();
  t.after(() => h.close());

  // Take the whole household offline except the leader.
  await Promise.all(
    h.household.servers.slice(1).map((server) => new Promise((resolve) => server.close(resolve))),
  );

  const result = await h.runner.run(h.sceneByName('Play City Radio').id, { trigger: 'test' });
  assert.equal(typeof result.durationMs, 'number');
  assert.equal(h.runner.running.size, 0, 'it finished rather than hanging');
  assert.ok(result.durationMs < 20000, `took ${result.durationMs} ms`);
});

test('saving twice at once cannot corrupt scenes.json', async (t) => {
  const h = await harness();
  t.after(() => h.close());

  h.store.replaceAll([{ name: 'A' }, { name: 'B' }]);
  const first = h.store.save();
  h.store.replaceAll([{ name: 'C' }]);
  const second = h.store.save();
  await Promise.all([first, second]);

  const { SceneStore } = require('../src/store');
  const reopened = new SceneStore({ storagePath: h.dir, log: quietLog });
  const names = reopened.load().map((scene) => scene.name);
  assert.deepEqual(names, ['C'], 'the last save won, and the file is valid JSON');
  const leftovers = fs.readdirSync(path.join(h.dir, 'sonos-control-pro')).filter((n) => n.includes('.tmp-'));
  assert.deepEqual(leftovers, [], 'no temp files left behind');
});

test('two scenes sharing an id are separated instead of one vanishing', async (t) => {
  const h = await harness({ scenes: [{ name: 'Tom', steps: [] }] });
  t.after(() => h.close());

  h.store.replaceAll([
    { id: 'same', name: 'Første' },
    { id: 'same', name: 'Anden' },
  ]);
  const list = h.store.list();
  assert.equal(list.length, 2, 'both survived');
  assert.equal(new Set(list.map((scene) => scene.id)).size, 2, 'with distinct ids');
});

test('no speaker makes a sound before its level is set', async (t) => {
  const h = await harness();
  t.after(() => h.close());

  // The house was left loud last night.
  for (const player of h.household.players) player.volume = 65;

  const order = [];
  const realExecute = h.household.execute.bind(h.household);
  h.household.execute = (player, action, args) => {
    if (action === 'SetVolume') order.push(`vol:${player.name}`);
    if (action === 'Play' || action === 'SetAVTransportURI' || action === 'AddURIToQueue') {
      order.push(`sound:${player.name}:${action}`);
    }
    return realExecute(player, action, args);
  };

  await h.runner.run(h.sceneByName('Background music').id, { trigger: 'test' });

  const firstSound = order.findIndex((entry) => entry.startsWith('sound:'));
  const lastVolume = order.map((entry) => entry.startsWith('vol:')).lastIndexOf(true);
  assert.ok(firstSound !== -1 && lastVolume !== -1, 'both happened');
  assert.ok(
    lastVolume < firstSound,
    `every level must be set before anything plays — levels ended at ${lastVolume}, sound started at ${firstSound}`,
  );
  assert.equal(h.household.byName('Kitchen').volume, 8);
  assert.equal(h.household.byName('Bedroom').volume, 14);
});

test('fixed timing keeps the source first', async (t) => {
  const h = await harness({ fast: false });
  t.after(() => h.close());

  const scene = h.sceneByName('Background music');
  scene.steps[0].params.timing = 'fixed';
  scene.steps[0].params.volumeDelayMs = 200;
  scene.steps[0].params.groupDelayMs = 400;
  scene.steps[0].params.modeDelayMs = 600;

  const order = [];
  const realExecute = h.household.execute.bind(h.household);
  h.household.execute = (player, action, args) => {
    if (action === 'SetVolume') order.push('vol');
    if (action === 'AddURIToQueue') order.push('source');
    return realExecute(player, action, args);
  };

  await h.runner.run(scene.id, { trigger: 'test' });
  assert.equal(order[0], 'source', 'the source still starts first');
  assert.ok(order.includes('vol'));
});

// ==================================== with a realistic network underneath

/** Give the mock household a believable latency for ordering tests. */
function slowDown(household, { base = 45, spotify = 600 } = {}) {
  household.latencyMs = base;
  household.actionLatencyMs = { AddURIToQueue: spotify };
}

test('a cancelled scene cannot beat the one that replaced it', async (t) => {
  const h = await harness({ fast: false });
  t.after(() => h.close());
  slowDown(h.household);

  const background = h.runner.run(h.sceneByName('Background music').id, { trigger: 'HomeKit' });
  await new Promise((resolve) => setTimeout(resolve, 120));
  const radio = h.runner.run(h.sceneByName('Play City Radio').id, { trigger: 'HomeKit' });

  const [cancelled, winner] = await Promise.all([background, radio]);
  await new Promise((resolve) => setTimeout(resolve, 400));

  assert.equal(winner.ok, true, winner.error || '');
  assert.equal(cancelled.ok, false, 'the abandoned run reports itself as abandoned');

  const kitchen = h.household.byName('Kitchen');
  assert.equal(kitchen.currentUri, 'x-sonosapi-hls:city-radio', 'the last press is what plays');
  assert.equal(kitchen.transportState, 'PLAYING');
  assert.equal(h.runner.running.size, 0);
});

test('a chain of impatient presses settles on the last one', async (t) => {
  const h = await harness({ fast: false });
  t.after(() => h.close());
  slowDown(h.household, { base: 25, spotify: 300 });

  const order = ['Background music', 'Play City Radio', 'Party mode', 'Play City Radio', 'Background music'];
  const runs = [];
  for (const name of order) {
    runs.push(h.runner.run(h.sceneByName(name).id, { trigger: 'HomeKit' }));
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  await Promise.all(runs);
  await new Promise((resolve) => setTimeout(resolve, 600));

  const kitchen = h.household.byName('Kitchen');
  assert.equal(h.runner.running.size, 0, 'nothing stuck');
  assert.equal(kitchen.currentUri, `x-rincon-queue:${kitchen.uuid}#0`, 'the last press won');
  assert.deepEqual(kitchen.queue, ['x-rincon-cpcontainer:1006206cjazz']);
  assert.equal(kitchen.transportState, 'PLAYING');
  assert.equal(h.household.byName('Kitchen').volume, 8, 'levels match the winning scene');
});

test('setting shuffle does not silently switch repeat off', async (t) => {
  const h = await harness({
    scenes: [
      { name: 'Bland', steps: [{ action: 'setShuffle', target: { type: 'players', names: ['Kitchen'] }, params: { enabled: true } }] },
      { name: 'Gentag', steps: [{ action: 'setRepeat', target: { type: 'players', names: ['Kitchen'] }, params: { mode: 'all' } }] },
    ],
  });
  t.after(() => h.close());

  const kitchen = h.household.byName('Kitchen');
  await h.runner.run(h.sceneByName('Bland').id, { trigger: 'test' });
  assert.equal(kitchen.playMode, 'SHUFFLE_NOREPEAT');

  await h.runner.run(h.sceneByName('Gentag').id, { trigger: 'test' });
  assert.equal(kitchen.playMode, 'SHUFFLE', 'shuffle kept, repeat added');

  await h.runner.run(h.sceneByName('Bland').id, { trigger: 'test' });
  assert.equal(kitchen.playMode, 'SHUFFLE', 'repeat survived a second shuffle press');
});

test('a play mode changed in the Sonos app is picked up again', async (t) => {
  const h = await harness({
    scenes: [
      { name: 'Bland', steps: [{ action: 'setShuffle', target: { type: 'players', names: ['Kitchen'] }, params: { enabled: true } }] },
    ],
  });
  t.after(() => h.close());

  const kitchen = h.household.byName('Kitchen');
  await h.runner.run(h.sceneByName('Bland').id, { trigger: 'test' });

  // Somebody turns on repeat from the app, and the memo goes stale.
  kitchen.playMode = 'SHUFFLE';
  h.system.playModeMemoTtlMs = 0;

  await h.runner.run(h.sceneByName('Bland').id, { trigger: 'test' });
  assert.equal(kitchen.playMode, 'SHUFFLE', 'the app-side repeat was not thrown away');
});

test('a scene whose leader was inside another group ends up correct', async (t) => {
  const h = await harness();
  t.after(() => h.close());

  // Kitchen is following Living Room when the scene starts.
  const stue = h.household.byName('Living Room');
  const kitchen = h.household.byName('Kitchen');
  h.household.grouping.set(kitchen.uuid, stue.uuid);
  await h.system.refreshTopology();

  await h.runner.run(h.sceneByName('Party mode').id, { trigger: 'test' });

  assert.equal(h.household.coordinatorOf(kitchen.uuid), kitchen.uuid, 'the leader broke out');
  assert.equal(h.household.membersOf(kitchen.uuid).length, ROOMS.length, 'and everyone joined it');
  // The model must agree with the wire, or the next scene decides wrongly.
  assert.equal(h.system.coordinatorFor(h.system.resolve('Kitchen')).name, 'Kitchen');
  assert.equal(h.system.coordinatorFor(h.system.resolve('Study')).name, 'Kitchen');
});

// ================================================== chaos: nothing may stick

test('two hundred random presses leave a consistent household and no leaks', async (t) => {
  const h = await harness({ fast: false });
  t.after(() => h.close());
  h.household.latencyMs = 3;

  const names = [
    'Play City Radio',
    'Background music',
    'Party mode',
    'Pause everything',
    'Volume up',
    'Volume down',
    'Join the living room',
  ];

  // A deterministic shuffle, so a failure is reproducible.
  let seed = 12345;
  const next = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };

  const rejections = [];
  const onRejection = (reason) => rejections.push(String(reason));
  process.on('unhandledRejection', onRejection);
  t.after(() => process.off('unhandledRejection', onRejection));

  const inFlight = [];
  for (let index = 0; index < 200; index += 1) {
    const name = names[Math.floor(next() * names.length)];
    inFlight.push(h.runner.run(h.sceneByName(name).id, { trigger: 'HomeKit' }));
    // Occasionally rip the household apart, the way a person does.
    if (next() < 0.05) {
      for (const player of h.household.players) h.household.grouping.set(player.uuid, player.uuid);
    }
    await new Promise((resolve) => setTimeout(resolve, next() < 0.5 ? 0 : 6));
  }

  const results = await Promise.all(inFlight);
  await new Promise((resolve) => setTimeout(resolve, 500));

  assert.deepEqual(rejections, [], 'no unhandled promise rejections');
  assert.equal(h.runner.running.size, 0, 'no run left registered');
  assert.equal(results.length, 200);
  assert.equal(
    results.every((result) => typeof result.ok === 'boolean' && Array.isArray(result.steps)),
    true,
    'every caller got a well-formed answer',
  );
  assert.ok(h.runner.history.length <= h.runner.historyLimit, 'history stays bounded');

  // Whatever happened, one final press must put the house in a known state.
  const final = await h.runner.run(h.sceneByName('Party mode').id, { trigger: 'HomeKit' });
  assert.equal(final.ok, true, final.error || final.steps.map((s) => s.detail).join(' | '));
  const kitchen = h.household.byName('Kitchen');
  assert.equal(h.household.membersOf(kitchen.uuid).length, ROOMS.length, 'the whole house is one group');
  assert.equal(h.household.byName('Bedroom').volume, 46);
  assert.equal(h.system.coordinatorFor(h.system.resolve('Study')).name, 'Kitchen', 'model agrees with the wire');
});

test('the household model never contradicts the speakers after a scene', async (t) => {
  const h = await harness();
  t.after(() => h.close());

  for (const name of ['Play City Radio', 'Background music', 'Party mode', 'Join the living room']) {
    await h.runner.run(h.sceneByName(name).id, { trigger: 'test' });

    for (const player of h.system.list()) {
      const wire = h.household.coordinatorOf(h.household.byName(player.name).uuid);
      const model = h.system.coordinatorFor(player).uuid;
      const wireName = h.household.players.find((entry) => entry.uuid === wire).name;
      const modelName = h.system.players.get(model).name;
      assert.equal(
        modelName,
        wireName,
        `efter "${name}": ${player.name} følger ${wireName} men modellen tror ${modelName}`,
      );
    }
  }
});
