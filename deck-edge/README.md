# Deck

A button deck for the Edge, in place of Elgato's Virtual Stream Deck. It runs on the iCUE-free **Edge dashboard** (`edge-dashboard/`), which sends the keys and runs the commands. It doesn't work inside iCUE.

What a button can do:
- **Hotkey:** e.g. `Ctrl+Alt+Shift+F1` for a WoW raid marker. The keys go to the app in front. Tapping the Edge never takes focus from it.
- **Type text:** emoji and symbols too, optionally followed by Enter.
- **Open:** a command line, like Stream Deck's Open (e.g. an SSH session).
- **Pages, folders and Back.**
- **Elgato Key Light:** on/off, brightness steps, warmer/cooler. The button shows the current brightness or color temperature.
- **Philips Hue:** recall a scene, or turn a room on/off. A lit room or the active scene gets a glow bar.
- **Hue Sync:** start/stop syncing in the Hue Sync PC app, with mode and intensity.

**Profiles** switch on their own with the app in front. The WoW profile shows while `Wow` has focus, and the first profile shows otherwise. Tap the profile chip at the bottom left to switch by hand, until the app in front changes.

**Swipe** sideways to change page.

Set it up on the dashboard's settings page (tray icon → **Settings…** → **Deck**), or import your Stream Deck profiles there. Details are in [`edge-dashboard/README.md`](../edge-dashboard/README.md#deck).
