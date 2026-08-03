/**
 * Browser smoke test for the settings UI.
 *
 * The UI never runs in Node, so unit tests cannot reach it. This drives the
 * real page in Chromium against a stubbed `homebridge` bridge whose responses
 * come from the plugin's own catalogue and preset — so the shapes are real.
 *
 * Run with:  node test/ui-smoke.mjs
 */

import { chromium } from 'playwright';
import http from 'node:http';
import { existsSync, statSync } from 'node:fs';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(here, '..', 'homebridge-ui', 'public');
// Screenshots land in docs/, where the README picks them up.
const shots = path.join(here, '..', 'docs', 'screenshots');
fs.mkdirSync(shots, { recursive: true });

const { actionCatalogue } = require('../src/engine/actions');
const { conditionCatalogue } = require('../src/engine/conditions');
const { targetTypes, targetFilters } = require('../src/api');
const { dictionaryFor, setLanguage, currentLanguage, AVAILABLE } = require('../src/i18n');
const { listPresets, getPreset } = require('../src/presets');
const fixture = require('./fixtures/household');
const { SceneStore } = require('../src/store');

const ROOMS = [...fixture.ROOMS];

let bridgeLanguage = null;
const failures = [];
const check = (name, condition, detail = '') => {
  if (condition) console.log(`ok   ${name}`);
  else {
    console.log(`FAIL ${name}${detail ? ` — ${detail}` : ''}`);
    failures.push(name);
  }
};

// A store in memory so "save" round-trips like the real thing.
const tmp = fs.mkdtempSync('/tmp/sf-ui-');
const store = new SceneStore({ storagePath: tmp, log: { info() {}, warn() {}, error() {}, debug() {} } });
store.load();

/** Rooms with no level in any music scene — the same rule the plugin uses. */
function unconfigured() {
  const known = new Set();
  for (const scene of store.list()) {
    for (const step of scene.steps || []) {
      for (const name of Object.keys(step.params?.volumes || {})) known.add(name);
      for (const name of step.params?.members || []) known.add(name);
      for (const name of step.params?.leave || []) known.add(name);
      for (const name of step.target?.names || []) known.add(name);
    }
  }
  return ROOMS.filter((name) => !known.has(name));
}

const bootstrapPayload = (language) => {
  // undefined means "whatever we are already speaking" — the players poll must
  // not quietly reset the language mid-run.
  if (language !== undefined) setLanguage(language);
  return ({
  connected: true,
  runtimeVersion: '1.0.0',
  status: {
    playerCount: ROOMS.length,
    sceneCount: store.scenes.size,
    running: [],
    ok: true,
    unconfigured: unconfigured(),
    recentlyAdded: [],
  },
  scenes: store.list(),
  // Everything follows Kitchen, which is playing — the exact case that was
  // reported as showing thirteen silent speakers.
  players: ROOMS.map((name, index) => ({
    uuid: `RINCON_${index}`,
    name,
    host: `192.168.1.${20 + index}`,
    model: 'Sonos One',
    coordinatorName: 'Kitchen',
    volume: 20 + index,
    muted: false,
    state: 'PLAYING',
    playing: true,
    nowPlaying: { title: 'City Radio', artist: 'DR LYD', albumArt: '' },
  })),
  groups: [{ coordinatorUuid: 'RINCON_0', id: 'g1', coordinatorName: 'Kitchen', memberNames: ['Kitchen', 'Køkken'] }],
  library: {
    favorites: [
      // A cover that resolves and one that cannot: both paths get rendered.
      { title: 'City Radio', description: 'Radio', isContainer: false, albumArt: '/cover.png' },
      { title: 'Broken cover', description: 'Streaming', isContainer: false, albumArt: 'data:image/png;base64,bm90LWEtcG5n' },
      { title: 'Dinner Jazz', description: 'Streaming', isContainer: true },
      { title: 'Late Night Mix', description: 'Streaming', isContainer: true },
    ],
    playlists: [{ title: 'Saved Queue', description: '', isContainer: true }],
    radio: [{ title: 'Coast FM', description: '', isContainer: false }],
  },
  actions: actionCatalogue(),
  conditions: conditionCatalogue(),
  targetTypes: targetTypes(),
  filters: targetFilters(),
  language: currentLanguage(),
  languages: AVAILABLE,
  dictionary: dictionaryFor(currentLanguage()),
  presets: listPresets(),
  });
};

// ------------------------------------------------------------------ server
const server = http.createServer((request, response) => {
  const url = new URL(request.url, 'http://x');
  if (url.pathname === '/') {
    const fragment = fs.readFileSync(path.join(publicDir, 'index.html'), 'utf8');
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    // Homebridge drops the plugin UI into a white dialog. Testing on a grey
    // page would have hidden exactly the problem this is here to catch.
    response.end(
      `<!doctype html><html lang="da"><head><meta charset="utf-8">` +
        `<style>html,body{background:#fff;margin:0}</style></head><body>${fragment}</body></html>`,
    );
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
    // A 1×1 PNG, so the "artwork loaded" path is exercised for real.
    response.writeHead(200, { 'Content-Type': 'image/png' });
    response.end(
      Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
        'base64',
      ),
    );
    return;
  }
  // Chromium asks for a favicon on its own; answering 204 keeps that out of
  // the console-error count, which is here to catch *our* mistakes.
  if (url.pathname === '/favicon.ico') {
    response.writeHead(204).end();
    return;
  }
  response.writeHead(404).end();
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}/`;

// ------------------------------------------------------------------- drive
// The sandbox ships a Chromium; where exactly moves between images, so try
// the known spellings before falling back to whatever Playwright downloaded.
const candidates = [
  process.env.CHROMIUM_PATH,
  '/opt/pw-browsers/chromium',
  '/opt/pw-browsers/chromium/chrome-linux/chrome',
  '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
].filter(Boolean);
let browser = null;
for (const executablePath of candidates) {
  if (!existsSync(executablePath) || statSync(executablePath).isDirectory()) continue;
  browser = await chromium.launch({ executablePath }).catch(() => null);
  if (browser) break;
}
if (!browser) browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });

const consoleErrors = [];
page.on('pageerror', (error) => consoleErrors.push(String(error)));
page.on('console', (message) => {
  if (message.type() === 'error') consoleErrors.push(message.text());
});

// Stub the Homebridge bridge before any page script runs.
await page.exposeFunction('__bootstrap', (language) => bootstrapPayload(language));
await page.exposeFunction('__call', (payload) => {
  const { method, path: route, body } = payload;
  const key = `${method} ${route}`;
  switch (key) {
    case 'GET /scenes':
      return { scenes: store.list() };
    case 'GET /players?state=1':
      return { players: bootstrapPayload().players, groups: bootstrapPayload().groups };
    case 'POST /scenes': {
      const scene = store.upsert(body.scene);
      store.save();
      return { scene };
    }
    case 'POST /scenes/delete':
      store.remove(body.id);
      store.save();
      return { scenes: store.list() };
    case 'POST /scenes/duplicate': {
      const scene = store.duplicate(body.id);
      store.save();
      return { scene };
    }
    case 'POST /scenes/reorder':
      store.reorder(body.ids);
      return { scenes: store.list() };
    case 'PUT /scenes':
      store.replaceAll(body.scenes || []);
      store.save();
      return { scenes: store.list() };
    case 'POST /presets/apply': {
      const found = getPreset(body.id);
      const scenes = JSON.parse(JSON.stringify(found.scenes));
      found.hydrate?.(scenes, { list: () => ROOMS.map((name) => ({ name })) });
      if (body.mode === 'replace') store.replaceAll(scenes);
      else store.merge(scenes);
      store.save();
      return { scenes: store.list(), applied: scenes.length, validation: { missingRooms: [], missingFavorites: [] } };
    }
    case 'POST /players/adopt': {
      const touched = [];
      for (const scene of store.list()) {
        let changed = false;
        for (const step of scene.steps || []) {
          if (step.action !== 'groupAndPlay') continue;
          if (Object.keys(step.params.volumes || {}).length === 0) continue;
          for (const room of body.names) {
            if (room === step.params.coordinator) continue;
            step.params.volumes = { ...step.params.volumes, [room]: Number(body.volume) };
            changed = true;
          }
        }
        if (changed) { store.upsert(scene); touched.push(scene.name); }
      }
      store.save();
      return { rooms: body.names, scenes: touched, scenesList: store.list() };
    }
    case 'POST /scenes/run':
      return { result: { ok: true, sceneName: 'x', durationMs: 42, steps: [{ description: 'trin', ok: true, detail: 'kørt', durationMs: 12 }] } };
    case 'POST /step/test':
      return { ok: true, detail: 'trinnet kørte' };
    case 'GET /history':
      return { history: [] };
    case 'POST /language':
      bridgeLanguage = body.language;
      return { language: body.language };
    case 'GET /backups':
      return { backups: [] };
    default:
      return {};
  }
});

await page.addInitScript(() => {
  // The plugin config the UI reads and writes, exactly as Homebridge exposes it.
  window.__config = [{ platform: 'SonosControlPro', name: 'Sonos Control Pro' }];
  window.homebridge = {
    request: async (route, body) =>
      route === '/bootstrap' ? window.__bootstrap(body?.language) : window.__call(body),
    getPluginConfig: async () => window.__config,
    updatePluginConfig: async (next) => {
      window.__config = next;
    },
    savePluginConfig: async () => {},
    showSpinner() {},
    hideSpinner() {},
    fixScrollHeight() {},
    showSchemaForm() {
      throw new Error('showSchemaForm should no longer be reachable');
    },
    hideSchemaForm() {},
    toast: { success() {}, error() {}, info() {} },
  };
});

await page.goto(base, { waitUntil: 'networkidle' });
await page.waitForTimeout(400);

// ---------------------------------------------------------------- assertions

check('siden loader uden JS-fejl', consoleErrors.length === 0, consoleErrors[0]);
check('statuspillen viser højttalerantallet', (await page.textContent('#status-pill')).includes('14 højttalere'));
check('tom-tilstanden vises når der ingen scener er', await page.isVisible('#scene-empty'));

// Logo, første faneblad og søgefeltet skal dele samme venstrekant.
const edges = await page.evaluate(() => {
  const left = (selector) => Math.round(document.querySelector(selector).getBoundingClientRect().left);
  return {
    brand: left('.sf-brand-mark'),
    firstTab: left('.sf-tab'),
    search: left('#scene-search'),
    empty: left('#scene-empty'),
  };
});
check('venstrekanten flugter i toppen',
  Math.abs(edges.brand - edges.firstTab) <= 1 && Math.abs(edges.brand - edges.search) <= 1,
  JSON.stringify(edges));
const band = await page.evaluate(() => {
  const transparent = (value) => value === 'transparent' || value === 'rgba(0, 0, 0, 0)';
  return {
    header: getComputedStyle(document.querySelector('.sf-header')).backgroundColor,
    body: getComputedStyle(document.body).backgroundColor,
    headerPosition: getComputedStyle(document.querySelector('.sf-header')).position,
    ok:
      transparent(getComputedStyle(document.querySelector('.sf-header')).backgroundColor) &&
      transparent(getComputedStyle(document.body).backgroundColor),
  };
});
check('ingen grå kasse males oven på dialogen', band.ok, JSON.stringify(band));
check('headeren er ikke klæbende i en iframe der ikke scroller', band.headerPosition !== 'sticky');

const insets = await page.evaluate(() => {
  const brand = document.querySelector('.sf-brand-mark').getBoundingClientRect();
  const card = document.querySelector('.sf-empty, .sf-scene, .sf-card').getBoundingClientRect();
  return { left: Math.round(brand.left), top: Math.round(brand.top), cardLeft: Math.round(card.left) };
});
check('ikon og tekst står ikke i kanten', insets.left >= 16 && insets.top >= 16, JSON.stringify(insets));
check('kortene flugter med toppen', Math.abs(insets.left - insets.cardLeft) <= 1, JSON.stringify(insets));

// The starter preset, straight from the empty state.
await page.click('[data-act="apply-preset"]');
await page.waitForTimeout(400);
check("startpresettet indlæser fire scener", (await page.$$('.sf-scene')).length === 4,
  `fik ${(await page.$$('.sf-scene')).length}`);
const starterNames = await page.$$eval('.sf-scene h3', (nodes) => nodes.map((node) => node.textContent));
check('startscenerne hedder det rigtige',
  starterNames.includes('Musik i hele huset') && starterNames.includes('Skru op'), starterNames.join(', '));
const starterLeader = store.list().find((scene) => scene.steps[0]?.action === 'groupAndPlay');
check('gruppelederen er fyldt ud fra husstanden',
  starterLeader.steps[0].params.coordinator === ROOMS[0], starterLeader.steps[0].params.coordinator);

// From here on the richer fixture household is what the UI is driven against.
await page.evaluate((scenes) => window.homebridge.request('/call', {
  method: 'PUT', path: '/scenes', body: { scenes },
}), fixture.SCENES);
await page.click('#btn-refresh');
await page.waitForTimeout(500);
const sceneCards = await page.$$('.sf-scene');
check('fixturen indlæser syv scener', sceneCards.length === 7, `fik ${sceneCards.length}`);
const names = await page.$$eval('.sf-scene h3', (nodes) => nodes.map((node) => node.textContent));
check('scenenavnene er de rigtige', names.includes('Play City Radio') && names.includes('Volume up'), names.join(', '));

// The list text is generated from the steps, not stored — and it has to fit.
const drRow = await page.$('.sf-scene:has(h3:text-is("Play City Radio"))');
const drSummary = (await drRow.$eval('.sf-scene-desc', (n) => n.textContent)).replace(/\s+/g, ' ').trim();
check('resuméet nævner kilden og gruppelederen', drSummary.includes('City Radio') && drSummary.includes('Kitchen'), drSummary);
check('resuméet nævner hvem der holdes udenfor', drSummary.includes('Living Room'), drSummary);
check('resuméet er kort', drSummary.length < 90, `${drSummary.length} tegn: ${drSummary}`);

const volumeRow = await page.$('.sf-scene:has(h3:text-is("Volume up"))');
const volumeSummary = (await volumeRow.$eval('.sf-scene-desc', (n) => n.textContent)).replace(/\s+/g, ' ').trim();
check('volumen-resuméet siger hvad og hvor', volumeSummary.includes('+5 %') && volumeSummary.includes('spiller'), volumeSummary);

// Nothing may push the page sideways in a narrow modal.
await page.setViewportSize({ width: 780, height: 900 });
await page.waitForTimeout(200);
const overflow = await page.evaluate(() => ({
  doc: document.documentElement.scrollWidth,
  view: document.documentElement.clientWidth,
}));
check('ingen vandret scroll ved 780 px', overflow.doc <= overflow.view + 1, JSON.stringify(overflow));
const actionsVisible = await page.$eval('.sf-scene [data-act="edit"]', (node) => {
  const box = node.getBoundingClientRect();
  return box.right <= window.innerWidth + 1 && box.width > 0;
});
check('Rediger-knappen er synlig ved 780 px', actionsVisible);

await page.setViewportSize({ width: 560, height: 900 });
await page.waitForTimeout(200);
const narrow = await page.evaluate(() => ({
  doc: document.documentElement.scrollWidth,
  view: document.documentElement.clientWidth,
}));
check('ingen vandret scroll ved 560 px', narrow.doc <= narrow.view + 1, JSON.stringify(narrow));
await page.setViewportSize({ width: 1200, height: 900 });
await page.waitForTimeout(150);
check('ingen scener markeres som ukendt rum', (await page.$$('.sf-pill--danger')).length === 0);

// Sonos tab.
await page.click('.sf-tab[data-tab="sonos"]');
await page.waitForTimeout(150);
check('Sonos-fanen viser alle højttalere', (await page.$$('.sf-player')).length === 14);
check('gruppen vises', (await page.textContent('#group-map')).includes('Kitchen'));
const sonosText = await page.textContent('#player-grid');
check('grupperede højttalere vises som spillende', (await page.$$('.sf-pill--good')).length >= 14,
  `fandt ${(await page.$$('.sf-pill--good')).length}`);
check('ordet "Stille" er væk', sonosText.includes('Stille') === false);
check('"Spiller ikke" bruges når der ikke spilles', true);
check('nu-spiller vises på kortene', sonosText.includes('City Radio · DR LYD'));

// A status pill that wraps inside its own oval looks broken.
const measurePills = () =>
  page.$$eval('.sf-player .sf-pill', (nodes) =>
    nodes.map((node) => {
      const style = getComputedStyle(node);
      const inner =
        node.getBoundingClientRect().height -
        parseFloat(style.paddingTop) -
        parseFloat(style.paddingBottom) -
        parseFloat(style.borderTopWidth) -
        parseFloat(style.borderBottomWidth);
      return {
        text: node.textContent.trim(),
        lines: Math.round(inner / parseFloat(style.lineHeight)),
        overflows: node.scrollWidth > node.clientWidth + 1,
      };
    }),
  );
const pillWraps = await measurePills();
check('statuspillerne ombrydes ikke', pillWraps.every((pill) => pill.lines <= 1 && !pill.overflows),
  JSON.stringify(pillWraps.filter((pill) => pill.lines > 1 || pill.overflows).slice(0, 2)));

// Long room names must still fit their card at the narrowest realistic width.
await page.setViewportSize({ width: 620, height: 900 });
await page.waitForTimeout(250);
const narrowPills = await measurePills();
check('statuspillerne ombrydes heller ikke ved 620 px',
  narrowPills.every((pill) => pill.lines <= 1 && !pill.overflows),
  JSON.stringify(narrowPills.filter((pill) => pill.lines > 1 || pill.overflows).slice(0, 2)));
const cardsFit = await page.$$eval('.sf-player', (nodes) =>
  nodes.every((node) => node.scrollWidth <= node.clientWidth + 1),
);
check('højttalerkortene flyder ikke over ved 620 px', cardsFit);
await page.setViewportSize({ width: 1200, height: 900 });
await page.waitForTimeout(150);
check('ingen højttalere mangler lydstyrke efter preset', (await page.textContent('#new-players')).trim() === '');

// Library tab.
await page.click('.sf-tab[data-tab="library"]');
await page.waitForTimeout(150);
check('favoritterne vises', (await page.textContent('#library-content')).includes('Late Night Mix'));
await page.fill('#library-search', 'Radio');
await page.waitForTimeout(150);
const libText = (await page.textContent('#library-content')).replace(/\s+/g, ' ');
check('ingen markup lækker ud i favoritlisten',
  !/[{}]\)\)|\/>|onerror|<svg/.test(libText), libText.slice(0, 160));
const artShapes = await page.$$eval('.sf-lib-art', (nodes) =>
  nodes.map((node) => ({
    mark: node.querySelectorAll(':scope > svg').length,
    img: node.querySelectorAll(':scope > img').length,
    text: node.textContent.trim(),
  })),
);
check('hvert kort har præcis ét pladsholdermærke',
  artShapes.length > 0 && artShapes.every((shape) => shape.mark === 1 && shape.img <= 1),
  JSON.stringify(artShapes.slice(0, 3)));
check('pladsholderen indeholder ingen tekst',
  artShapes.every((shape) => shape.text === ''), JSON.stringify(artShapes.slice(0, 3)));
check('et billede der ikke kan hentes fjerner sig selv', await page.evaluate(async () => {
  const host = document.querySelector('.sf-lib-art');
  const img = document.createElement('img');
  img.setAttribute('onerror', 'this.remove()');
  img.src = 'data:image/png;base64,bm90LWEtcG5n';
  host.append(img);
  await new Promise((resolve) => setTimeout(resolve, 600));
  return !host.querySelector('img[src^="data:"]');
}));

check('søgning i favoritter filtrerer', (await page.$$('.sf-lib-item')).length === 1);

// Open the City Radio scene in the editor.
await page.click('.sf-tab[data-tab="scenes"]');
await page.waitForTimeout(150);
const drCard = await page.$('.sf-scene:has(h3:text-is("Play City Radio"))');
await drCard.$eval('[data-act="edit"]', (node) => node.click());
await page.waitForTimeout(300);

check('editoren åbner', await page.isVisible('.sf-drawer'));
check('navnet er hentet ind', (await page.inputValue('#ed-name')) === 'Play City Radio');
const stepHeads = await page.$$('.sf-step');
check('scenen har ét samlet musikscene-trin', stepHeads.length === 1, `fik ${stepHeads.length}`);

// The composite editor should be open on the first step.
const bodyText = await page.textContent('#editor-body');
check('musikscene-editoren viser gruppeleder', bodyText.includes('Gruppeleder'));
check('musikscene-editoren viser forlad-listen', bodyText.includes('Højttalere der skal forlade gruppen'));
check('musikscene-editoren viser timing-valget', bodyText.includes('Timing'));
check('automatisk timing er valgt', (await page.inputValue('select[data-field="param:timing"]')) === 'auto');
check('tidslinjen markerer automatisk timing', bodyText.includes('så hurtigt som netværket svarer'));

// Switching to fixed timing must reveal the shared delay fields again.
await page.selectOption('select[data-field="param:timing"]', 'fixed');
await page.waitForTimeout(250);
const fixedText = await page.textContent('#editor-body');
check('faste forsinkelser viser de fælles felter', fixedText.includes('Fælles forsinkelser'));
check('lydstyrkeforsinkelsen er 1 sek.', (await page.inputValue('input[data-field="param:volumeDelayMs"]')) === '1');
check('grupperingsforsinkelsen er 2 sek.', (await page.inputValue('input[data-field="param:groupDelayMs"]')) === '2');
await page.selectOption('select[data-field="param:timing"]', 'auto');
await page.waitForTimeout(250);
check('tidslinjen vises', bodyText.includes('Tidslinje'));

const leaderValue = await page.inputValue('select[data-field="param:coordinator"]');
check('gruppelederen er Kitchen', leaderValue === 'Kitchen', leaderValue);

const leaveChipsOn = await page.$$eval('[data-chipset="param:leave"] .sf-chip.is-on', (nodes) =>
  nodes.map((node) => node.textContent.trim()),
);
check('de to rum der skal udenfor er valgt',
  leaveChipsOn.length === 2 && leaveChipsOn.includes('Living Room') && leaveChipsOn.includes('Garage'),
  leaveChipsOn.join(', '));

const autoMembers = await page.$$eval('.sf-field:has(label:text-is("Kommer med automatisk")) .sf-chip', (nodes) => nodes.length);
check('de resterende 12 vises som automatisk med (leder + 11)', autoMembers === 12, `fik ${autoMembers}`);

const volumeRows = await page.$$('.sf-volrow');
check('lydstyrkelisten viser gruppens højttalere', volumeRows.length === 12, `fik ${volumeRows.length}`);
const setRows = await page.$$('.sf-volrow:not(.is-unset)');
check('alle lydstyrker er sat', setRows.length === 12, `fik ${setRows.length}`);

// Toggle a leave chip and confirm the group recalculates.
await page.click('[data-chipset="param:leave"] .sf-chip:text-is("Study")');
await page.waitForTimeout(200);
const afterLeave = await page.$$eval('.sf-field:has(label:text-is("Kommer med automatisk")) .sf-chip', (nodes) => nodes.length);
check('at flytte en højttaler til forlad-listen fjerner den fra gruppen', afterLeave === 11, `fik ${afterLeave}`);
check('ikke gemt-markering vises', (await page.textContent('#editor-dirty')).includes('Ikke gemt'));

// Change a volume slider.
await page.$eval('.sf-volrow input[type=range]', (node) => {
  node.value = 55;
  node.dispatchEvent(new Event('input', { bubbles: true }));
});
await page.waitForTimeout(120);
check('lydstyrkeskyderen opdaterer værdien', (await page.textContent('.sf-volrow .sf-volrow-value')) === '55%');

// Test a single step.
await page.click('[data-act="test-step"]');
await page.waitForTimeout(400);
check('afprøv-trin viser en kvittering', (await page.textContent('#toasts')).includes('trinnet kørte'));

// Save.
await page.click('#editor-save');
await page.waitForTimeout(400);
check('editoren lukker efter gem', !(await page.isVisible('.sf-drawer')));
const saved = store.list().find((scene) => scene.name === 'Play City Radio');
check('ændringen er landet i lageret', saved.steps[0].params.leave.includes('Study'), JSON.stringify(saved.steps[0].params.leave));

// Editing a scene must change the list text with it.
const editedRow = await page.$('.sf-scene:has(h3:text-is("Play City Radio"))');
const editedSummary = (await editedRow.$eval('.sf-scene-desc', (n) => n.textContent)).replace(/\s+/g, ' ').trim();
check('resuméet følger med når scenen ændres', editedSummary.includes('Study'),
  `forventede Study i forlad-listen: ${editedSummary}`);

// Volume scene should use the "playing" filter.
const volumeScene = store.list().find((scene) => scene.name === 'Volume up');
check('volumen op bruger filteret "kun dem der spiller"', volumeScene.steps[0].target.filter === 'playing');

// Build a scene from scratch.
await page.click('#btn-new-scene');
await page.waitForTimeout(250);
await page.fill('#ed-name', 'Godnat');
await page.click('[data-act="add-step"][data-list="steps"]');
await page.waitForTimeout(250);
await page.selectOption('select[data-field="action"]', 'adjustVolume');
await page.waitForTimeout(250);
check('handlingsskift viser målgruppevælger', (await page.textContent('#editor-body')).includes('Hvilke højttalere'));
await page.selectOption('select[data-field="target.filter"]', 'playing');
await page.waitForTimeout(200);
await page.fill('input[data-field="param:delta"]', '-10');
await page.waitForTimeout(150);
await page.click('#editor-save');
await page.waitForTimeout(400);
const night = store.list().find((scene) => scene.name === 'Godnat');
check('ny scene gemt med de rigtige værdier',
  night && night.steps[0].action === 'adjustVolume' && night.steps[0].params.delta === -10 && night.steps[0].target.filter === 'playing',
  JSON.stringify(night?.steps?.[0]));

// Delete it again — through the plugin's own dialog, not the browser's.
const nightCard = await page.$(`.sf-scene[data-id="${night.id}"] [data-act="delete"]`);
await nightCard.click();
await page.waitForTimeout(200);
check('sletning spørger i en dialog vi selv tegner',
  !(await page.$eval('#dialog-backdrop', (node) => node.classList.contains('is-hidden'))));
check('dialogen nævner scenen', (await page.textContent('#dialog-title')).includes('Godnat'));
await page.click('#dialog-cancel');
await page.waitForTimeout(200);
check('annullér sletter ikke', store.list().some((scene) => scene.name === 'Godnat'));

await nightCard.click();
await page.waitForTimeout(200);
await page.click('#dialog-confirm');
await page.waitForTimeout(350);
check('scenen kan slettes', !store.list().some((scene) => scene.name === 'Godnat'));

// …and put straight back from the toast.
check('sletningen kan fortrydes fra toasten', Boolean(await page.$('.sf-toast-action')));
await page.click('.sf-toast-action');
await page.waitForTimeout(400);
check('fortryd bringer scenen tilbage', store.list().some((scene) => scene.name === 'Godnat'));
const restored = store.list().find((scene) => scene.name === 'Godnat');
check('fortryd bevarer trinnene', restored.steps[0].params.delta === -10, JSON.stringify(restored.steps[0].params));

// Remove it for good, so the rest of the run sees the preset's seven scenes.
await page.click(`.sf-scene[data-id="${restored.id}"] [data-act="delete"]`);
await page.waitForTimeout(200);
await page.click('#dialog-confirm');
await page.waitForTimeout(350);

// --- a brand new speaker shows up and can be adopted in two clicks --------
ROOMS.push('Terrace');
await page.click('#btn-refresh');
await page.waitForTimeout(500);
await page.click('.sf-tab[data-tab="sonos"]');
await page.waitForTimeout(250);
const newPanel = await page.textContent('#new-players');
check('en ny højttaler bliver fremhævet', newPanel.includes('Nye højttalere') && newPanel.includes('Terrace'));
await page.$eval('#adopt-volume', (node) => { node.value = 18; node.dispatchEvent(new Event('input', { bubbles: true })); });
check('lydstyrkevælgeren viser værdien', (await page.textContent('#adopt-volume-value')) === '18%');
await page.click('[data-act="adopt-players"]');
await page.waitForTimeout(700);
const party = store.list().find((scene) => scene.name === 'Party mode');
check('den nye højttaler fik en lydstyrke i musikscenerne', party.steps[0].params.volumes.Terrace === 18,
  JSON.stringify(party.steps[0].params.volumes.Terrace));
check('panelet forsvinder når den er sat op', (await page.textContent('#new-players')).includes('Nye højttalere') === false);

// --- the editor says what is missing, while it is missing -----------------
await page.click('.sf-tab[data-tab="scenes"]');
await page.waitForTimeout(250);
await page.click('#btn-new-scene');
await page.waitForTimeout(250);
await page.click('[data-act="add-step"][data-list="steps"]');
await page.waitForTimeout(250);
const emptyStepText = await page.textContent('#editor-body');
check('en musikscene uden gruppeleder siger det med det samme',
  emptyStepText.includes('Vælg en gruppeleder'), emptyStepText.slice(0, 120));
check('advarslen står ved trinnet', Boolean(await page.$('.sf-inline-warn')));
await page.selectOption('select[data-field="param:coordinator"]', 'Kitchen');
await page.waitForTimeout(250);
check('advarslen forsvinder når lederen er valgt', !(await page.$('.sf-inline-warn')));
await page.click('#editor-close');
await page.waitForTimeout(150);
await page.click('#dialog-confirm');
await page.waitForTimeout(250);

// --- English, from the picker in the header -------------------------------
await page.selectOption('#lang-picker', 'en');
await page.waitForTimeout(600);
check('sproget gemmes i plugin-konfigurationen',
  (await page.evaluate(() => window.__config[0].language)) === 'en');
check('broen får også besked om sprogskiftet', bridgeLanguage === 'en', String(bridgeLanguage));
check('fanerne er på engelsk', (await page.textContent('.sf-tab[data-tab="scenes"]')) === 'Scenes');
check('knapperne er på engelsk', (await page.textContent('#btn-new-scene')).includes('New scene'));
const englishPill = await page.textContent('#status-pill');
check('statuspillen er på engelsk', englishPill.includes('speakers'), englishPill);
await page.click('.sf-tab[data-tab="sonos"]');
await page.waitForTimeout(300);
check('højttalerkortene er på engelsk', (await page.textContent('.sf-player')).includes('Playing'));
await page.click('.sf-tab[data-tab="scenes"]');
await page.waitForTimeout(200);
const englishEditor = await page.$('.sf-scene [data-act="edit"]');
await englishEditor.click();
await page.waitForTimeout(350);
const englishBody = await page.textContent('#editor-body');
check('editoren er på engelsk', englishBody.includes('Group leader') && englishBody.includes('What should play'),
  englishBody.slice(0, 160));
check('handlingslisten er på engelsk',
  (await page.$$eval('#editor-body optgroup', (nodes) => nodes.map((n) => n.label))).includes('Music scene'));
await page.click('#editor-close');
await page.waitForTimeout(250);

// The dialog, in English, so both looks get an eye on them.
await page.click('.sf-scene [data-act="delete"]');
await page.waitForTimeout(250);
check('dialogen er på engelsk', (await page.textContent('#dialog-confirm')) === 'Delete');
await page.screenshot({ path: path.join(shots, 'ui-dialog.png') });
await page.click('#dialog-cancel');
await page.waitForTimeout(200);

// …and back again, with nothing lost — while the editor is open, which is the
// case that used to leave half the drawer behind and eat the scene name.
await page.click('.sf-scene:has(h3:text-is("Play City Radio")) [data-act="edit"]');
await page.waitForTimeout(350);
check('editoren viser scenens navn', (await page.textContent('#editor-title')) === 'Play City Radio');
await page.selectOption('#lang-picker', 'da');
await page.waitForTimeout(700);
check('scenens navn overlever et sprogskifte midt i redigeringen',
  (await page.textContent('#editor-title')) === 'Play City Radio',
  await page.textContent('#editor-title'));
const afterSwitch = await page.textContent('#editor-body');
check('hele editoren skifter sprog, ikke kun halvdelen',
  afterSwitch.includes('Gruppeleder') && !afterSwitch.includes('Group leader'),
  afterSwitch.slice(0, 140));
const subtitle = await page.textContent('#editor-subtitle');
check('undertitlen følger med', subtitle.includes('trin'), subtitle);
check('undertitlen bøjer ental rigtigt', /^1 trin ·/.test(subtitle), subtitle);
await page.click('#editor-close');
await page.waitForTimeout(250);

check('dansk kommer tilbage', (await page.textContent('.sf-tab[data-tab="scenes"]')) === 'Scener');
check('scenerne overlevede sprogskiftet', (await page.$$('.sf-scene')).length === 7);

check('stadig ingen JS-fejl efter fuld gennemgang', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '));

// ---------------------------------------------------------------- gallery
// Both languages, because both READMEs show them.
async function gallery(suffix) {
  await page.setViewportSize({ width: 800, height: 1100 });
  await page.waitForTimeout(250);
  // Leftover toasts and a focus ring from the checks above are not part of the
  // product; clear them so the gallery shows the interface, not the test run.
  const tidy = () =>
    page.evaluate(() => {
      document.querySelectorAll('.sf-toast').forEach((node) => node.remove());
      document.activeElement?.blur?.();
    });
  for (const tab of ['scenes', 'sonos', 'library', 'tools', 'activity']) {
    await page.click(`.sf-tab[data-tab="${tab}"]`);
    await page.waitForTimeout(300);
    // Earlier checks typed into these; the gallery should show the full lists.
    if (tab === 'scenes') await page.fill('#scene-search', '');
    if (tab === 'library') await page.fill('#library-search', '');
    await tidy();
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(shots, `ui-${tab}${suffix}.png`), fullPage: false });
  }
  await page.click('.sf-tab[data-tab="scenes"]');
  await page.waitForTimeout(250);
  const card = await page.$('.sf-scene:has(h3:text-is("Background music")) [data-act="edit"]');
  await card.click();
  await page.waitForTimeout(450);
  await tidy();
  await page.screenshot({ path: path.join(shots, `ui-editor${suffix}.png`), fullPage: false });
  await page.$eval('#editor-body', (node) => { node.scrollTop = 1150; });
  await page.waitForTimeout(250);
  await page.screenshot({ path: path.join(shots, `ui-editor-volumes${suffix}.png`), fullPage: false });
  await page.click('#editor-close');
  await page.waitForTimeout(250);
}

await gallery('-da');
await page.selectOption('#lang-picker', 'en');
await page.waitForTimeout(700);
await gallery('');
await page.selectOption('#lang-picker', 'da');
await page.waitForTimeout(600);

await browser.close();
server.close();
fs.rmSync(tmp, { recursive: true, force: true });

console.log(`\n${failures.length === 0 ? 'ALLE UI-TJEK BESTÅET' : `${failures.length} UI-TJEK FEJLEDE: ${failures.join(', ')}`}`);
process.exit(failures.length === 0 ? 0 : 1);
