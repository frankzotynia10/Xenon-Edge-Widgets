/******************************************************************************
 **
 ** File      SimpleSensorApiWrapper.js
 ** Author    Maksym Aldokhin
 ** Copyright (c) 2026, Corsair Memory, Inc. All Rights Reserved.
 **
 ** This file is part of Corsair iCUE Software.
 **
 ******************************************************************************/

/**
 * Sensor API
 *
 * Sensor-specific wrapper that extends IcueWidgetApiWrapper.
 * Provides convenient methods for sensor data retrieval.
 *
 * For initialization use sensorsplugin.
 *
 * Usage:
 *   const api = new SimpleSensorApiWrapper(sensorsplugin);
 *   api.getSensorValue(sensorId).then(value => {
 *       console.log("Sensor value:", value);
 *   });
 */

class SimpleSensorApiWrapper extends IcueWidgetApiWrapper {
	constructor(sensorPlugin, timeoutMs = 5000) {
		super(sensorPlugin, timeoutMs);
	}

	getSensorValue(sensorId) {
		return this.request(this.plugin.getSensorValue, sensorId);
	}

	getSensorUnits(sensorId) {
		return this.request(this.plugin.getSensorUnits, sensorId);
	}

	getSensorName(sensorId) {
		return this.request(this.plugin.getSensorName, sensorId);
	}

	getSensorDeviceName(sensorId) {
		return this.request(this.plugin.getSensorDeviceName, sensorId);
	}

	getSensorType(sensorId) {
		return this.request(this.plugin.getSensorType, sensorId);
	}

	getSensorKind(sensorId) {
		return this.request(this.plugin.getSensorKind, sensorId);
	}

	getAllSensorIds() {
		return this.request(this.plugin.getAllSensorIds);
	}

	sensorIsConnected(sensorId) {
		return this.request(this.plugin.sensorIsConnected, sensorId);
	}
}
