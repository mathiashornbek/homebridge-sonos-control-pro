'use strict';

const { t } = require('./i18n');

/**
 * The rule Apple applies to a name, as Homebridge checks it.
 *
 * Copied from `@homebridge/hap-nodejs`, `lib/util/checkName.js`: the name has
 * to begin and end with a letter or a number, and only the characters in the
 * middle class are allowed in between. Note that brackets are permitted inside
 * a name but cannot end one.
 *
 * A name that fails is not refused outright, which would at least be visible.
 * Homebridge writes a warning to the log and carries on, and the Home app may
 * then decline to add the accessory or show it as unresponsive.
 */
const HOMEKIT_NAME = /^[\p{L}\p{N}][\p{L}\p{N}\p{Zs}’'&!._:;()/,-]*[\p{L}\p{N}]$/u;
const HOMEKIT_DISALLOWED = /[^\p{L}\p{N}\p{Zs}’'&!._:;()/,-]/gu;
const HOMEKIT_EDGES = /^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu;

/**
 * The name to hand HomeKit for a scene.
 *
 * The user's own name is left exactly as they typed it everywhere they can see
 * it — the editor, the scene list, the log. This is only what goes to HomeKit,
 * and only when what they typed would not be accepted.
 *
 * @param {string} name
 * @returns {string}
 */
function homekitName(name) {
  const wanted = String(name ?? '').trim();
  if (HOMEKIT_NAME.test(wanted)) return wanted;

  const cleaned = wanted
    // A space rather than nothing, so removing an emoji between two words does
    // not run them together.
    .replace(HOMEKIT_DISALLOWED, ' ')
    // Brackets are allowed in the middle but cannot end a name, and trimming
    // only the closing one leaves the opening one hanging: "Musik (aften"
    // reads worse than "Musik aften". They go together or not at all. Names
    // that are already acceptable never reach this line, so a bracket the user
    // can live with is left alone.
    .replace(/[()]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(HOMEKIT_EDGES, '')
    .trim();

  // A single character satisfies Apple's intent but not the expression, which
  // wants a first *and* a last one. Nothing can be done about that short of
  // inventing a character, so it is left as written.
  return cleaned || t('scene.homekitFallback');
}

/**
 * One HomeKit switch per scene.
 *
 * Momentary switches flip themselves back off once the scene has been kicked
 * off, which is what makes them behave like a button in the Home app. Stateful
 * switches stay on until you turn them off, and turning them off runs the
 * scene's "sluk"-steps.
 */
class SceneSwitch {
  /**
   * @param {import('./platform').SonosControlPlatform} platform
   * @param {object} accessory  PlatformAccessory
   * @param {object} scene
   */
  constructor(platform, accessory, scene) {
    this.platform = platform;
    this.accessory = accessory;
    this.scene = scene;
    this.log = platform.log;

    const { Service, Characteristic } = platform.api.hap;
    this.Characteristic = Characteristic;

    // A stateful switch that was on when Homebridge restarted used to come back
    // off while the music was still playing — and the next press then ran the
    // "on" branch again instead of turning it off. Homebridge persists an
    // accessory's context across restarts, so that is where the answer belongs.
    this.state = scene.switchType === 'stateful' && accessory.context?.on === true;
    this._autoOffTimer = null;
    const label = homekitName(scene.name);
    accessory.displayName = label;

    const information =
      accessory.getService(Service.AccessoryInformation) ||
      accessory.addService(Service.AccessoryInformation);
    information
      .setCharacteristic(Characteristic.Manufacturer, 'Sonos Control Pro')
      .setCharacteristic(
        Characteristic.Model,
        t(scene.switchType === 'stateful' ? 'model.stateful' : 'model.momentary'),
      )
      .setCharacteristic(Characteristic.SerialNumber, scene.id)
      .setCharacteristic(Characteristic.FirmwareRevision, platform.version);

    this.service =
      accessory.getService(Service.Switch) || accessory.addService(Service.Switch, label);

    // A service carries its own name, separate from the characteristic and from
    // the accessory, and it is set once — when the service is created. Renaming
    // a scene updated the other two and left this one behind, and because it is
    // written into Homebridge's accessory cache, the name the scene had on the
    // day it was made came back on every restart. That is what HomeKit was
    // shown, and what it complained about, months after the scene had been
    // renamed. Set it every time, not only at creation.
    this.service.displayName = label;
    this.service.setCharacteristic(Characteristic.Name, label);
    if (Characteristic.ConfiguredName) {
      if (!this.service.testCharacteristic(Characteristic.ConfiguredName)) {
        this.service.addOptionalCharacteristic(Characteristic.ConfiguredName);
      }
      this.service.setCharacteristic(Characteristic.ConfiguredName, label);
    }

    this.service
      .getCharacteristic(Characteristic.On)
      .onGet(() => this.state)
      .onSet((value) => this._handleSet(Boolean(value)));
  }

  /** Re-point this accessory at an edited scene without rebuilding it. */
  update(scene) {
    const previousName = this.scene.name;
    this.scene = scene;
    if (previousName !== scene.name) {
      const label = homekitName(scene.name);
      this.service.displayName = label;
      this.service.updateCharacteristic(this.Characteristic.Name, label);
      if (this.Characteristic.ConfiguredName && this.service.testCharacteristic(this.Characteristic.ConfiguredName)) {
        this.service.updateCharacteristic(this.Characteristic.ConfiguredName, label);
      }
      this.accessory.displayName = label;
    }
    const information = this.accessory.getService(this.platform.api.hap.Service.AccessoryInformation);
    information?.updateCharacteristic(
      this.Characteristic.Model,
      t(scene.switchType === 'stateful' ? 'model.stateful' : 'model.momentary'),
    );

    // A scene switched from stateful to momentary must not stay stuck on.
    if (scene.switchType !== 'stateful' && this.state) this._setState(false);
  }

  /** @private Record the switch's position, so a restart does not invent one. */
  _remember(value) {
    this.state = value;
    if (this.accessory.context) this.accessory.context.on = value;
  }

  /** @private Record it, and tell Apple Home. */
  _setState(value) {
    this._remember(value);
    this.service.updateCharacteristic(this.Characteristic.On, value);
  }

  /**
   * @private
   * Never throws: an exception here reaches HAP and Apple Home shows the
   * accessory as "No Response", which is a far worse outcome than a scene
   * that failed and said so in the log.
   */
  async _handleSet(value) {
    try {
      await this._applySet(value);
    } catch (error) {
      this.log.error(t('log.sceneError', { name: this.scene.name, message: error?.message || error }));
    }
  }

  /** @private */
  async _applySet(value) {
    const scene = this.scene;
    clearTimeout(this._autoOffTimer);

    if (scene.switchType === 'stateful') {
      this._remember(value);
      const branch = value ? 'on' : 'off';
      if (branch === 'off' && (scene.offSteps || []).length === 0) {
        // Nothing configured for "off": treat it as a plain reset of the switch.
        this.log.debug?.(t('log.statefulNoOff', { name: scene.name }));
        return;
      }
      this.platform.runner
        .run(scene.id, { branch, trigger: t('trigger.homekit') })
        .then((result) => {
          // The runner reports a failed scene by *resolving* with ok:false; it
          // only rejects for an unknown scene id. So the catch below never fired
          // for the case it was written for, and a stateful switch sat there
          // showing on after a scene that had reached nothing at all.
          if (branch === 'on' && result && result.ok === false && !result.aborted) {
            this._setState(false);
          }
        })
        .catch((error) => {
          this._setState(false);
          this.log.error(t('log.sceneFailed', { name: scene.name, message: error.message }));
        });
      return;
    }

    // Momentary: only a rising edge means anything.
    if (!value) {
      this._remember(false);
      return;
    }

    this._remember(true);
    this.platform.runner.run(scene.id, { branch: 'on', trigger: t('trigger.homekit') }).catch((error) => {
      this.log.error(t('log.sceneFailed', { name: scene.name, message: error.message }));
    });

    // Nothing catches a throw from inside a timer, and an uncaught one takes
    // the whole bridge down — every other plugin with it.
    this._autoOffTimer = setTimeout(() => {
      try {
        this._setState(false);
      } catch (error) {
        this.log.debug?.(t('log.sceneError', { name: scene.name, message: error?.message || error }));
      }
    }, scene.autoOffMs || 1000);
    this._autoOffTimer.unref?.();
  }

  dispose() {
    clearTimeout(this._autoOffTimer);
  }
}

module.exports = { SceneSwitch, homekitName, HOMEKIT_NAME };
