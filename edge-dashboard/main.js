// Edge dashboard: shows our widgets full-screen on the Xeneon Edge without iCUE.
//   npx electron .          on the Edge (borderless, always on top, never takes focus)
//   npx electron . --dev    a framed 1280x360 preview window on the main screen
// A tray icon has the controls; everything that happens goes to dashboard.log.
'use strict';
const { app, BrowserWindow, Menu, Tray, globalShortcut, screen, shell, nativeImage } = require('electron');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const server = require('./server');

const DEV = process.argv.includes('--dev');
const EDGE = { width: 2560, height: 720 };
const LAYOUT = path.join(__dirname, 'layout.json');
const PREFS = path.join(__dirname, 'prefs.json');
const LOG = path.join(__dirname, 'dashboard.log');

// ---------- log (dashboard.log, rotated to dashboard.log.old at 1 MB) ----------
function log(...parts) {
  const line = `[${new Date().toISOString()}] ${parts.map(p => (p instanceof Error ? p.stack : String(p))).join(' ')}\n`;
  try {
    if (fs.existsSync(LOG) && fs.statSync(LOG).size > 1024 * 1024) fs.renameSync(LOG, LOG + '.old');
    fs.appendFileSync(LOG, line);
  } catch { /* never let logging break the dashboard */ }
  process.stdout.write(line);
}
process.on('uncaughtException', e => log('Uncaught error:', e));
process.on('unhandledRejection', e => log('Unhandled rejection:', e));

if (!app.requestSingleInstanceLock()) { app.quit(); process.exit(0); }

const readJson = (f, fallback) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return fallback; } };
const prefs = () => ({ mouseLock: readJson(LAYOUT, {}).mouseLock !== false, ...readJson(PREFS, {}) });
function setPref(key, value) { const p = readJson(PREFS, {}); p[key] = value; fs.writeFileSync(PREFS, JSON.stringify(p, null, 2) + '\n'); }

// The Edge is the display whose physical resolution is 2560x720.
function findEdge() {
  return screen.getAllDisplays().find(d =>
    Math.round(d.size.width * d.scaleFactor) === EDGE.width && Math.round(d.size.height * d.scaleFactor) === EDGE.height);
}

let url = null, win = null, status = 'Starting';
function setStatus(s) { if (s !== status) { status = s; log('Status:', s); } updateTray(); }

// ---------- the dashboard window ----------
let waiting = null;
function createWindow() {
  const edge = DEV ? null : findEdge();
  if (!DEV && !edge) {
    setStatus('Edge not found, waiting');
    clearTimeout(waiting); waiting = setTimeout(createWindow, 5000);
    return;
  }
  win = new BrowserWindow(DEV
    ? { width: 1280, height: 360, useContentSize: true, title: 'Edge dashboard (preview)', backgroundColor: '#000000' }
    // thickFrame: false drops Windows' invisible 8 px resize border, which otherwise grows the
    // window to 2576x728 and leaves a sliver of desktop showing at the top of the Edge.
    : { ...edge.bounds, frame: false, thickFrame: false, resizable: false, movable: false, alwaysOnTop: true, skipTaskbar: true,
        focusable: false, fullscreenable: false, backgroundColor: '#000000', title: 'Edge dashboard' });
  win.setMenuBarVisibility(false);
  if (!DEV) { win.setAlwaysOnTop(true, 'screen-saver'); win.setBounds(edge.bounds); }
  win.loadURL(url);
  win.webContents.on('did-fail-load', (e, code, desc, u) => log(`Page failed to load (${code} ${desc}): ${u}`));
  win.on('closed', () => { win = null; if (DEV && !quitting) app.quit(); });
  setStatus(DEV ? 'Preview window (dev mode)' : `On the Edge at ${edge.bounds.x},${edge.bounds.y}`);
}

// Re-pin after the Edge is unplugged/replugged or Windows rearranges displays.
function repin(reason) {
  if (DEV) { if (win) win.show(); return; }
  const edge = findEdge();
  if (!edge) { if (win) win.hide(); setStatus('Edge not found, waiting'); return; }
  if (!win) return createWindow();
  win.setBounds(edge.bounds); win.showInactive();
  if (reason) log(`Re-pinned to the Edge (${reason})`);
  setStatus(`On the Edge at ${edge.bounds.x},${edge.bounds.y}`);
}

// ---------- mouse lock (mouse-lock.ps1): keeps the mouse off the Edge, touch still works ----------
let lockProc = null, quitting = false, lockRestart = null;
function startMouseLock() {
  if (DEV || lockProc || !prefs().mouseLock) return;
  const s = readJson(LAYOUT, {}).screen || EDGE;
  lockProc = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, 'mouse-lock.ps1'),
    '-Width', String(s.width), '-Height', String(s.height)], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  log('Mouse lock started');
  lockProc.stdout.on('data', d => String(d).trim().split(/\r?\n/).forEach(l => l && log('Mouse lock:', l)));
  lockProc.stderr.on('data', d => log('Mouse lock error:', String(d).trim()));
  lockProc.on('exit', code => {
    lockProc = null; updateTray();
    if (quitting || !prefs().mouseLock) return;
    log(`Mouse lock exited (${code}), restarting in 3 s`);
    lockRestart = setTimeout(startMouseLock, 3000);
  });
  updateTray();
}
function stopMouseLock() { clearTimeout(lockRestart); if (lockProc) { lockProc.kill(); log('Mouse lock stopped'); } }

// ---------- settings window (main screen, where there's a mouse and keyboard) ----------
let settingsWin = null;
function openSettings() {
  if (settingsWin) { settingsWin.show(); settingsWin.focus(); return; }
  const wa = screen.getPrimaryDisplay().workArea;
  const w = Math.min(1100, wa.width), h = Math.min(820, wa.height);
  settingsWin = new BrowserWindow({ x: wa.x + Math.round((wa.width - w) / 2), y: wa.y + Math.round((wa.height - h) / 2), width: w, height: h,
    title: 'Edge widget settings', backgroundColor: '#0f1012', autoHideMenuBar: true, icon: path.join(__dirname, 'resources', 'tray.png') });
  settingsWin.loadURL(url + 'settings');
  settingsWin.on('closed', () => { settingsWin = null; });
}

// ---------- page hotkeys (Alt+Left / Alt+Right by default, like iCUE) ----------
// Global, so they work from any app. Like iCUE's, they take those keys from other apps
// (Alt+Left is Back in browsers); change them with "pageKeys" in layout.json.
function registerPageKeys() {
  const keys = { previous: 'Alt+Left', next: 'Alt+Right', ...(readJson(LAYOUT, {}).pageKeys || {}) };
  for (const [name, accel] of Object.entries(keys)) {
    if (!accel) continue;
    const step = name === 'previous' ? -1 : 1;
    let ok = false;
    try { ok = globalShortcut.register(accel, () => server.broadcast('page', { step })); } catch (e) { log(`Bad page key "${accel}":`, e.message); }
    log(ok ? `Page key ${accel} -> ${name} page` : `Couldn't register ${accel} (another app, maybe iCUE, has it)`);
  }
}

// ---------- start at login ----------
const loginArgs = () => ({ path: process.execPath, args: [app.getAppPath()] });
const startsAtLogin = () => app.getLoginItemSettings(loginArgs()).openAtLogin;
function setStartAtLogin(on) { app.setLoginItemSettings({ openAtLogin: on, ...loginArgs() }); log(`Start at login ${on ? 'on' : 'off'}`); }

// ---------- tray ----------
let tray = null;
function updateTray() {
  if (!tray) return;
  const p = prefs();
  tray.setToolTip(`Edge dashboard: ${status}`);
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: status, enabled: false },
    { label: DEV ? 'Mouse lock: off in dev mode' : `Mouse lock: ${lockProc ? 'on' : 'off'}`, enabled: false },
    { type: 'separator' },
    { label: DEV ? 'Show window' : 'Show on Edge', click: () => repin('tray') },
    { label: 'Settings…', click: openSettings },
    { label: 'Reload widgets', click: () => { log('Reloading widgets (tray)'); if (win) win.webContents.reloadIgnoringCache(); } },
    { type: 'separator' },
    { label: 'Mouse lock', type: 'checkbox', checked: p.mouseLock, enabled: !DEV,
      click: m => { setPref('mouseLock', m.checked); if (m.checked) startMouseLock(); else stopMouseLock(); updateTray(); } },
    { label: 'Start at login', type: 'checkbox', checked: startsAtLogin(), click: m => { setStartAtLogin(m.checked); updateTray(); } },
    { label: 'Open log', click: () => shell.openPath(LOG) },
    { type: 'separator' },
    { label: 'Quit', click: () => { log('Quit (tray)'); app.quit(); } },
  ]));
}

app.whenReady().then(async () => {
  log(`Edge dashboard starting${DEV ? ' (dev mode)' : ''}`);
  try { ({ url } = await server.start()); }
  catch (e) { log('Could not start the local server (is another copy running?):', e); app.quit(); return; }

  tray = new Tray(nativeImage.createFromPath(path.join(__dirname, 'resources', 'tray.png')));
  tray.on('click', () => tray.popUpContextMenu());
  updateTray();

  server.events.on('open-settings', openSettings);
  createWindow();
  startMouseLock();
  registerPageKeys();

  screen.on('display-added', () => repin('display added'));
  screen.on('display-removed', () => repin('display removed'));
  screen.on('display-metrics-changed', () => repin('display changed'));
});

app.on('render-process-gone', (e, wc, d) => log(`A page crashed (${d.reason}, exit ${d.exitCode}): ${wc.getURL()}`));
app.on('child-process-gone', (e, d) => { if (d.reason !== 'clean-exit') log(`Electron ${d.type} process gone: ${d.reason}`); });
app.on('second-instance', () => { log('Second copy started; showing this one'); repin('second copy'); });
app.on('before-quit', () => { quitting = true; stopMouseLock(); });
app.on('will-quit', () => globalShortcut.unregisterAll());
// The tray keeps the app running when windows close; Quit is in the tray menu.
app.on('window-all-closed', () => { if (DEV) app.quit(); });
