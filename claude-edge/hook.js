// Claude Code hook: passes the event to the Edge helper (claude-edge/helper, port 6795).
// Set up in ~/.claude/settings.json for SessionStart, UserPromptSubmit, Notification, Stop and SessionEnd.
// It never blocks or fails Claude: no output, always exits 0, and gives up after a second.
'use strict';
const http = require('http');

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', c => { input += c; });
process.stdin.on('end', () => {
  let e; try { e = JSON.parse(input.replace(/^﻿/, '')); } catch { return; }
  // Only what the widget shows. The prompt is cut short; tool details and the transcript stay out.
  const body = JSON.stringify({
    session_id: e.session_id, hook_event_name: e.hook_event_name, cwd: e.cwd, transcript_path: e.transcript_path,
    prompt: typeof e.prompt === 'string' ? e.prompt.slice(0, 200) : undefined,
    message: e.message, notification_type: e.notification_type,
  });
  const req = http.request({ host: '127.0.0.1', port: 6795, path: '/event', method: 'POST', timeout: 1000,
    headers: { 'content-type': 'application/json', 'x-claude-edge': '1', 'content-length': Buffer.byteLength(body) } });
  req.on('error', () => {});
  req.on('timeout', () => req.destroy());
  req.end(body);
});
setTimeout(() => process.exit(0), 1500).unref();
