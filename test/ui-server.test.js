'use strict';

/**
 * The settings-UI server, `homebridge-ui/server.js`, run the way Homebridge
 * runs it: as a child process with an IPC channel, answering `request`
 * messages with `response` messages. It sits between the page and the bridge,
 * and until now nothing exercised it — the page was tested against a stub of
 * it, and the bridge was tested directly.
 *
 * The server refuses to start without `process.send`, so it cannot simply be
 * required. Forking it is not a workaround; it is the real thing.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { fork } = require('node:child_process');

const { apiHarness } = require('./api-harness');

const SERVER = path.join(__dirname, '..', 'homebridge-ui', 'server.js');

/** Start the UI server against a storage folder, and talk to it over IPC. */
function uiServer(storagePath) {
  const child = fork(SERVER, [], {
    env: { ...process.env, HOMEBRIDGE_STORAGE_PATH: storagePath, LANG: 'da_DK.UTF-8' },
    // The server logs every request to stdout; that is noise here.
    stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
  });
  const stderr = [];
  child.stderr.on('data', (chunk) => stderr.push(String(chunk)));

  const pending = new Map();
  let nextId = 1;
  const ready = new Promise((resolve, reject) => {
    child.on('message', (message) => {
      if (message.action === 'ready') resolve();
      if (message.action === 'response') {
        const waiter = pending.get(message.payload.requestId);
        if (!waiter) return;
        pending.delete(message.payload.requestId);
        waiter(message.payload);
      }
    });
    child.on('exit', (code) => reject(new Error(`ui server exited with ${code}: ${stderr.join('')}`)));
  });

  return {
    ready,
    stderr,
    /** One request, as the page would make it. Resolves to `{success, data}`. */
    request(route, body) {
      return new Promise((resolve) => {
        const requestId = nextId;
        nextId += 1;
        pending.set(requestId, resolve);
        child.send({ action: 'request', requestId, path: route, body });
      });
    },
    close() {
      child.kill('SIGTERM');
    },
  };
}

test('the settings page can open while a speaker is asleep', async (t) => {
  const h = await apiHarness();
  t.after(() => h.close());
  // The living room is unplugged. It accepts the connection and never answers,
  // which is what a speaker that is off looks like from the network.
  h.household.asleep.add('Living Room');

  const ui = uiServer(h.dir);
  t.after(() => ui.close());
  await ui.ready;

  const started = performance.now();
  const { success, data } = await ui.request('/bootstrap', {});
  const took = performance.now() - started;

  assert.ok(success, ui.stderr.join(''));
  assert.equal(data.connected, true);
  assert.equal(data.scenes.length, 0, 'the scene list is there');
  assert.equal(data.players.length, 4, 'and so is every speaker, the sleeping one included');
  // This is the point. Asking a sleeping speaker for its volume costs a
  // timeout, and bootstrap used to ask every speaker before it would answer:
  // eight seconds on a real house with one speaker off. Nothing on this page
  // needs the speakers before it can be drawn.
  assert.ok(took < 1000, `bootstrap took ${took.toFixed(0)} ms with a speaker asleep`);
  assert.equal(data.players[0].volume, undefined, 'state is not part of the first answer');
});

test('speaker state arrives afterwards, and a sleeping speaker delays only itself', async (t) => {
  const h = await apiHarness();
  t.after(() => h.close());
  h.household.asleep.add('Living Room');

  const ui = uiServer(h.dir);
  t.after(() => ui.close());
  await ui.ready;

  const started = performance.now();
  const { success, data } = await ui.request('/call', { method: 'GET', path: '/players?state=1' });
  const took = performance.now() - started;

  assert.ok(success);
  const byName = new Map(data.players.map((player) => [player.name, player]));
  assert.equal(typeof byName.get('Kitchen').volume, 'number', 'the awake speakers report');
  assert.equal(byName.get('Living Room').volume, null, 'the sleeping one is shown as unknown, not as zero');
  // One glance, no retry, both reads at once: a little over a second, where it
  // was two full waits of four seconds each, one after the other.
  assert.ok(took < 2500, `state took ${took.toFixed(0)} ms`);
});

test('with the bridge stopped, the page still gets its scenes from disk', async (t) => {
  const h = await apiHarness();
  h.store.replaceAll([{ name: 'Aften' }]);
  await h.store.save();
  // Stop the bridge — but keep the folder, which is what the UI server reads.
  await h.stopBridge();
  t.after(() => fs.rmSync(h.dir, { recursive: true, force: true }));

  const ui = uiServer(h.dir);
  t.after(() => ui.close());
  await ui.ready;

  const { success, data } = await ui.request('/bootstrap', {});
  assert.ok(success);
  assert.equal(data.connected, false);
  assert.deepEqual(
    data.scenes.map((scene) => scene.name),
    ['Aften'],
    'the scenes are read straight from scenes.json',
  );
  assert.ok(data.offlineReason, 'and the page is told why the speakers are missing');
});

test('the offline fallback refuses a scene id it does not know, like the bridge does', async (t) => {
  const h = await apiHarness();
  await h.stopBridge();
  t.after(() => fs.rmSync(h.dir, { recursive: true, force: true }));

  const ui = uiServer(h.dir);
  t.after(() => ui.close());
  await ui.ready;

  const missing = await ui.request('/call', { method: 'POST', path: '/scenes/delete', body: {} });
  assert.equal(missing.success, false);
  assert.equal(missing.data.error.status, 400);

  const unknown = await ui.request('/call', { method: 'POST', path: '/scenes/duplicate', body: { id: 'nope' } });
  assert.equal(unknown.success, false);
  assert.equal(unknown.data.error.status, 404);

  const noList = await ui.request('/call', { method: 'POST', path: '/scenes/reorder', body: {} });
  assert.equal(noList.success, false);
  assert.equal(noList.data.error.status, 400);
});

test('a route that could not be sent to the bridge is refused before it gets there', async (t) => {
  const h = await apiHarness();
  t.after(() => h.close());
  const ui = uiServer(h.dir);
  t.after(() => ui.close());
  await ui.ready;

  for (const route of ['scenes', '/sce nes', '/scenes\n']) {
    const answer = await ui.request('/call', { method: 'GET', path: route });
    assert.equal(answer.success, false, JSON.stringify(route));
    assert.equal(answer.data.error.status, 400);
  }
});
