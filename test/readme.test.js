'use strict';

/**
 * The two READMEs are one document in two languages, and nothing kept them
 * that way. The i18n dictionaries have a test that fails the moment a key
 * exists in one language and not the other; the READMEs — longer, read by more
 * people, and edited by hand — had no such thing. A section added to one and
 * forgotten in the other would simply stay forgotten.
 *
 * Structure is compared rather than content: every heading carries an emoji,
 * and the sequence of emoji and heading levels is the document's skeleton. The
 * words differ; the skeleton must not.
 *
 * Two more things drift on their own. The toolbox section lists every action
 * the plugin has, and the install section quotes how many tests the suite
 * has. Both are checked against the source of truth.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { setLanguage } = require('../src/i18n');
const { actionCatalogue } = require('../src/engine/actions');

const ROOT = path.join(__dirname, '..');
const READMES = {
  en: fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8'),
  da: fs.readFileSync(path.join(ROOT, 'README.da.md'), 'utf8'),
};

/** `## 🎁 Templates: …` → `{ level: 2, emoji: '🎁' }` */
function skeleton(markdown) {
  return markdown
    .split('\n')
    .filter((line) => /^#{1,6} /.test(line))
    .map((line) => {
      const [, hashes, rest] = /^(#{1,6}) (.*)$/.exec(line);
      // The emoji is the first grapheme; some are two code points wide.
      const [emoji] = [...new Intl.Segmenter('en', { granularity: 'grapheme' }).segment(rest)].map(
        (segment) => segment.segment,
      );
      return `${hashes} ${emoji}`;
    });
}

test('the English and Danish READMEs have the same sections, in the same order', () => {
  const en = skeleton(READMES.en);
  const da = skeleton(READMES.da);
  assert.ok(en.length > 10, 'the walker found the headings');
  // The bilingual section swaps its two flags around — 🇬🇧 🇩🇰 in one, 🇩🇰 🇬🇧
  // in the other — which is the one place the emoji is allowed to differ.
  const flags = (entry) => entry.replace(/🇬🇧|🇩🇰/gu, '🏳️');
  assert.deepEqual(da.map(flags), en.map(flags));
});

test('the READMEs link to the same places', () => {
  const links = (markdown) => [...markdown.matchAll(/\]\((https?:\/\/[^)\s]+)\)/g)].map((m) => m[1]).sort();
  assert.deepEqual(links(READMES.da), links(READMES.en));
});

test('every action the plugin has is in the toolbox, in both languages', () => {
  for (const [language, readme] of Object.entries(READMES)) {
    setLanguage(language);
    const missing = [];
    for (const group of actionCatalogue()) {
      for (const action of group.actions) {
        if (!readme.includes(action.label)) missing.push(`${action.id} ("${action.label}")`);
      }
    }
    assert.deepEqual(missing, [], `${language}: actions the README does not mention`);
  }
});

test('the number of starter scenes is quoted correctly wherever it is written out', () => {
  const { getPreset } = require('../src/presets');
  const { t } = require('../src/i18n');
  const count = getPreset('starter').scenes.length;
  const words = {
    en: ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'],
    da: ['nul', 'en', 'to', 'tre', 'fire', 'fem', 'seks', 'syv', 'otte', 'ni', 'ti'],
  };
  for (const [language, readme] of Object.entries(READMES)) {
    setLanguage(language);
    const word = words[language][count];
    assert.ok(word, `no word for ${count} in ${language}`);
    // The button on the empty page, and the sentence above it.
    for (const key of ['ui.scenes.emptyPreset', 'ui.scenes.emptyBody']) {
      assert.match(t(key), new RegExp(`\\b${word}\\b`, 'i'), `${language}: ${key} — "${t(key)}" should say ${word}`);
    }
    // And the README, which lists them by name as well.
    assert.match(readme, new RegExp(`\\b${word}\\b`, 'i'), `${language}: the README should say ${word} starter scenes`);
    for (const scene of getPreset('starter').scenes) {
      assert.ok(readme.includes(scene.name), `${language}: the README should name "${scene.name}"`);
    }
  }
});

test('the test counts the READMEs quote are the real ones', () => {
  // Counted the way the runner counts them: one `test(` at the start of a line
  // per test. A loop that registers tests would break this — there is none.
  const unit = fs
    .readdirSync(__dirname)
    .filter((name) => name.endsWith('.test.js'))
    .reduce((sum, name) => sum + (fs.readFileSync(path.join(__dirname, name), 'utf8').match(/^test\(/gm) || []).length, 0);
  const browser = (fs.readFileSync(path.join(__dirname, 'ui-smoke.mjs'), 'utf8').match(/^\s*check\(/gm) || []).length;

  for (const [language, readme] of Object.entries(READMES)) {
    const quotedUnit = Number(/npm test\s+#\s+(\d+)/.exec(readme)?.[1]);
    const quotedBrowser = Number(/npm run test:ui\s+#\s+(\d+)/.exec(readme)?.[1]);
    assert.equal(quotedUnit, unit, `${language}: "npm test # N" — the suite has ${unit} tests`);
    assert.equal(quotedBrowser, browser, `${language}: "npm run test:ui # N" — the smoke test has ${browser} checks`);
  }
});
