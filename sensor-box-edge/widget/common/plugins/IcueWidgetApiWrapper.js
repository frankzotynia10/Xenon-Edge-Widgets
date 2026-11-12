/******************************************************************************
 **
 ** File      IcueWidgetApiWrapper.js
 ** Author    Maksym Aldokhin
 ** Copyright (c) 2026, Corsair Memory, Inc. All Rights Reserved.
 **
 ** This file is part of Corsair iCUE Software.
 **
 ******************************************************************************/

/**
 * Widget API Wrapper
 *
 * Universal wrapper for Qt WebChannel plugins that provides Promise-based API.
 * Works around Qt WebChannel limitation where functions cannot be serialized.
 *
 * Usage:
 *   const api = new IcueWidgetApiWrapper(plugin);
 *   api.request(plugin.getSensorValue, sensorId).then(value => {
 *       console.log("Sensor value:", value);
 *   });
 */

class IcueWidgetApiWrapper {
	constructor(plugin, timeoutMs = 5000) {
		this.plugin = plugin;
		this.timeoutMs = timeoutMs;
		this.pendingRequests = new Map();
		this.nextRequestId = 0;

		if (this.plugin && this.plugin.asyncResponse) {
			this.plugin.asyncResponse.connect(this._handleAsyncResponse.bind(this));
		}
	}

	_nextRequestId() {
		return this.nextRequestId++;
	}

	_handleAsyncResponse(requestId, value) {
		const pending = this.pendingRequests.get(requestId);
		if (pending) {
			if (pending.timeoutId) {
				clearTimeout(pending.timeoutId);
			}
			pending.resolve(value);
			this.pendingRequests.delete(requestId);
		}
	}

	request(method, ...args) {
		return new Promise((resolve, reject) => {
			const requestId = this._nextRequestId();
			method.call(this.plugin, requestId, ...args);
			const timeoutId = setTimeout(() => {
				if (this.pendingRequests.has(requestId)) {
					this.pendingRequests.delete(requestId);
					reject(new Error("Request timeout"));
				}
			}, this.timeoutMs);
			this.pendingRequests.set(requestId, { resolve, reject, timeoutId });
		});
	}
}
