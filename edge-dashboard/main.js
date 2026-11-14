// Edge dashboard: shows our widgets full-screen on the Xeneon Edge without iCUE.
//   npx electron .          on the Edge (borderless, always on top, never takes focus)
//   npx electron . --dev    a framed 1280x360 preview window on the main screen
'use strict';
const { app, BrowserWindow, screen } = require('electron');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const server = require('./server');

const DEV = process.argv.includes('--dev');
const EDGE = { width: 2560, height: 720 };

if (!app.requestSingleInstanceLock()) app.quit();

// The Edge is the display whose physical resolution is 2560x720.
function findEdge() {
  return screen.getAllDisplays().find(d =>
    Math.round(d.size.width * d.scaleFactor) === EDGE.width && Math.round(d.size.height * d.scaleFactor) === EDGE.height);
}

let win = null;
function createWindow(url) {
  const edge = DEV ? null : findEdge();
  if (!DEV && !edge) { console.log('Xeneon Edge not found; retrying in 5 s'); return setTimeout(() => createWindow(url), 5000); }

  win = new BrowserWindow(DEV
    ? { width: 1280, height: 360, useContentSize: true, title: 'Edge dashboard (preview)', backgroundColor: '#000000' }
    : { ...edge.bounds, frame: false, resizable: false, movable: false, alwaysOnTop: true, skipTaskbar: true,
        focusable: false, fullscreenable: false, backgroundColor: '#000000', title: 'Edge dashboard' });
  win.setMenuBarVisibility(false);
  if (!DEV) { win.setAlwaysOnTop(true, 'screen-saver'); win.setBounds(edge.bounds); }
  win.loadURL(url);
  win.on('closed', () => { win = null; });
}

// Mouse lock: keeps the mouse off the Edge while touch still works (mouse-lock.ps1).
// On by default; set "mouseLock": false in layout.json to turn it off.
let lockProc = null, quitting = false;
function startMouseLock() {
  let layout = {};
  try { layout = JSON.parse(fs.readFileSync(path.join(__dirname, 'layout.json'), 'utf8')); } catch { /* defaults */ }
  if (layout.mouseLock === false) return;
  const s = layout.screen || EDGE;
  lockProc = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, 'mouse-lock.ps1'),
    '-Width', String(s.width), '-Height', String(s.height)], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  lockProc.stdout.on('data', d => console.log('mouse lock:', String(d).trim()));
  lockProc.stderr.on('data', d => console.error('mouse lock:', String(d).trim()));
  lockProc.on('exit', code => { lockProc = null; if (!quitting) { console.log(`mouse lock exited (${code}), restarting in 3 s`); setTimeout(startMouseLock, 3000); } });
}
app.on('before-quit', () => { quitting = true; if (lockProc) lockProc.kill(); });

// Settings open in a normal window on the main screen, where there's a mouse and keyboard.
let settingsWin = null;
function openSettings(url) {
  if (settingsWin) { settingsWin.show(); settingsWin.focus(); return; }
  const wa = screen.getPrimaryDisplay().workArea;
  const w = Math.min(1100, wa.width), h = Math.min(820, wa.height);
  settingsWin = new BrowserWindow({ x: wa.x + Math.round((wa.width - w) / 2), y: wa.y + Math.round((wa.height - h) / 2), width: w, height: h,
    title: 'Edge widget settings', backgroundColor: '#0f1012', autoHideMenuBar: true });
  settingsWin.loadURL(url + 'settings');
  settingsWin.on('closed', () => { settingsWin = null; });
}

app.whenReady().then(async () => {
  const { url } = await server.start();
  server.events.on('open-settings', () => openSettings(url));
  createWindow(url);
  if (!DEV) startMouseLock();

  // Re-pin after the Edge is unplugged/replugged or Windows rearranges displays.
  const repin = () => {
    if (DEV) return;
    const edge = findEdge();
    if (!edge) { if (win) win.hide(); return; }
    if (!win) return createWindow(url);
    win.setBounds(edge.bounds); win.showInactive();
  };
  screen.on('display-added', repin); screen.on('display-removed', repin); screen.on('display-metrics-changed', repin);
});

// Closing the settings window must not quit the dashboard.
app.on('window-all-closed', () => { if (!win) app.quit(); });
