# Edge dashboard (iCUE-free)

Shows the widgets full-screen on the Xeneon Edge **without iCUE**. It's a small Electron window, which uses about 270 MB with all five widgets, compared with iCUE's growing memory use.

**Status: work in progress.** This is step 1: the window, the layout and the iCUE stand-in. Still to do:
- a settings page, including importing your current iCUE settings
- Sensor Box sensors and FPS
- Stream Deck
- start at login

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
- **`shim.js`** stands in for the parts of iCUE the widgets use:
  - Each `<meta name="x-icue-property">` becomes a global, set from `settings.json` or from the tag's `data-default`.
  - It calls `icueEvents.onICUEInitialized()` after load and sets `iCUE_initialized`.
  - It sends setting changes to `icueEvents.onDataUpdated({settings})`.
- **`settings.json`** (git-ignored) holds per-widget values, keyed by widget id, e.g. `{ "discord": { "accentColor": "#5865F2" } }`.
- **`main.js`** is the Electron window. It re-pins to the Edge when displays change.

The widgets still need the Edge helper running, as before.
