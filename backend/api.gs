/* ====================================================================
 * Assistaa Team API v1 (for team.assistaa.com) · rev 3
 * Paste at the END of the existing script in BOTH sheets.
 * Everything above keeps working; the new app calls doPost().
 * ==================================================================== */

const FCM_PROJECT = 'assistaa-ce837';

function doPost(e) {
  let out;
  try {
    const b = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    out = { ok: true, data: api_(b) };
  } catch (err) {
    out = { ok: false, error: String((err && err.message) || err) };
  }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}

const READS_ = ['login', 'info', 'me', 'boss', 'history', 'pinFree'];

function api_(b) {
  const n = String(b.name || '').trim(), p = String(b.pin || '').trim();
  const out = route_(b, n, p);
  if (READS_.indexOf(b.action) < 0) bump_();
  return out;
}

/* ---------- speed: remember answers for 45 s; any change clears them ---------- */
function ver_() { return CacheService.getScriptCache().get('ver') || '0'; }
function bump_() { CacheService.getScriptCache().put('ver', String(Date.now()), 21600); }
function cached_(key, fn) {
  const c = CacheService.getScriptCache();
  const k = key + '|' + ver_();
  const hit = c.get(k);
  if (hit) return JSON.parse(hit);
  const v = fn();
  try { c.put(k, JSON.stringify(v), 45); } catch (e) {}
  return v;
}

function route_(b, n, p) {
  switch (b.action) {
    case 'login': {
      const who = login_(p);
      if (b.withData) who.data = who.role === 'owner' ? cached_('boss', boss_) : cached_('me:' + who.name, () => me_(who.name, p));
      return who;
    }
    case 'pinFree': return { free: pinFree_(p) };
    case 'changePin': return changePin_(n, p, String(b.newPin || '').trim());
    case 'info':
      return { team: ss_().getName().replace('Assistaa – ', ''), support: isSupport_(), names: getTeamNames(), owner: OWNER_NAME };
    case 'me': check_(n, p); return cached_('me:' + n, () => me_(n, p));
    case 'act': doAction(n, p, b.act, b.text, b.amount);
      if (b.act === 'message') push_([OWNER_NAME], n + ' · ' + (b.amount || 'Message'), String(b.text || '').slice(0, 140), '/#inbox');
      return me_(n, p);
    case 'task': setMyTask(n, p, b.row, b.status);
      push_([OWNER_NAME], n + ' updated a task', b.status + ': ' + (b.title || ''), '/#boss');
      return me_(n, p);
    case 'history': return getHistory(n, p, b.from, b.to);
    case 'token': if (n === OWNER_NAME) owner_(p); else check_(n, p);
      saveToken_(n, b.token, b.device, b.origin); return { saved: true };
    case 'reply': check_(n, p); replyInbox_(n, b.id, b.text);
      push_([OWNER_NAME], n + ' replied', String(b.text || '').slice(0, 140), '/#boss');
      return me_(n, p);
    case 'seen': check_(n, p); seenInbox_(n, b.ids || []); return { ok: true };
    case 'profile': check_(n, p); saveProfile_(n, b); return me_(n, p);
    case 'boss': owner_(p); return cached_('boss', boss_);
    case 'send': owner_(p); sendInbox_(b.to, b.text, b.kind); return boss_();
    case 'saveTask': owner_(p); {
      const t = b.task || {};
      const before = t.row ? taskRows_().find(x => x.row === Number(t.row)) : null;
      saveTask(p, t);
      if (t.owner && (!before || before.owner !== t.owner))
        push_([t.owner], 'New task from ' + OWNER_NAME, String(t.task || '').slice(0, 140) + (t.store ? ' · ' + t.store : ''), '/#tasks');
      return boss_();
    }
    case 'testPush': owner_(p); return { sent: push_([b.to || OWNER_NAME], 'Assistaa', 'Notifications are working 🎉', '/') };
    default: throw new Error('Unknown action.');
  }
}

/* ---------- change PIN (from the profile screen) ---------- */
function pinFree_(pin) {
  const own = String(settings_().owner_pin || '').trim();
  return pin !== own && !team_().some(t => t.pin === pin);
}
function changePin_(name, oldPin, newPin) {
  if (name === OWNER_NAME) {
    owner_(oldPin);
    if (!/^\d{6}$/.test(newPin)) throw new Error('Your manager PIN must be 6 digits.');
    if (team_().some(t => t.pin === newPin)) throw new Error('That PIN is already used. Pick another one.');
    const sh = sheet_('Settings'); const v = sh.getDataRange().getValues();
    const i = v.findIndex(r => String(r[0]).trim() === 'owner_pin');
    if (i < 0) throw new Error('owner_pin is missing in Settings.');
    sh.getRange(i + 1, 2).setValue("'" + newPin);
    return { changed: true };
  }
  check_(name, oldPin);
  if (!/^\d{4}$/.test(newPin)) throw new Error('Your PIN must be 4 digits.');
  if (/^(\d)\1{3}$/.test(newPin) || ['1234', '4321', '0000', '1111'].indexOf(newPin) >= 0) throw new Error('That PIN is too easy to guess. Pick another one.');
  if (!pinFree_(newPin)) throw new Error('That PIN is already used. Pick another one.');
  const sh = sheet_('Team'); const v = sh.getDataRange().getValues();
  const col = v[0].map(h => String(h).trim().toUpperCase()).indexOf('PIN');
  const row = v.findIndex((r, k) => k > 0 && String(r[0]).trim() === name);
  if (col < 0 || row < 1) throw new Error('Could not find you in the Team tab.');
  sh.getRange(row + 1, col + 1).setValue("'" + newPin);
  return { changed: true };
}

/* PIN-only login: the PIN alone tells us who it is. Too many wrong PINs pause logins for 10 minutes. */
function login_(pin) {
  const cache = CacheService.getScriptCache();
  const fails = Number(cache.get('login-fails') || 0);
  if (fails >= 40) throw new Error('Too many wrong PINs. Wait 10 minutes and try again.');
  if (/^\d{4,8}$/.test(pin)) {
    const own = String(settings_().owner_pin || '').trim();
    if (own && pin === own) return { role: 'owner', name: OWNER_NAME, team: ss_().getName().replace('Assistaa – ', ''), support: isSupport_() };
    const m = team_().find(t => t.pin && t.pin === pin);
    if (m) return { role: 'member', name: m.name, team: ss_().getName().replace('Assistaa – ', ''), support: isSupport_() };
  }
  cache.put('login-fails', String(fails + 1), 600);
  throw new Error('Wrong PIN');
}

function me_(n, p) {
  const d = getMyData(n, p);
  d.inbox = inbox_(n);
  d.profile = profile_(n);
  d.role = (team_().find(t => t.name === n) || {}).role || '';
  return d;
}

/* ---------- helper sheets (created automatically) ---------- */

function helper_(name, head) {
  let sh = sheet_(name);
  if (!sh) {
    sh = ss_().insertSheet(name);
    sh.getRange(1, 1, 1, head.length).setValues([head]).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  return sh;
}
function inboxSheet_() { return helper_('Inbox', ['Time', 'To', 'From', 'Message', 'Kind', 'Seen', 'Reply', 'Reply time', 'Id']); }
function tokenSheet_() { return helper_('Push Tokens', ['Name', 'Token', 'Device', 'App address', 'Updated']); }
function profileSheet_() { return helper_('Profiles', ['Name', 'Photo', 'About', 'Skills', 'Joined', 'Updated']); }

/* ---------- inbox: messages from Atiq with a reply box ---------- */

function sendInbox_(to, text, kind) {
  const msg = String(text || '').trim().slice(0, 2000);
  if (!msg) throw new Error('Write a message first.');
  const names = to === 'all' ? team_().map(t => t.name) : [String(to || '').trim()];
  if (!names[0] || (to !== 'all' && !team_().some(t => t.name === names[0]))) throw new Error('Pick a person.');
  const sh = inboxSheet_();
  names.forEach(nm => sh.appendRow([new Date(), nm, OWNER_NAME, msg, kind || 'Message', '', '', '', Utilities.getUuid().slice(0, 8)]));
  push_(names, (kind || 'Message') + ' from ' + OWNER_NAME, msg.slice(0, 140), '/#inbox');
}

function inbox_(name) {
  return inboxSheet_().getDataRange().getValues().slice(1)
    .filter(r => String(r[1]).trim() === name && r[3])
    .slice(-30).reverse()
    .map(r => ({ id: String(r[8]), time: r[0] instanceof Date ? fmt_(r[0], 'yyyy-MM-dd HH:mm') : String(r[0]), from: r[2], text: r[3],
      kind: r[4], seen: !!r[5], reply: r[6], replyTime: r[7] instanceof Date ? fmt_(r[7], 'HH:mm') : '' }));
}

function rowById_(name, id) {
  const sh = inboxSheet_();
  const v = sh.getDataRange().getValues();
  for (let i = 1; i < v.length; i++) if (String(v[i][8]) === String(id) && String(v[i][1]).trim() === name) return { sh, row: i + 1 };
  throw new Error('Message not found.');
}
function replyInbox_(name, id, text) {
  const t = String(text || '').trim().slice(0, 2000);
  if (!t) throw new Error('Write a reply first.');
  const r = rowById_(name, id);
  r.sh.getRange(r.row, 6, 1, 3).setValues([[new Date(), t, new Date()]]);
}
function seenInbox_(name, ids) {
  ids.forEach(id => { try { const r = rowById_(name, id); if (!r.sh.getRange(r.row, 6).getValue()) r.sh.getRange(r.row, 6).setValue(new Date()); } catch (e) {} });
}

/* ---------- profiles ---------- */

function profile_(name) {
  const r = profileSheet_().getDataRange().getValues().slice(1).find(x => String(x[0]).trim() === name);
  return r ? { photo: r[1] || '', about: r[2] || '', skills: r[3] || '', joined: r[4] instanceof Date ? fmt_(r[4], 'yyyy-MM-dd') : String(r[4] || '') } : { photo: '', about: '', skills: '', joined: '' };
}
function saveProfile_(name, b) {
  const sh = profileSheet_();
  const v = sh.getDataRange().getValues();
  let row = v.findIndex((x, i) => i > 0 && String(x[0]).trim() === name) + 1;
  if (!row) { row = sh.getLastRow() + 1; sh.getRange(row, 1).setValue(name); sh.getRange(row, 5).setValue(new Date()); }
  if (b.photo !== undefined) {
    const ph = String(b.photo || '');
    if (ph && (!/^data:image\/(jpeg|png|webp);base64,/.test(ph) || ph.length > 45000)) throw new Error('Photo is too big. Pick a smaller one.');
    sh.getRange(row, 2).setValue(ph);
  }
  if (b.about !== undefined) sh.getRange(row, 3).setValue(String(b.about).slice(0, 300));
  if (b.skills !== undefined) sh.getRange(row, 4).setValue(String(b.skills).slice(0, 200));
  sh.getRange(row, 6).setValue(new Date());
}

/* ---------- boss view (Atiq) ---------- */

function boss_() {
  const support = isSupport_();
  const tasks = support ? [] : taskRows_();
  const inbox = inboxSheet_().getDataRange().getValues().slice(1).filter(r => r[3]).slice(-60).reverse()
    .map(r => ({ id: String(r[8]), to: r[1], time: r[0] instanceof Date ? fmt_(r[0], 'MMM d, HH:mm') : '', text: r[3], kind: r[4], seen: !!r[5], reply: r[6] }));
  const reports = sheet_('Reports').getDataRange().getDisplayValues().slice(1).slice(-40).reverse()
    .map(r => ({ time: r[0], name: r[1], type: r[2], msg: r[3], reply: r[4] }));
  const people = team_().map(pp => {
    const st = todayState_(pp.name);
    const mine = tasks.filter(t => t.owner === pp.name && t.status !== 'Done');
    return { name: pp.name, role: pp.role, state: st.state, start: st.start, done: st.done, photo: profile_(pp.name).photo,
      open: mine.length, overdue: mine.filter(t => t.overdue).length };
  });
  return { team: ss_().getName().replace('Assistaa – ', ''), support, people, inbox, reports,
    tasks: tasks.filter(t => t.status !== 'Done' || t.added >= fmt_(new Date(Date.now() - 14 * 864e5), 'yyyy-MM-dd')),
    stores: support ? [] : stores_(), statuses: ['To do', 'In progress', 'To check', 'Daily', 'Done'] };
}

/* ---------- push notifications (Firebase Cloud Messaging) ---------- */

function saveToken_(name, token, device, origin) {
  token = String(token || '').trim();
  if (!token) throw new Error('No token.');
  const sh = tokenSheet_();
  const v = sh.getDataRange().getValues();
  const i = v.findIndex((x, k) => k > 0 && String(x[1]) === token);
  const row = [name, token, String(device || '').slice(0, 120), String(origin || '').slice(0, 120), new Date()];
  if (i > 0) sh.getRange(i + 1, 1, 1, 5).setValues([row]); else sh.appendRow(row);
}

function push_(names, title, body, path) {
  try {
    const sh = tokenSheet_();
    const v = sh.getDataRange().getValues();
    const targets = [];
    v.forEach((r, i) => { if (i > 0 && r[1] && names.indexOf(String(r[0]).trim()) >= 0) targets.push({ row: i + 1, token: String(r[1]), origin: String(r[3] || 'https://team.assistaa.com') }); });
    if (!targets.length) return 0;
    const auth = 'Bearer ' + ScriptApp.getOAuthToken();
    const url = 'https://fcm.googleapis.com/v1/projects/' + FCM_PROJECT + '/messages:send';
    const res = UrlFetchApp.fetchAll(targets.map(t => ({
      url, method: 'post', contentType: 'application/json', muteHttpExceptions: true,
      headers: { Authorization: auth, 'X-Goog-User-Project': FCM_PROJECT },
      payload: JSON.stringify({ message: { token: t.token,
        data: { title: String(title), body: String(body || ''), link: t.origin + (path || '/') },
        webpush: { headers: { Urgency: 'high', TTL: '86400' } } } })
    })));
    let sent = 0;
    const dead = [];
    res.forEach((r, i) => {
      const c = r.getResponseCode();
      if (c === 200) sent++;
      else if (c === 404 || /UNREGISTERED|INVALID_ARGUMENT/.test(r.getContentText())) dead.push(targets[i].row);
      else console.log('push failed ' + c + ' ' + r.getContentText().slice(0, 300));
    });
    dead.sort((a, b) => b - a).forEach(r => sh.deleteRow(r));
    return sent;
  } catch (e) {
    console.log('push error ' + e);
    return 0;
  }
}
