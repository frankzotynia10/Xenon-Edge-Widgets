# WoW raid marker icons for Stream Deck

24 key icons (288×288 PNG). All the artwork is original and drawn in `icons.js`; nothing is taken from the game.

- **Target markers 1–8**, in `/tm` order: star, circle, diamond, triangle, moon, square, cross, skull.
- **World markers 1–8**, in `/wm` order: square, triangle, diamond, cross, star, circle, moon, skull. Each has a ground flare and its number in the corner.
- **Extras:**
  - Clear target marker
  - Clear all markers
  - Clear world markers
  - Hello
  - Wait
  - Pat
  - Ready check
  - Countdown 10

## Install
Copy the icon pack into Stream Deck's icon pack folder, then restart the Stream Deck app:

```bash
cp -r com.frank.wowmarkers.sdIconPack "$APPDATA/Elgato/StreamDeck/IconPacks/"
```

The icons appear under **WoW Raid Markers** in the icon picker of any key. You can also drag a PNG from `png/` onto a key.

## Suggested key actions
- **Markers:** a Hotkey action that presses your WoW keybind for that marker.
- **Emotes, ready check and countdown:** a Text action that types a chat command, with Enter.
  - `/hello`, `/wait`, `/pat`
  - `/readycheck`
  - `/countdown 10`
  - Clear world markers: `/cwm all`

## Changing the icons
Edit `icons.js`, then run `node build.js`. It renders the icons with headless Chrome or Edge. Open `preview.html` to see the whole set.
