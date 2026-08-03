'use strict';

const { EventEmitter, setMaxListeners } = require('node:events');
const { ACTIONS, playersForStep, describeStep, isExclusiveAction } = require('./actions');
const { evaluateCondition } = require('./conditions');
const { t } = require('../i18n');

/**
 * Executes scenes.
 *
 * Timing model:
 * every step is launched at the same instant and each one waits out its own
 * delay first. Step 4 with a 2 s delay therefore fires 2 s after the scene
 * started — not 2 s after step 3 finished. A scene can opt into strict
 * sequential execution instead, which is occasionally what you want.
 */

const DEFAULT_MAX_RUNTIME_MS = 60000;
/** Above this setTimeout fires immediately instead of waiting. */
const MAX_TIMER_MS = 2 ** 31 - 1;

function sleep(ms, signal) {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener?.('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(Object.assign(new Error(t('error.aborted')), { aborted: true }));
    };
    if (signal?.aborted) {
      clearTimeout(timer);
      reject(Object.assign(new Error(t('error.aborted')), { aborted: true }));
      return;
    }
    signal?.addEventListener?.('abort', onAbort, { once: true });
  });
}

class SceneRunner extends EventEmitter {
  /**
   * @param {object} options
   * @param {import('../sonos/system').SonosSystem} options.system
   * @param {object} options.log
   * @param {() => Map<string, object>} options.getScenes  id → scene
   */
  constructor({ system, log, getScenes }) {
    super();
    this.system = system;
    this.log = log;
    this.getScenes = getScenes;
    /**
     * In-flight runs, keyed by run rather than by scene.
     *
     * Two runs of the *same* scene can legitimately overlap when the scene is
     * only a volume nudge — pressing "louder" twice means twice. Keying by
     * scene would let the second press evict the first's bookkeeping and leave
     * an orphan that nobody ever cancels or clears.
     * @type {Map<number, object>}
     */
    this.running = new Map();
    this._nextRunId = 1;
    /** Shared snapshot memory across scenes. */
    this.snapshots = new Map();
    /** Ring buffer of recent runs, surfaced in the UI's activity feed. */
    this.history = [];
    this.historyLimit = 60;
  }

  isRunning(sceneId) {
    return this.runsFor(sceneId).length > 0;
  }

  /** Every in-flight run of one scene. */
  runsFor(sceneId) {
    return [...this.running.values()].filter((entry) => entry.sceneId === sceneId);
  }

  /** Scene ids with at least one run in flight, for the settings UI. */
  runningSceneIds() {
    return [...new Set([...this.running.values()].map((entry) => entry.sceneId))];
  }

  /**
   * Does this scene decide what plays or who is grouped with whom?
   *
   * Those scenes conflict with each other and only the newest should win.
   * A volume nudge or a pause is not in that category — it can happily run
   * while music is being set up.
   *
   * @private
   */
  _isExclusive(scene) {
    if (scene.allowConcurrent === true) return false;
    const lists = [scene.steps, scene.elseSteps, scene.offSteps];
    return lists.some((list) =>
      (list || []).some((step) => step.enabled !== false && isExclusiveAction(step.action)),
    );
  }

  /** Stop every in-flight run of a scene. */
  cancel(sceneId, reason = t('reason.restarted')) {
    let stopped = false;
    for (const entry of this.runsFor(sceneId)) {
      this._cancelEntry(entry, reason);
      stopped = true;
    }
    return stopped;
  }

  /** @private */
  _cancelEntry(entry, reason) {
    entry.cancelled = true;
    entry.controller.abort(reason);
    this.running.delete(entry.runId);
  }

  cancelAll() {
    for (const entry of [...this.running.values()]) this._cancelEntry(entry, t('reason.shutdown'));
  }

  /**
   * Run a scene.
   *
   * Guards the impatient cases before anything is sent to a speaker:
   *
   *  - The same scene pressed again while it is still running is one press,
   *    not two. Tapping a tile three times in a second must not tear a
   *    half-built group apart and start over twice.
   *  - The same scene switched the other way (on → off) *does* mean something
   *    new, so that cancels and runs the other branch.
   *  - Volume, pause and skip are not exclusive: pressing "louder" twice
   *    genuinely means twice, and those runs are allowed to overlap.
   *
   * @param {string} sceneId
   * @param {object} [options]
   * @param {'on'|'off'} [options.branch] Which step list to run for stateful switches.
   * @param {string} [options.trigger]    Where the run came from, for the log.
   * @param {Set<string>} [options.stack] Guards against scene→scene recursion.
   * @returns {Promise<{ok: boolean, sceneName: string, steps: object[], error?: string}>}
   */
  run(sceneId, options = {}) {
    const branch = options.branch === 'off' ? 'off' : 'on';
    // A scene chaining back to one that is already in its own call stack is a
    // loop, and _run is what detects and reports that. Handing back the
    // in-flight promise here instead would make the scene wait for itself, and
    // it would wait for ever.
    const recursive = options.stack ? options.stack.has(sceneId) : false;
    const inFlight = recursive
      ? null
      : this.runsFor(sceneId).find(
          (entry) => entry.exclusive && entry.branch === branch && entry.promise,
        );

    if (inFlight) {
      this.log.info(t('log.sceneAlreadyRunning', { name: inFlight.name }));
      return inFlight.promise;
    }

    return this._run(sceneId, { ...options, branch });
  }

  /** @private */
  async _run(sceneId, { branch = 'on', trigger = 'HomeKit', stack = new Set() } = {}) {
    const scenes = this.getScenes();
    const scene = scenes.get(sceneId);
    if (!scene) throw new Error(t('error.sceneGone', { id: sceneId }));
    if (scene.enabled === false) {
      this.log.info(t('log.sceneDisabled', { name: scene.name }));
      return { ok: true, sceneName: scene.name, steps: [], skipped: true };
    }
    if (stack.has(sceneId)) {
      this.log.warn(t('log.sceneLoop', { name: scene.name }));
      return { ok: false, sceneName: scene.name, steps: [], error: t('error.loopDetected') };
    }

    const exclusive = this._isExclusive(scene);

    if (exclusive) {
      // Re-triggering the same scene the other way round (on → off) is a new
      // intention, so the old direction is abandoned. Overlapping runs of a
      // *non*-exclusive scene are left alone: two volume nudges must both land.
      // A run that another scene asked for is not a repeat press: two scenes
      // that both end by chaining to "Everything off" must not shoot each
      // other's copy of it half-finished. Those are de-duplicated in run()
      // instead, so the second caller waits for the first one's result.
      if (stack.size === 0) {
        for (const entry of this.runsFor(sceneId)) {
          this._cancelEntry(entry, t('reason.newPress'));
        }
      }

      // Two scenes that both decide what plays and who is grouped must not run
      // at the same time. Pressing a second one means "no, this instead", and
      // letting them fight makes both crawl: measured at 6 s and 18 s for two
      // scenes that take well under a second on their own.
      for (const entry of [...this.running.values()]) {
        if (entry.sceneId === sceneId) continue;
        if (!entry.exclusive) continue;
        // Never cancel whoever asked for this run — a scene that chains to
        // another must not shoot its own caller.
        if (stack.has(entry.sceneId)) continue;
        this.log.info(t('log.sceneSuperseded', { name: entry.name, other: scene.name }));
        this._cancelEntry(entry, t('reason.superseded', { name: scene.name }));
      }
    }

    const controller = new AbortController();
    // A scene with a dozen parallel steps attaches a dozen abort listeners to
    // the same signal; without this Node warns about a leak that is not one.
    setMaxListeners(0, controller.signal);
    const startedAt = Date.now();
    const runId = this._nextRunId;
    this._nextRunId += 1;

    // The promise is created here rather than by the caller, so a nested run —
    // which never goes through run() — is just as de-duplicable as any other.
    let settle;
    const settled = new Promise((resolve) => {
      settle = resolve;
    });
    const entry = {
      runId,
      sceneId,
      controller,
      startedAt,
      branch,
      name: scene.name,
      exclusive,
      promise: settled,
    };
    this.running.set(runId, entry);
    this.emit('start', { sceneId, sceneName: scene.name, branch, trigger });

    const record = {
      sceneId,
      sceneName: scene.name,
      branch,
      trigger,
      startedAt,
      steps: [],
      ok: true,
    };

    try {
      // Discovery first. The scene's condition asks the speakers what they are
      // doing, and asking before the household is known is asking nobody: every
      // "is nothing playing here?" came back true for the first few seconds
      // after a restart, so the scenes written specifically not to interrupt
      // music were the ones that interrupted it.
      await this.system.ensureReady().catch(() => {});

      const steps = await this._selectSteps(scene, branch, record);
      this.log.info(
        t(branch === 'off' ? 'log.sceneStartOff' : 'log.sceneStart', {
          name: scene.name,
          trigger,
          count: steps.length,
        }),
      );

      const context = {
        system: this.system,
        log: this.log,
        sceneId,
        signal: controller.signal,
        snapshots: this.snapshots,
        sleep: (ms) => sleep(ms, controller.signal),
        runScene: async (targetId) => {
          const nested = new Set(stack);
          nested.add(sceneId);
          // Through run(), not _run(): that is where a scene already in flight
          // is recognised, so two parents chaining to the same child both wait
          // for the one copy of it instead of racing to restart it.
          const result = await this.run(targetId, {
            branch: 'on',
            trigger: t('trigger.scene', { name: scene.name }),
            stack: nested,
          });
          // A nested failure has to surface here, or the calling step would
          // report success for something that never happened.
          if (!result.ok) {
            throw new Error(result.error || t('error.sceneFailedNested', { name: result.sceneName }));
          }
          return result.sceneName;
        },
      };

      const timeout = setTimeout(() => {
        controller.abort(t('reason.timeout'));
      }, this._budgetFor(scene, steps));
      if (timeout.unref) timeout.unref();

      try {
        if (scene.mode === 'sequential') {
          await this._runSequential(steps, context, record);
        } else {
          await this._runParallel(steps, context, record);
        }
      } finally {
        clearTimeout(timeout);
      }

      // A run that was cancelled did not succeed — it simply stopped. Counting
      // it as a success would make a chained scene report that it ran something
      // that never happened.
      record.aborted = controller.signal.aborted;
      record.ok =
        !record.aborted && record.steps.every((step) => step.ok || (step.skipped && !step.aborted));
      record.finishedAt = Date.now();
      record.durationMs = record.finishedAt - startedAt;
      this.log.info(
        t(record.ok ? 'log.sceneDone' : 'log.sceneDoneWithErrors', {
          name: scene.name,
          ms: record.durationMs,
        }),
      );
      return { ...record, sceneName: scene.name };
    } catch (error) {
      record.ok = false;
      record.error = error?.message || String(error);
      record.finishedAt = Date.now();
      record.durationMs = record.finishedAt - startedAt;
      record.aborted = true;
      if (error?.aborted || controller.signal.aborted) {
        this.log.info(
          t('log.sceneAborted', {
            name: scene.name,
            reason: controller.signal.reason || t('reason.unknown'),
          }),
        );
      } else {
        this.log.error(t('log.sceneFailed', { name: scene.name, message: record.error }));
      }
      return { ...record, sceneName: scene.name };
    } finally {
      this.running.delete(runId);
      this._remember(record);
      this.emit('finish', record);
      settle({ ...record, sceneName: scene.name });
    }
  }

  /**
   * @private How long this run is allowed to take.
   *
   * The ceiling used to be a flat sixty seconds, and the scene's own waits were
   * not counted against it. There is no fade action, so the way anyone writes a
   * gentle wake-up is `setVolume 8`, `playFavorite`, `wait 90`, `setVolume 30` —
   * and that scene was cut off in the middle, every time: the bedroom left at a
   * whisper, the switch on, the log saying "cancelled". The setting that would
   * have raised the ceiling was not in the editor either.
   *
   * So the budget now covers what the scene actually asked to wait for, plus
   * half a minute for the speakers to answer.
   */
  _budgetFor(scene, steps) {
    let sequential = 0;
    let longest = 0;
    for (const step of steps) {
      const seconds = step.action === 'wait' ? Number(step.params?.seconds) : 0;
      const wait = Number.isFinite(seconds) ? Math.max(0, seconds * 1000) : 0;
      const own = (Number(step.delayMs) || 0) + wait;
      sequential += own;
      if (own > longest) longest = own;
    }
    const planned = scene.mode === 'sequential' ? sequential : longest;
    const configured = Number(scene.maxRuntimeMs);
    const base = Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_MAX_RUNTIME_MS;
    return Math.min(MAX_TIMER_MS, Math.max(1000, base, planned + 30000));
  }

  /** @private Pick the right list of steps and evaluate the scene condition. */
  async _selectSteps(scene, branch, record) {
    if (branch === 'off') return (scene.offSteps || []).filter((step) => step.enabled !== false);

    const hasCondition = scene.condition && scene.condition.type && scene.condition.type !== 'always';
    if (!hasCondition) return (scene.steps || []).filter((step) => step.enabled !== false);

    const passed = await evaluateCondition(this.system, scene.condition);
    record.conditionResult = passed;
    this.log.debug?.(
      t('log.conditionResult', {
        name: scene.name,
        result: t(passed ? 'ui.activity.conditionMet' : 'ui.activity.conditionNotMet'),
      }),
    );
    const chosen = passed ? scene.steps : scene.elseSteps;
    return (chosen || []).filter((step) => step.enabled !== false);
  }

  /** @private Everything starts now; each step waits out its own delay. */
  async _runParallel(steps, context, record) {
    await Promise.all(
      steps.map(async (step, index) => {
        const entry = this._newStepRecord(step, index);
        record.steps.push(entry);
        try {
          if (step.delayMs > 0) await sleep(step.delayMs, context.signal);
          if (context.signal.aborted) {
            entry.skipped = true;
            entry.aborted = true;
            entry.detail = t('result.abortedBeforeStart');
            return;
          }
          await this._runStep(step, context, entry);
        } catch (error) {
          this._failStep(entry, error, context);
        }
      }),
    );
    record.steps.sort((a, b) => a.index - b.index);
  }

  /** @private Strictly one after another — each delay is measured from the previous step. */
  async _runSequential(steps, context, record) {
    for (const [index, step] of steps.entries()) {
      const entry = this._newStepRecord(step, index);
      record.steps.push(entry);
      try {
        if (step.delayMs > 0) await sleep(step.delayMs, context.signal);
        if (context.signal.aborted) {
          entry.skipped = true;
          entry.aborted = true;
          entry.detail = t('result.abortedBeforeStart');
          continue;
        }
        await this._runStep(step, context, entry);
      } catch (error) {
        this._failStep(entry, error, context);
        if (step.stopOnError) break;
      }
    }
  }

  /** @private */
  _newStepRecord(step, index) {
    return {
      index,
      action: step.action,
      description: describeStep(step),
      ok: false,
      skipped: false,
      aborted: false,
      detail: '',
      durationMs: 0,
    };
  }

  /** @private */
  async _runStep(step, context, entry) {
    const definition = ACTIONS[step.action];
    if (!definition) throw new Error(t('error.unknownAction', { action: step.action }));

    const startedAt = Date.now();
    const resolved = await playersForStep(this.system, step);

    if (resolved.missing.length > 0) {
      this.log.warn(
        t('log.unknownSpeakerInStep', {
          description: describeStep(step),
          names: resolved.missing.join(', '),
        }),
      );
    }
    if (definition.targets !== 'none' && resolved.players.length === 0) {
      // Every speaker this step names has gone — the usual cause is a room
      // renamed in the Sonos app. That is not a step that had nothing to do; it
      // is a step that could not find its target, and recording it as a success
      // meant the scene went green, a stateful switch stayed on, and the only
      // trace was a single warning line in the log.
      if (resolved.missing.length > 0) {
        throw new Error(t('error.speakersGone', { names: resolved.missing.join(', ') }));
      }
      entry.skipped = true;
      entry.ok = true;
      entry.detail =
        resolved.skipped.length > 0
          ? t('result.noneWerePlaying', { count: resolved.skipped.length })
          : t('result.nothingMatched');
      entry.durationMs = Date.now() - startedAt;
      this.log.debug?.(t('log.stepSkipped', { description: entry.description, detail: entry.detail }));
      return;
    }

    // Give the action a look at what was filtered out so it can say so, and
    // hand it players whose network calls are cancelled together with the
    // scene — otherwise an interrupted run keeps issuing commands.
    const augmented = { ...step, _skipped: resolved.skipped };
    const bound = resolved.players.map((player) => player.withSignal(context.signal));
    entry.detail = await definition.run(context, augmented, bound);
    entry.ok = true;
    entry.durationMs = Date.now() - startedAt;
    if (entry.durationMs > 3000) {
      // Naming the slow step turns "why did that take ten seconds?" into an
      // answer instead of a guess.
      this.log.warn(
        t('log.stepSlow', {
          description: entry.description,
          ms: entry.durationMs,
          detail: entry.detail,
        }),
      );
    } else {
      this.log.debug?.(t('log.stepOk', { detail: entry.detail, ms: entry.durationMs }));
    }
  }

  /** @private */
  _failStep(entry, error, context) {
    if (error?.aborted || context.signal.aborted) {
      entry.skipped = true;
      entry.aborted = true;
      entry.detail = t('result.aborted');
      return;
    }
    entry.ok = false;
    entry.detail = error?.message || String(error);
    this.log.warn(t('log.stepFailed', { description: entry.description, detail: entry.detail }));
  }

  /** @private */
  _remember(record) {
    this.history.unshift({
      sceneId: record.sceneId,
      sceneName: record.sceneName,
      branch: record.branch,
      trigger: record.trigger,
      startedAt: record.startedAt,
      durationMs: record.durationMs || 0,
      ok: record.ok,
      error: record.error || '',
      conditionResult: record.conditionResult,
      steps: record.steps.map((step) => ({
        description: step.description,
        ok: step.ok,
        skipped: step.skipped,
        detail: step.detail,
        durationMs: step.durationMs,
      })),
    });
    if (this.history.length > this.historyLimit) this.history.length = this.historyLimit;
  }
}

module.exports = { SceneRunner, sleep, DEFAULT_MAX_RUNTIME_MS };
