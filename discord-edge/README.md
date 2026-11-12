# Discord Voice widget for Xeneon Edge

> **Now runs inside the combined Edge helper** (`../edge-helper`), which a scheduled task keeps running. The `install-startup.ps1` steps below are only needed to run this helper on its own.

Two parts:
- `helper/` - a small Node script that talks to the Discord desktop app over its local RPC pipe and serves voice state on `ws://localhost:6789`.
- `widget/` - the iCUE widget. It shows the channel, members, speaking rings and mute/deafen badges, and has Mute / Deafen / Go Live / Leave buttons. Leave takes two taps: the first arms it (it pulses red and says "Tap again"), the second hangs up.

## What each size shows
| Size | Approx. pixels | Layout |
|---|---|---|
| **S** | 840×344 | People in the call plus icon-only Mute / Deafen / Go Live / Leave. |
| **M** | 840×704 | Channel, people, up to 3 **favorite voice channels** (tap to join, **+** to pin more), then the controls. |
| **L** | 1688×704 | Status and controls, people, and a **Channels** / **Messages** tab panel. |
| **XL** | 2544×704 | Same as L, with Channels and Messages side by side. |

- **People:** on M, L and XL, tap someone to set their volume (0–200%) or mute them for you only. Like right-clicking them in Discord, they can't tell.
- **Channels:** your favorites, then every server. Open a server to see its voice channels and who's in each. Tap one to join, or ★ to make it a favorite.
- **Messages:** your Discord notifications, filterable by All, Mentions & DMs, or channel. Tap one to open that channel in Discord, × to dismiss.
  - New mentions and DMs also pop up briefly at every size. You can turn that off in the widget's iCUE settings (**Mention pop-ups**).
  - To see *every* message in a channel here, set that channel's notifications to **All Messages** in Discord.

**Why there's no full channel feed or replying:** Discord only lets its approved partner apps read channel messages or send them over this local connection. Every channel returns no messages, and live updates fail with error 4005. What it does allow is the notifications Discord would show you, which is what Messages uses. Answering calls isn't available either.

## 1. Discord app (one time, ~3 min)
1. Go to https://discord.com/developers/applications → **New Application** → name it something like "Edge Widget".
2. **OAuth2** page:
   - Copy the **Client ID**.
   - **Reset Secret**, then copy the **Client Secret**.
   - **Add Redirect** → `http://localhost` → Save.
3. You're the app owner, so you can use the RPC voice scopes without any Discord review.

## 2. Helper
Requires Node 18+ (`node -v`).

```powershell
cd helper
npm install
copy config.example.json config.json   # then paste clientId + clientSecret into it
node index.js                          # first run in a visible window
```
On the first run, Discord pops up an authorization prompt. Approve it. The token is saved to `token.json` and refreshes automatically after that.

Once it works, Ctrl+C, then set it to run hidden at login:
```powershell
powershell -ExecutionPolicy Bypass -File .\install-startup.ps1
```
To remove it: `uninstall-startup.ps1`. Logs go to `helper\helper.log`.

## 2b. Go Live button (one time)
Discord's RPC has no "start stream" command, so the Go Live button has the helper press a Discord keybind for you.
1. Discord → User Settings → **Keybinds** → **Add a Keybind** → action **Toggle Go Live Streaming** (the stream/screen-share toggle) → record **Ctrl+Alt+Shift+P**.
2. The keybind streams whichever window has focus, so it'll stream WoW. Tap it again to stop.
3. To use a different combo, change `goLiveKeys` in `config.json` (e.g. `["ctrl","alt","shift","f8"]`).

## 3. Widget
1. Package the `widget/` folder with the WidgetBuilder CLI from Corsair's WidgetBuilder Kit (`icuewidget --help` lists the validate/package commands). That produces a `.icuewidget` file.
2. Double-click the `.icuewidget` file to import it, then add **Discord Voice** to the Edge in iCUE.
3. In iCUE, allow the network permissions when it asks: `localhost:6789` (the helper) and `cdn.discordapp.com` (avatars).

## Troubleshooting
- **Widget says "Helper not running":** check `helper.log`. If it shows `Rejected widget connection from origin ...`, set `"allowAnyOrigin": true` in `config.json` and restart the helper. (Ordinary web pages are blocked by default so a random site can't mute you.)
- **"Discord closed the pipe during handshake":** the clientId is wrong.
- **Token errors:** delete `token.json` and re-run to re-authorize.
- **Go Live does nothing:** check that the Discord keybind exists and matches `goLiveKeys`. `helper.log` shows a "Pressing Go Live keybind" line on every tap.
- **No avatars, only letters:** the cdn.discordapp.com permission was denied in iCUE.
