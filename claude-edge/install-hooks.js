// Adds (or with --remove, takes out) the Claude Code hooks that feed the Claude widget, in
// %USERPROFILE%\.claude\settings.json. Keeps everything else in that file, and any hooks you
// already have. Safe to run twice. A copy of the old file is kept as settings.json.bak.
//   node claude-edge\install-hooks.js            add
//   node claude-edge\install-hooks.js --remove   take out
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const FILE = path.join(os.homedir(), '.claude', 'settings.json');
const HOOK = path.join(__dirname, 'hook.js').replace(/\\/g, '/');
const COMMAND = `node "${HOOK}"`;
const EVENTS = ['SessionStart', 'UserPromptSubmit', 'Notification', 'Stop', 'SessionEnd'];
const remove = process.argv.includes('--remove');
const ours = h => h && typeof h.command === 'string' && h.command.includes('claude-edge/hook.js');

let text = '';
try { text = fs.readFileSync(FILE, 'utf8').replace(/^﻿/, ''); } catch { /* no file yet */ }
let cfg;
try { cfg = text.trim() ? JSON.parse(text) : {}; } catch (e) {
  console.error(`Couldn't read ${FILE}: ${e.message}\nFix the file (or add the hooks by hand, see README.md) and try again.`);
  process.exit(1);
}

cfg.hooks = cfg.hooks || {};
let changed = 0;
for (const ev of EVENTS) {
  const list = Array.isArray(cfg.hooks[ev]) ? cfg.hooks[ev] : [];
  // Take out our entry wherever it is, then add it back once (unless removing).
  const kept = list.map(g => ({ ...g, hooks: (g.hooks || []).filter(h => !ours(h)) })).filter(g => g.hooks.length);
  const had = list.some(g => (g.hooks || []).some(ours));
  if (!remove) kept.push({ hooks: [{ type: 'command', command: COMMAND, timeout: 5 }] });
  if (had !== !remove || JSON.stringify(kept) !== JSON.stringify(list)) changed++;
  if (kept.length) cfg.hooks[ev] = kept; else delete cfg.hooks[ev];
}
if (!Object.keys(cfg.hooks).length) delete cfg.hooks;

if (!changed) { console.log(remove ? 'The Claude widget hooks weren\'t there. Nothing to do.' : 'The Claude widget hooks are already there. Nothing to do.'); process.exit(0); }
fs.mkdirSync(path.dirname(FILE), { recursive: true });
if (text) fs.writeFileSync(FILE + '.bak', text);
fs.writeFileSync(FILE, JSON.stringify(cfg, null, 2) + '\n');
console.log(remove
  ? `Took the Claude widget hooks out of ${FILE}.`
  : `Added the Claude widget hooks to ${FILE}.\nNew Claude Code sessions will show on the widget; ones already open won't until they're restarted.`);
