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

/** Fill in every field a scene is allowed to have, so the rest of the code never guards. */
function normalizeScene(raw, index = 0) {
  const scene = raw && typeof raw === 'object' ? raw : {};
  const fallbackName = t('scene.defaultName', { number: index + 1 });
  return {
    id: scene.id || newId(),
    name: String(scene.name || fallbackName).trim() || fallbackName,
    description: String(scene.description || ''),
    enabled: scene.enabled !== false,
    order: Number.isFinite(scene.order) ? scene.order : index,
    /** 'momentary' resets itself after running; 'stateful' stays on until switched off. */
    switchType: scene.switchType === 'stateful' ? 'stateful' : 'momentary',
    autoOffMs: Number.isFinite(scene.autoOffMs) ? Math.max(200, scene.autoOffMs) : 1000,
    /** 'parallel': every step starts at once and waits out its own delay. */
    mode: scene.mode === 'sequential' ? 'sequential' : 'parallel',
    maxRuntimeMs: Number.isFinite(scene.maxRuntimeMs) ? scene.maxRuntimeMs : 60000,
    condition: normalizeCondition(scene.condition),
    steps: normalizeSteps(scene.steps),
    elseSteps: normalizeSteps(scene.elseSteps),
    offSteps: normalizeSteps(scene.offSteps),
    icon: String(scene.icon || 'music'),
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
  return raw.map((step, index) => normalizeStep(step, index));
}

function normalizeStep(raw, index = 0) {
  const step = raw && typeof raw === 'object' ? raw : {};
  return {
    id: step.id || newId(),
    action: String(step.action || 'pause'),
    enabled: step.enabled !== false,
    delayMs: Number.isFinite(step.delayMs) ? Math.max(0, step.delayMs) : 0,
    stopOnError: step.stopOnError === true,
    note: String(step.note || ''),
    order: Number.isFinite(step.order) ? step.order : index,
    target:
      step.target && typeof step.target === 'object'
        ? {
            type: step.target.type || 'all',
            names: Array.isArray(step.target.names) ? step.target.names.filter(Boolean) : [],
            coordinator: step.target.coordinator || '',
            filter: step.target.filter || 'any',
          }
        : { type: 'all', names: [], coordinator: '', filter: 'any' },
    params: step.params && typeof step.params === 'object' ? { ...step.params } : {},
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

  /** Load from disk. Never throws: a broken file is quarantined, not fatal. */
  load() {
    this.ensureDirs();
    this._migrateLegacyState();
    if (!fs.existsSync(this.file)) {
      this.scenes = new Map();
      this.settings = {};
      return this.list();
    }
    try {
      const raw = fs.readFileSync(this.file, 'utf8');
      const parsed = JSON.parse(raw);
      const scenes = Array.isArray(parsed) ? parsed : parsed.scenes || [];
      this.settings = (!Array.isArray(parsed) && parsed.settings) || {};
      this.replaceAll(scenes);
      return this.list();
    } catch (error) {
      const quarantine = `${this.file}.broken-${Date.now()}`;
      try {
        fs.copyFileSync(this.file, quarantine);
      } catch {
        /* best effort */
      }
      this.log.error(
        t('log.brokenStore', { message: error.message, backup: path.basename(quarantine) }),
      );
      this.scenes = new Map();
      this.settings = {};
      return this.list();
    }
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
    this._saveChain = this._saveChain.then(
      () => this._save(options),
      () => this._save(options),
    );
    return this._saveChain;
  }

  /** @private */
  async _save({ backup = true } = {}) {
    this.ensureDirs();
    const payload = {
      schemaVersion: SCHEMA_VERSION,
      updatedAt: new Date().toISOString(),
      settings: this.settings,
      scenes: this.list(),
    };
    const serialised = `${JSON.stringify(payload, null, 2)}\n`;

    if (backup && fs.existsSync(this.file)) {
      await this._writeBackup().catch(() => {});
    }

    this._saveCounter += 1;
    const temp = `${this.file}.tmp-${process.pid}-${this._saveCounter}`;
    await fsp.writeFile(temp, serialised, 'utf8');
    await fsp.rename(temp, this.file);
    this._lastWriteAt = Date.now();
    this.emit('saved', this.list());
    return payload;
  }

  /** @private Keep the last 20 versions around. */
  async _writeBackup() {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    await fsp.copyFile(this.file, path.join(this.backupDir, `scenes-${stamp}.json`));
    const entries = (await fsp.readdir(this.backupDir))
      .filter((name) => name.startsWith('scenes-') && name.endsWith('.json'))
      .sort();
    while (entries.length > 20) {
      const oldest = entries.shift();
      await fsp.unlink(path.join(this.backupDir, oldest)).catch(() => {});
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
    await this.save();
    return this.list();
  }

  // --------------------------------------------------------------- mutations

  upsert(sceneInput) {
    const existing = sceneInput.id ? this.scenes.get(sceneInput.id) : null;
    const merged = normalizeScene(
      { ...(existing || {}), ...sceneInput, updatedAt: new Date().toISOString() },
      existing ? existing.order : this.scenes.size,
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
    const copy = normalizeScene(
      {
        ...JSON.parse(JSON.stringify(source)),
        id: newId(),
        name: t('scene.copySuffix', { name: source.name }),
        order: this.scenes.size,
        createdAt: new Date().toISOString(),
      },
      this.scenes.size,
    );
    // Fresh ids for every step, otherwise the UI keys collide.
    for (const list of ['steps', 'elseSteps', 'offSteps']) {
      copy[list] = copy[list].map((step) => ({ ...step, id: newId() }));
    }
    this.scenes.set(copy.id, copy);
    return copy;
  }

  reorder(orderedIds) {
    orderedIds.forEach((id, index) => {
      const scene = this.scenes.get(id);
      if (scene) scene.order = index;
    });
    return this.list();
  }

  replaceAll(scenes) {
    this.scenes = new Map();
    for (const [index, scene] of (scenes || []).entries()) {
      const normalized = normalizeScene(scene, index);
      // Two scenes sharing an id would silently collapse into one, taking the
      // other's switch out of Apple Home with it.
      if (this.scenes.has(normalized.id)) {
        this.log.warn(t('log.duplicateId', { id: normalized.id, name: normalized.name }));
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
    let order = this.scenes.size;
    for (const scene of scenes || []) {
      let name = scene.name;
      let suffix = 2;
      while (existingNames.has(String(name).toLowerCase())) {
        name = `${scene.name} ${suffix}`;
        suffix += 1;
      }
      existingNames.add(String(name).toLowerCase());
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
