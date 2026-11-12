// Microsoft Graph calendar for the Teams widget (L / XL sizes).
//
// Sign-in uses the OAuth "device code" flow: the widget shows a short code, you enter it at
// microsoft.com/devicelogin once per account, and the helper keeps a refresh token after that.
// Needs your own (free) app registration - its Application (client) ID goes in graph.json.
// Several accounts are supported (e.g. work + personal); their events are merged.
//
// Files (both next to this script):
//   graph.json           { "clientId": "..." }  - you edit this
//   graph-accounts.json  signed-in accounts + refresh tokens - written by the helper, keep it private
'use strict';

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const DIR = __dirname;
const CONFIG_PATH = path.join(DIR, 'graph.json');
const ACCOUNTS_PATH = path.join(DIR, 'graph-accounts.json');
const SCOPES = 'openid profile offline_access User.Read Calendars.Read';
const LOGIN = 'https://login.microsoftonline.com';
const PERSONAL_TENANT = '9188040d-6c67-4c5b-b112-36a304b66dad';
const REFRESH_MS = 5 * 60_000;

if (!fs.existsSync(CONFIG_PATH)) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify({ clientId: '', tenant: 'common' }, null, 2));
}

function readConfig() {
  try { const c = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')); return { clientId: String(c.clientId || '').trim(), tenant: c.tenant || 'common' }; }
  catch { return { clientId: '', tenant: 'common' }; }
}
function loadAccounts() { try { return JSON.parse(fs.readFileSync(ACCOUNTS_PATH, 'utf8')).accounts || []; } catch { return []; } }
function saveAccounts() {
  try { fs.writeFileSync(ACCOUNTS_PATH, JSON.stringify({ accounts: accounts.map(a => ({ ...a, access: undefined, accessExp: undefined })) }, null, 2)); }
  catch (e) { log('Could not save graph-accounts.json:', e.message); }
}

let log = () => {}, onChange = () => {};
let accounts = loadAccounts();          // { id, tid, name, email, kind, refreshToken, access?, accessExp?, error? }
let events = [];                        // merged, sorted
let signIn = null;                      // { code, url, expiresAt, tenant, deviceCode, interval, timer }
let lastError = '', updatedAt = 0, refreshTimer = null, stopped = false;

// ---------- what the widget sees ----------
function publicState() {
  const cfg = readConfig();
  return {
    configured: !!cfg.clientId,
    accounts: accounts.map(a => ({ id: a.id, name: a.name, email: a.email, kind: a.kind, error: a.error || '' })),
    events: events.map(e => ({ id: e.id, account: e.account, kind: e.kind, subject: e.subject, start: e.start, end: e.end, allDay: e.allDay,
      location: e.location, showAs: e.showAs, joinable: !!e.joinUrl, tentative: e.tentative })),
    signIn: signIn ? { code: signIn.code, url: signIn.url, expiresAt: signIn.expiresAt } : null,
    error: lastError, updatedAt
  };
}
function changed() { try { onChange(); } catch { /* ignore */ } }

// ---------- OAuth ----------
async function post(url, form) {
  const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(form).toString() });
  let body = {}; try { body = await res.json(); } catch { /* ignore */ }
  return { ok: res.ok, status: res.status, body };
}
function jwtClaims(t) { try { return JSON.parse(Buffer.from(String(t).split('.')[1], 'base64url').toString('utf8')); } catch { return {}; } }

async function startSignIn() {
  const cfg = readConfig();
  if (!cfg.clientId) { lastError = 'Add your app\'s client ID to teams-edge\\helper\\graph.json'; changed(); return; }
  if (signIn && signIn.expiresAt > Date.now() + 30_000) { openUrl(signIn.url); copyText(signIn.code); return; } // already waiting
  cancelSignIn();
  const r = await post(`${LOGIN}/${cfg.tenant}/oauth2/v2.0/devicecode`, { client_id: cfg.clientId, scope: SCOPES });
  if (!r.ok) {
    lastError = describe(r.body, 'Could not start sign-in');
    log('Graph device code failed:', r.status, r.body.error || '', (r.body.error_description || '').split('\r\n')[0]);
    changed(); return;
  }
  signIn = { code: r.body.user_code, url: r.body.verification_uri || 'https://microsoft.com/devicelogin', expiresAt: Date.now() + (r.body.expires_in || 900) * 1000,
    tenant: cfg.tenant, clientId: cfg.clientId, deviceCode: r.body.device_code, interval: Math.max(5, r.body.interval || 5), timer: null };
  lastError = '';
  log(`Graph sign-in started: enter code ${signIn.code} at ${signIn.url}`);
  openUrl(signIn.url); copyText(signIn.code);
  changed();
  pollSignIn();
}
function cancelSignIn() { if (signIn) { clearTimeout(signIn.timer); signIn = null; changed(); } }

function pollSignIn() {
  const s = signIn; if (!s || stopped) return;
  s.timer = setTimeout(async () => {
    if (signIn !== s) return;
    if (Date.now() > s.expiresAt) { log('Graph sign-in code expired'); lastError = 'Sign-in code expired - tap Sign in again'; signIn = null; return changed(); }
    let r;
    try { r = await post(`${LOGIN}/${s.tenant}/oauth2/v2.0/token`, { grant_type: 'urn:ietf:params:oauth:grant-type:device_code', client_id: s.clientId, device_code: s.deviceCode }); }
    catch (e) { return pollSignIn(); }
    if (signIn !== s) return;
    if (!r.ok) {
      const err = r.body.error;
      if (err === 'authorization_pending') return pollSignIn();
      if (err === 'slow_down') { s.interval += 5; return pollSignIn(); }
      log('Graph sign-in failed:', err || r.status, (r.body.error_description || '').split('\r\n')[0]);
      lastError = describe(r.body, 'Sign-in didn\'t finish');
      signIn = null; return changed();
    }
    signIn = null;
    await addAccount(r.body);
  }, s.interval * 1000);
}

async function addAccount(tok) {
  const claims = jwtClaims(tok.id_token);
  const acct = { id: claims.oid || claims.sub || String(Date.now()), tid: claims.tid || 'common', name: claims.name || '', email: claims.preferred_username || '',
    kind: claims.tid === PERSONAL_TENANT ? 'personal' : 'work', refreshToken: tok.refresh_token,
    access: tok.access_token, accessExp: Date.now() + (tok.expires_in || 3600) * 1000 - 120_000 };
  accounts = accounts.filter(a => a.id !== acct.id).concat(acct);
  saveAccounts();
  lastError = '';
  log(`Graph account added: ${acct.email || acct.name} (${acct.kind})`);
  changed();
  await refreshCalendar();
}

async function accessToken(a) {
  if (a.access && a.accessExp > Date.now()) return a.access;
  const cfg = readConfig();
  const r = await post(`${LOGIN}/${a.tid || 'common'}/oauth2/v2.0/token`, { grant_type: 'refresh_token', client_id: cfg.clientId, refresh_token: a.refreshToken, scope: SCOPES });
  if (!r.ok) {
    const e = new Error(describe(r.body, 'Sign-in expired'));
    e.fatal = ['invalid_grant', 'interaction_required', 'unauthorized_client'].includes(r.body.error);
    log(`Graph token refresh failed for ${a.email}:`, r.body.error || r.status, (r.body.error_description || '').split('\r\n')[0]);
    throw e;
  }
  a.access = r.body.access_token; a.accessExp = Date.now() + (r.body.expires_in || 3600) * 1000 - 120_000;
  if (r.body.refresh_token && r.body.refresh_token !== a.refreshToken) { a.refreshToken = r.body.refresh_token; saveAccounts(); }
  return a.access;
}

function describe(body, fallback) {
  const d = String((body && body.error_description) || '');
  if (/AADSTS65001|AADSTS90094|admin/i.test(d)) return 'Your organization needs an admin to approve this app';
  if (/AADSTS7000218|client_assertion|client_secret/i.test(d)) return 'Turn on "Allow public client flows" in the app registration';
  if (/AADSTS700016|not found in the directory/i.test(d)) return 'Client ID not found - check graph.json';
  if (/AADSTS50059|AADSTS90002|tenant/i.test(d) && /not found|identif/i.test(d)) return 'App registration must allow personal + work accounts';
  if (body && body.error === 'authorization_declined') return 'Sign-in was cancelled';
  if (body && body.error === 'expired_token') return 'Sign-in code expired - tap Sign in again';
  return fallback;
}

// ---------- calendar ----------
async function graphGet(a, url) {
  const res = await fetch(url, { headers: { authorization: `Bearer ${await accessToken(a)}`, prefer: 'outlook.timezone="UTC"' } });
  if (res.status === 401) { a.access = null; throw new Error('Graph said 401'); }
  if (!res.ok) throw new Error(`Graph ${res.status}`);
  return res.json();
}

function toEvent(a, ev) {
  const allDay = !!ev.isAllDay;
  // UTC "2026-11-11T15:00:00.0000000"; all-day events are whole local days, so keep just the date
  const t = s => (allDay ? s.slice(0, 10) : new Date(s.replace(/(\.\d+)?$/, 'Z')).toISOString());
  const joinUrl = (ev.onlineMeeting && ev.onlineMeeting.joinUrl) || ev.onlineMeetingUrl || '';
  return { id: `${a.id}:${ev.id}`, account: a.id, kind: a.kind, subject: ev.subject || '(No title)', start: t(ev.start.dateTime), end: t(ev.end.dateTime), allDay,
    location: (ev.location && ev.location.displayName) || '', showAs: ev.showAs || 'busy', joinUrl,
    tentative: !!(ev.responseStatus && ev.responseStatus.response === 'tentativelyAccepted') };
}

async function fetchAccount(a) {
  const now = new Date();
  const from = new Date(now.getFullYear(), now.getMonth(), now.getDate());            // local midnight today
  const to = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 2);           // end of tomorrow
  const sel = 'id,subject,start,end,isAllDay,isCancelled,onlineMeeting,onlineMeetingUrl,location,showAs,responseStatus';
  let url = `https://graph.microsoft.com/v1.0/me/calendarView?startDateTime=${from.toISOString()}&endDateTime=${to.toISOString()}` +
    `&$select=${sel}&$orderby=start/dateTime&$top=100`;
  const out = [];
  for (let page = 0; url && page < 3; page++) {
    const j = await graphGet(a, url);
    for (const ev of j.value || []) {
      if (ev.isCancelled) continue;
      if (ev.responseStatus && ev.responseStatus.response === 'declined') continue;
      out.push(toEvent(a, ev));
    }
    url = j['@odata.nextLink'];
  }
  return out;
}

let refreshing = null;
function refreshCalendar() {
  if (refreshing) return refreshing;
  refreshing = (async () => {
    clearTimeout(refreshTimer);
    const all = [];
    let anyOk = false;
    for (const a of accounts) {
      try { all.push(...await fetchAccount(a)); a.error = ''; anyOk = true; }
      catch (e) {
        a.error = e.message;
        if (e.fatal) a.error = 'Signed out - tap Sign in to reconnect';
        // keep this account's previous events rather than blanking the agenda on a network blip
        all.push(...events.filter(x => x.account === a.id));
      }
    }
    events = all.sort((x, y) => (x.start < y.start ? -1 : x.start > y.start ? 1 : 0));
    if (anyOk) updatedAt = Date.now();
    changed();
  })().finally(() => { refreshing = null; if (!stopped) refreshTimer = setTimeout(refreshCalendar, REFRESH_MS); });
  return refreshing;
}

// ---------- joining ----------
function joinEvent(id) {
  const ev = events.find(e => e.id === id);
  if (!ev || !ev.joinUrl) return false;
  let u;
  try { u = new URL(ev.joinUrl); } catch { return false; }
  if (u.protocol !== 'https:' || !/(^|\.)(teams\.microsoft\.com|teams\.live\.com|teams\.cloud\.microsoft)$/i.test(u.hostname)) {
    log('Not opening a non-Teams join link:', u.hostname); return false;
  }
  // msteams: goes straight to the desktop app instead of a browser "open Teams?" page
  const target = /teams\.microsoft\.com$/i.test(u.hostname) ? 'msteams:' + u.pathname + u.search + u.hash : u.href;
  log(`Joining: ${ev.subject}`);
  openUrl(target);
  return true;
}

function openUrl(url) {
  try { spawn('rundll32.exe', ['url.dll,FileProtocolHandler', url], { windowsHide: true, detached: true, stdio: 'ignore' }).unref(); }
  catch (e) { log('Could not open link:', e.message); }
}
function copyText(text) {
  try { const p = spawn('clip.exe', [], { windowsHide: true, stdio: ['pipe', 'ignore', 'ignore'] }); p.stdin.end(text); } catch { /* ignore */ }
}

function removeAccount(id) {
  const before = accounts.length;
  accounts = accounts.filter(a => a.id !== id);
  if (accounts.length !== before) { events = events.filter(e => e.account !== id); saveAccounts(); log('Graph account removed'); changed(); }
}

function start(opts) {
  log = opts.log || log; onChange = opts.onChange || onChange;
  if (accounts.length) refreshCalendar();
  else refreshTimer = setTimeout(refreshCalendar, REFRESH_MS);
  // catch up after sleep / long gaps
  let lastTick = Date.now();
  const tick = setInterval(() => { const n = Date.now(); if (n - lastTick > 3 * 60_000 && accounts.length) refreshCalendar(); lastTick = n; }, 60_000);
  tick.unref && tick.unref();
}
function stop() { stopped = true; clearTimeout(refreshTimer); if (signIn) clearTimeout(signIn.timer); }

module.exports = { start, stop, publicState, startSignIn, cancelSignIn, refreshCalendar, joinEvent, removeAccount };
