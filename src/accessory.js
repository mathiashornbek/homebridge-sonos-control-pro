'use strict';

const { t } = require('./i18n');

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
    accessory.displayName = scene.name;

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
      accessory.getService(Service.Switch) || accessory.addService(Service.Switch, scene.name);

    this.service.setCharacteristic(Characteristic.Name, scene.name);
    if (Characteristic.ConfiguredName) {
      if (!this.service.testCharacteristic(Characteristic.ConfiguredName)) {
        this.service.addOptionalCharacteristic(Characteristic.ConfiguredName);
      }
      this.service.setCharacteristic(Characteristic.ConfiguredName, scene.name);
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
      this.service.updateCharacteristic(this.Characteristic.Name, scene.name);
      if (this.Characteristic.ConfiguredName && this.service.testCharacteristic(this.Characteristic.ConfiguredName)) {
        this.service.updateCharacteristic(this.Characteristic.ConfiguredName, scene.name);
      }
      this.accessory.displayName = scene.name;
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

module.exports = { SceneSwitch };
