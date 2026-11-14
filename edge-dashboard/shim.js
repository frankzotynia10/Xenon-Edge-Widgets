// Stand-in for the bits of iCUE our widgets use, injected at the end of each widget's <head>.
//  - Each <meta name="x-icue-property"> becomes a global, from the saved setting or its data-default.
//  - icueEvents.onICUEInitialized() fires after load, and iCUE_initialized becomes true.
//  - Setting changes from the dashboard arrive by postMessage and go to icueEvents.onDataUpdated({settings}).
(function () {
  'use strict';
  var saved = window.__edgeSettings || {};
  var plugins = window.plugins = window.plugins || {};
  function tr(s) { return s; }

  // ---------- iCUE's sensor plugin (plugins.Sensorsdataprovider), backed by LibreHardwareMonitor ----------
  // Same calls and signals Sensor Box uses: getSensorValue(req, id) / getSensorUnits(req, id) answer
  // through asyncResponse(req, value); sensorValueChanged(id, value) fires when a watched value changes.
  function Signal() {
    var fns = [];
    return {
      connect: function (f) { if (typeof f === 'function') fns.push(f); },
      disconnect: function (f) { fns = fns.filter(function (g) { return g !== f; }); },
      emit: function () { var a = arguments; fns.forEach(function (f) { try { f.apply(null, a); } catch (e) { console.error(e); } }); }
    };
  }
  var sensorState = { byId: {}, auto: {}, ok: false, loaded: false }, watched = {}, waiters = [], polling = false;
  function realId(id) { return sensorState.auto[id] || id; }
  function sensorOf(id) { return sensorState.byId[realId(id)]; }
  function pollSensors() {
    fetch((window.__edgeApi || 'http://127.0.0.1:6800') + '/api/sensors', { cache: 'no-store' })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        var byId = {};
        (d.sensors || []).forEach(function (s) { byId[s.id] = s; });
        var before = sensorState.byId;
        sensorState = { byId: byId, auto: d.auto || {}, ok: !!d.ok, loaded: true };
        Object.keys(watched).forEach(function (id) {
          var s = sensorOf(id), old = before[realId(id)];
          if (s && (!old || old.value !== s.value)) SP.sensorValueChanged.emit(id, String(s.value));
          if (s && (!old || old.unit !== s.unit)) SP.sensorUnitsChanged.emit(id, s.unit);
        });
      })
      .catch(function () { sensorState.loaded = true; sensorState.ok = false; })
      .then(function () { var w = waiters; waiters = []; w.forEach(function (f) { f(); }); });
  }
  function whenLoaded(f) {
    if (!polling) { polling = true; pollSensors(); setInterval(pollSensors, 1000); }
    if (sensorState.loaded) f(); else waiters.push(f);
  }
  var SP = {
    asyncResponse: Signal(), sensorValueChanged: Signal(), sensorUnitsChanged: Signal(),
    getDefaultSensorIdBlock: function (type, hint) { return 'auto:' + type + ':' + hint; },
    getSensorValue: function (req, id) { watched[id] = 1; whenLoaded(function () { var s = sensorOf(id); SP.asyncResponse.emit(req, s && isFinite(s.value) ? String(s.value) : ''); }); },
    getSensorUnits: function (req, id) { watched[id] = 1; whenLoaded(function () { var s = sensorOf(id); SP.asyncResponse.emit(req, s ? s.unit : ''); }); }
  };
  if (!plugins.Sensorsdataprovider) plugins.Sensorsdataprovider = SP;

  // ---------- iCUE's FPS plugin (plugins.Fpsdataprovider), backed by PresentMon via /api/fps ----------
  // getFpsAvailable(req) / getCurrentFps(req) answer through asyncResponse(req, value);
  // fpsUpdated(fps) and fpsAvailabilityChanged(bool) fire as they change. Polls only once a widget asks.
  var fpsState = { available: false, fps: 0, loaded: false }, fpsWaiters = [], fpsPolling = false;
  function pollFps() {
    fetch((window.__edgeApi || 'http://127.0.0.1:6800') + '/api/fps', { cache: 'no-store' })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        var was = fpsState;
        fpsState = { available: !!d.available, fps: d.fps || 0, loaded: true };
        if (was.available !== fpsState.available) FP.fpsAvailabilityChanged.emit(fpsState.available);
        if (fpsState.available) FP.fpsUpdated.emit(fpsState.fps);
      })
      .catch(function () { if (fpsState.available) FP.fpsAvailabilityChanged.emit(false); fpsState = { available: false, fps: 0, loaded: true }; })
      .then(function () { var w = fpsWaiters; fpsWaiters = []; w.forEach(function (f) { f(); }); });
  }
  function whenFps(f) {
    if (!fpsPolling) { fpsPolling = true; pollFps(); setInterval(pollFps, 1000); }
    if (fpsState.loaded) f(); else fpsWaiters.push(f);
  }
  var FP = {
    asyncResponse: Signal(), fpsUpdated: Signal(), fpsAvailabilityChanged: Signal(),
    getFpsAvailable: function (req) { whenFps(function () { FP.asyncResponse.emit(req, fpsState.available); }); },
    getCurrentFps: function (req) { whenFps(function () { FP.asyncResponse.emit(req, fpsState.available ? fpsState.fps : 0); }); }
  };
  if (!plugins.Fpsdataprovider) plugins.Fpsdataprovider = FP;

  function evalExpr(expr) {
    if (expr == null || expr === '') return undefined;
    try { return new Function('tr', 'plugins', 'return (' + expr + ');')(tr, plugins); } catch (e) { return expr; }
  }

  var props = {};
  var metas = document.querySelectorAll('meta[name="x-icue-property"]');
  for (var i = 0; i < metas.length; i++) {
    var m = metas[i], key = m.getAttribute('content');
    if (!key) continue;
    var value = Object.prototype.hasOwnProperty.call(saved, key) ? saved[key] : evalExpr(m.getAttribute('data-default'));
    props[key] = value;
    window[key] = value;
  }

  // Widgets assign `icueEvents = {...}` (sometimes in strict mode), so the global has to exist.
  if (!('icueEvents' in window)) window.icueEvents = undefined;
  window.iCUE_initialized = false;

  function events() { return window.icueEvents || {}; }

  window.addEventListener('load', function () {
    setTimeout(function () {
      window.iCUE_initialized = true;
      var ev = events();
      if (typeof ev.onICUEInitialized === 'function') { try { ev.onICUEInitialized(); } catch (e) { console.error(e); } }
      var se = window.pluginSensorsdataproviderEvents;
      if (se && typeof se.onInitialized === 'function') { try { se.onInitialized(); } catch (e) { console.error(e); } }
      var fe = window.pluginFpsdataproviderEvents;
      if (fe && typeof fe.onInitialized === 'function') { try { fe.onInitialized(); } catch (e) { console.error(e); } }
    }, 0);
  });

  window.addEventListener('message', function (e) {
    var d = e.data;
    if (!d || d.type !== 'edge-settings' || !d.settings) return;
    for (var k in d.settings) if (Object.prototype.hasOwnProperty.call(d.settings, k)) { props[k] = d.settings[k]; window[k] = d.settings[k]; }
    var ev = events();
    if (typeof ev.onDataUpdated === 'function') { try { ev.onDataUpdated({ settings: d.settings }); } catch (err) { console.error(err); } }
  });
})();
