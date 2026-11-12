# Apple Music widget for Xeneon Edge

> **Now runs inside the combined Edge helper** (`../edge-helper`), which a scheduled task keeps running. The `install-startup.ps1` steps below are only needed to run this helper on its own.

Two parts:
- `helper/`: a small Node script that serves Apple Music to the widget on `ws://localhost:6790`. You don't need an Apple account or API key. It runs three hidden PowerShell bridges:
  - `smtc.ps1` reads now playing (title, artwork, progress) from Windows' media controls.
  - `uia.ps1` controls Apple Music through Windows UI Automation, the accessibility API screen readers use. This covers favorite, seeking and the library browser. It doesn't move your mouse or type.
  - `audio.ps1` captures what Windows is playing for the visualizer and sets Apple Music's volume in the Windows volume mixer.
- `widget/`: the iCUE widget.

Works with the Apple Music app from the Microsoft Store.

## What's on the widget
- **Now playing:** artwork with a blurred background, title, artist and album. Tap or drag the progress bar to seek. Below that are favorite (star), previous, play/pause, next and a volume slider for Apple Music only (large sizes only).
- **Visualizer:** bars along the bottom driven by the real audio. They only move while Apple Music is making sound.
- **Swipe gestures** (the small size has no previous/next buttons, so swipe there):
  - On now playing: swipe left for next, right for the previous track, up to open the library, down to play/pause.
  - In the library: swipe right to go back (out of a playlist, or close the library), or swipe down on the header to close it.
- **Library:** tap the list button in the top-right corner, or swipe up.
  - **Songs:** your whole library.
  - **Favorites:** your Favorite Songs playlist.
  - **Playlists:** tap one to open it; ▶ plays it and the shuffle icon shuffles it.
  - **Search:** searches the whole Apple Music catalog.
  - On any song: tap the row or ▶ to play it, or tap **+** to add it to the queue. The bar at the bottom is a mini player.

## Good to know
- **Apple Music must be open.** Minimized is fine, but not closed to the tray. The library uses Apple Music's own window, so browsing or searching from the widget also changes what that window shows.
- **Speed:** opening Songs takes a few seconds the first time (about 2 s per 1,000 songs). Playing a song takes about a second.
- **Artwork in lists:**
  - It comes from Apple's public iTunes Search API, which receives the artist and album names.
  - It's cached in `helper\art-cache`.
  - Apple allows about 20 lookups a minute, so new lists fill in gradually.
  - Set `"artworkLookup": false` in `config.json` to turn this off; rows then show a colored letter instead.
- Apple Music updates can rename buttons inside the app. If the star or the library stop working after an update, look for `controls:` lines in `helper.log`.

## 1. Helper
Requires Node 18+ (`node -v`).

```powershell
cd helper
npm install
node index.js        # first run in a visible window
```
You should see `Now playing: ...` once Apple Music is playing. Then press Ctrl+C and set it to run hidden at login:
```powershell
powershell -ExecutionPolicy Bypass -File .\install-startup.ps1
```
To remove it: `uninstall-startup.ps1`. Logs go to `helper\helper.log`.

`config.json` is optional; copy `config.example.json` to start. It holds the port, `bars` (visualizer bar count), `artworkLookup`, and `appMatch` (a regex on the Windows media app ID).

## 2. Widget
1. `apple-music.icuewidget` is already built. To rebuild after edits, run `icuewidget package widget`.
2. Double-click `apple-music.icuewidget` to import it, then add **Apple Music** to the Edge in iCUE. If you already have it, importing again updates it.
3. When iCUE asks, allow the `localhost:6790` network permission.

Settings in iCUE: accent color, blurred background, show album name, round artwork (spins while playing), visualizer bars, star color (under Custom style) and swipe gestures.

## Troubleshooting
- **"Helper not running":** check `helper.log`. If it shows `Rejected widget connection from origin ...`, set `"allowAnyOrigin": true` in `config.json` and restart the helper.
- **Star greyed out:** the Apple Music window isn't available. Open Apple Music.
- **No volume slider:** Apple Music hasn't played anything since it launched.
- **Library says it couldn't find something:** Apple Music changed screens underneath it. Tap the section again.
