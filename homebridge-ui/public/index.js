/* global homebridge */
'use strict';

/**
 * Sonos Control Pro — settings UI.
 *
 * Everything the user needs is here: build scenes from live speaker names,
 * test them without leaving the page, and see exactly when each step fires.
 * There is never a reason to open a config file or dig a room name out of a log.
 */

// ---------------------------------------------------------------- state

const state = {
  connected: false,
  /** The active language and its full dictionary, both shipped by the server. */
  language: 'da',
  languages: [],
  dictionary: {},
  configuredLanguage: '',
  status: null,
  scenes: [],
  players: [],
  groups: [],
  library: { favorites: [], playlists: [], radio: [] },
  actions: [],
  conditions: [],
  targetTypes: [],
  filters: [],
  presets: [],
  offlineReason: '',
  recentlyAdded: [],
  sceneFilter: '',
  libraryFilter: '',
  editing: null, // working copy of the scene in the drawer
  editingOriginal: '',
  openStepId: null,
  runningScenes: new Set(),
};

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

// ---------------------------------------------------------------- language

/**
 * Translate.
 *
 * The dictionary is the plugin's own, shipped whole on every bootstrap, so the
 * browser and the bridge can never disagree about what a thing is called.
 * Before the first bootstrap answers, the markup's own Danish stands in.
 *
 * @param {string} key
 * @param {object} [params] `{name}` placeholders
 */
function t(key, params) {
  const template = state.dictionary[key];
  if (template === undefined) return key;
  if (!params) return template;
  return String(template).replace(/\{(\w+)\}/g, (match, name) =>
    params[name] === undefined || params[name] === null ? match : String(params[name]),
  );
}

/** Plural-aware helper: one key for the singular, one for everything else. */
function tn(count, oneKey, manyKey, params) {
  return t(count === 1 ? oneKey : manyKey, { ...params, count });
}

/** Push the dictionary into the static markup. */
function applyStaticText() {
  if (!Object.keys(state.dictionary).length) return;
  $$('[data-i18n]').forEach((node) => {
    node.textContent = t(node.dataset.i18n);
  });
  $$('[data-i18n-ph]').forEach((node) => {
    node.placeholder = t(node.dataset.i18nPh);
  });
  $$('[data-i18n-title]').forEach((node) => {
    node.title = t(node.dataset.i18nTitle);
  });
  $$('[data-i18n-aria]').forEach((node) => {
    node.setAttribute('aria-label', t(node.dataset.i18nAria));
  });
  document.documentElement.lang = state.language;
}

/** The language picker in the header. */
function renderLanguagePicker() {
  const picker = $('#lang-picker');
  if (!picker || !state.languages.length) return;
  // With nothing configured, show what is actually being spoken rather than
  // pre-selecting "auto" — which would be a claim the plugin does not make.
  const selected = state.configuredLanguage || state.language;
  picker.innerHTML = state.languages
    .map(
      (entry) =>
        `<option value="${entry.code}" ${entry.code === selected ? 'selected' : ''}>${escapeHtml(
          entry.label || t(entry.labelKey),
        )}</option>`,
    )
    .join('');
}

/**
 * Switch language.
 *
 * Written into the plugin's own config so the choice also applies to the
 * Homebridge log the next time the bridge starts — one setting, not two.
 */
async function changeLanguage(code) {
  state.configuredLanguage = code;
  // The bridge is a separate process with its own translator. Without this it
  // would keep describing steps, naming triggers and reporting errors in the
  // language it started in, until Homebridge was restarted.
  await api('POST', '/language', { language: code }, { silent: true }).catch(() => {});
  try {
    const configs = await homebridge.getPluginConfig();
    // An empty list means the platform is not in config.json at all. Writing
    // one from a language picker would quietly configure the plugin, which is
    // not what pressing this asked for — switch the page and leave it there.
    if (configs?.length) {
      const [config, ...rest] = configs;
      await homebridge.updatePluginConfig([{ ...config, language: code }, ...rest]);
      await homebridge.savePluginConfig();
    }
  } catch {
    // Not being able to persist it must not stop the UI from switching.
  }
  await bootstrap({ quiet: true });
  toast(t('settings.languageChanged'), 'success', 2500);
}

// ---------------------------------------------------------------- helpers

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function uid() {
  return (crypto.randomUUID ? crypto.randomUUID() : `id-${Math.random().toString(36).slice(2)}${Date.now()}`);
}

/**
 * A transient message in the corner.
 *
 * @param {string} message
 * @param {'info'|'success'|'error'|'warn'} [kind]
 * @param {number} [ttl]
 * @param {{label: string, onClick: () => void}} [action] An inline button —
 *   this is what turns "deleted" into "deleted, unless you say otherwise".
 */
function toast(message, kind = 'info', ttl = 4200, action = null) {
  const host = $('#toasts');
  // Three at a time is plenty; beyond that they cover what you are looking at.
  // A toast carrying an action is the exception: culling it would withdraw an
  // offer already made — "you can undo afterwards" has to stay true.
  while (host.children.length >= 3) {
    const expendable = [...host.children].find((node) => !node.querySelector('.sf-toast-action'));
    (expendable || host.firstElementChild).remove();
  }
  const node = document.createElement('div');
  node.className = `sf-toast ${kind === 'success' ? 'is-good' : kind === 'error' ? 'is-bad' : kind === 'warn' ? 'is-warn' : ''}`;
  const text = document.createElement('span');
  text.textContent = message;
  node.append(text);

  let dismiss = null;
  const close = () => {
    clearTimeout(dismiss);
    node.style.transition = 'opacity .2s ease, transform .2s ease';
    node.style.opacity = '0';
    node.style.transform = 'translateY(6px)';
    setTimeout(() => node.remove(), 220);
  };

  if (action) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'sf-toast-action';
    button.textContent = action.label;
    button.addEventListener('click', () => {
      close();
      action.onClick();
    });
    node.append(button);
  }

  host.append(node);
  dismiss = setTimeout(close, ttl);
  return close;
}

/**
 * A confirmation the page draws itself.
 *
 * `window.confirm` inside a Homebridge iframe is a jarring browser chrome box
 * that says the wrong thing in the wrong language and cannot be styled. This
 * one matches the rest of the page and can be dismissed with Escape.
 *
 * @param {{title: string, body?: string, confirmLabel?: string, cancelLabel?: string, danger?: boolean}} options
 * @returns {Promise<boolean>}
 */
function confirmDialog({ title, body = '', confirmLabel, cancelLabel, danger = false } = {}) {
  return openDialog({ title, body, confirmLabel, cancelLabel, danger }).then((value) => value !== null);
}

/**
 * Ask for a number between 0 and 100, with a slider rather than a text box.
 * @returns {Promise<number|null>} null when cancelled.
 */
async function promptVolume({ title, body = '', value = 10 } = {}) {
  const extra = `
    <div class="sf-row" style="margin-top:14px;gap:12px">
      <input id="dialog-range" type="range" min="0" max="100" value="${value}" style="flex:1" />
      <span id="dialog-range-value" class="sf-volume-value">${value}%</span>
    </div>`;
  const result = await openDialog({
    title,
    body,
    extra,
    onOpen: (root) => {
      const range = root.querySelector('#dialog-range');
      const label = root.querySelector('#dialog-range-value');
      range.addEventListener('input', () => {
        label.textContent = `${range.value}%`;
      });
      range.focus();
    },
    read: (root) => Number(root.querySelector('#dialog-range').value),
  });
  return result;
}

/** @private The one dialog both helpers drive. Resolves null on cancel. */
function openDialog({ title, body = '', extra = '', confirmLabel, cancelLabel, danger = false, onOpen, read } = {}) {
  const backdrop = $('#dialog-backdrop');
  $('#dialog-title').textContent = title || t('dialog.confirm');
  const bodyNode = $('#dialog-body');
  bodyNode.textContent = body;
  bodyNode.classList.toggle('is-hidden', !body);
  $('#dialog-extra').innerHTML = extra;
  const confirm = $('#dialog-confirm');
  const cancel = $('#dialog-cancel');
  confirm.textContent = confirmLabel || t('dialog.ok');
  cancel.textContent = cancelLabel || t('common.cancel');
  confirm.classList.toggle('sf-btn--danger', danger);
  confirm.classList.toggle('sf-btn--primary', !danger);
  backdrop.classList.remove('is-hidden');
  onOpen?.(backdrop);
  if (!onOpen) confirm.focus();

  return new Promise((resolve) => {
    const finish = (value) => {
      backdrop.classList.add('is-hidden');
      confirm.removeEventListener('click', onConfirm);
      cancel.removeEventListener('click', onCancel);
      backdrop.removeEventListener('mousedown', onBackdrop);
      document.removeEventListener('keydown', onKey, true);
      resolve(value);
    };
    const onConfirm = () => finish(read ? read(backdrop) : true);
    const onCancel = () => finish(null);
    const onBackdrop = (event) => {
      if (event.target === backdrop) finish(null);
    };
    const onKey = (event) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        finish(null);
      }
      if (event.key === 'Enter' && event.target.tagName !== 'BUTTON') {
        event.preventDefault();
        onConfirm();
      }
    };
    confirm.addEventListener('click', onConfirm);
    cancel.addEventListener('click', onCancel);
    backdrop.addEventListener('mousedown', onBackdrop);
    document.addEventListener('keydown', onKey, true);
  });
}

/** Call the plugin's control API through the UI server. */
async function api(method, path, body, { silent = false } = {}) {
  try {
    return await homebridge.request('/call', { method, path, body });
  } catch (error) {
    const message = error?.message || String(error);
    if (!silent) toast(message, 'error', 6000);
    throw error;
  }
}

function fmtMs(ms) {
  if (!ms) return '0 s';
  if (ms < 1000) return `${ms} ms`;
  const seconds = ms / 1000;
  return `${seconds % 1 === 0 ? seconds : seconds.toFixed(1)} s`;
}

function fmtTime(iso) {
  if (!iso) return '';
  const date = typeof iso === 'number' ? new Date(iso) : new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const locale = state.language === 'da' ? 'da-DK' : 'en-GB';
  return date.toLocaleString(locale, { dateStyle: 'short', timeStyle: 'short' });
}

const ICONS = {
  music: '<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>',
  radio: '<circle cx="12" cy="12" r="2"/><path d="M4.9 19.1a10 10 0 0 1 0-14.2M19.1 4.9a10 10 0 0 1 0 14.2M7.8 16.2a6 6 0 0 1 0-8.4M16.2 7.8a6 6 0 0 1 0 8.4"/>',
  flame: '<path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"/>',
  pause: '<rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
  'volume-up': '<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07M19.07 4.93a10 10 0 0 1 0 14.14"/>',
  'volume-down': '<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/>',
  speaker: '<rect x="4" y="2" width="16" height="20" rx="2"/><circle cx="12" cy="14" r="4"/><circle cx="12" cy="6" r="1"/>',
  moon: '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  party: '<path d="M5.8 11.3 2 22l10.7-3.79"/><path d="M4 3h.01M22 8h.01M15 2h.01M22 20h.01"/><path d="m22 2-2.24.75a2.9 2.9 0 0 0-1.96 3.12v0c.1.86-.57 1.63-1.45 1.63h-.38c-.86 0-1.6.6-1.76 1.44L14 10"/><path d="m22 13-.82-.33c-.86-.34-1.82.2-1.98 1.11v0c-.11.7-.72 1.22-1.43 1.22H16"/><path d="M11 2 9.66 2.6a2 2 0 0 0-1.07 2.51v0c.2.58-.14 1.2-.73 1.35L7 6.7"/>',
  bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>',
  home: '<path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>',
};

const ICON_CHOICES = ['music', 'radio', 'flame', 'pause', 'link', 'volume-up', 'volume-down', 'speaker', 'moon', 'sun', 'party', 'bell', 'home'];

function icon(name, size = 18) {
  const body = ICONS[name] || ICONS.music;
  return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
}

/** Look up an action definition by id across all categories. */
function findAction(id) {
  for (const group of state.actions) {
    const match = group.actions.find((action) => action.id === id);
    if (match) return match;
  }
  return null;
}

function playerNames() {
  return state.players.map((player) => player.name);
}

/** True when a scene references a room the household no longer has. */
function isKnownRoom(name) {
  if (!state.players.length) return true; // can't judge while offline
  return state.players.some((player) => player.name === name);
}

// ---------------------------------------------------------------- bootstrap

async function bootstrap({ quiet = false } = {}) {
  if (!quiet) homebridge.showSpinner();
  try {
    const data = await homebridge.request('/bootstrap', { language: state.configuredLanguage });
    state.dictionary = data.dictionary || state.dictionary;
    state.language = data.language || state.language;
    state.languages = data.languages || state.languages;
    state.connected = data.connected;
    state.status = data.status;
    state.scenes = data.scenes || [];
    state.players = data.players || [];
    state.groups = data.groups || [];
    state.library = data.library || { favorites: [], playlists: [], radio: [] };
    state.actions = data.actions || [];
    state.conditions = data.conditions || [];
    state.targetTypes = data.targetTypes || [];
    state.filters = data.filters || [];
    state.presets = data.presets || [];
    state.offlineReason = data.offlineReason || '';
    state.runningScenes = new Set(data.status?.running || []);
    state.recentlyAdded = data.status?.recentlyAdded || [];
    applyStaticText();
    renderLanguagePicker();
    renderAll();
  } catch (error) {
    toast(error.message, 'error', 8000);
  } finally {
    if (!quiet) homebridge.hideSpinner();
  }
}

function renderAll() {
  renderStatus();
  renderScenes();
  renderPlayers();
  renderLibrary();
  renderPresets();
  // An open drawer is part of the page too: switching language while editing
  // must translate the drawer, not leave half of it behind.
  if (state.editing) {
    $('#editor-title').textContent = state.editing.name || t('ui.editor.newTitle');
    renderEditor();
  }
  homebridge.fixScrollHeight?.();
}

function renderStatus() {
  const pill = $('#status-pill');
  const banner = $('#offline-banner');
  if (state.connected && state.status) {
    const count = state.status.playerCount || 0;
    const sceneCount = state.scenes.length;
    pill.className = count > 0 ? 'sf-pill sf-pill--good' : 'sf-pill sf-pill--warn';
    pill.textContent =
      count > 0
        ? tn(sceneCount, 'ui.status.summaryOneScene', 'ui.status.summary', {
            players: count,
            scenes: sceneCount,
          })
        : t('ui.status.noPlayers');
    banner.classList.add('is-hidden');
  } else {
    pill.className = 'sf-pill sf-pill--warn';
    pill.textContent = t('ui.status.bridgeDown');
    banner.textContent = state.offlineReason || t('ui.status.offline');
    banner.classList.remove('is-hidden');
  }
}

// ---------------------------------------------------------------- scenes

function renderScenes() {
  const list = $('#scene-list');
  const empty = $('#scene-empty');
  const filter = state.sceneFilter.trim().toLowerCase();
  const scenes = state.scenes.filter(
    (scene) =>
      !filter ||
      scene.name.toLowerCase().includes(filter) ||
      (scene.description || '').toLowerCase().includes(filter),
  );

  if (state.scenes.length === 0) {
    list.innerHTML = '';
    empty.classList.remove('is-hidden');
    return;
  }
  empty.classList.add('is-hidden');

  list.innerHTML = scenes
    .map((scene) => {
      const stepCount = (scene.steps || []).length + (scene.elseSteps || []).length;
      const badges = [];
      badges.push(
        scene.switchType === 'stateful'
          ? `<span class="sf-pill sf-pill--accent">${escapeHtml(t('ui.scenes.stateful'))}</span>`
          : `<span class="sf-pill sf-pill--muted">${escapeHtml(t('ui.scenes.momentary'))}</span>`,
      );
      if (scene.condition && scene.condition.type !== 'always') {
        badges.push(`<span class="sf-pill sf-pill--muted">${escapeHtml(t('ui.scenes.conditional'))}</span>`);
      }
      if (state.runningScenes.has(scene.id)) {
        badges.push(`<span class="sf-pill sf-pill--accent">${escapeHtml(t('ui.scenes.running'))}</span>`);
      }
      const missing = collectMissingRooms(scene);
      if (missing.length) {
        badges.push(
          `<span class="sf-pill sf-pill--danger" title="${escapeHtml(missing.join(', '))}">${escapeHtml(
            tn(missing.length, 'ui.scenes.unknownRoomsOne', 'ui.scenes.unknownRooms'),
          )}</span>`,
        );
      }

      return `
      <article class="sf-scene ${scene.enabled ? '' : 'is-disabled'} ${state.runningScenes.has(scene.id) ? 'is-running' : ''}"
               data-id="${scene.id}" draggable="true">
        <span class="sf-drag" title="${escapeHtml(t('ui.scenes.dragHint'))}">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><circle cx="9" cy="6" r="1.6"/><circle cx="15" cy="6" r="1.6"/><circle cx="9" cy="12" r="1.6"/><circle cx="15" cy="12" r="1.6"/><circle cx="9" cy="18" r="1.6"/><circle cx="15" cy="18" r="1.6"/></svg>
        </span>
        <span class="sf-scene-icon">${icon(scene.icon, 20)}</span>
        <div class="sf-scene-body">
          <div class="sf-scene-title">
            <h3>${escapeHtml(scene.name)}</h3>
            ${badges.join('')}
          </div>
          <p class="sf-scene-desc" title="${escapeHtml(scene.description || '')}">${sceneSummary(scene)
            .map((part) => `<span class="sf-seg">${escapeHtml(part)}</span>`)
            .join('<span class="sf-sep">·</span>')}</p>
        </div>
        <div class="sf-scene-actions">
          <button class="sf-btn sf-btn--ghost sf-btn--sm" data-act="run" data-id="${scene.id}" ${state.connected ? '' : 'disabled'}>${escapeHtml(t('common.run'))}</button>
          <button class="sf-btn sf-btn--ghost sf-btn--sm" data-act="edit" data-id="${scene.id}">${escapeHtml(t('common.edit'))}</button>
          <button class="sf-btn sf-btn--icon" data-act="duplicate" data-id="${scene.id}" title="${escapeHtml(t('common.duplicate'))}">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
          </button>
          <button class="sf-btn sf-btn--icon" data-act="delete" data-id="${scene.id}" title="${escapeHtml(t('common.delete'))}">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>
          </button>
          <label class="sf-switch" title="${escapeHtml(t(scene.enabled ? 'ui.scenes.disable' : 'ui.scenes.enable'))}">
            <input type="checkbox" data-act="toggle" data-id="${scene.id}" ${scene.enabled ? 'checked' : ''} />
            <span></span>
          </label>
        </div>
      </article>`;
    })
    .join('');

  wireSceneDrag(list);
}

function collectMissingRooms(scene) {
  if (!state.players.length) return [];
  const names = new Set();
  const visit = (steps) => {
    for (const step of steps || []) {
      for (const name of step.target?.names || []) names.add(name);
      if (step.target?.coordinator) names.add(step.target.coordinator);
      const params = step.params || {};
      if (params.coordinator) names.add(params.coordinator);
      if (params.player) names.add(params.player);
      for (const name of params.members || []) names.add(name);
      for (const name of params.leave || []) names.add(name);
      for (const name of Object.keys(params.volumes || {})) names.add(name);
    }
  };
  visit(scene.steps);
  visit(scene.elseSteps);
  visit(scene.offSteps);
  if (scene.condition?.params?.player) names.add(scene.condition.params.player);
  return [...names].filter((name) => name && !isKnownRoom(name));
}

/** Trim a title so one long playlist name cannot push the card off-screen. */
function short(value, max = 26) {
  const text = String(value || '');
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/**
 * A live, compact summary of what a scene actually does.
 *
 * Generated from the steps rather than stored as text, so editing a scene
 * updates the list immediately and the description can never drift out of
 * step with the configuration.
 *
 * @returns {string[]} short segments, joined with a dot in the UI
 */
function sceneSummary(scene) {
  const steps = (scene.steps || []).filter((step) => step.enabled !== false);
  if (steps.length === 0) return [t('ui.scenes.noSteps')];

  const parts = [];
  for (const step of steps) {
    const params = step.params || {};

    if (step.action === 'groupAndPlay') {
      const source = params.source || {};
      if (source.type && source.type !== 'keep' && source.value) parts.push(`♪ ${short(source.value)}`);
      parts.push(`→ ${params.coordinator || t('common.notChosen')}`);
      if ((params.membersMode || 'all') === 'all') {
        parts.push(`+ ${t('common.all')}`);
      } else if ((params.members || []).length) {
        parts.push(`+ ${tn(params.members.length, 'common.roomsOne', 'common.rooms')}`);
      }
      if ((params.leave || []).length) {
        // A truncated list ("Stue, Garage Soundboks, Kon…") tells you less than
        // a count does, so past a certain length just say how many.
        const joined = params.leave.join(', ');
        parts.push(
          t('describe.minus', {
            names: joined.length <= 30 ? joined : tn(params.leave.length, 'common.roomsOne', 'common.rooms'),
          }),
        );
      }
      if (params.shuffle === true) parts.push(t('action.setShuffle.label').toLowerCase());
      continue;
    }

    if (step.action === 'adjustVolume') {
      const delta = Number(params.delta);
      parts.push(`${delta > 0 ? '+' : ''}${delta} %`);
      parts.push(targetSummary(step.target));
      continue;
    }

    if (step.action === 'setVolume') {
      parts.push(`${params.volume} %`);
      parts.push(targetSummary(step.target));
      continue;
    }

    if (step.action === 'joinGroup') {
      const who = (step.target?.names || []).join(', ');
      parts.push(`${short(who, 24) || t('target.players')} → ${params.coordinator || t('common.dash')}`);
      continue;
    }

    const definition = findAction(step.action);
    parts.push(definition ? definition.label : step.action);
    const target = targetSummary(step.target);
    if (target && definition?.targets !== 'none') parts.push(target);
  }

  // Repeated segments across steps read as noise; one of each is enough.
  return parts.filter(Boolean).filter((part, index, all) => all.indexOf(part) === index);
}

/** The shortest honest way to say which speakers a step touches. */
function targetSummary(target) {
  if (!target) return t('common.all');
  const filterKey = {
    playing: 'target.describe.onlyPlaying',
    notPlaying: 'target.describe.onlySilent',
    coordinators: 'target.describe.onlyLeaders',
  }[target.filter];
  const names = target.names || [];
  const joined = names.join(', ');
  switch (target.type) {
    case 'players':
      if (names.length === 0) return t('common.notChosen');
      return joined.length <= 30 ? joined : tn(names.length, 'common.roomsOne', 'common.rooms');
    case 'allExcept':
      return t('target.describe.allExcept', {
        names: joined.length <= 24 ? joined : tn(names.length, 'common.roomsOne', 'common.rooms'),
      });
    case 'group':
      return t('target.describe.group', { name: target.coordinator || t('common.dash') });
    case 'coordinator':
      return t('target.describe.coordinator', { name: target.coordinator || t('common.dash') });
    default:
      return filterKey ? t(filterKey) : t('common.all');
  }
}

function wireSceneDrag(list) {
  // Same story as the drawer: the container outlives every repaint.
  if (list.dataset.wired) return;
  list.dataset.wired = '1';
  let dragged = null;
  let fromHandle = false;
  list.addEventListener('mousedown', (event) => {
    fromHandle = Boolean(event.target.closest('.sf-drag'));
  });
  list.addEventListener('mouseup', () => {
    fromHandle = false;
  });
  list.addEventListener('dragstart', (event) => {
    const card = event.target.closest('.sf-scene');
    if (!card) return;
    if (!fromHandle) {
      event.preventDefault();
      return;
    }
    dragged = card;
    card.classList.add('is-dragging');
    event.dataTransfer.effectAllowed = 'move';
  });
  list.addEventListener('dragend', () => {
    dragged?.classList.remove('is-dragging');
    $$('.sf-scene', list).forEach((card) => card.classList.remove('is-drop-target'));
    dragged = null;
    fromHandle = false;
  });
  list.addEventListener('dragover', (event) => {
    event.preventDefault();
    const card = event.target.closest('.sf-scene');
    if (!card || card === dragged) return;
    $$('.sf-scene', list).forEach((node) => node.classList.remove('is-drop-target'));
    card.classList.add('is-drop-target');
  });
  list.addEventListener('drop', async (event) => {
    event.preventDefault();
    const card = event.target.closest('.sf-scene');
    if (!card || !dragged || card === dragged) return;
    const rect = card.getBoundingClientRect();
    const after = event.clientY > rect.top + rect.height / 2;
    card.parentNode.insertBefore(dragged, after ? card.nextSibling : card);
    const ids = $$('.sf-scene', list).map((node) => node.dataset.id);
    const byId = new Map(state.scenes.map((scene) => [scene.id, scene]));
    state.scenes = ids.map((id) => byId.get(id)).filter(Boolean);
    await api('POST', '/scenes/reorder', { ids });
    renderScenes();
  });
}

// ---------------------------------------------------------------- players

/**
 * Rooms that no music scene gives a level to.
 *
 * Derived from what is currently on screen rather than from a server snapshot,
 * so loading a preset or saving a scene updates it immediately.
 */
function unconfiguredPlayers() {
  const known = new Set();
  for (const scene of state.scenes) {
    for (const list of ['steps', 'elseSteps', 'offSteps']) {
      for (const step of scene[list] || []) {
        for (const name of Object.keys(step.params?.volumes || {})) known.add(name);
        for (const name of step.params?.members || []) known.add(name);
        for (const name of step.params?.leave || []) known.add(name);
        for (const name of step.params?.coordinator ? [step.params.coordinator] : []) known.add(name);
        for (const name of step.target?.names || []) known.add(name);
      }
    }
  }
  return playerNames().filter((name) => !known.has(name));
}

/**
 * Re-read just the speakers.
 *
 * Cheaper than a full bootstrap and it leaves the rest of the page alone, so
 * the live view can update often without anything else flickering.
 */
async function refreshPlayers() {
  if (!state.connected) return;
  try {
    const data = await api('GET', '/players?state=1', undefined, { silent: true });
    state.players = data.players || [];
    state.groups = data.groups || [];
    renderPlayers();
    renderStatus();
  } catch {
    /* a dropped poll is not worth telling anyone about */
  }
}

function renderNewPlayers() {
  const host = $('#new-players');
  if (!host) return;
  const pending = unconfiguredPlayers();

  if (pending.length === 0) {
    host.innerHTML = state.recentlyAdded.length
      ? `<div class="sf-banner sf-banner--ok">${escapeHtml(
          t('ui.newPlayers.recent', {
            names: state.recentlyAdded.map((entry) => entry.name).join(', '),
          }),
        )}</div>`
      : '';
    return;
  }

  host.innerHTML = `
    <div class="sf-card">
      <div class="sf-card-head">
        <div>
          <h2>${escapeHtml(t('ui.newPlayers.title'))} <span class="sf-pill sf-pill--accent">${pending.length}</span></h2>
          <p class="sf-help">${escapeHtml(t('ui.newPlayers.body'))}</p>
        </div>
      </div>
      <div class="sf-card-body">
        <div class="sf-chips" style="margin-bottom:12px">
          ${pending.map((name) => `<span class="sf-chip is-on">${escapeHtml(name)}</span>`).join('')}
        </div>
        <div class="sf-row sf-row--wrap">
          <label class="sf-row" style="gap:8px">
            <span class="sf-hint">${escapeHtml(t('ui.newPlayers.volume'))}</span>
            <input id="adopt-volume" type="range" min="0" max="100" value="12" style="width:160px" />
            <span class="sf-volume-value" id="adopt-volume-value">12%</span>
          </label>
          <button class="sf-btn sf-btn--primary" data-act="adopt-players" type="button">
            ${escapeHtml(t('ui.newPlayers.add'))}
          </button>
        </div>
      </div>
    </div>`;
}

function renderPlayers() {
  const grid = $('#player-grid');
  const summary = $('#sonos-summary');
  const groupMap = $('#group-map');
  renderNewPlayers();

  const manual = $('#manual-ips');

  if (!state.players.length) {
    grid.innerHTML = '';
    groupMap.innerHTML = '';
    summary.textContent = t(state.connected ? 'ui.sonos.noneFound' : 'ui.sonos.noneOffline');
    // Nothing was found: this is the one moment the address box is the answer,
    // so open it rather than leaving it folded away under everything.
    if (manual && state.connected) manual.open = true;
    return;
  }

  // Found some — fold it back, unless addresses are how they were found.
  if (manual && !state.playerIps) manual.open = false;

  summary.textContent =
    state.groups.length === 1
      ? t('ui.sonos.summaryOneGroup', { players: state.players.length })
      : t('ui.sonos.summary', { players: state.players.length, groups: state.groups.length });

  grid.innerHTML = state.players
    .map((player) => {
      const playing = player.playing ?? (player.state === 'PLAYING' || player.state === 'TRANSITIONING');
      const grouped = player.coordinatorName && player.coordinatorName !== player.name;
      const track = player.nowPlaying
        ? [player.nowPlaying.title, player.nowPlaying.artist].filter(Boolean).join(' · ')
        : '';
      return `
      <article class="sf-player" data-name="${escapeHtml(player.name)}">
        <div class="sf-player-head">
          <div>
            <p class="sf-player-name">${escapeHtml(player.name)}</p>
            <p class="sf-player-meta">${escapeHtml(player.model || 'Sonos')}${
              grouped ? ` · ${escapeHtml(t('ui.sonos.follows', { name: player.coordinatorName }))}` : ''
            }</p>
          </div>
          <span class="sf-pill sf-pill--sm ${playing ? 'sf-pill--good' : 'sf-pill--muted'}">${escapeHtml(
            t(playing ? 'ui.sonos.playing' : 'ui.sonos.notPlaying'),
          )}</span>
        </div>
        ${track ? `<p class="sf-player-track" title="${escapeHtml(track)}">${escapeHtml(track)}</p>` : ''}
        <div class="sf-player-controls">
          <button class="sf-btn sf-btn--icon" data-act="player-toggle" data-name="${escapeHtml(player.name)}" title="${escapeHtml(
            t(playing ? 'ui.sonos.pauseGroup' : 'ui.sonos.play'),
          )}">
            ${playing
              ? '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/></svg>'
              : '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>'}
          </button>
          <input class="sf-volume" type="range" min="0" max="100" value="${player.volume ?? 0}"
                 data-act="player-volume" data-name="${escapeHtml(player.name)}" />
          <span class="sf-volume-value">${player.volume ?? '–'}%</span>
        </div>
      </article>`;
    })
    .join('');

  groupMap.innerHTML = state.groups
    .filter((group) => group.memberNames.length > 1)
    .map(
      (group) => `
      <div class="sf-group">
        <h4>${escapeHtml(t('ui.sonos.groupAround', { name: group.coordinatorName }))}</h4>
        <div class="sf-chips">${group.memberNames
          .map(
            (name) =>
              `<span class="sf-chip ${name === group.coordinatorName ? 'is-leader' : ''} sf-chip--mini">${escapeHtml(name)}</span>`,
          )
          .join('')}</div>
      </div>`,
    )
    .join('');
}

// ---------------------------------------------------------------- library

function renderLibrary() {
  const container = $('#library-content');
  const filter = state.libraryFilter.trim().toLowerCase();
  const sections = [
    { key: 'favorites', title: t('ui.library.favorites'), help: t('ui.library.favoritesHelp') },
    { key: 'playlists', title: t('ui.library.playlists'), help: t('ui.library.playlistsHelp') },
    { key: 'radio', title: t('ui.library.radio'), help: t('ui.library.radioHelp') },
  ];

  const html = sections
    .map((section) => {
      const items = (state.library[section.key] || []).filter(
        (item) => !filter || item.title.toLowerCase().includes(filter),
      );
      return `
      <div class="sf-card">
        <div class="sf-card-head">
          <div>
            <h2>${escapeHtml(section.title)} <span class="sf-pill sf-pill--muted">${items.length}</span></h2>
            <p class="sf-help">${escapeHtml(section.help)}</p>
          </div>
        </div>
        <div class="sf-card-body">
          ${items.length === 0
            ? `<p class="sf-help">${escapeHtml(t(filter ? 'ui.library.noMatches' : 'ui.library.empty'))}</p>`
            : `<div class="sf-lib-items">${items
                .map(
                  (item) => `
              <div class="sf-lib-item">
                <div class="sf-lib-art">
                  ${icon('music', 16)}
                  ${item.albumArt
                    ? `<img src="${escapeHtml(item.albumArt)}" alt="" loading="lazy" onerror="this.remove()" />`
                    : ''}
                </div>
                <div class="sf-lib-text">
                  <strong title="${escapeHtml(item.title)}">${escapeHtml(item.title)}</strong>
                  <small>${escapeHtml(item.description || t(item.isContainer ? 'ui.library.list' : 'ui.library.stream'))}</small>
                </div>
              </div>`,
                )
                .join('')}</div>`}
        </div>
      </div>`;
    })
    .join('');

  container.innerHTML = html;
}

// ---------------------------------------------------------------- presets

function renderPresets() {
  const container = $('#preset-cards');
  container.innerHTML = state.presets
    .map(
      (preset) => `
    <div class="sf-card">
      <div class="sf-card-head">
        <div>
          <h2>${escapeHtml(preset.name)}</h2>
          <p class="sf-help">${escapeHtml(preset.description)}</p>
        </div>
        <span class="sf-pill sf-pill--accent">${escapeHtml(
          tn(preset.sceneCount, 'ui.tools.scenesCountOne', 'ui.tools.scenesCount'),
        )}</span>
      </div>
      <div class="sf-card-body">
        <div class="sf-chips" style="margin-bottom:14px">
          ${preset.sceneNames.map((name) => `<span class="sf-chip sf-chip--mini">${escapeHtml(name)}</span>`).join('')}
        </div>
        <div class="sf-row sf-row--wrap">
          <button class="sf-btn sf-btn--primary" data-act="preset-apply" data-id="${preset.id}" data-mode="replace">
            ${escapeHtml(t('ui.tools.presetReplace'))}
          </button>
          <button class="sf-btn sf-btn--ghost" data-act="preset-apply" data-id="${preset.id}" data-mode="merge">
            ${escapeHtml(t('ui.tools.presetMerge'))}
          </button>
        </div>
      </div>
    </div>`,
    )
    .join('');
}

// ---------------------------------------------------------------- editor

function blankScene() {
  return {
    id: uid(),
    name: t('ui.editor.newTitle'),
    description: '',
    icon: 'music',
    enabled: true,
    switchType: 'momentary',
    autoOffMs: 1000,
    mode: 'parallel',
    condition: { type: 'always', params: {} },
    steps: [],
    elseSteps: [],
    offSteps: [],
  };
}

function blankStep(action = 'groupAndPlay') {
  const definition = findAction(action);
  const params = {};
  for (const param of definition?.params || []) {
    if (param.default !== undefined) params[param.key] = structuredClone(param.default);
  }
  return {
    id: uid(),
    action,
    enabled: true,
    delayMs: 0,
    target: { type: 'all', names: [], coordinator: '', filter: 'any' },
    params,
  };
}

function openEditor(scene) {
  state.editing = structuredClone(scene);
  state.editingOriginal = JSON.stringify(state.editing);
  state.openStepId = state.editing.steps?.[0]?.id || null;
  $('#editor-title').textContent = scene.name || t('ui.editor.newTitle');
  $('#editor-backdrop').classList.remove('is-hidden');
  document.body.style.overflow = 'hidden';
  renderEditor();
  // The drawer body is reused across openings, so reset where we are looking.
  $('#editor-body').scrollTop = 0;
}

async function closeEditor({ force = false } = {}) {
  if (!force && state.editing && JSON.stringify(state.editing) !== state.editingOriginal) {
    const ok = await confirmDialog({
      title: t('ui.editor.confirmClose'),
      body: t('ui.editor.confirmCloseBody'),
      confirmLabel: t('common.close'),
      danger: true,
    });
    if (!ok) return;
  }
  state.editing = null;
  $('#editor-backdrop').classList.add('is-hidden');
  document.body.style.overflow = '';
}

function markDirty() {
  const dirty = state.editing && JSON.stringify(state.editing) !== state.editingOriginal;
  $('#editor-dirty').textContent = dirty ? t('ui.editor.unsaved') : '';
  const stepCount = (state.editing?.steps || []).length;
  $('#editor-subtitle').textContent = state.editing
    ? tn(stepCount, 'ui.editor.subtitleOne', 'ui.editor.subtitle', {
        steps: stepCount,
        type: t(state.editing.switchType === 'stateful' ? 'ui.editor.typeStateful' : 'ui.editor.typeMomentary'),
      })
    : '';
}

/**
 * What is stopping this scene from working?
 *
 * Checked as you type rather than when you press save, so a half-finished music
 * scene says so on the spot instead of failing at the speaker later.
 *
 * @param {object} step
 * @returns {string[]} human-readable problems, empty when the step is sound
 */
function stepProblems(step) {
  const problems = [];
  const params = step.params || {};
  if (step.action === 'groupAndPlay') {
    if (!params.coordinator) problems.push(t('ui.editor.needsLeader'));
    const source = params.source || {};
    if (source.type && source.type !== 'keep' && !source.value) problems.push(t('ui.editor.needsSource'));
    if ((params.membersMode || 'all') === 'list' && (params.members || []).length === 0) {
      problems.push(t('ui.editor.needsSpeakers'));
    }
    return problems;
  }
  const definition = findAction(step.action);
  for (const param of definition?.params || []) {
    if (!param.required) continue;
    const value = params[param.key];
    if (value === undefined || value === null || value === '' || (Array.isArray(value) && !value.length)) {
      problems.push(`${param.label}: ${t('common.notChosen')}`);
    }
  }
  if (definition && definition.targets === 'multi' && step.target?.type === 'players' && !(step.target.names || []).length) {
    problems.push(t('ui.editor.needsSpeakers'));
  }
  return problems;
}

/** A small inline warning strip. */
function warnings(problems) {
  if (!problems.length) return '';
  return `<div class="sf-inline-warn">${problems
    .map((problem) => `<span>${escapeHtml(problem)}</span>`)
    .join('')}</div>`;
}

function renderEditor() {
  const scene = state.editing;
  if (!scene) return;
  const body = $('#editor-body');
  const hasCondition = scene.condition && scene.condition.type !== 'always';

  body.innerHTML = `
    <section class="sf-section">
      <div class="sf-box">
        <div class="sf-grid-2">
          <div class="sf-field">
            <label for="ed-name">${escapeHtml(t('ui.editor.name'))}</label>
            <input id="ed-name" class="sf-input" type="text" value="${escapeHtml(scene.name)}" />
            <small>${escapeHtml(t('ui.editor.nameHelp'))}</small>
          </div>
          <div class="sf-field">
            <label for="ed-icon">${escapeHtml(t('ui.editor.icon'))}</label>
            <div class="sf-chips" id="ed-icon">
              ${ICON_CHOICES.map(
                (name) =>
                  `<button type="button" class="sf-chip ${scene.icon === name ? 'is-on' : ''}" data-act="pick-icon" data-icon="${name}" title="${name}">${icon(name, 15)}</button>`,
              ).join('')}
            </div>
          </div>
        </div>
        <div class="sf-field" style="margin-top:14px">
          <label for="ed-desc">${escapeHtml(t('ui.editor.description'))}</label>
          <textarea id="ed-desc" class="sf-input" placeholder="${escapeHtml(t('ui.editor.descriptionPlaceholder'))}">${escapeHtml(scene.description || '')}</textarea>
        </div>
      </div>
    </section>

    <section class="sf-section">
      <h3>${escapeHtml(t('ui.editor.switchSection'))}</h3>
      <div class="sf-box">
        <div class="sf-grid-2">
          <div class="sf-field">
            <label for="ed-type">${escapeHtml(t('ui.editor.switchType'))}</label>
            <select id="ed-type" class="sf-select">
              <option value="momentary" ${scene.switchType === 'momentary' ? 'selected' : ''}>${escapeHtml(t('ui.editor.switchMomentary'))}</option>
              <option value="stateful" ${scene.switchType === 'stateful' ? 'selected' : ''}>${escapeHtml(t('ui.editor.switchStateful'))}</option>
            </select>
            <small>${escapeHtml(
              t(scene.switchType === 'stateful' ? 'ui.editor.switchStatefulHelp' : 'ui.editor.switchMomentaryHelp'),
            )}</small>
          </div>
          <div class="sf-field">
            <label for="ed-autooff">${escapeHtml(t(scene.switchType === 'stateful' ? 'ui.editor.autoOffUnused' : 'ui.editor.autoOff'))}</label>
            <select id="ed-autooff" class="sf-select" ${scene.switchType === 'stateful' ? 'disabled' : ''}>
              ${[400, 600, 1000, 1500, 2000, 3000]
                .map((value) => `<option value="${value}" ${scene.autoOffMs === value ? 'selected' : ''}>${fmtMs(value)}</option>`)
                .join('')}
            </select>
          </div>
        </div>
        <div class="sf-grid-2" style="margin-top:14px">
          <div class="sf-field">
            <label for="ed-mode">${escapeHtml(t('ui.editor.mode'))}</label>
            <select id="ed-mode" class="sf-select">
              <option value="parallel" ${scene.mode === 'parallel' ? 'selected' : ''}>${escapeHtml(t('ui.editor.modeParallel'))}</option>
              <option value="sequential" ${scene.mode === 'sequential' ? 'selected' : ''}>${escapeHtml(t('ui.editor.modeSequential'))}</option>
            </select>
            <small>${escapeHtml(t('ui.editor.modeHelp'))}</small>
          </div>
          <div class="sf-field">
            <label for="ed-condition">${escapeHtml(t('ui.editor.condition'))}</label>
            <select id="ed-condition" class="sf-select">
              ${state.conditions
                .map((condition) => `<option value="${condition.id}" ${scene.condition.type === condition.id ? 'selected' : ''}>${escapeHtml(condition.label)}</option>`)
                .join('')}
            </select>
            <small>${escapeHtml(t('ui.editor.conditionHelp'))}</small>
          </div>
        </div>
        <div id="ed-condition-params" style="margin-top:12px">${renderConditionParams(scene.condition)}</div>
      </div>
    </section>

    <section class="sf-section">
      <h3>${escapeHtml(t(hasCondition ? 'ui.editor.actionsWhenTrue' : 'ui.editor.actions'))}</h3>
      <p class="sf-section-help">${escapeHtml(t('ui.editor.actionsHelp'))}</p>
      <div class="sf-steps" id="steps-then" data-list="steps">${renderSteps(scene.steps, 'steps')}</div>
      <button class="sf-btn sf-btn--ghost" style="margin-top:10px" data-act="add-step" data-list="steps" type="button">${escapeHtml(t('ui.editor.addStep'))}</button>
      ${renderTimeline(scene.steps, scene.mode)}
    </section>

    ${hasCondition
      ? `<section class="sf-section">
          <h3>${escapeHtml(t('ui.editor.actionsWhenFalse'))}</h3>
          <p class="sf-section-help">${escapeHtml(t('ui.editor.actionsWhenFalseHelp'))}</p>
          <div class="sf-steps" id="steps-else" data-list="elseSteps">${renderSteps(scene.elseSteps, 'elseSteps')}</div>
          <button class="sf-btn sf-btn--ghost" style="margin-top:10px" data-act="add-step" data-list="elseSteps" type="button">${escapeHtml(t('ui.editor.addStep'))}</button>
        </section>`
      : ''}

    ${scene.switchType === 'stateful'
      ? `<section class="sf-section">
          <h3>${escapeHtml(t('ui.editor.actionsOff'))}</h3>
          <p class="sf-section-help">${escapeHtml(t('ui.editor.actionsOffHelp'))}</p>
          <div class="sf-steps" id="steps-off" data-list="offSteps">${renderSteps(scene.offSteps, 'offSteps')}</div>
          <button class="sf-btn sf-btn--ghost" style="margin-top:10px" data-act="add-step" data-list="offSteps" type="button">${escapeHtml(t('ui.editor.addStep'))}</button>
        </section>`
      : ''}

    <div id="editor-result"></div>
  `;

  wireEditor();
  markDirty();
}

function renderConditionParams(condition) {
  const definition = state.conditions.find((entry) => entry.id === condition.type);
  if (!definition || definition.params.length === 0) return '';
  return `<div class="sf-grid-2">${definition.params
    .map((param) => renderParamField(param, condition.params?.[param.key], `cond:${param.key}`))
    .join('')}</div>`;
}

function renderSteps(steps, listKey) {
  if (!steps || steps.length === 0) {
    return `<p class="sf-help" style="padding:8px 2px">${escapeHtml(t('ui.editor.noSteps'))}</p>`;
  }
  return steps.map((step, index) => renderStep(step, index, listKey)).join('');
}

function renderStep(step, index, listKey) {
  const definition = findAction(step.action);
  const open = state.openStepId === step.id;
  const label = definition ? definition.label : t('describe.unknownAction', { action: step.action });
  const summary = summariseStep(step, definition);
  const problems = stepProblems(step);

  return `
  <article class="sf-step ${open ? 'is-open' : ''} ${step.enabled === false ? 'is-off' : ''}"
           data-step="${step.id}" data-list="${listKey}" draggable="true">
    <div class="sf-step-head" data-act="toggle-step" data-step="${step.id}">
      <span class="sf-drag" title="${escapeHtml(t('ui.scenes.dragHint'))}">
        <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><circle cx="9" cy="6" r="1.6"/><circle cx="15" cy="6" r="1.6"/><circle cx="9" cy="12" r="1.6"/><circle cx="15" cy="12" r="1.6"/><circle cx="9" cy="18" r="1.6"/><circle cx="15" cy="18" r="1.6"/></svg>
      </span>
      <span class="sf-step-index">${index + 1}</span>
      <div class="sf-step-title">
        <strong>${escapeHtml(label)}</strong>
        <small>${escapeHtml(summary)}</small>
      </div>
      ${problems.length ? `<span class="sf-pill sf-pill--warn" title="${escapeHtml(problems.join(' · '))}">!</span>` : ''}
      ${step.delayMs > 0 ? `<span class="sf-pill sf-pill--muted">+${fmtMs(step.delayMs)}</span>` : ''}
      <button class="sf-btn sf-btn--icon" data-act="test-step" data-step="${step.id}" data-list="${listKey}" title="${escapeHtml(t('ui.editor.testStep'))}" ${state.connected ? '' : 'disabled'}>
        <svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
      </button>
      <button class="sf-btn sf-btn--icon" data-act="delete-step" data-step="${step.id}" data-list="${listKey}" title="${escapeHtml(t('ui.editor.removeStep'))}">
        <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>
      </button>
    </div>
    ${open ? `<div class="sf-step-body">${warnings(problems)}${renderStepBody(step, listKey)}</div>` : ''}
  </article>`;
}

function summariseStep(step, definition) {
  const params = step.params || {};
  if (step.action === 'groupAndPlay') {
    const bits = [];
    const source = params.source || {};
    if (source.type && source.type !== 'keep') bits.push(`"${source.value}"`);
    bits.push(t('describe.on', { name: params.coordinator || t('common.notChosen') }));
    if ((params.membersMode || 'all') === 'all') {
      const leave = (params.leave || []).length;
      bits.push(
        leave ? t('target.describe.allExcept', { names: params.leave.join(', ') }) : t('target.all'),
      );
    } else {
      bits.push(tn((params.members || []).length, 'common.roomsOne', 'common.rooms'));
    }
    return bits.join(' · ');
  }
  const bits = [];
  if (definition?.targets !== 'none') bits.push(describeTargetLocal(step.target));
  if (params.volume !== undefined) bits.push(`${params.volume}%`);
  if (params.delta !== undefined) bits.push(`${params.delta > 0 ? '+' : ''}${params.delta}%`);
  if (params.favorite) bits.push(`"${params.favorite}"`);
  if (params.coordinator) bits.push(`→ ${params.coordinator}`);
  return bits.join(' · ') || (definition?.help ?? '');
}

function describeTargetLocal(target) {
  if (!target) return t('target.all');
  const filterKey = {
    playing: 'target.describe.onlyPlaying',
    notPlaying: 'target.describe.onlySilent',
    coordinators: 'target.describe.onlyLeaders',
  }[target.filter];
  const suffix = filterKey ? ` (${t(filterKey)})` : '';
  const names = (target.names || []).join(', ');
  const anchor = target.coordinator || t('common.dash');
  switch (target.type) {
    case 'players':
      return `${names || t('common.notChosen')}${suffix}`;
    case 'allExcept':
      return `${t('target.allExcept')} ${names || t('common.dash')}${suffix}`;
    case 'group':
      return `${t('target.group')} ${anchor}${suffix}`;
    case 'coordinator':
      return `${t('target.coordinator')} ${anchor}`;
    default:
      return `${t('target.all')}${suffix}`;
  }
}

function renderStepBody(step, listKey) {
  const definition = findAction(step.action);
  const actionOptions = state.actions
    .map(
      (group) =>
        `<optgroup label="${escapeHtml(group.category)}">${group.actions
          .map((action) => `<option value="${action.id}" ${action.id === step.action ? 'selected' : ''}>${escapeHtml(action.label)}</option>`)
          .join('')}</optgroup>`,
    )
    .join('');

  const parts = [
    `<div class="sf-field">
      <label>${escapeHtml(t('ui.editor.action'))}</label>
      <select class="sf-select" data-field="action" data-step="${step.id}" data-list="${listKey}">${actionOptions}</select>
      ${definition?.help ? `<small>${escapeHtml(definition.help)}</small>` : ''}
    </div>`,
  ];

  if (definition && definition.targets !== 'none' && step.action !== 'groupAndPlay') {
    parts.push(renderTargetPicker(step, listKey));
  }

  if (step.action === 'groupAndPlay') {
    parts.push(renderGroupAndPlay(step, listKey));
  } else if (definition) {
    const fields = definition.params
      .map((param) => renderParamField(param, step.params?.[param.key], `param:${param.key}`, step, listKey))
      .join('');
    if (fields) parts.push(`<div class="sf-grid-2">${fields}</div>`);
  }

  // Kept, but out of the way: commands reach the speakers in milliseconds now,
  // so a manual wait is the exception rather than something to configure.
  parts.push(`
    <details class="sf-field" ${step.delayMs > 0 || step.enabled === false ? 'open' : ''}>
      <summary style="cursor:pointer;font-weight:600;font-size:.82rem;color:var(--sf-heading)">${escapeHtml(t('ui.editor.advanced'))}</summary>
      <div class="sf-grid-2" style="margin-top:11px">
        <div class="sf-field">
          <label>${escapeHtml(t('ui.editor.stepDelay'))}</label>
          <div class="sf-row">
            <input class="sf-input" type="number" min="0" step="0.5" style="max-width:110px"
                   value="${(step.delayMs || 0) / 1000}" data-field="delaySeconds" data-step="${step.id}" data-list="${listKey}" />
            <span class="sf-hint">${escapeHtml(t('ui.editor.stepDelayUnit'))}</span>
          </div>
          <small>${escapeHtml(t('ui.editor.stepDelayHelp'))}</small>
        </div>
        <label class="sf-row" style="gap:8px;cursor:pointer;align-items:flex-start">
          <input type="checkbox" data-field="enabled" data-step="${step.id}" data-list="${listKey}" ${step.enabled !== false ? 'checked' : ''} />
          <span class="sf-hint">${escapeHtml(t('ui.editor.stepEnabled'))}</span>
        </label>
      </div>
    </details>`);

  return parts.join('');
}

function renderTargetPicker(step, listKey) {
  const target = step.target || { type: 'all', names: [], coordinator: '', filter: 'any' };
  const needsNames = target.type === 'players' || target.type === 'allExcept';
  const needsCoordinator = target.type === 'group' || target.type === 'coordinator';

  return `
  <div class="sf-field">
    <label>${escapeHtml(t('target.label'))}</label>
    <div class="sf-grid-2">
      <select class="sf-select" data-field="target.type" data-step="${step.id}" data-list="${listKey}">
        ${state.targetTypes.map((entry) => `<option value="${entry.value}" ${target.type === entry.value ? 'selected' : ''}>${escapeHtml(entry.label)}</option>`).join('')}
      </select>
      <select class="sf-select" data-field="target.filter" data-step="${step.id}" data-list="${listKey}">
        ${state.filters.map((entry) => `<option value="${entry.value}" ${target.filter === entry.value ? 'selected' : ''}>${escapeHtml(entry.label)}</option>`).join('')}
      </select>
    </div>
    ${needsNames ? `<div style="margin-top:9px">${renderPlayerChips(target.names || [], `target.names`, step.id, listKey, true)}</div>` : ''}
    ${needsCoordinator
      ? `<div style="margin-top:9px">${renderPlayerSelect(target.coordinator, 'target.coordinator', step.id, listKey)}</div>`
      : ''}
    <small>${escapeHtml(t('target.help'))}</small>
  </div>`;
}

function renderPlayerChips(selected, field, stepId, listKey, withBulk = false) {
  const names = playerNames();
  const unknown = (selected || []).filter((name) => !names.includes(name));
  const all = [...names, ...unknown];
  return `
    <div class="sf-chips" data-chipset="${field}" data-step="${stepId}" data-list="${listKey}">
      ${all
        .map(
          (name) =>
            `<button type="button" class="sf-chip ${(selected || []).includes(name) ? 'is-on' : ''} ${names.includes(name) ? '' : 'is-missing'}"
                data-act="chip" data-field="${field}" data-step="${stepId}" data-list="${listKey}" data-name="${escapeHtml(name)}"
                title="${names.includes(name) ? '' : escapeHtml(t('ui.editor.unknownSpeaker'))}">${escapeHtml(name)}</button>`,
        )
        .join('')}
      ${all.length === 0 ? `<span class="sf-hint">${escapeHtml(t('ui.status.noPlayers'))}</span>` : ''}
    </div>
    ${withBulk && all.length
      ? `<div class="sf-row" style="margin-top:7px">
           <button type="button" class="sf-btn sf-btn--ghost sf-btn--sm" data-act="chip-all" data-field="${field}" data-step="${stepId}" data-list="${listKey}">${escapeHtml(t('ui.editor.selectAll'))}</button>
           <button type="button" class="sf-btn sf-btn--ghost sf-btn--sm" data-act="chip-none" data-field="${field}" data-step="${stepId}" data-list="${listKey}">${escapeHtml(t('ui.editor.clear'))}</button>
         </div>`
      : ''}`;
}

function renderPlayerSelect(value, field, stepId, listKey) {
  const names = playerNames();
  const options = [...new Set([...(value ? [value] : []), ...names])];
  return `
    <select class="sf-select" data-field="${field}" data-step="${stepId}" data-list="${listKey}">
      <option value="">${escapeHtml(t('ui.editor.pickSpeaker'))}</option>
      ${options
        .map(
          (name) =>
            `<option value="${escapeHtml(name)}" ${value === name ? 'selected' : ''}>${escapeHtml(name)}${names.includes(name) ? '' : ` (${escapeHtml(t('ui.editor.notInSonos'))})`}</option>`,
        )
        .join('')}
    </select>`;
}

/** The rich, one-screen editor for the composite "music scene" action. */
function renderGroupAndPlay(step, listKey) {
  const params = step.params || {};
  const source = params.source || { type: 'keep', value: '' };
  const membersMode = params.membersMode || 'all';
  const timing = params.timing || 'auto';
  const leave = params.leave || [];
  const members = params.members || [];
  const coordinator = params.coordinator || '';

  const inGroup =
    membersMode === 'all'
      ? playerNames().filter((name) => name !== coordinator && !leave.includes(name))
      : members.filter((name) => name !== coordinator);
  const volumeRooms = [...new Set([coordinator, ...inGroup].filter(Boolean))];

  const sourceValues =
    source.type === 'favorite'
      ? state.library.favorites
      : source.type === 'playlist'
        ? state.library.playlists
        : source.type === 'radio'
          ? state.library.radio
          : [];

  return `
  <div class="sf-field">
    <label>${escapeHtml(t('action.groupAndPlay.coordinator'))}</label>
    ${renderPlayerSelect(coordinator, 'param:coordinator', step.id, listKey)}
    <small>${escapeHtml(t('action.groupAndPlay.coordinatorHelp'))}</small>
  </div>

  <div class="sf-field">
    <label>${escapeHtml(t('action.groupAndPlay.source'))}</label>
    <div class="sf-grid-2">
      <select class="sf-select" data-field="param:source.type" data-step="${step.id}" data-list="${listKey}">
        <option value="keep" ${source.type === 'keep' ? 'selected' : ''}>${escapeHtml(t('ui.editor.sourceKeep'))}</option>
        <option value="favorite" ${source.type === 'favorite' ? 'selected' : ''}>${escapeHtml(t('ui.editor.sourceFavorite'))}</option>
        <option value="playlist" ${source.type === 'playlist' ? 'selected' : ''}>${escapeHtml(t('ui.editor.sourcePlaylist'))}</option>
        <option value="radio" ${source.type === 'radio' ? 'selected' : ''}>${escapeHtml(t('ui.editor.sourceRadio'))}</option>
        <option value="uri" ${source.type === 'uri' ? 'selected' : ''}>${escapeHtml(t('ui.editor.sourceUri'))}</option>
      </select>
      ${source.type === 'keep'
        ? `<span class="sf-hint" style="align-self:center">${escapeHtml(t('ui.editor.sourceUnchanged'))}</span>`
        : source.type === 'uri'
          ? `<input class="sf-input" type="text" placeholder="http://…" value="${escapeHtml(source.value || '')}" data-field="param:source.value" data-step="${step.id}" data-list="${listKey}" />`
          : `<select class="sf-select" data-field="param:source.value" data-step="${step.id}" data-list="${listKey}">
               <option value="">${escapeHtml(t('ui.editor.pick'))}</option>
               ${[...new Set([...(source.value ? [source.value] : []), ...sourceValues.map((item) => item.title)])]
                 .map(
                   (title) =>
                     `<option value="${escapeHtml(title)}" ${source.value === title ? 'selected' : ''}>${escapeHtml(title)}</option>`,
                 )
                 .join('')}
             </select>`}
    </div>
    ${source.type !== 'keep' && source.type !== 'uri' && sourceValues.length === 0
      ? `<small style="color:var(--sf-warn)">${escapeHtml(t('ui.editor.sourceEmpty'))}</small>`
      : ''}
  </div>

  <div class="sf-field">
    <label>${escapeHtml(t('action.groupAndPlay.membersMode'))}</label>
    <select class="sf-select" data-field="param:membersMode" data-step="${step.id}" data-list="${listKey}">
      <option value="all" ${membersMode === 'all' ? 'selected' : ''}>${escapeHtml(t('action.groupAndPlay.membersModeAll'))}</option>
      <option value="list" ${membersMode === 'list' ? 'selected' : ''}>${escapeHtml(t('action.groupAndPlay.membersModeList'))}</option>
    </select>
    <small>${escapeHtml(t('action.groupAndPlay.membersModeHelp'))}</small>
  </div>

  <div class="sf-field">
    <label>${escapeHtml(t('action.groupAndPlay.leave'))}</label>
    ${renderPlayerChips(leave, 'param:leave', step.id, listKey)}
    <small>${escapeHtml(t('action.groupAndPlay.leaveHelp'))}</small>
  </div>

  ${membersMode === 'list'
    ? `<div class="sf-field">
        <label>${escapeHtml(t('action.groupAndPlay.members'))}</label>
        ${renderPlayerChips(members, 'param:members', step.id, listKey, true)}
        <small>${escapeHtml(t('action.groupAndPlay.membersHelp'))}</small>
      </div>`
    : `<div class="sf-field">
        <label>${escapeHtml(t('ui.editor.autoMembers'))}</label>
        <div class="sf-chips">
          ${coordinator ? `<span class="sf-chip is-leader sf-chip--mini">${escapeHtml(coordinator)} (${escapeHtml(t('ui.editor.leader'))})</span>` : ''}
          ${inGroup.map((name) => `<span class="sf-chip sf-chip--mini">${escapeHtml(name)}</span>`).join('')}
          ${inGroup.length === 0 && !coordinator ? `<span class="sf-hint">${escapeHtml(t('ui.editor.pickLeaderFirst'))}</span>` : ''}
        </div>
      </div>`}

  <div class="sf-field">
    <label>${escapeHtml(t('action.groupAndPlay.timing'))}</label>
    <select class="sf-select" data-field="param:timing" data-step="${step.id}" data-list="${listKey}">
      <option value="auto" ${timing === 'auto' ? 'selected' : ''}>${escapeHtml(t('action.groupAndPlay.timingAuto'))}</option>
      <option value="fixed" ${timing === 'fixed' ? 'selected' : ''}>${escapeHtml(t('action.groupAndPlay.timingFixed'))}</option>
    </select>
    <small>${escapeHtml(t('action.groupAndPlay.timingHelp'))}</small>
  </div>

  ${timing === 'fixed'
    ? `<div class="sf-field">
        <label>${escapeHtml(t('ui.editor.sharedDelays'))}</label>
        <div class="sf-grid-2">
          <div class="sf-field">
            <label style="font-weight:500;font-size:.78rem">${escapeHtml(t('ui.editor.volumeAfter'))}</label>
            <div class="sf-row">
              <input class="sf-input" type="number" min="0" step="0.5" style="max-width:100px"
                     value="${(params.volumeDelayMs ?? 1000) / 1000}" data-field="param:volumeDelayMs" data-unit="s" data-step="${step.id}" data-list="${listKey}" />
              <span class="sf-hint">${escapeHtml(t('common.seconds'))}</span>
            </div>
          </div>
          <div class="sf-field">
            <label style="font-weight:500;font-size:.78rem">${escapeHtml(t('ui.editor.groupAfter'))}</label>
            <div class="sf-row">
              <input class="sf-input" type="number" min="0" step="0.5" style="max-width:100px"
                     value="${(params.groupDelayMs ?? 2000) / 1000}" data-field="param:groupDelayMs" data-unit="s" data-step="${step.id}" data-list="${listKey}" />
              <span class="sf-hint">${escapeHtml(t('common.seconds'))}</span>
            </div>
          </div>
        </div>
        <small>${escapeHtml(t('ui.editor.sharedDelaysHelp'))}</small>
      </div>`
    : ''}

  <div class="sf-field">
    <label>${escapeHtml(t('ui.editor.volumePerSpeaker'))}</label>
    <div class="sf-row sf-row--wrap" style="margin-bottom:8px">
      <button type="button" class="sf-btn sf-btn--ghost sf-btn--sm" data-act="vol-all" data-step="${step.id}" data-list="${listKey}">${escapeHtml(t('ui.editor.setAll'))}</button>
      <button type="button" class="sf-btn sf-btn--ghost sf-btn--sm" data-act="vol-current" data-step="${step.id}" data-list="${listKey}" ${state.connected ? '' : 'disabled'}>${escapeHtml(t('ui.editor.useCurrent'))}</button>
      <button type="button" class="sf-btn sf-btn--ghost sf-btn--sm" data-act="vol-clear" data-step="${step.id}" data-list="${listKey}">${escapeHtml(t('ui.editor.clearAll'))}</button>
    </div>
    <div class="sf-volmap">
      ${volumeRooms.length === 0 ? `<span class="sf-hint">${escapeHtml(t('ui.editor.pickLeaderFirst'))}</span>` : ''}
      ${volumeRooms
        .map((name) => {
          const value = params.volumes?.[name];
          const set = value !== undefined && value !== null && value !== '';
          return `
          <div class="sf-volrow ${set ? '' : 'is-unset'}">
            <span class="sf-volrow-name" title="${escapeHtml(name)}">${escapeHtml(name)}${name === coordinator ? ' ★' : ''}</span>
            <input type="range" min="0" max="100" value="${set ? value : 10}"
                   data-act="vol-set" data-name="${escapeHtml(name)}" data-step="${step.id}" data-list="${listKey}" />
            <span class="sf-volrow-num">
              <input type="number" min="0" max="100" step="1" inputmode="numeric"
                     value="${set ? value : ''}" placeholder="—"
                     aria-label="${escapeHtml(name)}"
                     data-act="vol-num" data-name="${escapeHtml(name)}" data-step="${step.id}" data-list="${listKey}" />
              <span aria-hidden="true">%</span>
            </span>
            <button type="button" class="sf-btn sf-btn--icon" data-act="vol-unset" data-name="${escapeHtml(name)}" data-step="${step.id}" data-list="${listKey}" title="${escapeHtml(t('ui.editor.dontTouch'))}">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>
            </button>
          </div>`;
        })
        .join('')}
    </div>
    <small>${escapeHtml(t('ui.editor.volumeUntouched'))}</small>
  </div>

  <details class="sf-field">
    <summary style="cursor:pointer;font-weight:600;font-size:.82rem;color:var(--sf-heading)">${escapeHtml(t('ui.editor.playbackMode'))}</summary>
    <div class="sf-grid-2" style="margin-top:11px">
      <div class="sf-field">
        <label>${escapeHtml(t('action.groupAndPlay.shuffle'))}</label>
        <select class="sf-select" data-field="param:shuffle" data-tristate="1" data-step="${step.id}" data-list="${listKey}">
          <option value="" ${params.shuffle === null || params.shuffle === undefined ? 'selected' : ''}>${escapeHtml(t('tristate.unchanged'))}</option>
          <option value="true" ${params.shuffle === true ? 'selected' : ''}>${escapeHtml(t('tristate.on'))}</option>
          <option value="false" ${params.shuffle === false ? 'selected' : ''}>${escapeHtml(t('tristate.off'))}</option>
        </select>
      </div>
      <div class="sf-field">
        <label>${escapeHtml(t('action.groupAndPlay.repeat'))}</label>
        <select class="sf-select" data-field="param:repeat" data-step="${step.id}" data-list="${listKey}">
          <option value="" ${params.repeat === null || params.repeat === undefined ? 'selected' : ''}>${escapeHtml(t('tristate.unchanged'))}</option>
          <option value="none" ${params.repeat === 'none' ? 'selected' : ''}>${escapeHtml(t('repeat.none'))}</option>
          <option value="all" ${params.repeat === 'all' ? 'selected' : ''}>${escapeHtml(t('repeat.all'))}</option>
          <option value="one" ${params.repeat === 'one' ? 'selected' : ''}>${escapeHtml(t('repeat.one'))}</option>
        </select>
      </div>
      <div class="sf-field">
        <label>${escapeHtml(t('action.groupAndPlay.crossfade'))}</label>
        <select class="sf-select" data-field="param:crossfade" data-tristate="1" data-step="${step.id}" data-list="${listKey}">
          <option value="" ${params.crossfade === null || params.crossfade === undefined ? 'selected' : ''}>${escapeHtml(t('tristate.unchanged'))}</option>
          <option value="true" ${params.crossfade === true ? 'selected' : ''}>${escapeHtml(t('tristate.on'))}</option>
          <option value="false" ${params.crossfade === false ? 'selected' : ''}>${escapeHtml(t('tristate.off'))}</option>
        </select>
      </div>
      ${timing === 'fixed'
        ? `<div class="sf-field">
            <label>${escapeHtml(t('ui.editor.setAfter'))}</label>
            <div class="sf-row">
              <input class="sf-input" type="number" min="0" step="0.5" style="max-width:100px"
                     value="${(params.modeDelayMs ?? 3000) / 1000}" data-field="param:modeDelayMs" data-unit="s" data-step="${step.id}" data-list="${listKey}" />
              <span class="sf-hint">${escapeHtml(t('common.seconds'))}</span>
            </div>
          </div>`
        : ''}
    </div>
  </details>`;
}

function renderParamField(param, value, field, step, listKey) {
  const stepAttrs = step ? `data-step="${step.id}" data-list="${listKey}"` : 'data-step="" data-list=""';
  const label = `<label>${escapeHtml(param.label)}</label>`;
  const hint = param.help ? `<small>${escapeHtml(param.help)}</small>` : '';
  const base = (control) => `<div class="sf-field">${label}${control}${hint}</div>`;

  switch (param.type) {
    case 'boolean':
      return base(
        `<label class="sf-row" style="gap:8px;cursor:pointer">
           <input type="checkbox" data-field="${field}" ${stepAttrs} ${value === undefined ? (param.default ? 'checked' : '') : value ? 'checked' : ''} />
           <span class="sf-hint">${escapeHtml(param.label)}</span>
         </label>`,
      );
    case 'select':
      return base(
        `<select class="sf-select" data-field="${field}" ${stepAttrs}>
           ${(param.options || []).map((option) => `<option value="${escapeHtml(option.value)}" ${String(value ?? param.default) === String(option.value) ? 'selected' : ''}>${escapeHtml(option.label)}</option>`).join('')}
         </select>`,
      );
    case 'player':
      return base(renderPlayerSelectRaw(value, field, stepAttrs));
    case 'players':
      return base(
        step
          ? renderPlayerChips(value || [], field, step.id, listKey, true)
          : '<span class="sf-hint">—</span>',
      );
    case 'favorite':
    case 'playlist':
    case 'radio': {
      const items =
        param.type === 'favorite'
          ? state.library.favorites
          : param.type === 'playlist'
            ? state.library.playlists
            : state.library.radio;
      const titles = [...new Set([...(value ? [value] : []), ...items.map((item) => item.title)])];
      return base(
        `<select class="sf-select" data-field="${field}" ${stepAttrs}>
           <option value="">${escapeHtml(t('ui.editor.pick'))}</option>
           ${titles.map((title) => `<option value="${escapeHtml(title)}" ${value === title ? 'selected' : ''}>${escapeHtml(title)}</option>`).join('')}
         </select>`,
      );
    }
    case 'scene':
      return base(
        `<select class="sf-select" data-field="${field}" ${stepAttrs}>
           <option value="">${escapeHtml(t('ui.editor.pickScene'))}</option>
           ${state.scenes.map((scene) => `<option value="${scene.id}" ${value === scene.id ? 'selected' : ''}>${escapeHtml(scene.name)}</option>`).join('')}
         </select>`,
      );
    case 'volume':
      return base(
        `<div class="sf-row">
           <input type="range" min="${param.min ?? 0}" max="${param.max ?? 100}" value="${value ?? param.default ?? 10}" data-field="${field}" ${stepAttrs} />
           <span class="sf-volume-value">${value ?? param.default ?? 10}%</span>
         </div>`,
      );
    case 'number':
      return base(
        `<input class="sf-input" type="number" ${param.min !== undefined ? `min="${param.min}"` : ''} ${param.max !== undefined ? `max="${param.max}"` : ''} step="${param.step ?? 1}"
                value="${value ?? param.default ?? ''}" placeholder="${escapeHtml(param.placeholder || '')}" data-field="${field}" ${stepAttrs} />`,
      );
    case 'time':
      return base(
        `<input class="sf-input" type="time" value="${escapeHtml(value ?? param.default ?? '')}" data-field="${field}" ${stepAttrs} />`,
      );
    default:
      return base(
        `<input class="sf-input" type="text" value="${escapeHtml(value ?? param.default ?? '')}" placeholder="${escapeHtml(param.placeholder || '')}" data-field="${field}" ${stepAttrs} />`,
      );
  }
}

function renderPlayerSelectRaw(value, field, stepAttrs) {
  const names = playerNames();
  const options = [...new Set([...(value ? [value] : []), ...names])];
  return `<select class="sf-select" data-field="${field}" ${stepAttrs}>
      <option value="">${escapeHtml(t('ui.editor.pickSpeaker'))}</option>
      ${options.map((name) => `<option value="${escapeHtml(name)}" ${value === name ? 'selected' : ''}>${escapeHtml(name)}</option>`).join('')}
    </select>`;
}

/** Visual answer to "when does what actually happen?" */
function renderTimeline(steps, mode) {
  const active = (steps || []).filter((step) => step.enabled !== false);
  if (active.length === 0) return '';

  const events = [];
  if (mode === 'sequential') {
    let cursor = 0;
    for (const step of active) {
      cursor += step.delayMs || 0;
      events.push({ at: cursor, label: summariseStepShort(step), secondary: false });
    }
  } else {
    for (const step of active) {
      const at = step.delayMs || 0;
      if (step.action === 'groupAndPlay') {
        const params = step.params || {};
        const source = params.source || {};
        const auto = (params.timing || 'auto') === 'auto';
        events.push({
          at,
          label:
            source.type && source.type !== 'keep'
              ? `${t('describe.playingNow', { title: source.value })} ${t('describe.on', { name: params.coordinator || t('common.dash') })}`
              : `${t('verb.play')} ${t('describe.on', { name: params.coordinator || t('common.dash') })}`,
          secondary: false,
          auto,
        });
        if ((params.leave || []).length) {
          events.push({ at, label: t('result.left', { names: params.leave.join(', ') }), secondary: true, auto });
        }
        if (Object.keys(params.volumes || {}).length || params.defaultVolume) {
          events.push({
            at: at + (auto ? 0 : params.volumeDelayMs ?? 1000),
            label: t('ui.editor.volumePerSpeaker'),
            secondary: true,
            auto,
          });
        }
        events.push({
          at: at + (auto ? 0 : params.groupDelayMs ?? 2000),
          label: t('ui.editor.groupAfter'),
          secondary: false,
          auto,
        });
        if (params.shuffle !== null && params.shuffle !== undefined) {
          events.push({
            at: at + (auto ? 0 : params.modeDelayMs ?? 3000),
            label: `${t('action.setShuffle.label')} ${t(params.shuffle ? 'tristate.on' : 'tristate.off').toLowerCase()}`,
            secondary: true,
            auto,
          });
        }
      } else {
        events.push({ at, label: summariseStepShort(step), secondary: false });
      }
    }
  }

  events.sort((a, b) => a.at - b.at);
  const allAuto = events.every((event) => event.auto);
  return `
  <div class="sf-box" style="margin-top:14px">
    <div class="sf-label" style="margin-bottom:9px">${escapeHtml(t('ui.editor.timeline'))}${
      allAuto ? ` <span class="sf-pill sf-pill--accent">${escapeHtml(t('ui.editor.timelineAuto'))}</span>` : ''
    }</div>
    <div class="sf-timeline">
      ${events
        .map(
          (event) => `
        <div class="sf-tl-row">
          <span class="sf-tl-time">${escapeHtml(
            event.auto
              ? events.indexOf(event) === 0
                ? t('ui.editor.timelineNow')
                : t('ui.editor.timelineThen')
              : event.at === 0
                ? t('ui.editor.timelineNow')
                : `+${fmtMs(event.at)}`,
          )}</span>
          <span class="sf-tl-bar ${event.secondary ? 'is-secondary' : ''}">${escapeHtml(event.label)}</span>
        </div>`,
        )
        .join('')}
    </div>
  </div>`;
}

function summariseStepShort(step) {
  const definition = findAction(step.action);
  return `${definition ? definition.label : step.action} — ${summariseStep(step, definition)}`;
}

// ---------------------------------------------------------------- editing ops

function listOf(key) {
  if (!state.editing) return [];
  if (!Array.isArray(state.editing[key])) state.editing[key] = [];
  return state.editing[key];
}

function stepById(listKey, stepId) {
  return listOf(listKey).find((step) => step.id === stepId) || null;
}

function setDeep(object, pathString, value) {
  const parts = pathString.split('.');
  let cursor = object;
  for (let index = 0; index < parts.length - 1; index += 1) {
    if (cursor[parts[index]] === undefined || cursor[parts[index]] === null) cursor[parts[index]] = {};
    cursor = cursor[parts[index]];
  }
  cursor[parts[parts.length - 1]] = value;
}

function wireEditor() {
  const body = $('#editor-body');

  $('#ed-name').addEventListener('input', (event) => {
    state.editing.name = event.target.value;
    $('#editor-title').textContent = event.target.value || t('ui.editor.newTitle');
    markDirty();
  });
  $('#ed-desc').addEventListener('input', (event) => {
    state.editing.description = event.target.value;
    markDirty();
  });
  $('#ed-type').addEventListener('change', (event) => {
    state.editing.switchType = event.target.value;
    renderEditor();
  });
  $('#ed-autooff').addEventListener('change', (event) => {
    state.editing.autoOffMs = Number(event.target.value);
    markDirty();
  });
  $('#ed-mode').addEventListener('change', (event) => {
    state.editing.mode = event.target.value;
    renderEditor();
  });
  $('#ed-condition').addEventListener('change', (event) => {
    state.editing.condition = { type: event.target.value, params: {} };
    renderEditor();
  });

  // The drawer body itself survives every repaint, so its delegated listeners
  // must only ever be attached once — otherwise every click fires N times.
  if (!body.dataset.wired) {
    body.dataset.wired = '1';
    body.addEventListener('click', onEditorClick);
    body.addEventListener('change', onEditorChange);
    body.addEventListener('input', onEditorInput);
    wireStepDrag(body);
  }
}

async function onEditorClick(event) {
  const button = event.target.closest('[data-act]');
  if (!button) return;
  const act = button.dataset.act;
  const listKey = button.dataset.list;
  const stepId = button.dataset.step;

  if (act === 'pick-icon') {
    state.editing.icon = button.dataset.icon;
    renderEditor();
    return;
  }
  if (act === 'toggle-step') {
    if (event.target.closest('[data-act="test-step"], [data-act="delete-step"]')) return;
    state.openStepId = state.openStepId === stepId ? null : stepId;
    renderEditor();
    return;
  }
  if (act === 'add-step') {
    const step = blankStep('groupAndPlay');
    listOf(listKey).push(step);
    state.openStepId = step.id;
    renderEditor();
    return;
  }
  if (act === 'delete-step') {
    event.stopPropagation();
    const list = listOf(listKey);
    const index = list.findIndex((step) => step.id === stepId);
    if (index >= 0) list.splice(index, 1);
    renderEditor();
    return;
  }
  if (act === 'test-step') {
    event.stopPropagation();
    testStep(listKey, stepId, button);
    return;
  }
  if (act === 'chip') {
    const step = stepById(listKey, stepId);
    if (!step) return;
    const field = button.dataset.field;
    const path = field.startsWith('param:') ? `params.${field.slice(6)}` : field;
    const current = path.split('.').reduce((value, key) => (value ? value[key] : undefined), step) || [];
    const name = button.dataset.name;
    const next = current.includes(name) ? current.filter((entry) => entry !== name) : [...current, name];
    setDeep(step, path, next);
    renderEditor();
    return;
  }
  if (act === 'chip-all' || act === 'chip-none') {
    const step = stepById(listKey, stepId);
    if (!step) return;
    const field = button.dataset.field;
    const path = field.startsWith('param:') ? `params.${field.slice(6)}` : field;
    setDeep(step, path, act === 'chip-all' ? playerNames() : []);
    renderEditor();
    return;
  }
  if (act === 'vol-unset') {
    const step = stepById(listKey, stepId);
    if (!step) return;
    step.params.volumes = { ...(step.params.volumes || {}) };
    delete step.params.volumes[button.dataset.name];
    renderEditor();
    return;
  }
  if (act === 'vol-clear') {
    const step = stepById(listKey, stepId);
    if (!step) return;
    step.params.volumes = {};
    renderEditor();
    return;
  }
  if (act === 'vol-all') {
    const step = stepById(listKey, stepId);
    if (!step) return;
    const answer = await promptVolume({
      title: t('ui.editor.pickLevelTitle'),
      body: t('ui.editor.pickLevelBody'),
      value: 10,
    });
    if (answer === null) return;
    const value = Math.max(0, Math.min(100, Math.round(answer)));
    if (!Number.isFinite(value)) return;
    const coordinator = step.params.coordinator;
    const members =
      (step.params.membersMode || 'all') === 'all'
        ? playerNames().filter((name) => name !== coordinator && !(step.params.leave || []).includes(name))
        : step.params.members || [];
    const volumes = {};
    for (const name of [coordinator, ...members].filter(Boolean)) volumes[name] = value;
    step.params.volumes = volumes;
    renderEditor();
    return;
  }
  if (act === 'vol-current') {
    const step = stepById(listKey, stepId);
    if (!step) return;
    const volumes = { ...(step.params.volumes || {}) };
    const coordinator = step.params.coordinator;
    const members =
      (step.params.membersMode || 'all') === 'all'
        ? playerNames().filter((name) => name !== coordinator && !(step.params.leave || []).includes(name))
        : step.params.members || [];
    for (const name of [coordinator, ...members].filter(Boolean)) {
      const player = state.players.find((entry) => entry.name === name);
      if (player && typeof player.volume === 'number') volumes[name] = player.volume;
    }
    step.params.volumes = volumes;
    renderEditor();
    toast(t('ui.editor.currentLevelsUsed'), 'success');
  }
}

function onEditorChange(event) {
  if (event.target.dataset.act === 'vol-num') {
    // Normalise what is on screen to what was stored: 250 becomes 100, 7.6
    // becomes 8, and "abc" goes back to empty rather than sitting there.
    const step = stepById(event.target.dataset.list, event.target.dataset.step);
    const stored = step?.params?.volumes?.[event.target.dataset.name];
    event.target.value = stored === undefined ? '' : stored;
    return;
  }
  const field = event.target.dataset.field;
  if (!field) return;
  const listKey = event.target.dataset.list;
  const stepId = event.target.dataset.step;

  // Scene-level condition parameters.
  if (field.startsWith('cond:')) {
    state.editing.condition.params = state.editing.condition.params || {};
    state.editing.condition.params[field.slice(5)] = readControl(event.target);
    markDirty();
    return;
  }

  const step = stepById(listKey, stepId);
  if (!step) return;

  if (field === 'action') {
    const next = blankStep(event.target.value);
    next.id = step.id;
    next.delayMs = step.delayMs;
    next.enabled = step.enabled;
    const list = listOf(listKey);
    list[list.indexOf(step)] = next;
    renderEditor();
    return;
  }

  if (field === 'enabled') {
    step.enabled = event.target.checked;
    renderEditor();
    return;
  }

  if (field === 'delaySeconds') {
    step.delayMs = Math.max(0, Math.round(Number(event.target.value) * 1000) || 0);
    renderEditor();
    return;
  }

  const path = field.startsWith('param:') ? `params.${field.slice(6)}` : field;
  setDeep(step, path, readControl(event.target));

  // Structural switches need a repaint so dependent fields appear.
  if (
    field === 'target.type' ||
    field === 'param:membersMode' ||
    field === 'param:timing' ||
    field === 'param:source.type' ||
    field === 'param:coordinator' ||
    field.endsWith('Ms')
  ) {
    renderEditor();
    return;
  }
  markDirty();
}

function onEditorInput(event) {
  const target = event.target;
  if (target.dataset.act === 'vol-set') {
    const step = stepById(target.dataset.list, target.dataset.step);
    if (!step) return;
    step.params.volumes = { ...(step.params.volumes || {}) };
    step.params.volumes[target.dataset.name] = Number(target.value);
    const row = target.closest('.sf-volrow');
    row.classList.remove('is-unset');
    row.querySelector('.sf-volrow-num input').value = target.value;
    markDirty();
    return;
  }

  /*
   * The typed percentage.
   *
   * A slider is fine for finding a level by ear and hopeless for saying "12".
   * Clearing the field is the same as pressing ×: this speaker is left alone.
   */
  if (target.dataset.act === 'vol-num') {
    const step = stepById(target.dataset.list, target.dataset.step);
    if (!step) return;
    const row = target.closest('.sf-volrow');
    const raw = target.value.trim();
    step.params.volumes = { ...(step.params.volumes || {}) };
    if (raw === '') {
      delete step.params.volumes[target.dataset.name];
      row.classList.add('is-unset');
    } else {
      const value = Math.max(0, Math.min(100, Math.round(Number(raw))));
      if (!Number.isFinite(value)) return;
      step.params.volumes[target.dataset.name] = value;
      row.classList.remove('is-unset');
      row.querySelector('input[type="range"]').value = value;
    }
    markDirty();
    return;
  }
  if (target.type === 'range' && target.dataset.field) {
    const bubble = target.parentElement.querySelector('.sf-volume-value');
    if (bubble) bubble.textContent = `${target.value}%`;
    const step = stepById(target.dataset.list, target.dataset.step);
    if (step) {
      const path = target.dataset.field.startsWith('param:') ? `params.${target.dataset.field.slice(6)}` : target.dataset.field;
      setDeep(step, path, Number(target.value));
    } else if (target.dataset.field.startsWith('cond:')) {
      state.editing.condition.params[target.dataset.field.slice(5)] = Number(target.value);
    }
    markDirty();
    return;
  }
  if (target.dataset.field && (target.type === 'text' || target.type === 'number' || target.tagName === 'TEXTAREA')) {
    onEditorChangeLight(target);
  }
}

/** Text inputs update the model on every keystroke but never repaint. */
function onEditorChangeLight(target) {
  const field = target.dataset.field;
  const step = stepById(target.dataset.list, target.dataset.step);
  if (field.startsWith('cond:')) {
    state.editing.condition.params = state.editing.condition.params || {};
    state.editing.condition.params[field.slice(5)] = readControl(target);
    markDirty();
    return;
  }
  if (!step) return;
  if (field === 'delaySeconds') {
    step.delayMs = Math.max(0, Math.round(Number(target.value) * 1000) || 0);
    markDirty();
    return;
  }
  const path = field.startsWith('param:') ? `params.${field.slice(6)}` : field;
  setDeep(step, path, readControl(target));
  markDirty();
}

function readControl(element) {
  if (element.type === 'checkbox') return element.checked;
  if (element.dataset.tristate === '1') {
    if (element.value === '') return null;
    return element.value === 'true';
  }
  if (element.dataset.unit === 's') {
    return Math.max(0, Math.round(Number(element.value) * 1000) || 0);
  }
  if (element.type === 'number' || element.type === 'range') {
    if (element.value === '') return '';
    return Number(element.value);
  }
  if (element.tagName === 'SELECT' && element.value === '') return element.dataset.field?.endsWith('repeat') ? null : '';
  return element.value;
}

function wireStepDrag(root) {
  let dragged = null;
  /*
   * Only the grip starts a drag.
   *
   * The card is draggable, and a range input inside a draggable element hands
   * the gesture to the parent — so reaching for a volume slider moved the whole
   * step instead. The browser tells us nothing useful in dragstart (its target
   * is the card, whatever you actually grabbed), so remember the mousedown.
   */
  let fromHandle = false;
  root.addEventListener('mousedown', (event) => {
    fromHandle = Boolean(event.target.closest('.sf-drag'));
  });
  root.addEventListener('mouseup', () => {
    fromHandle = false;
  });
  root.addEventListener('dragstart', (event) => {
    const card = event.target.closest('.sf-step');
    if (!card) return;
    if (!fromHandle) {
      event.preventDefault();
      return;
    }
    dragged = card;
    card.classList.add('is-dragging');
    event.dataTransfer.effectAllowed = 'move';
  });
  root.addEventListener('dragend', () => {
    dragged?.classList.remove('is-dragging');
    $$('.sf-step', root).forEach((card) => card.classList.remove('is-drop-target'));
    dragged = null;
    fromHandle = false;
  });
  root.addEventListener('dragover', (event) => {
    const card = event.target.closest('.sf-step');
    if (!card || !dragged || card === dragged) return;
    if (card.dataset.list !== dragged.dataset.list) return;
    event.preventDefault();
    $$('.sf-step', root).forEach((node) => node.classList.remove('is-drop-target'));
    card.classList.add('is-drop-target');
  });
  root.addEventListener('drop', (event) => {
    const card = event.target.closest('.sf-step');
    if (!card || !dragged || card === dragged) return;
    if (card.dataset.list !== dragged.dataset.list) return;
    event.preventDefault();
    const listKey = card.dataset.list;
    const list = listOf(listKey);
    const from = list.findIndex((step) => step.id === dragged.dataset.step);
    let to = list.findIndex((step) => step.id === card.dataset.step);
    if (from === -1 || to === -1) return;
    const rect = card.getBoundingClientRect();
    if (event.clientY > rect.top + rect.height / 2) to += 1;
    const [moved] = list.splice(from, 1);
    list.splice(from < to ? to - 1 : to, 0, moved);
    renderEditor();
  });
}

async function testStep(listKey, stepId, button) {
  const step = stepById(listKey, stepId);
  if (!step) return;
  const original = button.innerHTML;
  button.innerHTML = '<span class="sf-spin"></span>';
  button.disabled = true;
  try {
    const result = await api('POST', '/step/test', { step });
    toast(
      result.skipped ? t('ui.editor.stepSkipped', { detail: result.detail }) : result.detail || t('ui.editor.stepRan'),
      result.skipped ? 'warn' : 'success',
      6000,
    );
  } catch {
    /* api() already reported it */
  } finally {
    button.innerHTML = original;
    button.disabled = false;
  }
}

async function saveScene() {
  const scene = state.editing;
  if (!scene) return;
  if (!scene.name.trim()) {
    toast(t('ui.editor.nameRequired'), 'warn');
    return;
  }
  homebridge.showSpinner();
  try {
    await api('POST', '/scenes', { scene });
    const { scenes } = await api('GET', '/scenes');
    state.scenes = scenes;
    state.editingOriginal = JSON.stringify(scene);
    closeEditor({ force: true });
    renderScenes();
    renderPlayers();
    toast(t('ui.scenes.saved', { name: scene.name }), 'success');
  } catch {
    /* reported */
  } finally {
    homebridge.hideSpinner();
  }
}

// ---------------------------------------------------------------- activity

async function loadHistory() {
  try {
    const { history } = await api('GET', '/history');
    const list = $('#history-list');
    if (!history || history.length === 0) {
      list.innerHTML = `
        <div class="sf-empty">
          <span class="sf-empty-mark">${icon('bell', 20)}</span>
          <h3>${escapeHtml(t('ui.activity.emptyTitle'))}</h3>
          <p>${escapeHtml(t('ui.activity.emptyBody'))}</p>
        </div>`;
      return;
    }
    list.innerHTML = history
      .map(
        (entry) => `
      <div class="sf-card">
        <div class="sf-card-head">
          <div>
            <h2>${escapeHtml(entry.sceneName)} ${
              entry.ok ? '' : `<span class="sf-pill sf-pill--danger">${escapeHtml(t('ui.activity.failed'))}</span>`
            }</h2>
            <p class="sf-help">${fmtTime(entry.startedAt)} · ${escapeHtml(entry.trigger)} · ${entry.durationMs} ms${
              entry.conditionResult === undefined
                ? ''
                : ` · ${escapeHtml(t(entry.conditionResult ? 'ui.activity.conditionMet' : 'ui.activity.conditionNotMet'))}`
            }</p>
          </div>
        </div>
        <div class="sf-card-body">
          <div class="sf-result">
            ${entry.steps
              .map(
                (step) => `
              <div class="sf-result-row ${step.ok ? '' : 'is-bad'} ${step.skipped ? 'is-skip' : ''}">
                <span>${step.skipped ? '⏭' : step.ok ? '✓' : '✖'}</span>
                <span><strong>${escapeHtml(step.description)}</strong><br /><code>${escapeHtml(step.detail || '')}</code></span>
              </div>`,
              )
              .join('')}
            ${entry.error ? `<div class="sf-result-row is-bad">${escapeHtml(entry.error)}</div>` : ''}
          </div>
        </div>
      </div>`,
      )
      .join('');
  } catch {
    /* reported */
  }
}

async function loadBackups() {
  try {
    const { backups } = await api('GET', '/backups');
    const list = $('#backup-list');
    if (!backups || backups.length === 0) {
      list.innerHTML = `<p class="sf-help">${escapeHtml(t('ui.tools.noBackups'))}</p>`;
      return;
    }
    list.innerHTML = backups
      .map(
        (backup) => `
      <div class="sf-list-row">
        <div style="flex:1">
          <strong>${fmtTime(backup.savedAt)}</strong>
          <div class="sf-hint">${escapeHtml(
            tn(backup.sceneCount, 'ui.tools.scenesCountOne', 'ui.tools.scenesCount'),
          )} · ${escapeHtml(backup.name)}</div>
        </div>
        <button class="sf-btn sf-btn--ghost sf-btn--sm" data-act="restore-backup" data-name="${escapeHtml(backup.name)}">${escapeHtml(t('ui.tools.restore'))}</button>
      </div>`,
      )
      .join('');
  } catch {
    /* reported */
  }
}

// ---------------------------------------------------------------- wiring

function switchTab(name) {
  $$('.sf-tab').forEach((tab) => tab.classList.toggle('is-active', tab.dataset.tab === name));
  $$('.sf-panel-tab').forEach((panel) => panel.classList.toggle('is-active', panel.dataset.panel === name));
  if (name === 'activity') loadHistory();
  if (name === 'tools') loadBackups();
  if (name === 'sonos') refreshPlayers();
  homebridge.fixScrollHeight?.();
}

function download(filename, text) {
  const blob = new Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function wireApp() {
  $$('.sf-tab').forEach((tab) => tab.addEventListener('click', () => switchTab(tab.dataset.tab)));

  $('#btn-refresh').addEventListener('click', () => bootstrap());
  $('#lang-picker').addEventListener('change', (event) => changeLanguage(event.target.value));
  $('#scene-search').addEventListener('input', (event) => {
    state.sceneFilter = event.target.value;
    renderScenes();
  });
  $('#library-search').addEventListener('input', (event) => {
    state.libraryFilter = event.target.value;
    renderLibrary();
  });
  $('#btn-new-scene').addEventListener('click', () => openEditor(blankScene()));

  $('#btn-rediscover').addEventListener('click', async () => {
    homebridge.showSpinner();
    try {
      await api('POST', '/discover', {});
      await bootstrap({ quiet: true });
      toast(t('ui.sonos.found', { count: state.players.length }), 'success');
    } catch {
      /* reported */
    } finally {
      homebridge.hideSpinner();
    }
  });

  $('#btn-manual-ips').addEventListener('click', async () => {
    const field = $('#manual-ips-input');
    const value = field.value.trim();
    homebridge.showSpinner();
    try {
      // The bridge first, so the addresses are tried now rather than at the
      // next restart — then config.json, so they survive one.
      const result = await api('POST', '/playerIps', { playerIps: value });
      // Remembered, so the panel stays open while addresses are in use — they
      // are how these speakers were found, and the first thing to check if one
      // of them stops answering.
      state.playerIps = value;
      const configs = await homebridge.getPluginConfig();
      if (configs?.length) {
        const [config, ...rest] = configs;
        await homebridge.updatePluginConfig([{ ...config, playerIps: value }, ...rest]);
        await homebridge.savePluginConfig();
      }
      await bootstrap({ quiet: true });
      toast(
        result?.found
          ? t('ui.sonos.found', { count: result.found })
          : t('ui.sonos.manualNothing'),
        result?.found ? 'success' : 'warn',
      );
    } catch {
      /* reported */
    } finally {
      homebridge.hideSpinner();
    }
  });

  $('#btn-reload-library').addEventListener('click', async () => {
    homebridge.showSpinner();
    try {
      state.library = await api('GET', '/library?force=1');
      renderLibrary();
      toast(t('ui.library.reloaded'), 'success');
    } catch {
      /* reported */
    } finally {
      homebridge.hideSpinner();
    }
  });

  $('#btn-reload-history').addEventListener('click', loadHistory);
  $('#btn-reload-backups').addEventListener('click', loadBackups);

  $('#btn-export').addEventListener('click', () => {
    download(`sonos-control-pro-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify({ scenes: state.scenes }, null, 2));
  });

  $('#btn-copy-json').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify({ scenes: state.scenes }, null, 2));
      toast(t('ui.tools.copied'), 'success');
    } catch {
      toast(t('ui.tools.copyFailed'), 'warn');
    }
  });

  $('#file-import').addEventListener('change', async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text());
      const scenes = Array.isArray(parsed) ? parsed : parsed.scenes;
      if (!Array.isArray(scenes)) throw new Error(t('ui.tools.importNoScenes'));
      const replace = await confirmDialog({
        title: t('ui.tools.importFound', { count: scenes.length }),
        confirmLabel: t('ui.tools.importReplace'),
        cancelLabel: t('ui.tools.importMerge'),
      });
      // Both answers import — the choice is only whether to replace or add.
      const result = await api('POST', '/scenes/import', { scenes, mode: replace ? 'replace' : 'merge' });
      state.scenes = result.scenes;
      renderScenes();
      toast(t('ui.tools.imported'), 'success');
    } catch (error) {
      toast(t('ui.tools.importFailed', { message: error.message }), 'error', 7000);
    } finally {
      event.target.value = '';
    }
  });

  // Delegated clicks across the whole app.
  document.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-act]');
    if (!button || button.closest('#editor-body')) return;
    const act = button.dataset.act;

    if (act === 'edit') {
      const scene = state.scenes.find((entry) => entry.id === button.dataset.id);
      if (scene) openEditor(scene);
      return;
    }
    if (act === 'run') {
      button.disabled = true;
      const original = button.textContent;
      button.textContent = t('ui.scenes.running');
      state.runningScenes.add(button.dataset.id);
      try {
        const { result } = await api('POST', '/scenes/run', { id: button.dataset.id });
        const failed = (result.steps || []).filter((step) => !step.ok && !step.skipped);
        if (result.ok) toast(t('ui.scenes.ranIn', { name: result.sceneName, ms: result.durationMs }), 'success');
        else {
          toast(
            t('ui.scenes.runFailed', {
              name: result.sceneName,
              message: failed[0]?.detail || result.error || t('ui.scenes.somethingWrong'),
            }),
            'error',
            8000,
          );
        }
      } catch {
        /* reported */
      } finally {
        state.runningScenes.delete(button.dataset.id);
        button.disabled = false;
        button.textContent = original;
        renderScenes();
      }
      return;
    }
    if (act === 'duplicate') {
      const { scene } = await api('POST', '/scenes/duplicate', { id: button.dataset.id });
      const { scenes } = await api('GET', '/scenes');
      state.scenes = scenes;
      renderScenes();
      toast(t('ui.scenes.created', { name: scene.name }), 'success');
      return;
    }
    if (act === 'delete') {
      const scene = state.scenes.find((entry) => entry.id === button.dataset.id);
      if (!scene) return;
      const ok = await confirmDialog({
        title: t('ui.scenes.confirmDelete', { name: scene.name }),
        body: t('ui.scenes.confirmDeleteBody'),
        confirmLabel: t('common.delete'),
        danger: true,
      });
      if (!ok) return;
      // Keep the whole scene, not just its id: putting it back has to restore
      // every step exactly, including the id Apple Home knows it by.
      const removed = structuredClone(scene);
      const { scenes } = await api('POST', '/scenes/delete', { id: scene.id });
      state.scenes = scenes;
      renderScenes();
      toast(t('ui.scenes.undoDelete', { name: scene.name }), 'success', 9000, {
        label: t('common.undo'),
        onClick: async () => {
          try {
            await api('POST', '/scenes', { scene: removed });
            const restored = await api('GET', '/scenes');
            state.scenes = restored.scenes;
            renderScenes();
            toast(t('ui.scenes.saved', { name: removed.name }), 'success', 3000);
          } catch {
            /* reported */
          }
        },
      });
      return;
    }
    if (act === 'apply-preset') {
      await applyPreset(state.presets[0]?.id, 'merge');
      return;
    }
    if (act === 'new-scene') {
      openEditor(blankScene());
      return;
    }
    if (act === 'preset-apply') {
      await applyPreset(button.dataset.id, button.dataset.mode);
      return;
    }
    if (act === 'restore-backup') {
      const ok = await confirmDialog({
        title: t('ui.tools.confirmRestore'),
        body: t('ui.tools.confirmRestoreBody'),
        confirmLabel: t('ui.tools.restore'),
        danger: true,
      });
      if (!ok) return;
      const { scenes } = await api('POST', '/backups/restore', { name: button.dataset.name });
      state.scenes = scenes;
      renderScenes();
      toast(t('ui.tools.restored'), 'success');
      return;
    }
    if (act === 'adopt-players') {
      const volume = Number($('#adopt-volume')?.value ?? 12);
      const names = unconfiguredPlayers();
      button.disabled = true;
      try {
        const result = await api('POST', '/players/adopt', { names, volume });
        state.scenes = result.scenesList || state.scenes;
        await bootstrap({ quiet: true });
        toast(
          result.scenes.length
            ? t('ui.newPlayers.added', {
                rooms: result.rooms.join(', '),
                scenes: result.scenes.join(', '),
                volume,
              })
            : t('ui.newPlayers.nothingToAdd', { rooms: result.rooms.join(', ') }),
          'success',
          7000,
        );
      } catch {
        /* reported */
      } finally {
        button.disabled = false;
      }
      return;
    }
    if (act === 'player-toggle') {
      const player = state.players.find((entry) => entry.name === button.dataset.name);
      const wasPlaying = player?.playing ?? (player?.state === 'PLAYING' || player?.state === 'TRANSITIONING');
      await api('POST', '/player/transport', {
        player: button.dataset.name,
        command: wasPlaying ? 'pause' : 'play',
      });
      setTimeout(refreshPlayers, 500);
    }
  });

  document.addEventListener('change', async (event) => {
    const target = event.target;
    if (target.dataset.act === 'toggle' && !target.closest('#editor-body')) {
      const scene = state.scenes.find((entry) => entry.id === target.dataset.id);
      if (!scene) return;
      scene.enabled = target.checked;
      await api('POST', '/scenes', { scene });
      renderScenes();
      toast(t(scene.enabled ? 'ui.scenes.turnedOn' : 'ui.scenes.turnedOff', { name: scene.name }), 'success', 2500);
    }
  });

  document.addEventListener('input', async (event) => {
    const target = event.target;
    if (target.id === 'adopt-volume') {
      const label = $('#adopt-volume-value');
      if (label) label.textContent = `${target.value}%`;
      return;
    }
    if (target.dataset.act !== 'player-volume') return;
    const bubble = target.parentElement.querySelector('.sf-volume-value');
    if (bubble) bubble.textContent = `${target.value}%`;
    clearTimeout(target._timer);
    target._timer = setTimeout(() => {
      api('POST', '/player/volume', { player: target.dataset.name, volume: Number(target.value) }, { silent: true }).catch(() => {});
      const player = state.players.find((entry) => entry.name === target.dataset.name);
      if (player) player.volume = Number(target.value);
    }, 260);
  });

  $('#editor-close').addEventListener('click', () => closeEditor());
  $('#editor-cancel').addEventListener('click', () => closeEditor());
  $('#editor-save').addEventListener('click', saveScene);
  $('#editor-test').addEventListener('click', async () => {
    if (!state.editing) return;
    homebridge.showSpinner();
    try {
      await api('POST', '/scenes', { scene: state.editing });
      state.editingOriginal = JSON.stringify(state.editing);
      const { result } = await api('POST', '/scenes/run', { id: state.editing.id });
      renderRunResult(result);
      toast(
        result.ok ? t('ui.editor.ranIn', { ms: result.durationMs }) : t('ui.editor.ranWithErrors'),
        result.ok ? 'success' : 'warn',
        6000,
      );
      const { scenes } = await api('GET', '/scenes');
      state.scenes = scenes;
      renderScenes();
    } catch {
      /* reported */
    } finally {
      homebridge.hideSpinner();
    }
  });

  $('#editor-backdrop').addEventListener('mousedown', (event) => {
    if (event.target.id === 'editor-backdrop') closeEditor();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && state.editing) closeEditor();
    if ((event.metaKey || event.ctrlKey) && event.key === 's' && state.editing) {
      event.preventDefault();
      saveScene();
    }
  });
}

function renderRunResult(result) {
  const container = $('#editor-result');
  if (!container) return;
  container.innerHTML = `
    <section class="sf-section">
      <h3>${escapeHtml(t('ui.editor.result'))}</h3>
      <div class="sf-result">
        ${(result.steps || [])
          .map(
            (step) => `
          <div class="sf-result-row ${step.ok ? '' : 'is-bad'} ${step.skipped ? 'is-skip' : ''}">
            <span>${step.skipped ? '⏭' : step.ok ? '✓' : '✖'}</span>
            <span><strong>${escapeHtml(step.description)}</strong><br /><code>${escapeHtml(step.detail || '')}</code></span>
          </div>`,
          )
          .join('')}
        ${result.error ? `<div class="sf-result-row is-bad">${escapeHtml(result.error)}</div>` : ''}
      </div>
    </section>`;
  container.scrollIntoView({ behavior: 'smooth', block: 'end' });
}

async function applyPreset(id, mode) {
  if (!id) return;
  if (mode === 'replace') {
    const ok = await confirmDialog({
      title: t('ui.tools.presetConfirm'),
      body: t('ui.tools.presetConfirmBody'),
      confirmLabel: t('ui.tools.presetReplace'),
      danger: true,
    });
    if (!ok) return;
  }
  homebridge.showSpinner();
  try {
    const result = await api('POST', '/presets/apply', { id, mode });
    state.scenes = result.scenes;
    renderScenes();
    renderPlayers();
    switchTab('scenes');

    const problems = [];
    if (result.validation?.missingRooms?.length) {
      problems.push(t('ui.tools.missingRooms', { names: result.validation.missingRooms.join(', ') }));
    }
    if (result.validation?.missingFavorites?.length) {
      problems.push(t('ui.tools.missingFavorites', { names: result.validation.missingFavorites.join(', ') }));
    }
    if (problems.length) toast(problems.join(' · '), 'warn', 12000);
    else toast(t('ui.tools.presetLoaded', { count: result.applied }), 'success', 6000);
  } catch {
    /* reported */
  } finally {
    homebridge.hideSpinner();
  }
}

// ---------------------------------------------------------------- start

(async () => {
  wireApp();
  // Read the saved choice first, so the very first paint is already right.
  try {
    const configs = await homebridge.getPluginConfig();
    // '' means "never chosen", which the plugin reads as its house language.
    // Sending 'auto' instead would make the settings and the Homebridge log
    // disagree on an English-locale machine.
    state.configuredLanguage = configs?.[0]?.language || '';
    state.playerIps = configs?.[0]?.playerIps || '';
    const field = $('#manual-ips-input');
    if (field) field.value = state.playerIps;
  } catch {
    state.configuredLanguage = '';
  }
  await bootstrap();
  // Keep the live speaker view honest while it is on screen. Only the Sonos
  // tab is refreshed, and only while the browser tab is actually visible.
  setInterval(() => {
    if (state.editing || document.hidden) return;
    if (document.querySelector('.sf-panel-tab[data-panel="sonos"].is-active')) refreshPlayers();
  }, 5000);

  // Switching to the Sonos tab should show current state at once, not in five
  // seconds' time.
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && document.querySelector('.sf-panel-tab[data-panel="sonos"].is-active')) {
      refreshPlayers();
    }
  });
})();
