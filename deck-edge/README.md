# Deck

A button deck for the Edge, in place of Elgato's Virtual Stream Deck. It runs on the iCUE-free **Edge dashboard** (`edge-dashboard/`), which sends the keys and runs the commands. It doesn't work inside iCUE.

What a button can do:
- **Hotkey:** e.g. `Ctrl+Alt+Shift+F1` for a WoW raid marker. The keys go to the app in front. Tapping the Edge never takes focus from it.
- **Type text:** emoji and symbols too, optionally followed by Enter.
- **Start / switch to app:** one or more Start menu apps. Each one starts, or comes to the front if it's already open (so OBS never says "already running"). Uses the App Launcher part of the Edge helper, so no console window.
- **Volume slider:** a column covering 1 or more spots (pick "Rows"). Drag up or down to set the volume; tap the speaker to mute. It follows volume changes made anywhere else. "Whose volume" picks:
  - **the PC:** your current speakers or headphones
  - **one app:** Discord, Apple Music or any other app by its process name. It shows "–" while that app has no sound open.
  - **the app in front:** whatever you are in, e.g. your game
- **Hue / Key Light brightness sliders:** the same kind of column for a Hue room (or zone) or a Key Light. Drag to dim; all the way down turns it off, and dragging up turns it on. Tap the bulb to turn it on or off. They follow changes made in the Hue app or Control Center within a few seconds.
- **Turn screens off:** turns every screen off, the Edge too. Any mouse move, key or touch wakes them, and so does the mouse jiggler, so pause it first.
- **Webhook:** calls a URL (POST with an optional body, or GET), for example an n8n or Home Assistant webhook. The button flashes red if it doesn't answer OK.
- **Battery (wireless mouse / keyboard):** a battery gauge with the percentage, read straight from the device once a minute, so no vendor app (Synapse, G Hub, Fusion) needs to be running. Pick the device in the editor. Works with Razer, Logitech (Unifying, Bolt and Lightspeed receivers, or a cable) and Pulsar receivers, plus any Bluetooth device Windows shows a battery for. Green, amber under 40%, red at 15% and below (the button then pulses red until it charges), while it charges, a bolt and "charging" instead of the percentage (a mouse on its cable reads high, because the charger raises the cell voltage it judges by). Shows "asleep" when the device doesn't answer. Tap it to read it again right away.
- **Open:** a command line, like Stream Deck's Open (e.g. an SSH session).
- **Pages, folders and Back.**
- **Elgato Key Light:** on/off, brightness steps, warmer/cooler. The button shows the current brightness or color temperature.
- **Philips Hue:** recall a scene, or turn a room on/off. A lit room or the active scene gets a glow bar.
- **Hue Sync:** start/stop syncing in the Hue Sync PC app, with mode and intensity.

**Colors:** in the editor, every button has a color: a slider's fill, or a button's background (it shows behind text, symbols and see-through images). A button with an image also has **Image color shift**, which turns the image's colors around the color wheel (120° makes blue green), so any built-in image can match. Gray and white parts stay as they are.

**Profiles** switch on their own with the app in front. The WoW profile shows while `Wow` has focus, and the first profile shows otherwise. Tap the profile chip at the bottom left to switch by hand, until the app in front changes.

**Swipe** sideways to change page. **Folders** go back to the page you came from after 15 seconds without a tap (set per folder; 0 to stay).

Set it up on the dashboard's settings page (tray icon → **Settings…** → **Deck**), or import your Stream Deck profiles there. Details are in [`edge-dashboard/README.md`](../edge-dashboard/README.md#deck).

## Built-in button images
`icons/` has images for the light, OBS and ShadowPlay buttons, and a picture for each common Hue scene (Tokyo, Vapor, Energize, Relax, Tropical and more).
- **Automatic:** when you pick one of those actions in the editor, the button gets the matching image, until you choose your own.
- **On and off:** room, Key Light and Hue Sync buttons switch to a dark version while the light is off.
- **Redrawing:** the images are drawn by `icons/make.js`. Edit it and run `node make.js`.
- **Existing buttons:** `node deck-icon-suggest.js --apply` in `edge-dashboard/` gives them the images. It skips images you picked yourself; add `--dry-run` to preview.
