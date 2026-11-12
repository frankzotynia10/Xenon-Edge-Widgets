# Xeneon Edge widgets

Custom iCUE widgets for the Corsair Xeneon Edge, the background helper that powers them, and a set of World of Warcraft raid marker icons for Stream Deck.

| Widget | What it does | Folder |
|---|---|---|
| **Discord voice** | Mute, deafen, Go Live and leave. Shows who's in your voice channel and who's speaking. | `discord-edge/` |
| **Apple Music** | Now playing with album art, playback controls, an audio visualizer and library browsing. | `apple-music-edge/` |
| **Notifications** | Your recent Windows notifications (Outlook, Teams, Discord and more). | `notifications-edge/` |
| **Sensor Box** | GPU and CPU temperature and load, VRAM, system memory, and FPS while you're in a game. | `sensor-box-edge/` |
| **Teams** | Meeting controls (mute, camera, hand, leave), with an optional calendar on the L and XL sizes. | `teams-edge/` |
| **App Launcher** | One-tap buttons for your apps with their real icons. A dot shows which ones are open. | `launcher-edge/` |

Each folder has its own README with details and settings.

## Requirements
- **Windows 10 or 11** with a **Corsair Xeneon Edge**.
- **iCUE 5.44 or newer.**
- **[Node.js](https://nodejs.org) 18 or newer**, used by the helper. Sensor Box works without it, except for system memory.

## Setup
1. **Install the helper's dependencies.** In each of these folders, run `npm install`:
   - `discord-edge/helper`
   - `apple-music-edge/helper`
   - `notifications-edge/helper`
   - `teams-edge/helper`
2. **Discord only:** copy `discord-edge/helper/config.example.json` to `config.json`. Then add the client ID and secret of your own Discord app (steps in [discord-edge/README.md](discord-edge/README.md)).
3. **Start the helper at login.** This registers a scheduled task that runs as you, with no admin needed:
   ```powershell
   powershell -ExecutionPolicy Bypass -File edge-helper\install-watchdog.ps1
   ```
4. **Import the widgets.** In iCUE, import the `.icuewidget` files, either from the [latest release](https://github.com/frankzotynia10/Xenon-Edge-Widgets/releases/latest) or from each widget folder.
   - **App Launcher:** first run `node build.js` in `launcher-edge/`. It fills the app dropdowns from your Start menu and creates `app-launcher.icuewidget`.

## How it fits together
A widget can't start programs or read other apps on its own. So one Node process, the **Edge helper** (`edge-helper/`), runs in the background, and the widgets talk to it over `localhost` WebSockets:

| Widget | Helper port |
|---|---|
| Discord | 6789 |
| Apple Music | 6790 |
| Notifications | 6791 |
| System (Sensor Box memory, sleep cover) | 6792 |
| Teams | 6793 |
| App Launcher | 6794 |

- **Watchdog:** a scheduled task restarts the helper if it stops answering.
- **Sleep cover:** the helper also provides an Edge "sleep cover", a dimmed wallpaper you toggle from a hotkey or Stream Deck. See [edge-helper/README.md](edge-helper/README.md).

Folder layout: `widget/` is the iCUE widget source (HTML, manifest, translations) and `helper/` is that widget's part of the helper. Rebuild a package with `icuewidget package widget` in the widget's folder. For the App Launcher, edit `widget-src/` and run `node build.js`.

## Stream Deck: WoW raid markers
`wow-streamdeck/` has 46 original key icons:
- the 8 target markers and the 8 world markers
- clear buttons
- 25 emotes (Hello, Wait, Pat, Thank You, Cheer, Dance, LOL, Heal me, OOM and more)
- ready check
- a 10-second countdown

The icons come as PNGs and as a Stream Deck icon pack. `SETUP.txt` is a keybind plan for WoW with the Xeneon Edge and Stream Deck. See [wow-streamdeck/README.md](wow-streamdeck/README.md).

## Privacy
Everything stays on your PC.
- **Network:** the helpers only listen on `localhost`. They only reach the internet for these features:
  - Discord sign-in
  - Apple Music album art lookups (can be turned off)
  - the optional Microsoft calendar
- **Local only:** secrets, sign-in tokens and per-PC settings are git-ignored and never leave your machine.

This is a personal project, not affiliated with Corsair, Discord, Apple, Microsoft, Elgato or Blizzard.
