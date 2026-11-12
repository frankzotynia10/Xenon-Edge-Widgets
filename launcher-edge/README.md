# App Launcher widget for Xeneon Edge

One-tap buttons for your apps and games, each with its real icon.

- **Tap:** opens the app. If the app is already open, the tap brings its window to the front instead of starting a second copy.
- **Running dot:** a glowing dot under an app means it's open.

## Setup
In iCUE, open the widget's settings. Pick apps for **Slot 1–16** from the dropdowns, which list the apps in your Start menu. Leave a slot on *(empty)* to skip it.

The buttons resize to the biggest size that fits the slot size and the number of apps you picked.

Appearance settings:
- **Show app names**
- **Tile style:** tiles or icons only
- **Running dot color**

### Adding newly installed apps
The dropdown list is baked into the widget when it's built, because iCUE can't fill a dropdown on the fly. After you install an app you want on the launcher:

```
cd launcher-edge
node build.js
```

Then re-import `app-launcher.icuewidget`.

## How it works
- `widget-src/` is the widget source. `build.js` fills in the slot dropdowns and writes `widget/` plus `app-launcher.icuewidget`. Edit `widget-src/`, not `widget/`.
- `helper/index.js` runs inside the combined Edge helper on `localhost:6794`. It serves the icons and the open/closed state, and it only launches apps that are in the Start menu.
- `helper/launcher.ps1` does the Windows side:
  - **App list:** reads the Start menu (`shell:AppsFolder`).
  - **Icons:** extracts them at 256 px into `helper/icons`.
  - **Open apps:** finds them by the app ID or exe path of each window.
  - **Launching:** opens apps through `shell:AppsFolder`.

## Limits
- **Running dot for game launchers:** a game started through a launcher counts as running only if its exe is in the launcher's folder. For example, Battle.net's dot follows Battle.net itself, not the game.
- **Games that aren't in the Start menu** (e.g. World of Warcraft, which runs through Battle.net) can't be picked yet.
