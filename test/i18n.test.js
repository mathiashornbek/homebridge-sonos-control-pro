'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const da = require('../src/i18n/da');
const en = require('../src/i18n/en');
const {
  createTranslator,
  resolveLanguage,
  dictionaryFor,
  interpolate,
  setLanguage,
  currentLanguage,
  t,
  tFirst,
  has,
  AVAILABLE,
} = require('../src/i18n');
const { ACTIONS, actionCatalogue, describeStep } = require('../src/engine/actions');
const { CONDITIONS, conditionCatalogue } = require('../src/engine/conditions');
const { describeTarget } = require('../src/engine/targets');

test.afterEach(() => setLanguage('da'));

// ─────────────────────────────────────────────────────────────── the dictionaries

test('the two dictionaries have exactly the same keys', () => {
  const danish = Object.keys(da).sort();
  const english = Object.keys(en).sort();
  const onlyDanish = danish.filter((key) => !(key in en));
  const onlyEnglish = english.filter((key) => !(key in da));
  assert.deepEqual(onlyDanish, [], `only in da.js: ${onlyDanish.join(', ')}`);
  assert.deepEqual(onlyEnglish, [], `only in en.js: ${onlyEnglish.join(', ')}`);
});

test('no string is left empty or accidentally identical across both languages', () => {
  // A handful genuinely are the same word in both languages; everything else
  // being identical would mean a translation was forgotten.
  const allowedIdentical = new Set([
    // Proper nouns, loan words, and lines that are punctuation with holes in.
    'app.name',
    'common.dash',
    'action.playUri.uri',
    'action.playUri.uriPlaceholder',
    // Two example IP addresses. There is no Danish for 192.168.1.40.
    'ui.sonos.manualPlaceholder',
    'action.playRadio.radio',
    'action.pause.label',
    'action.stop.label',
    'action.runScene.sceneId',
    'action.setCrossfade.label',
    'action.groupAndPlay.crossfade',
    'action.groupAndPlay.timing',
    'action.setLoudness.label',
    'verb.loudness',
    'verb.pause',
    'verb.stop',
    'verb.delta',
    'describe.minus',
    'trigger.homekit',
    'trigger.scene',
    'ui.tab.sonos',
    'ui.tab.tools',
    'ui.library.stream',
    'ui.tools.backupsTitle',
    'ui.scenes.runFailed',
    'ui.editor.sourceUri',
    'condition.timeBetween.fromPlaceholder',
    'condition.timeBetween.toPlaceholder',
    'dialog.ok',
    'log.stepFailed',
    'log.stepSkipped',
    'log.stepOk',
    'scene.defaultName',
    'ui.tools.scenesCountOne',
    'error.soapTimeout',
    'error.soapUnreachable',
  ]);
  const identical = [];
  for (const key of Object.keys(da)) {
    assert.ok(String(da[key]).trim(), `da.js: ${key} is empty`);
    assert.ok(String(en[key]).trim(), `en.js: ${key} is empty`);
    if (da[key] === en[key] && !allowedIdentical.has(key)) identical.push(key);
  }
  assert.deepEqual(identical, [], `same text in both languages: ${identical.join(', ')}`);
});

test('every placeholder in one language exists in the other', () => {
  const placeholders = (value) => (String(value).match(/\{(\w+)\}/g) || []).sort().join(',');
  const mismatched = Object.keys(da).filter((key) => placeholders(da[key]) !== placeholders(en[key]));
  assert.deepEqual(mismatched, [], `placeholders differ: ${mismatched.join(', ')}`);
});

// ───────────────────────────────────────────────────────────────── the translator

test('resolveLanguage takes an explicit code, then the environment, then English', () => {
  assert.equal(resolveLanguage('da', {}), 'da');
  assert.equal(resolveLanguage('en', {}), 'en');
  assert.equal(resolveLanguage('auto', { LANG: 'da_DK.UTF-8' }), 'da');
  assert.equal(resolveLanguage('auto', { LC_ALL: 'da_DK.UTF-8', LANG: 'en_GB' }), 'da');
  // With an empty env, the answer comes from Intl — so it depends on the
  // machine. Assert the equivalence rather than the answer: this test used to
  // demand 'en' and failed on the author's own Mac, which is set to Danish.
  assert.equal(
    resolveLanguage(undefined, {}),
    resolveLanguage('auto', {}),
    'no setting behaves exactly like auto',
  );
  assert.equal(resolveLanguage('', {}), resolveLanguage('auto', {}));
  // With an env, it is decided before Intl is consulted, so these are fixed.
  assert.equal(
    resolveLanguage(undefined, { LANG: 'da_DK.UTF-8' }),
    'da',
    'no setting still follows a Danish machine',
  );
  assert.equal(resolveLanguage(undefined, { LANG: 'en_GB.UTF-8' }), 'en', 'and an English one');
  assert.equal(resolveLanguage('sv', {}), 'en', 'an unknown code falls back rather than crashing');
  // A locale we do not speak falls through to whatever the machine reports;
  // both answers are legitimate, a crash or a raw key is not.
  assert.ok(['da', 'en'].includes(resolveLanguage('auto', { LANG: 'de_DE.UTF-8' })));
});

test('interpolation fills what it can and leaves the rest legible', () => {
  assert.equal(interpolate('{a} og {b}', { a: 1, b: 2 }), '1 og 2');
  assert.equal(interpolate('{a} og {b}', { a: 1 }), '1 og {b}');
  assert.equal(interpolate('ingen pladsholdere'), 'ingen pladsholdere');
});

test('a missing key falls back to English rather than showing the raw key', () => {
  const translate = createTranslator('da');
  assert.equal(translate('app.tagline'), da['app.tagline']);
  assert.equal(translate('der.findes.ikke'), 'der.findes.ikke');
});

test('dictionaryFor always returns a complete dictionary', () => {
  const shipped = dictionaryFor('da');
  for (const key of Object.keys(en)) assert.ok(shipped[key], `${key} missing from the shipped dictionary`);
});

test('the ambient translator switches language for the whole plugin', () => {
  setLanguage('en');
  assert.equal(currentLanguage(), 'en');
  assert.equal(t('common.save'), 'Save');
  setLanguage('da');
  assert.equal(t('common.save'), 'Gem');
});

test('tFirst picks the first key that exists', () => {
  assert.equal(tFirst(['nope.at.all', 'common.save']), 'Gem');
  assert.equal(tFirst(['nope.at.all']), '');
  assert.equal(has('common.save'), true);
  assert.equal(has('nope.at.all'), false);
});

test('every offered language is real', () => {
  for (const entry of AVAILABLE) {
    if (entry.code === 'auto') continue;
    assert.ok(['da', 'en'].includes(entry.code));
  }
});

// ──────────────────────────────────────────────────── every visible string is keyed

test('every action has a translated label and every parameter a translated name', () => {
  for (const language of ['da', 'en']) {
    setLanguage(language);
    for (const [id, definition] of Object.entries(ACTIONS)) {
      assert.ok(has(`action.${id}.label`), `${language}: action.${id}.label is missing`);
      if (definition.helpKey) assert.ok(has(definition.helpKey), `${language}: ${definition.helpKey} is missing`);
      for (const param of definition.params || []) {
        const found = has(`action.${id}.${param.key}`) || has(`param.${param.key}`);
        assert.ok(found, `${language}: no label for ${id}.${param.key}`);
      }
    }
  }
});

test('every condition has a translated label and every field a translated name', () => {
  for (const language of ['da', 'en']) {
    setLanguage(language);
    for (const [id, definition] of Object.entries(CONDITIONS)) {
      assert.ok(has(`condition.${id}.label`), `${language}: condition.${id}.label is missing`);
      for (const param of definition.params || []) {
        const found = has(`condition.${id}.${param.key}`) || has(`condition.field.${param.key}`);
        assert.ok(found, `${language}: no label for ${id}.${param.key}`);
      }
    }
  }
});

test('the catalogue is rendered in the active language', () => {
  setLanguage('da');
  const danish = actionCatalogue();
  const musicDa = danish.find((group) => group.actions.some((action) => action.id === 'groupAndPlay'));
  assert.equal(musicDa.category, 'Musikscene');
  assert.equal(musicDa.actions.find((a) => a.id === 'groupAndPlay').label, 'Start musik i en gruppe');

  setLanguage('en');
  const english = actionCatalogue();
  const musicEn = english.find((group) => group.actions.some((action) => action.id === 'groupAndPlay'));
  assert.equal(musicEn.category, 'Music scene');
  assert.equal(musicEn.actions.find((a) => a.id === 'groupAndPlay').label, 'Start music in a group');
  // The categories keep their order regardless of how they are spelled.
  assert.deepEqual(
    english.map((group) => group.actions[0].id),
    danish.map((group) => group.actions[0].id),
  );
});

test('conditions are rendered in the active language', () => {
  setLanguage('en');
  const catalogue = conditionCatalogue();
  assert.equal(catalogue.find((entry) => entry.id === 'isPlaying').label, 'The speaker is playing');
  assert.equal(catalogue.find((entry) => entry.id === 'isPlaying').params[0].label, 'Speaker');
});

test('step and target descriptions follow the language', () => {
  const step = {
    action: 'groupAndPlay',
    params: { coordinator: 'Kitchen', source: { type: 'radio', value: 'City Radio' }, membersMode: 'all' },
  };
  setLanguage('da');
  assert.match(describeStep(step), /^Musikscene: "City Radio" på Kitchen \+ alle andre$/);
  assert.equal(describeTarget({ type: 'all', filter: 'playing' }), 'Alle højttalere (kun dem der spiller)');

  setLanguage('en');
  assert.match(describeStep(step), /^Music scene: "City Radio" on Kitchen \+ everyone else$/);
  assert.equal(describeTarget({ type: 'all', filter: 'playing' }), 'All speakers (only those playing)');
});

test('an unknown action still describes itself, in the right language', () => {
  setLanguage('en');
  assert.equal(describeStep({ action: 'nonesuch' }), 'Unknown action (nonesuch)');
  setLanguage('da');
  assert.equal(describeStep({ action: 'nonesuch' }), 'Ukendt handling (nonesuch)');
});

// ──────────────────────────────────────────────────────── nothing left hard-coded

test('no Danish is left hard-coded anywhere the user can see it', async () => {
  const fs = require('node:fs/promises');
  const path = require('node:path');
  const root = path.join(__dirname, '..');

  const files = [];
  const walk = async (dir) => {
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (entry.name.endsWith('.js')) files.push(full);
    }
  };
  await walk(path.join(root, 'src'));
  await walk(path.join(root, 'homebridge-ui'));

  // Two detectors, because Danish is not always spelled with æøå: the letters
  // catch most of it, and a short list of words that cannot be English catches
  // the rest ("Ny scene", "Fejl 500" — both of which slipped through once).
  const danishLetters = /['"`][^'"`]*[æøåÆØÅ]/;
  // The word list earns its keep: three Danish strings sat in soap.js for
  // months because none of them happened to contain æ, ø or å.
  const danishWords =
    /['"`][^'"`]*\b(fejl|kunne|findes|vælg|ingen|indeholder|gemt|slettet|hentet|scener|scene[nr]|handling|trin|ny scene|afbrudt|mistede|forbindelsen?|svaret|blev|hvis|ikke|indstillinger)\b/i;

  // The dictionaries are the point, and the preset holds the user's own room
  // and scene names.
  const exempt = new Set(['src/i18n/da.js', 'src/i18n/en.js']);
  const offenders = [];
  for (const file of files) {
    const relative = path.relative(root, file).split(path.sep).join('/');
    if (exempt.has(relative)) continue;
    const source = await fs.readFile(file, 'utf8');
    source.split('\n').forEach((line, index) => {
      // Crude comment stripping: enough, because these files put their prose in
      // block comments and their strings on their own lines.
      const code = line.replace(/^\s*(\/\/|\*|\/\*).*$/, '');
      if (!danishLetters.test(code) && !danishWords.test(code)) return;
      offenders.push(`${relative}:${index + 1} ${line.trim()}`);
    });
  }
  assert.deepEqual(offenders, [], `hard-coded Danish:\n${offenders.join('\n')}`);
});
