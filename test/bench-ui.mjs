/**
 * How long does the settings page take to become useful?
 *
 * Drives the real page in Chromium against a stubbed bridge, the way
 * `ui-smoke.mjs` does, but with a household the size of a real one and a
 * bridge that takes as long to answer as speakers do. Reports where the time
 * goes: fetching and running the script, waiting for the bridge, and rendering.
 *
 * Run with:  node test/bench-ui.mjs [--delay=800] [--runs=5]
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  console.error('Needs Playwright: npm install --no-save playwright && npx playwright install chromium');
  process.exit(1);
}

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(here, '..', 'homebridge-ui', 'public');

const { actionCatalogue } = require('../src/engine/actions');
const { conditionCatalogue } = require('../src/engine/conditions');
const { targetTypes, targetFilters } = require('../src/api');
const { dictionaryFor, setLanguage, AVAILABLE } = require('../src/i18n');
const { listPresets } = require('../src/presets');
const { normalizeScene } = require('../src/store');

setLanguage('da');

const args = Object.fromEntries(
  process.argv.slice(2).map((arg) => {
    const [key, value = 'true'] = arg.replace(/^--/, '').split('=');
    return [key, value];
  }),
);
const BRIDGE_DELAY_MS = Number(args.delay ?? 0);
const RUNS = Number(args.runs ?? 5);

// ------------------------------------------------------------ a real house
const ROOMS = [
  'Bad 1. Sal', 'Badeværelse', 'Bryggers', 'Garage Soundboks', 'Gæsteværelse', 'Kontor',
  'Køkken', 'Køkkenalrum', 'Makeup Værelse', 'Roses Værelse', 'Soveværelse', 'Spisestue',
  'Stue', 'Stue 1. Sal',
];
const players = ROOMS.map((name, index) => ({
  uuid: `RINCON_${String(index).padStart(4, '0')}`,
  name,
  host: `192.168.1.${10 + index}`,
  port: 1400,
  model: 'Sonos One',
  coordinatorUuid: `RINCON_${String(index).padStart(4, '0')}`,
  coordinatorName: name,
  invisible: false,
  volume: 10 + index,
  muted: false,
  state: index % 3 === 0 ? 'PLAYING' : 'STOPPED',
  playing: index % 3 === 0,
  title: index % 3 === 0 ? 'Some Track Title' : '',
  artist: index % 3 === 0 ? 'Some Artist' : '',
  albumArt: index % 3 === 0 ? '/cover.png' : '',
}));
const groups = players.map((player) => ({
  id: `${player.uuid}:1`,
  coordinatorUuid: player.uuid,
  coordinatorName: player.name,
  memberUuids: [player.uuid],
  memberNames: [player.name],
}));
const many = (count, make) => Array.from({ length: count }, (_, index) => make(index));
const library = {
  favorites: many(40, (i) => ({ title: `Favorit ${i}`, description: 'Spotify', uri: `x-sonos-spotify:${i}`, isContainer: i % 2 === 0, albumArt: '/cover.png' })),
  playlists: many(20, (i) => ({ title: `Playliste ${i}`, description: '', uri: `file:///jffs/settings/savedqueues.rsq#${i}`, isContainer: true })),
  radio: many(15, (i) => ({ title: `Radio ${i}`, description: 'TuneIn', uri: `x-sonosapi-stream:s${i}`, isContainer: false })),
  fetchedAt: Date.now(),
};
const scenes = many(10, (i) =>
  normalizeScene(
    {
      name: `Scene ${i}`,
      description: 'En scene med et par trin',
      steps: [
        {
          action: 'groupAndPlay',
          params: {
            source: { type: 'favorite', value: 'Favorit 1' },
            coordinator: ROOMS[i % ROOMS.length],
            membersMode: 'all',
            volumes: Object.fromEntries(ROOMS.map((room, j) => [room, 10 + j])),
          },
        },
        { action: 'setVolume', target: { type: 'all' }, params: { volume: 20 } },
      ],
    },
    i,
  ),
);

const catalogue = () => ({
  actions: actionCatalogue(),
  conditions: conditionCatalogue(),
  targetTypes: targetTypes(),
  filters: targetFilters(),
  language: 'da',
  languages: AVAILABLE,
  dictionary: dictionaryFor('da'),
  presets: listPresets(),
});
const bootstrapPayload = () => ({
  ...catalogue(),
  connected: true,
  status: { ok: true, playerCount: ROOMS.length, groupCount: ROOMS.length, running: [], recentlyAdded: [], unconfigured: [] },
  scenes,
  players,
  groups,
  library,
});

// ------------------------------------------------------------------ server
const server = http.createServer((request, response) => {
  const url = new URL(request.url, 'http://x');
  if (url.pathname === '/') {
    const fragment = fs.readFileSync(path.join(publicDir, 'index.html'), 'utf8');
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    response.end(`<!doctype html><html lang="da"><head><meta charset="utf-8"></head><body>${fragment}</body></html>`);
    return;
  }
  const file = path.join(publicDir, url.pathname.replace(/^\//, ''));
  if (fs.existsSync(file) && fs.statSync(file).isFile()) {
    const type = file.endsWith('.css') ? 'text/css' : file.endsWith('.js') ? 'text/javascript' : 'text/plain';
    response.writeHead(200, { 'Content-Type': `${type}; charset=utf-8` });
    response.end(fs.readFileSync(file));
    return;
  }
  if (url.pathname === '/cover.png') {
    response.writeHead(200, { 'Content-Type': 'image/png' });
    response.end(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'));
    return;
  }
  response.writeHead(204).end();
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}/`;

// ------------------------------------------------------------------- drive
const browser = await chromium.launch();
const payloadJson = JSON.stringify(bootstrapPayload());
console.log(`bootstrap payload: ${(Buffer.byteLength(payloadJson) / 1024).toFixed(0)} kB · bridge delay ${BRIDGE_DELAY_MS} ms · ${RUNS} runs\n`);

const results = [];
for (let run = 0; run < RUNS; run += 1) {
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  await page.addInitScript(
    ({ payload, delay }) => {
      const t0 = performance.now();
      window.__marks = { t0 };
      const data = JSON.parse(payload);
      window.__config = [{ platform: 'SonosControlPro', name: 'Sonos Control Pro', language: 'da' }];
      // The speakers are what take time. Anything that asks them for state is
      // held for `delay`; everything the bridge already knows answers at once.
      const speakers = () => new Promise((resolve) => setTimeout(resolve, delay));
      const withoutState = data.players.map(({ volume, muted, state, playing, title, artist, albumArt, ...rest }) => rest);
      window.homebridge = {
        request: async (route, body) => {
          if (route === '/bootstrap') {
            window.__marks.bootstrapAsked = performance.now();
            // Bootstrap no longer waits for the speakers; only a cached library
            // and the speaker *list* travel with it.
            const answer = { ...data, players: withoutState };
            window.__marks.bootstrapAnswered = performance.now();
            return answer;
          }
          if (body?.path === '/players?state=1') {
            await speakers();
            window.__marks.stateAnswered = performance.now();
            return { players: data.players, groups: data.groups };
          }
          return {};
        },
        getPluginConfig: async () => window.__config,
        updatePluginConfig: async () => {},
        savePluginConfig: async () => {},
        showSpinner() {},
        hideSpinner() {},
        fixScrollHeight() {},
        toast: { success() {}, error() {}, info() {} },
      };
      // When does each part of the page actually appear? Sampled every frame,
      // which is also when a person could first have seen it.
      const seen = {};
      window.__marks.seen = seen;
      const look = () => {
        if (!seen.scenes && document.querySelector('#scene-list .sf-scene')) seen.scenes = performance.now();
        if (!seen.players && document.querySelector('.sf-player')) seen.players = performance.now();
        if (!seen.library && document.querySelector('.sf-lib-item')) seen.library = performance.now();
        // A speaker card shows "–%" until its volume has arrived.
        if (!seen.state && /\d+%/.test(document.querySelector('.sf-player .sf-volume-value')?.textContent || '')) {
          seen.state = performance.now();
        }
        if (!(seen.scenes && seen.players && seen.library && seen.state)) requestAnimationFrame(look);
      };
      requestAnimationFrame(look);
    },
    { payload: payloadJson, delay: BRIDGE_DELAY_MS },
  );

  await page.goto(base, { waitUntil: 'networkidle' });
  await page.waitForSelector('#scene-list .sf-scene');
  await page.waitForFunction(() => window.__marks.seen.state, null, { timeout: 30000 });
  await page.waitForTimeout(100);

  const marks = await page.evaluate(() => {
    const nav = performance.getEntriesByType('navigation')[0];
    const script = performance.getEntriesByType('resource').find((entry) => entry.name.endsWith('index.js'));
    const long = performance.getEntriesByType('longtask') || [];
    return {
      ...window.__marks,
      domInteractive: nav.domInteractive,
      domContentLoaded: nav.domContentLoadedEventEnd,
      scriptFetchMs: script ? script.responseEnd - script.startTime : null,
      // domContentLoaded fires after the classic script has *run*, so this is
      // parse + evaluate of index.js, less the fetch.
      scriptRunMs: script ? nav.domContentLoadedEventEnd - script.responseEnd : null,
      longTasks: long.length,
    };
  });
  results.push(marks);
  await page.close();
}
await browser.close();
server.close();

// ------------------------------------------------------------------ report
const median = (values) => {
  const sorted = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  return sorted.length ? sorted[Math.floor(sorted.length / 2)] : NaN;
};
const row = (label, values) => console.log(`  ${label.padEnd(44)} ${median(values).toFixed(0).padStart(6)} ms`);

console.log('median over runs:');
row('index.js fetched (local server)', results.map((r) => r.scriptFetchMs));
row('index.js parsed + evaluated', results.map((r) => r.scriptRunMs));
row('bootstrap asked, from navigation', results.map((r) => r.bootstrapAsked));
row('bootstrap answered (bridge delay)', results.map((r) => r.bootstrapAnswered - r.bootstrapAsked));
row('render: answer → scene cards on screen', results.map((r) => r.seen.scenes - r.bootstrapAnswered));
row('render: answer → speaker cards on screen', results.map((r) => (r.seen.players ?? NaN) - r.bootstrapAnswered));
row('render: answer → library on screen', results.map((r) => (r.seen.library ?? NaN) - r.bootstrapAnswered));
row('TOTAL: navigation → scene cards (usable)', results.map((r) => r.seen.scenes));
row('TOTAL: navigation → speaker volume shown', results.map((r) => r.seen.state));
console.log(`  long tasks (>50 ms) during load: ${median(results.map((r) => r.longTasks))}`);
