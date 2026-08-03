'use strict';

const da = require('./da');
const en = require('./en');

/**
 * Translation.
 *
 * Two dictionaries, flat string keys, `{name}` placeholders. Danish is the
 * house language and English is the fallback, so a key that only exists in one
 * of them still renders something readable rather than a raw key.
 *
 * Everything the user can see goes through here: the settings UI, the action
 * catalogue, log lines and error messages.
 */

const LANGUAGES = { da, en };
const DEFAULT_LANGUAGE = 'en';

/** The languages a user can pick, in the order the picker shows them. */
const AVAILABLE = [
  { code: 'auto', labelKey: 'settings.language.auto' },
  { code: 'da', label: 'Dansk' },
  { code: 'en', label: 'English' },
];

/**
 * Turn a configured value into a real language code.
 *
 * Three cases, deliberately distinct:
 *
 *   nothing set   follow the machine's locale, the same as 'auto'. Somebody
 *                 who has never opened the settings gets their own language
 *                 where we have it, and English where we do not.
 *   'auto'        the same thing, asked for explicitly.
 *   'da' / 'en'   precisely that.
 *
 * @param {string} [configured]
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {'da'|'en'}
 */
function resolveLanguage(configured, env = process.env) {
  if (configured && LANGUAGES[configured]) return configured;
  if (configured && configured !== 'auto') {
    // An unknown code is a typo, not a request for a language we do not have.
    return DEFAULT_LANGUAGE;
  }

  const candidates = [env.LC_ALL, env.LC_MESSAGES, env.LANG, env.LANGUAGE];
  for (const candidate of candidates) {
    if (!candidate) continue;
    const code = String(candidate).toLowerCase().split(/[._-]/)[0];
    if (LANGUAGES[code]) return code;
  }

  try {
    const resolved = Intl.DateTimeFormat().resolvedOptions().locale || '';
    const code = resolved.toLowerCase().split('-')[0];
    if (LANGUAGES[code]) return code;
  } catch {
    /* no Intl data — fall through */
  }
  return 'en';
}

function interpolate(template, params) {
  if (!params) return template;
  return String(template).replace(/\{(\w+)\}/g, (match, key) =>
    params[key] === undefined || params[key] === null ? match : String(params[key]),
  );
}

/**
 * Build a translator.
 * @param {string} [language] A code, or `auto`.
 * @returns {((key: string, params?: object) => string) & {language: string, dictionary: object}}
 */
function createTranslator(language) {
  const code = resolveLanguage(language);
  const dictionary = LANGUAGES[code];
  const fallback = LANGUAGES.en;

  const translate = (key, params) => {
    const template = dictionary[key] ?? fallback[key] ?? key;
    return interpolate(template, params);
  };
  translate.language = code;
  translate.dictionary = dictionary;
  return translate;
}

/** The full dictionary for one language, for shipping to the browser. */
function dictionaryFor(language) {
  const code = resolveLanguage(language);
  // Fill any gap from English so the UI never shows a bare key.
  return { ...LANGUAGES.en, ...LANGUAGES[code] };
}

/**
 * The ambient translator.
 *
 * One plugin instance speaks one language, chosen once at startup, so threading
 * a translator through every function signature would be ceremony without
 * benefit — and would have to reach into places (a thrown Error deep inside an
 * action) that have no business knowing about configuration. Modules simply
 * `require('../i18n').t`; the platform sets the language before anything runs.
 */
let active = createTranslator();

/** @param {string} [language] `auto`, `da` or `en`. @returns {string} the resolved code. */
function setLanguage(language) {
  active = createTranslator(language);
  return active.language;
}

/** Translate. @param {string} key @param {object} [params] */
function t(key, params) {
  return active(key, params);
}

/** The language currently in force. */
function currentLanguage() {
  return active.language;
}

/**
 * Pick the first key that exists, and translate it.
 *
 * Lets a caller say "the label for this action's `volume` parameter, or the
 * generic one" without every action needing its own copy of "Volume".
 *
 * @param {string[]} keys
 * @param {object} [params]
 * @returns {string} the first hit, or '' if none of them exist.
 */
function tFirst(keys, params) {
  for (const key of keys) {
    if (!key) continue;
    if (active.dictionary[key] !== undefined || LANGUAGES.en[key] !== undefined) {
      return active(key, params);
    }
  }
  return '';
}

/** Does a key exist in either the active language or the English fallback? */
function has(key) {
  return active.dictionary[key] !== undefined || LANGUAGES.en[key] !== undefined;
}

module.exports = {
  LANGUAGES,
  AVAILABLE,
  DEFAULT_LANGUAGE,
  createTranslator,
  resolveLanguage,
  dictionaryFor,
  interpolate,
  setLanguage,
  currentLanguage,
  t,
  tFirst,
  has,
};
