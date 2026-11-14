# Claude

Your Claude Code sessions at a glance, so you can see from the Edge when one needs you.

| State | Means |
|---|---|
| **Needs you** (amber, pulsing) | It's waiting for your OK, for example to run a command. The line underneath says what for. |
| **Working** (spinning) | It's working on your last message. |
| **Your turn** (green) | It finished and is waiting for your next message. |
| **Idle** (gray) | The session is open but hasn't been given anything yet. |

- **Each row:** the project folder (worktrees show as `repo · worktree`), the first thing you asked in that session, and how long it's been in that state.
- **Order:** sessions that need you come first.
- **Sizes:** S shows 2 sessions, M about 6, and full width shows them in three columns. Anything that doesn't fit becomes "+N more".
- **Setting:** turn off "Show what each session is doing" to hide the prompt line.

## Setup
The widget is fed by a Claude Code hook. Add this to `%USERPROFILE%\.claude\settings.json`, merging it with any `hooks` you already have:

```json
"hooks": {
  "SessionStart":     [{ "hooks": [{ "type": "command", "command": "node \"C:/Users/frank/dev/xeneon-edge/claude-edge/hook.js\"", "timeout": 5 }] }],
  "UserPromptSubmit": [{ "hooks": [{ "type": "command", "command": "node \"C:/Users/frank/dev/xeneon-edge/claude-edge/hook.js\"", "timeout": 5 }] }],
  "Notification":     [{ "hooks": [{ "type": "command", "command": "node \"C:/Users/frank/dev/xeneon-edge/claude-edge/hook.js\"", "timeout": 5 }] }],
  "Stop":             [{ "hooks": [{ "type": "command", "command": "node \"C:/Users/frank/dev/xeneon-edge/claude-edge/hook.js\"", "timeout": 5 }] }],
  "SessionEnd":       [{ "hooks": [{ "type": "command", "command": "node \"C:/Users/frank/dev/xeneon-edge/claude-edge/hook.js\"", "timeout": 5 }] }]
}
```

Change the path if the repo lives somewhere else. Sessions started after the change show up. To turn it off, remove those lines.

## How it works
- **`hook.js`** gets each event from Claude Code and passes it to the Edge helper on `localhost:6795`.
  - It sends only the session ID, folder, event, the first 200 characters of your prompt, and the notification text.
  - It never prints anything, never fails Claude, and gives up after a second if the helper isn't running.
- **`helper/`** is the Edge helper's part. It keeps the sessions in memory only and streams them to the widget.
  - "Needs you" goes back to "Working" as soon as the session's transcript changes, which means you answered.
  - A session it hasn't heard from in 12 hours is dropped.
- **Websites can't use it:** posting needs a header browsers can't send without asking, and requests from web pages are refused.

It doesn't show usage or limits: Claude Code's hooks don't report them.
