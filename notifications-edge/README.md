# Notifications widget for Xeneon Edge

> **Now runs inside the combined Edge helper** (`../edge-helper`), which a scheduled task keeps running. The `install-startup.ps1` steps below are only needed to run this helper on its own.

Shows Windows notifications on the Edge, but only from the apps you pick.

- `helper/` - a small Node script that reads Windows' notification list (the same one the Notification Center shows) and serves it on `ws://localhost:6791`. It only reads. It never changes or deletes anything in Windows.
- `widget/` - the iCUE widget. On the left: a count, **Clear** and **Apps** buttons. On the right: notification cards with the sender, message and time. On the wide Edge strip, swipe sideways for more cards.

## Picking apps
Tap **Apps** on the widget. It lists every app on this PC that can send notifications, with a checkbox for each. The apps you've ticked are listed first. Your choices are saved in `helper\settings.json`. On first run, Texts (BlueBubbles), Outlook and Microsoft Teams are ticked.

## Dismissing
- Tap a card to hide it from the widget.
- **Clear** (tap twice) hides everything currently shown.
- Clearing a notification in Windows' Notification Center also removes it from the widget.

Hiding a card on the widget doesn't remove it from Windows.

## Setup
Requires Node 22.13+ (`node -v`). It uses Node's built-in SQLite.

```powershell
cd helper
npm install
node index.js          # first run in a visible window to check it
powershell -ExecutionPolicy Bypass -File .\install-startup.ps1   # run hidden at login
```
To remove it: `uninstall-startup.ps1`. Logs go to `helper\helper.log`.

Widget: double-click `notifications.icuewidget`, add **Notifications** to the Edge, and allow the `localhost:6791` permission when iCUE asks. In iCUE you can set the accent color and turn off message text (shows only who it's from).

## Notes
- An app only shows up here if it uses normal Windows notifications. Discord and some games draw their own pop-ups instead, so those won't appear even if ticked.
- `config.json` is optional (copy `config.example.json`): port, poll interval, max cards.
