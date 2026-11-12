# Xeneon Edge widgets & Stream Deck setup

Custom iCUE widgets for the Corsair Xeneon Edge, the helper that powers them, and Stream Deck icons for WoW.

## Widgets
Each widget folder has a `README.md` and a ready-to-import `.icuewidget` package.

| Folder | Widget | Package to import | Helper port |
|---|---|---|---|
| `discord-edge/` | Discord voice | `discord-voice.icuewidget` | 6789 |
| `apple-music-edge/` | Apple Music | `apple-music.icuewidget` | 6790 |
| `notifications-edge/` | Notifications | `notifications.icuewidget` | 6791 |
| `sensor-box-edge/` | Sensor Box (GPU/CPU/memory/FPS) | `sensor-box.icuewidget` | 6792 (memory only) |
| `teams-edge/` | Teams (meeting controls, calendar) | `teams.icuewidget` | 6793 |
| `launcher-edge/` | App Launcher | `app-launcher.icuewidget` | 6794 |

**Folder layout:** most widgets have `widget/` for the source and `helper/` for that widget's part of the helper.

**App Launcher:** `widget-src/` is the source. `build.js` writes `widget/` and the package from it.

## Helper
`edge-helper/` holds the following (see its README):
- **The combined helper:** one Node process that runs every widget's helper.
- **The watchdog:** the "Edge Widget Helpers" scheduled task, which starts the helper at login and restarts it if needed.
- **The Edge sleep cover.**

## Stream Deck
`wow-streamdeck/` has the following:
- the WoW raid marker and emote key icons, as PNGs and as an icon pack
- `SETUP.txt`: the WoW + Xeneon Edge Stream Deck keybind plan

## Other folders
- `reference/icue-widgets/`: Corsair's built-in widgets, kept as examples of the iCUE widget API. Not used at runtime.
- `archive/`: old copies kept just in case (the first Discord widget zip, an old Discord helper backup). Safe to delete.
- `BACKLOG.md`: widget ideas and what's done.
- `.claude/launch.json`: local preview servers for each widget (used by Claude Code).
