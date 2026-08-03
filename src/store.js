'use strict';

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { EventEmitter } = require('node:events');
const { SCHEMA_VERSION, STATE_DIR, LEGACY_STATE_DIRS, SCENES_FILE, BACKUP_DIR } = require('./settings');
const { t } = require('./i18n');

/**
 * Scenes live in their own file next to Homebridge's config, not inside
 * config.json. That keeps config.json small and human-readable, lets the UI
 * save without rewriting Homebridge's own settings, and means a bad edit can
 * never take the whole bridge down.
 *
 * Writes are atomic (temp file + rename) and every save leaves a timestamped
 * backup behind, so there is always a way back.
 */

function newId() {
  return crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex');
}

/**
 * An id we are willing to put in an HTML attribute and match on again.
 *
 * Ids reach us from `scenes.json`, which is hand-editable, and from imported
 * scene files, which is a feature people are told to use. An id containing a
 * quote used to truncate the attribute it was written into: the lookup then
 * missed, and Edit, Run, Delete and the enable switch all silently did nothing
 * for that scene — with no way to remove it from the interface. An id
 * containing markup was worse.
 *
 * Ids are opaque; nobody types them and nobody reads them. So anything outside
 * this alphabet is not sanitised, it is replaced.
 *
 * @param {unknown} value
 * @returns {string}
 */
function safeId(value) {
  const id = String(value ?? '').trim();
  return /^[A-Za-z0-9_.:-]{1,128}$/.test(id) ? id : newId();
}

/**
 * Nothing below is a limit anyone will meet by typing. A 200,000-character
 * scene name is not a long name; it is a file that came from somewhere else.
 * Without a ceiling one imported scene could make scenes.json several megabytes
 * — and every save copies that file into `backups/`, so the cost is paid over
 * and over on a memory card.
 */
const MAX_NAME_LENGTH = 64;
const MAX_TEXT_LENGTH = 512;
const MAX_STEPS = 200;
const MAX_VOLUME_ENTRIES = 200;
/** setTimeout silently fires immediately above this, which is worse than refusing. */
const MAX_TIMER_MS = 2 ** 31 - 1;

function clampText(value, limit) {
  const text = String(value ?? '');
  return text.length > limit ? text.slice(0, limit) : text;
}

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

/** A saved file with its timestamp taken off, so two saves of the same state match. */
function materialPart(buffer) {
  try {
    const parsed = JSON.parse(buffer.toString('utf8'));
    if (Array.isArray(parsed)) return JSON.stringify(parsed);
    const { updatedAt, ...rest } = parsed;
    return JSON.stringify(rest);
  } catch {
    return buffer.toString('utf8');
  }
}

/** Settings are a free-form object. Anything else arriving in that field is not one. */
function safeSettings(raw) {
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
}

/** Fill in every field a scene is allowed to have, so the rest of the code never guards. */
function normalizeScene(raw, index = 0) {
  const scene = raw && typeof raw === 'object' ? raw : {};
  const fallbackName = t('scene.defaultName', { number: index + 1 });
  return {
    id: safeId(scene.id),
    name: clampText(String(scene.name || fallbackName).trim() || fallbackName, MAX_NAME_LENGTH),
    description: clampText(scene.description, MAX_TEXT_LENGTH),
    enabled: scene.enabled !== false,
    order: Number.isFinite(scene.order) ? scene.order : index,
    /** 'momentary' resets itself after running; 'stateful' stays on until switched off. */
    switchType: scene.switchType === 'stateful' ? 'stateful' : 'momentary',
    autoOffMs: clampNumber(scene.autoOffMs, 200, MAX_TIMER_MS, 1000),
    /** 'parallel': every step starts at once and waits out its own delay. */
    mode: scene.mode === 'sequential' ? 'sequential' : 'parallel',
    // A shared scene saying "30 days, so it never gets cut off" used to overflow
    // the timer and abort every run of that scene instantly, blaming the speakers.
    maxRuntimeMs: clampNumber(scene.maxRuntimeMs, 1000, MAX_TIMER_MS, 60000),
    condition: normalizeCondition(scene.condition),
    steps: normalizeSteps(scene.steps),
    elseSteps: normalizeSteps(scene.elseSteps),
    offSteps: normalizeSteps(scene.offSteps),
    icon: clampText(String(scene.icon || 'music'), MAX_NAME_LENGTH),
    hidden: scene.hidden === true,
    createdAt: scene.createdAt || new Date().toISOString(),
    updatedAt: scene.updatedAt || new Date().toISOString(),
  };
}

function normalizeCondition(raw) {
  if (!raw || typeof raw !== 'object' || !raw.type || raw.type === 'always') {
    return { type: 'always', params: {} };
  }
  return { type: String(raw.type), params: raw.params && typeof raw.params === 'object' ? raw.params : {} };
}

function normalizeSteps(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, MAX_STEPS).map((step, index) => normalizeStep(step, index));
}

/**
 * Copy a step's parameters, keeping numbers numeric.
 *
 * The editor writes numbers here, but the file they land in is editable and
 * importable, and the interface renders several of these straight into HTML
 * attributes. A string like `30"><img src=x onerror=…>` in a volume field used
 * to become markup. A number cannot.
 *
 * Only fields that are already numeric in the catalogue are coerced; anything
 * else — names, URIs, ids — is left exactly as it was, because those are
 * escaped where they are rendered.
 */
const NUMERIC_PARAMS = new Set([
  'volume',
  'delta',
  'amount',
  'level',
  'bass',
  'treble',
  'threshold',
  'seconds',
  'ms',
  'volumeDelayMs',
  'groupDelayMs',
  'modeDelayMs',
]);

function normalizeParams(raw) {
  if (!raw || typeof raw !== 'object') return {};
  const params = { ...raw };
  for (const key of Object.keys(params)) {
    if (NUMERIC_PARAMS.has(key) && params[key] !== '' && params[key] !== null) {
      const value = Number(params[key]);
      if (Number.isFinite(value)) params[key] = value;
      else delete params[key];
    }
  }
  // Per-speaker levels are a map of room name to number, and the values are
  // rendered into two attributes each.
  if (params.volumes && typeof params.volumes === 'object') {
    const volumes = {};
    for (const [name, value] of Object.entries(params.volumes).slice(0, MAX_VOLUME_ENTRIES)) {
      const level = Number(value);
      if (Number.isFinite(level)) volumes[String(name)] = Math.max(0, Math.min(100, Math.round(level)));
    }
    params.volumes = volumes;
  }
  return params;
}

function normalizeStep(raw, index = 0) {
  const step = raw && typeof raw === 'object' ? raw : {};
  return {
    id: safeId(step.id),
    action: String(step.action || 'pause'),
    enabled: step.enabled !== false,
    delayMs: clampNumber(step.delayMs, 0, MAX_TIMER_MS, 0),
    stopOnError: step.stopOnError === true,
    note: clampText(step.note, MAX_TEXT_LENGTH),
    order: Number.isFinite(step.order) ? step.order : index,
    target:
      step.target && typeof step.target === 'object'
        ? {
            type: step.target.type || 'all',
            names: Array.isArray(step.target.names) ? step.target.names.filter(Boolean).slice(0, MAX_STEPS) : [],
            coordinator: step.target.coordinator || '',
            filter: step.target.filter || 'any',
          }
        : { type: 'all', names: [], coordinator: '', filter: 'any' },
    params: normalizeParams(step.params),
  };
}

class SceneStore extends EventEmitter {
  /**
   * @param {object} options
   * @param {string} options.storagePath Homebridge's storage directory.
   * @param {object} options.log
   */
  constructor({ storagePath, log }) {
    super();
    this.log = log;
    this.dir = path.join(storagePath, STATE_DIR);
    this.legacyDirs = LEGACY_STATE_DIRS.map((name) => path.join(storagePath, name));
    this.file = path.join(this.dir, SCENES_FILE);
    this.backupDir = path.join(this.dir, BACKUP_DIR);
    /** @type {Map<string, object>} */
    this.scenes = new Map();
    this.settings = {};
    /**
     * True when the file is there but we could not read it — a permission
     * problem, a full descriptor table, an unmounted volume. It is not the same
     * as a broken file, and it must not be treated as "the user has no scenes":
     * while it is set, nothing is written and no switch is removed.
     */
    this.degraded = false;
    /** The last backup failure, so it can be reported rather than swallowed. */
    this.lastBackupError = null;
    this._watcher = null;
    this._reloadTimer = null;
    this._lastWriteAt = 0;
    /** Saves are chained: two at once would race on the same temp file. */
    this._saveChain = Promise.resolve();
    this._saveCounter = 0;
  }

  ensureDirs() {
    fs.mkdirSync(this.dir, { recursive: true });
    fs.mkdirSync(this.backupDir, { recursive: true });
  }

  /**
   * Carry scenes over from a folder this plugin used under an earlier name.
   * Copies rather than moves, so the old data stays put as a safety net.
   * The newest previous name wins.
   * @private
   */
  _migrateLegacyState() {
    if (fs.existsSync(this.file)) return;
    for (const legacyDir of this.legacyDirs) {
      const legacyFile = path.join(legacyDir, SCENES_FILE);
      if (!fs.existsSync(legacyFile)) continue;
      try {
        this.ensureDirs();
        fs.copyFileSync(legacyFile, this.file);
        const legacyBackups = path.join(legacyDir, BACKUP_DIR);
        if (fs.existsSync(legacyBackups)) {
          for (const name of fs.readdirSync(legacyBackups)) {
            fs.copyFileSync(path.join(legacyBackups, name), path.join(this.backupDir, name));
          }
        }
        this.log.info(t('log.migrated', { from: path.basename(legacyDir), to: STATE_DIR }));
      } catch (error) {
        this.log.warn(
          t('log.migrateFailed', { from: path.basename(legacyDir), message: error.message }),
        );
      }
      return;
    }
  }

  /**
   * Load from disk. Never throws.
   *
   * Two failures live here and they are not the same failure, though this code
   * used to treat them as one.
   *
   * A file we can read but not parse is broken: it gets quarantined and an
   * empty list is loaded. That is recoverable, and the backups are right there.
   *
   * A file we cannot read *at all* is something else. One `sudo` command that
   * leaves scenes.json owned by root, a descriptor table full on a busy box, a
   * NAS mount that has not come back yet — the file is intact and the scenes
   * are fine. Wiping them for that reason cost everything: every switch
   * unregistered from Apple Home, taking its room assignment and every
   * automation pointing at it, and then the next save wrote an empty list over
   * a file that was never damaged. So an unreadable file now leaves the scenes
   * exactly as they are and blocks writing until somebody has looked at it.
   */
  load() {
    try {
      this.ensureDirs();
      this._migrateLegacyState();
    } catch (error) {
      this.degraded = true;
      this.log.error(t('log.storeUnreadable', { message: error.message }));
      return this.list();
    }
    if (!fs.existsSync(this.file)) {
      this.scenes = new Map();
      this.settings = {};
      this.degraded = false;
      return this.list();
    }
    let raw;
    try {
      raw = fs.readFileSync(this.file, 'utf8');
    } catch (error) {
      this.degraded = true;
      this.log.error(t('log.storeUnreadable', { message: error.message }));
      return this.list();
    }
    try {
      const parsed = JSON.parse(raw);
      const scenes = Array.isArray(parsed) ? parsed : parsed.scenes || [];
      this.settings = safeSettings(Array.isArray(parsed) ? null : parsed.settings);
      this.replaceAll(scenes);
      this.degraded = false;
      if (this._idsReassigned) {
        // Write the new id back at once. Left in the file, the duplicate was
        // resolved to a *different* random id on every single load — so Apple
        // Home deleted and recreated that switch on every restart, and its room
        // and its automations went with it each time.
        this._idsReassigned = false;
        this.save().catch((error) => this.log.warn(t('log.saveFailed', { message: error.message })));
      }
      return this.list();
    } catch (error) {
      this._quarantine(error);
      this.scenes = new Map();
      this.settings = {};
      this.degraded = false;
      return this.list();
    }
  }

  /**
   * Keep a copy of a file we could not parse, so nothing is thrown away.
   *
   * This used to write a fresh full-size copy on every failing load — and every
   * handler in the settings backend calls load() when the bridge is down, so
   * clicking around a broken installation wrote copy after identical copy, none
   * of which anything ever deleted. The name now describes the file it came
   * from, so the same broken file is only ever kept once.
   * @private
   */
  _quarantine(error) {
    const prefix = `${path.basename(this.file)}.broken-`;
    let suffix;
    try {
      const stats = fs.statSync(this.file);
      suffix = `${Math.round(stats.mtimeMs)}-${stats.size}`;
    } catch {
      suffix = String(Date.now());
    }
    const quarantine = path.join(this.dir, `${prefix}${suffix}.json`);
    try {
      if (!fs.existsSync(quarantine)) fs.copyFileSync(this.file, quarantine);
      const kept = fs
        .readdirSync(this.dir)
        .filter((name) => name.startsWith(prefix))
        .sort();
      while (kept.length > 8) {
        const oldest = kept.shift();
        try {
          fs.unlinkSync(path.join(this.dir, oldest));
        } catch {
          /* best effort */
        }
      }
    } catch {
      /* best effort */
    }
    this.log.error(
      t('log.brokenStore', { message: error.message, backup: path.basename(quarantine) }),
    );
  }

  /** Scenes in display order. */
  list() {
    return [...this.scenes.values()].sort((a, b) => a.order - b.order || a.name.localeCompare(b.name, 'da'));
  }

  get(id) {
    return this.scenes.get(id) || null;
  }

  /**
   * Persist the current set, atomically, with a rolling backup.
   *
   * Calls are serialised: two saves landing together would write the same
   * temp file and could rename a half-written one into place.
   */
  save(options = {}) {
    // Take the snapshot now, not when the queued write finally runs. Between
    // those two moments the file watcher can reload from disk and replace the
    // whole map — and the edit that asked for this save would then be written
    // back out as though it had never happened, while the browser was told it
    // succeeded. Whoever asked to save meant "save what I have right now".
    const snapshot = { settings: safeSettings(this.settings), scenes: this.list() };
    this._saveChain = this._saveChain.then(
      () => this._save(options, snapshot),
      () => this._save(options, snapshot),
    );
    return this._saveChain;
  }

  /** @private */
  async _save({ backup = true } = {}, snapshot = null) {
    // Refusing to write is the whole point of the degraded flag: we could not
    // read the file, so we have no idea what would be overwritten.
    if (this.degraded) throw new Error(t('error.storeDegraded'));
    this.ensureDirs();
    const payload = {
      schemaVersion: SCHEMA_VERSION,
      updatedAt: new Date().toISOString(),
      settings: snapshot ? snapshot.settings : safeSettings(this.settings),
      scenes: snapshot ? snapshot.scenes : this.list(),
    };
    const serialised = `${JSON.stringify(payload, null, 2)}\n`;

    if (backup && fs.existsSync(this.file)) {
      try {
        await this._writeBackup();
        this.lastBackupError = null;
      } catch (error) {
        // Swallowing this meant a user could lose their backups months before
        // finding out: saves kept succeeding and the Backups tab kept showing
        // a list, frozen at the day the disk filled up.
        this.lastBackupError = error.message;
        this.log.warn(t('log.backupFailed', { message: error.message }));
      }
    }

    this._saveCounter += 1;
    const temp = `${this.file}.tmp-${process.pid}-${this._saveCounter}`;
    await fsp.writeFile(temp, serialised, 'utf8');
    await fsp.rename(temp, this.file);
    this._lastWriteAt = Date.now();
    this.emit('saved', payload.scenes);
    return payload;
  }

  /** @private Backup file names, oldest first. */
  async _backupNames() {
    const entries = await fsp.readdir(this.backupDir).catch(() => []);
    return entries.filter((name) => name.startsWith('scenes-') && name.endsWith('.json')).sort();
  }

  /**
   * Keep a copy of the file we are about to replace.
   *
   * Two things this got wrong, and both of them emptied the feature of its
   * point. Every save wrote a backup — including the twenty saves that an
   * afternoon of dragging scenes around produces — so all twenty slots filled
   * with byte-identical copies taken seconds apart, and the week-old state
   * anyone would actually want back was gone. And the retention was a flat
   * count, so the oldest thing you could reach was always the same afternoon.
   * @private
   */
  async _writeBackup() {
    const current = await fsp.readFile(this.file);
    const existing = await this._backupNames();
    if (existing.length) {
      const newest = await fsp
        .readFile(path.join(this.backupDir, existing[existing.length - 1]))
        .catch(() => null);
      // Compared on the scenes and the settings, not byte for byte: every save
      // stamps a fresh `updatedAt`, so no two files are ever identical and a
      // byte comparison would never skip anything.
      if (newest && materialPart(newest) === materialPart(current)) return;
    }
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    await fsp.writeFile(path.join(this.backupDir, `scenes-${stamp}.json`), current);
    await this._pruneBackups();
  }

  /**
   * Keep the last ten, whatever they are, plus the newest one from each day
   * that has one — so a busy afternoon cannot push out last week.
   * @private
   */
  async _pruneBackups() {
    const names = await this._backupNames();
    const keep = new Set(names.slice(-10));
    const newestPerDay = new Map();
    for (const name of names) newestPerDay.set(name.slice(7, 17), name);
    for (const name of newestPerDay.values()) keep.add(name);

    const doomed = names.filter((name) => !keep.has(name));
    const survivors = names.filter((name) => keep.has(name));
    while (survivors.length > 40) doomed.push(survivors.shift());

    for (const name of doomed) {
      await fsp.unlink(path.join(this.backupDir, name)).catch(() => {});
    }
  }

  async listBackups() {
    this.ensureDirs();
    const entries = await fsp.readdir(this.backupDir).catch(() => []);
    const files = entries.filter((name) => name.startsWith('scenes-') && name.endsWith('.json')).sort().reverse();
    return Promise.all(
      files.map(async (name) => {
        const stats = await fsp.stat(path.join(this.backupDir, name)).catch(() => null);
        let sceneCount = 0;
        try {
          const parsed = JSON.parse(await fsp.readFile(path.join(this.backupDir, name), 'utf8'));
          sceneCount = (parsed.scenes || parsed || []).length;
        } catch {
          /* corrupt backup: still list it, just without a count */
        }
        return { name, savedAt: stats?.mtime?.toISOString() || null, sceneCount };
      }),
    );
  }

  async restoreBackup(name) {
    if (!/^scenes-[\w.-]+\.json$/.test(name)) throw new Error(t('error.badBackupName'));
    const source = path.join(this.backupDir, name);
    const raw = await fsp.readFile(source, 'utf8');
    const parsed = JSON.parse(raw);
    const scenes = Array.isArray(parsed) ? parsed : parsed.scenes || [];
    this.replaceAll(scenes);
    // The settings came out of the same file and used to be left behind, so a
    // restore produced a state that was neither the backup nor what you had.
    this.settings = safeSettings(Array.isArray(parsed) ? null : parsed.settings);
    // Restoring is the deliberate act of overwriting whatever is on disk, which
    // makes it the way out of a store we had refused to write to.
    this.degraded = false;
    await this.save();
    return this.list();
  }

  // --------------------------------------------------------------- mutations

  /**
   * Where a new scene goes: after everything else.
   *
   * This used to be `this.scenes.size`, which is the same thing only while
   * nothing has ever been deleted. Delete one of three scenes and add a new
   * one, and it took an order another scene already held — landing in the
   * middle of the list instead of at the end, and putting a duplicate somewhere
   * other than next to its original.
   * @private
   */
  _nextOrder() {
    let highest = -1;
    for (const scene of this.scenes.values()) {
      if (Number.isFinite(scene.order) && scene.order > highest) highest = scene.order;
    }
    return highest + 1;
  }

  upsert(sceneInput) {
    const input = sceneInput && typeof sceneInput === 'object' ? sceneInput : {};
    const existing = input.id ? this.scenes.get(input.id) : null;
    const merged = normalizeScene(
      { ...(existing || {}), ...input, updatedAt: new Date().toISOString() },
      existing ? existing.order : this._nextOrder(),
    );
    this.scenes.set(merged.id, merged);
    return merged;
  }

  remove(id) {
    return this.scenes.delete(id);
  }

  duplicate(id) {
    const source = this.scenes.get(id);
    if (!source) throw new Error(t('error.sceneMissing'));
    const order = this._nextOrder();
    const copy = normalizeScene(
      {
        ...JSON.parse(JSON.stringify(source)),
        id: newId(),
        name: t('scene.copySuffix', { name: source.name }),
        order,
        createdAt: new Date().toISOString(),
      },
      order,
    );
    // Fresh ids for every step, otherwise the UI keys collide.
    for (const list of ['steps', 'elseSteps', 'offSteps']) {
      copy[list] = copy[list].map((step) => ({ ...step, id: newId() }));
    }
    this.scenes.set(copy.id, copy);
    return copy;
  }

  /**
   * Put the given ids in the given order, and renumber everything else after
   * them rather than trusting the caller to have sent the whole list. A partial
   * list used to leave the scenes it omitted holding orders that now collided
   * with the ones it had just assigned.
   */
  reorder(orderedIds) {
    const placed = new Set();
    let index = 0;
    for (const id of Array.isArray(orderedIds) ? orderedIds : []) {
      const scene = this.scenes.get(id);
      if (!scene || placed.has(id)) continue;
      placed.add(id);
      scene.order = index;
      index += 1;
    }
    for (const scene of this.list()) {
      if (placed.has(scene.id)) continue;
      scene.order = index;
      index += 1;
    }
    return this.list();
  }

  replaceAll(scenes) {
    this.scenes = new Map();
    this._idsReassigned = false;
    for (const [index, scene] of (scenes || []).entries()) {
      const normalized = normalizeScene(scene, index);
      // Two scenes sharing an id would silently collapse into one, taking the
      // other's switch out of Apple Home with it.
      if (this.scenes.has(normalized.id)) {
        this.log.warn(t('log.duplicateId', { id: normalized.id, name: normalized.name }));
        this._idsReassigned = true;
        normalized.id = newId();
        for (const list of ['steps', 'elseSteps', 'offSteps']) {
          normalized[list] = normalized[list].map((step) => ({ ...step, id: newId() }));
        }
      }
      this.scenes.set(normalized.id, normalized);
    }
    return this.list();
  }

  /** Add scenes without disturbing existing ones; names are made unique. */
  merge(scenes) {
    const existingNames = new Set([...this.scenes.values()].map((scene) => scene.name.toLowerCase()));
    const added = [];
    let order = this._nextOrder();
    // An import is a file, and a file can contain anything. `replaceAll` has
    // always coped with a null entry; merge threw on it, so the same file
    // imported in "replace" mode worked and in "add" mode returned a 500.
    for (const raw of Array.isArray(scenes) ? scenes : []) {
      const scene = raw && typeof raw === 'object' ? raw : {};
      const base =
        clampText(String(scene.name ?? '').trim(), MAX_NAME_LENGTH) ||
        t('scene.defaultName', { number: order + 1 });
      let name = base;
      let suffix = 2;
      while (existingNames.has(name.toLowerCase())) {
        name = `${base} ${suffix}`;
        suffix += 1;
      }
      existingNames.add(name.toLowerCase());
      const normalized = normalizeScene({ ...scene, id: newId(), name, order: order++ }, order);
      normalized.steps = normalized.steps.map((step) => ({ ...step, id: newId() }));
      normalized.elseSteps = normalized.elseSteps.map((step) => ({ ...step, id: newId() }));
      normalized.offSteps = normalized.offSteps.map((step) => ({ ...step, id: newId() }));
      this.scenes.set(normalized.id, normalized);
      added.push(normalized);
    }
    return added;
  }

  // ----------------------------------------------------------------- watching

  /**
   * Watch scenes.json so edits made in the UI process show up in the running
   * bridge within a second — no restart, no "did it save?" guessing.
   * @param {() => void} onChange
   */
  watch(onChange) {
    if (this._watcher) return;
    this.ensureDirs();
    try {
      this._watcher = fs.watch(this.dir, { persistent: false }, (_event, filename) => {
        if (filename && filename !== SCENES_FILE) return;
        // Ignore the echo of our own write.
        if (Date.now() - this._lastWriteAt < 400) return;
        clearTimeout(this._reloadTimer);
        this._reloadTimer = setTimeout(() => {
          try {
            this.load();
            onChange();
          } catch (error) {
            this.log.warn(t('log.reloadFailed', { message: error.message }));
          }
        }, 250);
        this._reloadTimer.unref?.();
      });
    } catch (error) {
      this.log.debug?.(t('log.watchUnavailable', { message: error.message }));
    }
  }

  unwatch() {
    if (this._watcher) {
      this._watcher.close();
      this._watcher = null;
    }
    clearTimeout(this._reloadTimer);
  }
}

module.exports = { SceneStore, normalizeScene, normalizeStep, newId };
