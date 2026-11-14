# Edge helper (combined)

One Node process that runs the helpers for all the Xeneon Edge widgets:

| Widget | Code | Port | Log |
|---|---|---|---|
| Discord | `discord-edge/helper` | 6789 | `discord-edge/helper/helper.log` |
| Apple Music | `apple-music-edge/helper` | 6790 | `apple-music-edge/helper/helper.log` |
| Notifications | `notifications-edge/helper` | 6791 | `notifications-edge/helper/helper.log` |
| System (Sensor Box memory, Edge sleep cover) | `edge-helper/system.js` | 6792 | `edge-helper/system.log` |
| Teams | `teams-edge/helper` | 6793 | `teams-edge/helper/helper.log` |
| App Launcher | `launcher-edge/helper` | 6794 | `launcher-edge/helper/helper.log` |

This folder also holds the startup watchdog (`watchdog.js`, `run-watchdog.vbs`, `install-watchdog.ps1`, log in `watchdog.log`) and `sleep-toggle.vbs`.

Each widget keeps its own folder, config and log, so the widgets didn't change. Apple Music's PowerShell bridges (`smtc.ps1`, `uia.ps1`, `audio.ps1`) are still separate child processes. That way, a slow library browse can't freeze now-playing or the visualizer.

- **Startup and restarts:** the "Edge Widget Helpers" scheduled task (`watchdog.js` here, registered by `install-watchdog.ps1`) starts this at login and checks it every 5 minutes. It restarts the helper if the process is gone or no widget answers.
- **If one widget breaks:** if a widget fails to start or throws an error, it's logged in `edge-helper.log` (naming which widget) and the others keep running. Too many errors in a minute makes the helper exit, so the watchdog restarts it cleanly.
- **Run by hand:** `node index.js`, or `start-hidden.vbs` for no window.
- **Each helper still runs on its own:** `node index.js` in its own folder, which is handy for debugging one widget. Stop the combined helper first, or that widget will find its port in use.

The per-widget `install-startup.ps1` scripts are no longer needed. The scheduled task replaces them.

## Edge sleep cover
A full-screen, heavily dimmed wallpaper over the Xeneon Edge, with a faint centered clock. It covers whatever iCUE is showing, without changing the Edge's brightness.

**Turning it on and off:**
- **Deck widget (Edge dashboard):** a button with the **Edge sleep cover** action. It calls `/sleep/toggle` directly, so no hotkey is needed.
- **Stream Deck "Hotkey" action:** set it to **Ctrl+Alt+Shift+F10**. The same key toggles it on and off.
- **Stream Deck "System › Open" action:** point it at `edge-helper\sleep-toggle.vbs`. It runs with no window.
- **Anything else:** `http://localhost:6792/sleep/toggle` (also `/sleep`, `/wake`, `/sleep/status`).
- **Waking it:** tap the Edge, or toggle again.

**Settings:** `sleep.json` in this folder is picked up as soon as you save it:

| Key | Default | Meaning |
|---|---|---|
| `hotkey` | `ctrl+alt+shift+f10` | Any ctrl/alt/shift/win + letter, digit or F-key. `""` for no hotkey. It's global, so it takes the key away from every other app; Ctrl+Alt+Shift+F10 is also the WoW `/readycheck` bind in `wow-streamdeck/SETUP.txt`, so set it to `""` if you use the Deck. |
| `wallpaper` | `""` | Empty means your desktop wallpaper. Or a full path to any image (it's cropped to fill the Edge). |
| `dim` | `0.88` | 0 is the image at full brightness, 1 is solid black. |
| `clock` | `true` | Faint time and date. It moves a few pixels each minute. |
| `tapToWake` | `true` | Tapping the Edge wakes it. |
| `screenWidth` / `screenHeight` | `2560` / `720` | How the Edge's screen is recognized. |

The cover is drawn by `sleep.ps1`, a hidden window. The system module restarts it if it ever exits.
