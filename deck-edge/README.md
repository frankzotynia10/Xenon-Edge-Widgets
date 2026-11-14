# Deck

A button deck for the Edge, in place of Elgato's Virtual Stream Deck. It runs on the iCUE-free **Edge dashboard** (`edge-dashboard/`), which sends the keys and runs the commands. It doesn't work inside iCUE.

What a button can do:
- **Hotkey:** e.g. `Ctrl+Alt+Shift+F1` for a WoW raid marker. The keys go to the app in front. Tapping the Edge never takes focus from it.
- **Type text:** emoji and symbols too, optionally followed by Enter.
- **Start / switch to app:** one or more Start menu apps. Each one starts, or comes to the front if it's already open (so OBS never says "already running"). Uses the App Launcher part of the Edge helper, so no console window.
- **Volume slider (PC):** a column covering 1 or more spots (pick "Rows"). Drag up or down to set the volume of your current speakers or headphones; tap the speaker to mute. It follows volume changes made anywhere else.
- **Open:** a command line, like Stream Deck's Open (e.g. an SSH session).
- **Pages, folders and Back.**
- **Elgato Key Light:** on/off, brightness steps, warmer/cooler. The button shows the current brightness or color temperature.
- **Philips Hue:** recall a scene, or turn a room on/off. A lit room or the active scene gets a glow bar.
- **Hue Sync:** start/stop syncing in the Hue Sync PC app, with mode and intensity.

**Profiles** switch on their own with the app in front. The WoW profile shows while `Wow` has focus, and the first profile shows otherwise. Tap the profile chip at the bottom left to switch by hand, until the app in front changes.

**Swipe** sideways to change page. **Folders** go back to the page you came from after 15 seconds without a tap (set per folder; 0 to stay).

Set it up on the dashboard's settings page (tray icon → **Settings…** → **Deck**), or import your Stream Deck profiles there. Details are in [`edge-dashboard/README.md`](../edge-dashboard/README.md#deck).

## Built-in button images
`icons/` has images for the light, OBS and ShadowPlay buttons, and a picture for each common Hue scene (Tokyo, Vapor, Energize, Relax, Tropical and more).
- **Automatic:** when you pick one of those actions in the editor, the button gets the matching image, until you choose your own.
- **On and off:** room, Key Light and Hue Sync buttons switch to a dark version while the light is off.
- **Redrawing:** the images are drawn by `icons/make.js`. Edit it and run `node make.js`.
- **Existing buttons:** `node deck-icon-suggest.js --apply` in `edge-dashboard/` gives them the images. It skips images you picked yourself; add `--dry-run` to preview.
