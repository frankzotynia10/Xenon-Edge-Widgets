# WoW raid marker icons for Stream Deck

46 key icons (288×288 PNG). All the artwork is original and drawn in `icons.js`; nothing is taken from the game.

- **Target markers 1–8**, in `/tm` order: star, circle, diamond, triangle, moon, square, cross, skull.
- **World markers 1–8**, in `/wm` order: square, triangle, diamond, cross, star, circle, moon, skull. Each has a ground flare and its number in the corner.
- **Extras:**
  - Clear target marker
  - Clear all markers
  - Clear world markers
  - Hello
  - Wait
  - Pat
  - Thank you
  - Cheer
  - Ready check
  - Countdown 10
- **More emotes** (`emote-*.png`): Dance, LOL, Cry, Roar, Facepalm, Hug, Kiss, Shrug, Sleep, Flex, Salute, Applaud, Charge, Follow me, Train, Violin, OOM, Heal me, Yes, No. The chat command is the name, e.g. `/dance`, `/followme`, `/healme`, `/oom`.

## Install
Copy the icon pack into Stream Deck's icon pack folder, then restart the Stream Deck app:

```bash
cp -r com.frank.wowmarkers.sdIconPack "$APPDATA/Elgato/StreamDeck/IconPacks/"
```

The icons appear under **WoW Raid Markers** in the icon picker of any key. You can also drag a PNG from `png/` onto a key.

## Key setup
Every key is a Stream Deck **Hotkey** action that presses a Ctrl+Alt+Shift combo bound in WoW.

- **Target markers:** WoW's own "Set Raid Target Icon" keybindings.
- **Everything else:** a [BindPad](https://www.curseforge.com/wow/addons/bindpad) macro bound to the combo, for example:
  - `/hello`, `/wait`, `/pat`, `/thank`, `/cheer`
  - `/readycheck`
  - `/countdown 10`
  - `/cwm all`

The full key list, macros and setup steps are in [SETUP.txt](SETUP.txt).

## Changing the icons
Edit `icons.js`, then run `node build.js`. It renders the icons with headless Chrome or Edge. Open `preview.html` to see the whole set.
