# Edge dashboard (iCUE-free)

Shows the widgets full-screen on the Xeneon Edge **without iCUE**. It's a small Electron window, which uses about 270 MB with all five widgets, compared with iCUE's growing memory use.

**Status: work in progress.** Done:
- the window, the layout and the iCUE stand-in
- the settings page, with an import of your iCUE settings

Still to do:
- Sensor Box sensors and FPS
- Stream Deck
- start at login

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
- **Opening it:** tap the faint gear at the right edge of the Edge. The settings window opens on your main screen. Outside Electron, open `http://127.0.0.1:6800/settings`.
- **What's on it:** the page is built from each widget's own setting definitions, so new settings show up on their own. Changes apply on the Edge right away; iCUE's equivalent is `onDataUpdated`.
- **Import from iCUE:** copies what you set in iCUE. The command-line version is `node import-icue.js`, or `node import-icue.js --dry-run` to see what it would import.
  - It reads `%APPDATA%\Corsair\CUE5\dashlcd\storage`.
  - If a widget is on several iCUE pages, it takes the copy with the most settings.
- **Who can change settings:** only the dashboard's own pages. Changes need an `x-edge-dashboard` header, which other websites can't send to it.

## Run it
```bash
npm install
npx electron . --dev
```
- `--dev` opens a framed 1280×360 preview window on your main screen.
- `npx electron .` pins a borderless window to the Edge. It finds the Edge as the 2560×720 display, and the window stays on top without taking focus, so tapping it never pulls focus out of a game.
- `node server.js` serves only the page, so you can open `http://127.0.0.1:6800/` in a browser.

Close iCUE (or turn its Edge dashboard off) first, or the two will fight over the screen.

## How it works
- **`layout.json`** places each widget on the 2560×720 screen and gives it a port (6801–6805). Each widget gets its own origin and storage, like separate widgets in iCUE.
  - Keep the slot sizes the widgets were designed for:
    - **S:** 840×344
    - **M:** 624×704
    - **L:** 1920×720
- **`server.js`** serves the dashboard on port 6800 and each widget on its own port. It injects the saved settings and `shim.js` into each widget's `index.html`.
  - It also serves the settings API: `/api/widgets`, `/api/settings`, and live events at `/api/events`.
- **`settings.html`** is the settings page, and **`import-icue.js`** is the iCUE importer. It decodes iCUE's saved values from Qt's binary format: switches, numbers, text and colors.
- **`shim.js`** stands in for the parts of iCUE the widgets use:
  - Each `<meta name="x-icue-property">` becomes a global, set from `settings.json` or from the tag's `data-default`.
  - It calls `icueEvents.onICUEInitialized()` after load and sets `iCUE_initialized`.
  - It sends setting changes to `icueEvents.onDataUpdated({settings})`.
- **`settings.json`** (git-ignored) holds per-widget values, keyed by widget id, e.g. `{ "discord": { "accentColor": "#5865F2" } }`.
- **`main.js`** is the Electron window. It re-pins to the Edge when displays change.

The widgets still need the Edge helper running, as before.
