# Teams widget for Xeneon Edge

Meeting controls for Microsoft Teams (the new Teams app) on the Edge. You don't need to sign in or get IT approval.

`helper/` serves the widget on `ws://localhost:6793` and runs inside the combined Edge helper (`../edge-helper`). It gets meeting state in one of two ways:

1. **UI Automation** (`teams-uia.ps1`). This is what your PC uses.
   - **Reading:** it finds the Teams meeting window and reads its buttons: `microphone-button`, `video-button`, `raisehands-button`, `share-button`, `chat-button`, `hangup-button`. For example, "Unmute mic" means you're muted.
   - **Pressing:** it presses those buttons directly, without keystrokes or stealing focus.
   - **Meeting name:** it shows the meeting's name from the window title.
   - **Limits:** Background blur isn't a button in Teams, so it's hidden in this mode.
2. **Teams' third-party app API** (`ws://127.0.0.1:8124`). It's used automatically if Teams ever offers it. On this PC, Teams never opens it, and the **Manage API** setting doesn't show up.

`widget/` is the iCUE widget.

## What it shows
| Size | Layout |
|---|---|
| **S** | Status, plus icon-only Mute / Camera / Raise hand / Leave. |
| **M** | Status, a 2×2 grid of big buttons, reactions, then Blur / Share / Chat. |
| **L / XL** | Status, the four big buttons, and reactions plus extras on the right. |

- Buttons turn red when you're muted or your camera is off, and purple when your hand is raised.
- Recording and Sharing tags appear when they're on.
- The Chat button gets a dot when you have unread messages.
- **Leave takes two taps:** the first arms it (it pulses red), the second leaves.
- Outside a meeting everything is greyed out and the widget says "Not in a meeting".

## Calendar (L and XL sizes)
The agenda column shows today's meetings, a countdown to the next one, and a **Join** button that opens the meeting in Teams. All-day events appear as chips. After the last meeting it shows tomorrow's. During a call it shrinks to just the current/next meeting. It's read through Microsoft Graph (`helper/graph.js`) and refreshes every 5 minutes. Turn it off with **Show calendar** in the widget settings.

### One-time setup: app registration (free, about 10 minutes)
1. Go to **https://entra.microsoft.com** and sign in with your **personal** Microsoft account. If it asks, create the free directory it offers.
2. Open **Applications → App registrations → New registration**.
   - **Name:** `Edge Widget`
   - **Supported account types:** *Accounts in any organizational directory and personal Microsoft accounts*
   - **Redirect URI:** leave it empty. Then click **Register**.
3. On the app's **Overview** page, copy the **Application (client) ID**.
4. Open **Authentication**, set **Allow public client flows** to **Yes**, and click **Save**.
5. Open **API permissions** and check that it lists `User.Read`. Add **Microsoft Graph → Delegated → Calendars.Read**. Don't click "Grant admin consent".
6. Paste the ID into `helper/graph.json`: `{ "clientId": "…", "tenant": "common" }`. The helper re-reads it, so you don't need to restart.

### Signing in
1. Tap **Sign in** on the widget.
2. A browser opens on your PC at microsoft.com/devicelogin, and the code is copied to your clipboard. The code also shows on the widget.
3. Paste the code and sign in.
4. To add a second account (e.g. work + personal), tap **+** next to the date.

- **Work accounts:** if you see **"Need admin approval"**, your company blocks users from approving apps. Only IT can allow it.
- **Your sign-in:** the refresh token is stored in `helper/graph-accounts.json`, so keep that file private. To sign out an account, delete it from that file, or delete the whole file.
- **Logs:** `helper.log` shows sign-in and refresh problems (`Graph …` lines).

## First-time pairing
Only needed if Teams' API is ever available: press a button during a meeting and click **Allow** in Teams. The UI Automation mode needs no pairing.

## Troubleshooting
- Look at `helper\helper.log`.
- **Nothing happens in a meeting:** the log shows `Meeting window found: …` once a meeting window is open, and `Action (uia): …` when a button is pressed.
- **The widget doesn't react after a Teams update:** Teams may have renamed its buttons. The log line `uia: no '…' button` says which one.
