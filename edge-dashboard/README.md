# Edge dashboard (iCUE-free)

Shows the widgets full-screen on the Xeneon Edge **without iCUE**. It's a small Electron window, which uses about 270 MB with all five widgets, compared with iCUE's growing memory use.

**Status: work in progress.** Done:
- the window, the layout and the iCUE stand-in
- the settings page, with an import of your iCUE settings
- Sensor Box sensors, from LibreHardwareMonitor

Still to do:
- FPS for the Sensor Box (PresentMon)
- the Deck widget, to replace Stream Deck
- start at login

## Pages
`layout.json` can have several pages, each with its own layout. Ways to switch:
- **Alt+← / Alt+→** from any app, like iCUE. They wrap around.
  - These are global hotkeys, so they take Alt+← (Back) from browsers too, the same as iCUE does.
  - Change them with `"pageKeys": { "previous": "...", "next": "..." }` in `layout.json`, using Electron key names. Set one to `""` to turn it off.
  - If another app already has the key, `dashboard.log` says so.
- Dots fade in at the bottom for a moment to show which page you're on.
- **From anything else, like a Stream Deck key:** `POST http://127.0.0.1:6800/api/page` with `{"step": 1}`, `{"step": -1}` or `{"index": 0}`, and the header `x-edge-dashboard: 1`.

Every page stays loaded, so switching is instant and the widgets stay connected. The dashboard remembers the page you were on.

The default pages follow the iCUE ones:
1. **Main:** Music (S) and Sensor Box (S), Discord (M), Teams (S) and Notifications (S).
2. **Meetings:** Music and Notifications, Teams (M), Launcher (M).
3. **Discord:** full width.

Slots match iCUE's: 840×344 (S), 840×704 (M) or 2540×704 (full), in three columns at x = 10, 860 and 1710, edge to edge.

## Tray icon and log
The dashboard has a tray icon (a little blue Edge) in the notification area. Its menu has:
- **Status:** whether it's on the Edge or waiting for it, and whether the mouse lock is on.
- **Show on Edge:** re-pins the window.
- **Settings…**
- **Reload widgets**
- **Mouse lock** (on/off)
- **Start at login:** a Windows login item for this app.
- **Open log**
- **Quit**

The mouse lock choice is saved in `prefs.json`, which is git-ignored.

Everything that happens goes to **`dashboard.log`**: the Edge found or lost, re-pins, the mouse lock starting or stopping, crashed pages and errors. At 1 MB it rolls over to `dashboard.log.old`. Starting a second copy just brings the running one back up.

## Mouse lock
When the dashboard runs on the Edge, `mouse-lock.ps1` keeps the **mouse** off the Edge, like iCUE's mouse lock. **Touch** still works.
- **How it works:** a low-level mouse hook drops mouse moves that would land on the Edge. Windows tags taps from the touchscreen and pen, and those pass through.
- **After a tap:** the next real mouse move sends the cursor back to where it was on your main screen.
- **Turning it off:** untick **Mouse lock** in the tray menu. Or, to change the default for everyone, set `"mouseLock": false` in `layout.json`.
- **When it runs:** only in Edge mode, not with `--dev`. The dashboard restarts it if it stops.

## Settings
- **Opening it:** choose **Settings…** in the tray menu. The settings window opens on your main screen. Outside Electron, open `http://127.0.0.1:6800/settings`.
- **What's on it:** the page is built from each widget's own setting definitions, so new settings show up on their own. Changes apply on the Edge right away; iCUE's equivalent is `onDataUpdated`.
- **Import from iCUE:** copies what you set in iCUE. The command-line version is `node import-icue.js`, or `node import-icue.js --dry-run` to see what it would import.
  - It reads `%APPDATA%\Corsair\CUE5\dashlcd\storage`.
  - If a widget is on several iCUE pages, it takes the copy with the most settings.
- **Who can change settings:** only the dashboard's own pages. Changes need an `x-edge-dashboard` header, which other websites can't send to it.

## Sensors (Sensor Box)
The Sensor Box gets its temperatures and loads from **LibreHardwareMonitor** in place of iCUE's sensor plugin.
- **Install:** `winget install LibreHardwareMonitor.LibreHardwareMonitor`. It installs the PawnIO driver, which needs admin.
- **Run it as admin**, then tick **Options → Run On Windows Startup**:
  ```powershell
  Start-Process "$env:LOCALAPPDATA\Microsoft\WinGet\Packages\LibreHardwareMonitor.LibreHardwareMonitor_Microsoft.Winget.Source_8wekyb3d8bbwe\LibreHardwareMonitor.exe" -Verb RunAs
  ```
- **Its web server must be on:** Options → Remote Web Server → Run, on `127.0.0.1:8085`. A different address can be set with the `LHM_URL` environment variable.
- **Automatic sensors:** the widget's defaults are picked on this PC. They are GPU core temperature and load, and GPU memory (preferring the NVIDIA card over the CPU's built-in Radeon), plus CPU total load and Tctl/Tdie. `node sensors.js` prints what it picks.
- **Choosing other sensors:** on the settings page, each sensor setting is a dropdown with "Automatic" plus every sensor, grouped by hardware.
- **Not imported from iCUE:** sensor picks. iCUE saves them as its own IDs, which mean nothing here, so they stay on Automatic.
- **If LibreHardwareMonitor isn't running:** the values show `--`, and the settings page says so.
- **Duplicate IDs:** LibreHardwareMonitor sometimes gives two sensors the same ID (GPU Memory and GPU Bus). The second one gets its name added, e.g. `/gpu-nvidia/0/load/3~GPU Bus`.

## Run it
```powershell
npm install
npx electron . --dev
```
- `--dev` opens a framed 1280×360 preview window on your main screen.
- `npx electron .` pins a borderless window to the Edge. It finds the Edge as the 2560×720 display, and the window stays on top without taking focus, so tapping it never pulls focus out of a game.
- `node server.js` serves only the page, so you can open `http://127.0.0.1:6800/` in a browser.

Close iCUE (or turn its Edge dashboard off) first, or the two will fight over the screen.

## How it works
- **`layout.json`** has `widgets`, which maps each widget to its folder and its own port (6801–6806), and `pages`, which places widgets on the 2560×720 screen. Each widget gets its own origin and storage, like separate widgets in iCUE. A widget can be on several pages.
- **`server.js`** serves the dashboard on port 6800 and each widget on its own port. It injects the saved settings and `shim.js` into each widget's `index.html`.
  - It also serves the settings API: `/api/widgets`, `/api/settings`, and live events at `/api/events`.
  - `/api/sensors` returns the LibreHardwareMonitor sensors (read by **`sensors.js`**) and the automatic picks.
- **`settings.html`** is the settings page, and **`import-icue.js`** is the iCUE importer. It decodes iCUE's saved values from Qt's binary format: switches, numbers, text and colors.
- **`shim.js`** stands in for the parts of iCUE the widgets use:
  - Each `<meta name="x-icue-property">` becomes a global, set from `settings.json` or from the tag's `data-default`.
  - It calls `icueEvents.onICUEInitialized()` after load and sets `iCUE_initialized`.
  - It sends setting changes to `icueEvents.onDataUpdated({settings})`.
  - `plugins.Sensorsdataprovider` polls `/api/sensors` every second and sends `sensorValueChanged` for the sensors a widget watches.
- **`settings.json`** (git-ignored) holds per-widget values, keyed by widget id, e.g. `{ "discord": { "accentColor": "#5865F2" } }`.
- **`main.js`** is the Electron window. It re-pins to the Edge when displays change.

The widgets still need the Edge helper running, as before.
