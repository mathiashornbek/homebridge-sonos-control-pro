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

    this.state = false;
    this._autoOffTimer = null;

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

  /** @private */
  _setState(value) {
    this.state = value;
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
      this.state = value;
      const branch = value ? 'on' : 'off';
      if (branch === 'off' && (scene.offSteps || []).length === 0) {
        // Nothing configured for "off": treat it as a plain reset of the switch.
        this.log.debug?.(t('log.statefulNoOff', { name: scene.name }));
        return;
      }
      this.platform.runner.run(scene.id, { branch, trigger: t('trigger.homekit') }).catch((error) => {
        this.log.error(t('log.sceneFailed', { name: scene.name, message: error.message }));
      });
      return;
    }

    // Momentary: only a rising edge means anything.
    if (!value) {
      this.state = false;
      return;
    }

    this.state = true;
    this.platform.runner.run(scene.id, { branch: 'on', trigger: t('trigger.homekit') }).catch((error) => {
      this.log.error(t('log.sceneFailed', { name: scene.name, message: error.message }));
    });

    this._autoOffTimer = setTimeout(() => {
      this._setState(false);
    }, scene.autoOffMs || 1000);
    this._autoOffTimer.unref?.();
  }

  dispose() {
    clearTimeout(this._autoOffTimer);
  }
}

module.exports = { SceneSwitch };
