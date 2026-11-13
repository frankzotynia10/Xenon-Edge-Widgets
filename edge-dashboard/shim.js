// Stand-in for the bits of iCUE our widgets use, injected at the end of each widget's <head>.
//  - Each <meta name="x-icue-property"> becomes a global, from the saved setting or its data-default.
//  - icueEvents.onICUEInitialized() fires after load, and iCUE_initialized becomes true.
//  - Setting changes from the dashboard arrive by postMessage and go to icueEvents.onDataUpdated({settings}).
(function () {
  'use strict';
  var saved = window.__edgeSettings || {};
  var plugins = window.plugins = window.plugins || {};
  function tr(s) { return s; }

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
