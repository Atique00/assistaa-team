/* Assistaa Team app */
(() => {
  'use strict';
  const C = window.ASSISTAA;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const app = $('#app');
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const PFX = C.storagePrefix || 'assistaa.';
  const ISSUES = C.issuesUrl || (C.backends.store.url + '?view=issues');
  const BASE = (location.origin + location.pathname.replace(/index\.html$/, '')).replace(/\/$/, '');

  /* ---------- icons ---------- */
  const P = {
    home: '<path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10"/><path d="M10 20v-6h4v6"/>',
    tasks: '<rect x="4" y="4" width="16" height="16" rx="4"/><path d="M8.5 12l2.5 2.5 4.5-5"/>',
    inbox: '<path d="M4 6h16v10H8l-4 4z"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
    team: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><circle cx="17.5" cy="9" r="2.5"/><path d="M16 14.5a5 5 0 0 1 5.5 5"/>',
    store: '<path d="M3 9l1.5-5h15L21 9"/><path d="M4 9v11h16V9"/><path d="M9 20v-6h6v6"/>',
    headset: '<path d="M4 14v-3a8 8 0 0 1 16 0v3"/><rect x="2" y="14" width="5" height="6" rx="1.5"/><rect x="17" y="14" width="5" height="6" rx="1.5"/>',
    crown: '<path d="M3 8l4 4 5-7 5 7 4-4-2 11H5z"/>',
    chev: '<path d="M9 6l6 6-6 6"/>',
    back: '<path d="M15 6l-6 6 6 6"/>',
    send: '<path d="M22 2L11 13"/><path d="M22 2l-7 20-4-9-9-4z"/>',
    bell: '<path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10 21a2 2 0 0 0 4 0"/>',
    play: '<path d="M7 4l13 8-13 8z"/>',
    check: '<path d="M5 12l5 5L20 7"/>',
    coffee: '<path d="M4 9h13v5a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5z"/><path d="M17 11h1.5a2.5 2.5 0 0 1 0 5H17"/><path d="M8 2v3M12 2v3"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    msg: '<path d="M21 12a8 8 0 0 1-11.5 7.2L4 21l1.8-5.5A8 8 0 1 1 21 12z"/>',
    cam: '<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>',
    out: '<path d="M15 4h4v16h-4"/><path d="M10 8l-4 4 4 4"/><path d="M6 12h10"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    warn: '<path d="M12 3l10 18H2z"/><path d="M12 10v5M12 18v.5"/>',
    history: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l3 2"/>',
    spark: '<path d="M12 2l2.4 7.6L22 12l-7.6 2.4L12 22l-2.4-7.6L2 12l7.6-2.4z"/>',
    refresh: '<path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/>',
    megaphone: '<path d="M3 11v2a2 2 0 0 0 2 2h2l5 4V5L7 9H5a2 2 0 0 0-2 2z"/><path d="M16 8a5 5 0 0 1 0 8"/>',
    phone: '<rect x="6" y="2" width="12" height="20" rx="3"/><path d="M11 18h2"/>',
    lock: '<rect x="5" y="11" width="14" height="10" rx="2.5"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
    share: '<path d="M12 3v12"/><path d="M8 7l4-4 4 4"/><path d="M5 12v8h14v-8"/>'
  };
  const I = (n, cls = '') => `<svg class="icon ${cls}" viewBox="0 0 24 24">${P[n] || ''}</svg>`;

  /* ---------- storage ---------- */
  const store = {
    get(k, d) { try { const v = localStorage.getItem(PFX + k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(PFX + k, JSON.stringify(v)); } catch (e) {} },
    del(k) { try { localStorage.removeItem(PFX + k); } catch (e) {} }
  };

  /* ---------- api ---------- */
  async function api(team, body) {
    const b = C.backends[team];
    if (!b || !b.url) throw new Error('This team is not connected yet.');
    const r = await fetch(b.url, { method: 'POST', body: JSON.stringify(body) });
    if (!r.ok) throw new Error('Network problem. Try again.');
    const j = await r.json();
    if (!j.ok) throw new Error(j.error || 'Something went wrong.');
    return j.data;
  }

  /* ---------- small UI helpers ---------- */
  const hue = (s) => { let h = 0; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) % 360; return h; };
  function avatar(name, photo, size = 56, state = '') {
    const h = hue(name);
    const st = `--s:${size}px;--c1:hsl(${h} 90% 55%);--c2:hsl(${(h + 70) % 360} 85% 55%)`;
    const ring = state ? ` ring ${state}` : '';
    return `<div class="avatar${ring}" style="${st}">${photo ? `<img src="${esc(photo)}" alt="">` : esc(String(name || '?').slice(0, 1).toUpperCase())}</div>`;
  }
  function toast(title, text = '', kind = '', icon = 'bell') {
    const el = document.createElement('div');
    el.className = 'toast ' + kind;
    el.innerHTML = `<div class="ti">${I(kind === 'ok' ? 'check' : kind === 'bad' ? 'warn' : icon)}</div><div><b>${esc(title)}</b>${text ? `<span>${esc(text)}</span>` : ''}</div>`;
    $('#toasts').appendChild(el);
    if (navigator.vibrate) navigator.vibrate(kind === 'bad' ? [30, 40, 30] : 15);
    setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 400); }, 3600);
  }
  function confetti() {
    const box = document.createElement('div');
    box.className = 'confetti';
    const cols = ['#00aeef', '#7c5cff', '#22d3a6', '#ffb547', '#ff5a7a', '#ffffff'];
    for (let i = 0; i < 70; i++) {
      const p = document.createElement('i');
      p.style.left = Math.random() * 100 + '%';
      p.style.background = cols[i % cols.length];
      p.style.setProperty('--x', (Math.random() * 200 - 100) + 'px');
      p.style.setProperty('--r', (Math.random() * 900 - 450) + 'deg');
      p.style.animationDelay = Math.random() * 0.4 + 's';
      p.style.animationDuration = 1.4 + Math.random() * 1.2 + 's';
      box.appendChild(p);
    }
    document.body.appendChild(box);
    setTimeout(() => box.remove(), 3200);
  }
  async function busy(btn, fn) {
    const html = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<span class="spin"></span>';
    try { return await fn(); } finally { btn.disabled = false; btn.innerHTML = html; }
  }
  function greet() { const h = new Date().getHours(); return h < 5 ? 'Late night' : h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'; }
  function emptyBox(icon, text) { return `<div class="empty">${I(icon)}<div>${esc(text)}</div></div>`; }

  /* ---------- sheet (bottom pop-up) ---------- */
  function openSheet(html, onMount) {
    const sh = $('#sheet'), sc = $('#scrim');
    sh.innerHTML = '<div class="grab"></div>' + html;
    sc.hidden = false;
    requestAnimationFrame(() => { sc.classList.add('on'); sh.classList.add('on'); });
    sc.onclick = closeSheet;
    let y0 = null;
    sh.ontouchstart = (e) => { if (sh.scrollTop <= 0) y0 = e.touches[0].clientY; };
    sh.ontouchmove = (e) => { if (y0 != null && e.touches[0].clientY - y0 > 90) { y0 = null; closeSheet(); } };
    if (onMount) onMount(sh);
  }
  function closeSheet() {
    const sh = $('#sheet'), sc = $('#scrim');
    sh.classList.remove('on'); sc.classList.remove('on');
    setTimeout(() => { sc.hidden = true; sh.innerHTML = ''; }, 400);
  }

  /* ---------- state ---------- */
  let S = store.get('session', null); // {team, name, pin}
  let D = null; // data for member
  let B = {}; // boss data per team
  let tab = 'home';
  let timer = null;
  let fresh = 0; // when data was last loaded (ms)
  const stale = (ms) => Date.now() - fresh > ms;

  /* ---------- splash ---------- */
  function hideSplash() { const s = $('#splash'); if (s) { s.classList.add('out'); setTimeout(() => s.remove(), 800); } }

  /* =========================================================
   *  LOGIN
   * ========================================================= */
  /* One screen: type your PIN and the app knows who you are. */
  function viewWelcome() {
    $('#nav').hidden = true; $('#fabSlot').innerHTML = '';
    let pin = '', waitT = null, busyLogin = false, wantGo = false;
    app.innerHTML = `<div class="view pin-wrap">
      <div class="hero stagger" style="padding-bottom:6px">
        <img class="mk" src="assets/mark.svg" alt="">
        <h1>Welcome to <b>Assistaa</b></h1>
        <p>Enter your PIN to open your profile</p>
      </div>
      <div class="dots" id="dots">${'<i></i>'.repeat(4)}</div>
      <div class="pinerr" id="perr"></div>
      <div class="pad">${[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => `<button data-k="${n}">${n}</button>`).join('')}<button class="fn" data-k="b" aria-label="Delete">⌫</button><button data-k="0">0</button><button class="fn ok" data-k="go" aria-label="Sign in">${I('check')}</button></div>
      <p class="muted small" style="margin-top:14px">4-digit PIN for the team · 6-digit PIN for the manager</p>
    </div>`;
    const dots = $('#dots');
    const paint = () => {
      const n = Math.max(4, pin.length);
      if (dots.children.length !== n) dots.innerHTML = '<i></i>'.repeat(n);
      $$('i', dots).forEach((d, i) => d.classList.toggle('on', i < pin.length));
    };
    const fail = (msg) => {
      dots.classList.add('bad'); $('#perr').textContent = msg;
      if (navigator.vibrate) navigator.vibrate([40, 50, 40]);
      setTimeout(() => { dots.classList.remove('bad'); pin = ''; paint(); }, 650);
    };
    const tryIt = async (final) => {
      const p = pin;
      busyLogin = true; dots.style.opacity = 0.55;
      const teams = Object.keys(C.backends).filter((k) => C.backends[k].url);
      const res = await Promise.all(teams.map((k) => api(k, { action: 'login', pin: p, withData: true }).then((r) => ({ k, r })).catch((e) => ({ k, e }))));
      busyLogin = false; dots.style.opacity = '';
      if (wantGo && p === pin) final = true;
      wantGo = false;
      if (p !== pin) { if (pin.length === 6) tryIt(true); return; } // they kept typing
      const owner = res.find((x) => x.r && x.r.role === 'owner');
      const mem = res.find((x) => x.r && x.r.role === 'member');
      const hit = owner ? { team: 'boss', name: C.owner } : mem ? { team: mem.k, name: mem.r.name } : null;
      if (hit) {
        dots.classList.add('ok');
        if (navigator.vibrate) navigator.vibrate([10, 30, 10]);
        $('#perr').innerHTML = `<span style="color:var(--green)">Welcome, ${esc(hit.name)} ✨</span>`;
        S = { team: hit.team, name: hit.name, pin: p }; store.set('session', S);
        if (owner) res.forEach((x) => { if (x.r && x.r.role === 'owner' && x.r.data) { B[x.k] = x.r.data; store.set('bossCache.' + x.k, x.r.data); } });
        else if (mem.r.data) store.set('cache.' + mem.k + '.' + mem.r.name, mem.r.data);
        fresh = Date.now();
        setTimeout(start, 650);
        return;
      }
      const other = res.find((x) => x.e && !/PIN/i.test(x.e.message));
      // a 4-digit miss may be the start of a 6-digit manager PIN: stay quiet unless they pressed ✓ or reached 6
      if (final || pin.length >= 6) fail(other ? other.e.message : 'Wrong PIN. Try again.');
    };
    $$('.pad button').forEach((b) => b.onclick = () => {
      const k = b.dataset.k;
      clearTimeout(waitT); $('#perr').textContent = '';
      if (k === 'go') {
        if (pin.length < 4) { fail('Enter at least 4 digits.'); return; }
        if (busyLogin) wantGo = true; else tryIt(true);
        return;
      }
      if (k === 'b') pin = pin.slice(0, -1); else if (pin.length < 6) pin += k;
      paint();
      if (!busyLogin && (pin.length === 4 || pin.length === 6)) tryIt(pin.length === 6);
    });
  }

  /* =========================================================
   *  MEMBER APP
   * ========================================================= */
  function nav(items) {
    const n = $('#nav');
    n.hidden = false;
    n.innerHTML = '<span class="hl"></span>' + items.map((t) => `<button data-tab="${t.id}" class="${tab === t.id ? 'on' : ''}">${I(t.icon)}${esc(t.label)}${t.badge ? `<span class="badge">${t.badge}</span>` : ''}</button>`).join('');
    $$('button', n).forEach((b) => b.onclick = () => { tab = b.dataset.tab; location.hash = tab; render(); });
    requestAnimationFrame(() => {
      const on = $('button.on', n), hl = $('.hl', n);
      if (on) { hl.style.left = on.offsetLeft + 'px'; hl.style.width = on.offsetWidth + 'px'; }
    });
  }

  async function loadMe(quiet) {
    try {
      D = await api(S.team, { action: 'me', name: S.name, pin: S.pin }); fresh = Date.now();
      store.set('cache.' + S.team + '.' + S.name, D);
      if (!quiet) render(); else render(true);
    } catch (e) {
      if (/PIN|Unknown name/i.test(e.message)) { logout(); toast('Please sign in again', e.message, 'bad'); }
      else if (!quiet) toast('Could not refresh', e.message, 'bad');
    }
  }

  function render(soft) {
    if (!S) return viewWelcome();
    if (S.team === 'boss') return renderBoss(soft);
    if (!D) return;
    const unread = (D.inbox || []).filter((m) => !m.seen).length;
    nav([
      { id: 'home', icon: 'home', label: 'Home' },
      { id: 'tasks', icon: D.support ? 'headset' : 'tasks', label: D.support ? 'Tickets' : 'Tasks' },
      { id: 'inbox', icon: 'inbox', label: 'Inbox', badge: unread || '' },
      { id: 'me', icon: 'user', label: 'Me' }
    ]);
    $('#fabSlot').innerHTML = tab === 'me' ? '' : `<button class="fab" id="fab" aria-label="Message ${esc(C.owner)}">${I('msg')}</button>`;
    if ($('#fab')) $('#fab').onclick = sheetMessage;
    const scroll = window.scrollY;
    const html = tab === 'tasks' ? pageTasks() : tab === 'inbox' ? pageInbox() : tab === 'me' ? pageMe() : pageHome();
    app.innerHTML = `<div class="${soft ? '' : 'view'}">${html}</div>`;
    if (soft) window.scrollTo(0, scroll);
    bind();
    if (tab === 'inbox') markSeen();
  }

  function header() {
    return `<div class="top">${avatar(D.name, D.profile && D.profile.photo, 52, D.today.state)}
      <div><div class="sub">${greet()},</div><h1>${esc(D.name)}</h1></div><div class="sp"></div>
      <button class="iconbtn" id="refresh" aria-label="Refresh">${I('refresh')}</button></div>`;
  }

  function pageHome() {
    const t = D.today;
    const stateTxt = { off: 'Not started', working: 'Working', break: 'On break', done: 'Done for today' }[t.state];
    const big = t.state === 'off' ? (new Date().getHours() < 10 ? 'Starts at 10:00' : 'Ready to start?') :
      t.state === 'working' ? 'Since ' + t.start : t.state === 'break' ? 'Break since ' + t.breakStart : 'Finished ' + t.done;
    let btns = '';
    if (t.state === 'off') btns = `<button class="btn" data-act="start">${I('play')} Start my day</button>`;
    else if (t.state === 'working') btns = `<div class="row">${D.support && !t.breakUsed ? `<button class="btn ghost" data-act="break">${I('coffee')} Break</button>` : ''}<button class="btn amber" data-act="done">${I('check')} Done for today</button></div>`;
    else if (t.state === 'break') btns = `<button class="btn green" data-act="breakend">${I('play')} End break</button>`;
    else btns = `<div class="muted small">Great work today. See you tomorrow ✨</div>`;
    const stats = (D.stats || []).map((s) => {
      const bad = /missing/i.test(s.value) || (/overdue|fine/i.test(s.label) && Number(String(s.value).replace(/[^0-9.]/g, '')) > 0);
      const good = /^(done|sent|yes)/i.test(s.value);
      return `<div class="stat"><span>${esc(s.label)}</span><b class="${bad ? 'bad' : good ? 'good' : ''}">${esc(s.value)}</b></div>`;
    }).join('');
    const latest = (D.inbox || []).filter((m) => !m.seen)[0];
    return `${header()}<div class="stagger">
      ${D.warn ? `<div class="warn">${I('warn')}<div>${esc(D.warn)}</div></div>` : ''}
      <div class="hero-card"><img class="orb" src="assets/mark.svg" alt="">
        <div class="state ${t.state}"><i></i>${stateTxt}</div>
        <div class="big">${esc(big)}</div>
        <div class="clock">${esc(D.day)} · ${esc(D.team)}</div>
        ${btns}
      </div>
      ${latest ? `<button class="msg unread" style="width:100%;text-align:left" data-go="inbox"><div class="from">${avatar(C.owner, '', 34)}<div><b>${esc(C.owner)}</b><div class="small muted">${esc(latest.kind)} · ${esc(latest.time)}</div></div></div><div class="text">${esc(latest.text)}</div></button>` : ''}
      ${D.score ? `<div class="card"><h3>${I('spark')} My score</h3><div class="row" style="align-items:center"><div class="score" style="--p:${Number(D.score.today) * 10}"><div><b>${esc(D.score.today)}</b></div></div><div><div class="muted small">7-day average</div><div class="display" style="font-size:28px;font-weight:700">${esc(D.score.week)}/10</div>${D.score.why ? `<div class="small muted">${esc(D.score.why)}</div>` : ''}</div></div></div>` : ''}
      <div class="card"><h3>${I('spark')} Today's numbers</h3><div class="stats">${stats}</div></div>
      ${D.support && t.state === 'working' ? `<div class="card"><h3>${I('headset')} Need more tickets?</h3><div class="row"><input class="field" id="reqn" type="number" min="1" max="200" inputmode="numeric" placeholder="How many?"><button class="btn sm" id="reqBtn" style="flex:0 0 auto">Request</button></div>${(t.requests || []).map((r) => `<div class="item"><span class="dot"></span><div class="body"><div class="t">${esc(r.time)} · asked for ${esc(r.amount)}</div><div class="s">${esc(r.status)}${r.note ? ' · ' + esc(r.note) : ''}</div></div></div>`).join('')}</div>` : ''}
      ${D.fines ? `<div class="card"><h3>${I('warn')} My fines this month <span class="cnt">${esc(D.fines.total)} ${esc(D.fines.unit)}</span></h3>${(D.fines.list || []).map((f) => `<div class="item"><span class="dot bad"></span><div class="body"><div class="t">${esc(f.rule)}</div><div class="s">${esc(f.date)}${f.ref ? ' · ' + esc(f.ref) : ''} · ${esc(f.amount)}</div></div></div>`).join('') || '<div class="muted small">No fines. Keep it up!</div>'}</div>` : ''}
      <div class="card"><h3>${I('history')} My recent reports</h3>${(D.reports || []).map((r) => `<div class="item"><span class="dot ${r.reply ? 'ok' : ''}"></span><div class="body"><div class="t">${esc(r.type)} <span class="muted small">· ${esc(r.time)}</span></div><div class="s">${esc(r.msg)}</div>${r.reply ? `<div class="reply">${esc(r.reply)}</div>` : ''}</div></div>`).join('') || emptyBox('history', 'Nothing yet today.')}</div>
    </div>`;
  }

  function pageTasks() {
    const items = D.items || [];
    const title = D.support ? 'Tickets waiting over 20 h' : 'My tasks';
    return `${header()}<div class="stagger"><div class="card"><h3>${I(D.support ? 'headset' : 'tasks')} ${title}<span class="cnt">${items.length}</span></h3>
      ${items.map((it) => `<div class="item"><span class="dot ${it.bad ? 'bad' : it.status === 'In progress' ? 'amber' : ''}"></span><div class="body">
        <div class="t">${esc(it.title)}</div><div class="s">${esc(it.sub)}</div>
        ${!D.support && it.row ? `<div class="acts">${it.status !== 'In progress' ? `<button class="btn sm ghost" data-task="${it.row}" data-st="In progress" data-title="${esc(it.title)}">${I('play')} Start</button>` : '<span class="pill amber">In progress</span>'}<button class="btn sm green" data-task="${it.row}" data-st="Done" data-title="${esc(it.title)}">${I('check')} Done</button></div>` : ''}
      </div></div>`).join('') || emptyBox('check', D.support ? 'No tickets over 20 hours. Nice!' : 'No open tasks. You\'re all clear!')}
    </div></div>`;
  }

  function pageInbox() {
    const list = D.inbox || [];
    return `${header()}<div class="stagger">
      ${list.map((m) => `<div class="msg ${m.seen ? '' : 'unread'}" data-id="${esc(m.id)}">
        <div class="from">${avatar(m.from || C.owner, '', 34)}<div><b>${esc(m.from || C.owner)}</b><div class="small muted">${esc(m.kind)} · ${esc(m.time)}</div></div></div>
        <div class="text">${esc(m.text)}</div>
        ${m.reply ? `<div class="reply mine">You: ${esc(m.reply)}${m.replyTime ? ` <span class="muted small">· ${esc(m.replyTime)}</span>` : ''}</div>` : `
        <div class="quick">${['On it 👍', 'Done ✅', 'Need help 🙋', 'Need more time ⏳'].map((q) => `<button class="chip" data-q="${esc(q)}">${q}</button>`).join('')}</div>
        <div class="compose"><textarea class="field" rows="1" placeholder="Write a reply…"></textarea><button class="send" data-reply="${esc(m.id)}" aria-label="Send">${I('send')}</button></div>`}
      </div>`).join('') || `<div class="card">${emptyBox('inbox', 'No messages from ' + C.owner + ' yet.')}</div>`}
    </div>`;
  }

  function pageMe() {
    const p = D.profile || {};
    const notif = ('Notification' in window) && Notification.permission === 'granted' && store.get('pushOn.' + S.team + '.' + S.name, false);
    return `<div class="stagger">
      <div class="profile card">
        <label class="avatar ring ${D.today.state}" style="--s:112px;--c1:hsl(${hue(D.name)} 90% 55%);--c2:hsl(${(hue(D.name) + 70) % 360} 85% 55%);margin:8px auto 0">
          ${p.photo ? `<img src="${esc(p.photo)}" alt="">` : `<span style="font:700 40px Space Grotesk,sans-serif">${esc(D.name[0])}</span>`}
          <span class="cam">${I('cam')}</span><input type="file" accept="image/*" id="photo" hidden></label>
        <h2>${esc(D.name)}</h2>
        <div class="role">${esc(D.role || '')}</div>
        <div class="badges"><span class="pill blue">${esc(D.team)}</span>${p.joined ? `<span class="pill">Since ${esc(p.joined)}</span>` : ''}${D.status ? `<span class="pill green">${esc(D.status)}</span>` : ''}</div>
      </div>
      <div class="card"><h3>${I('user')} About me</h3>
        <label class="fl">A line about you</label><textarea class="field" id="about" maxlength="300" placeholder="I list products for fashion stores and love clean pages.">${esc(p.about)}</textarea>
        <label class="fl">Skills</label><input class="field" id="skills" maxlength="200" placeholder="Shopify, product listing, image editing" value="${esc(p.skills)}">
        <div style="margin-top:12px"><button class="btn" id="saveProfile">Save profile</button></div></div>
      <div class="card"><h3>${I('bell')} Settings</h3>
        <div class="setting">${I('bell')}<div><b>Notifications</b><div class="small muted">Tasks and messages from ${esc(C.owner)}</div></div><div class="sp"></div><button class="switch ${notif ? 'on' : ''}" id="pushSw" aria-label="Notifications"></button></div>
        <div class="setting">${I('phone')}<div><b>Install the app</b><div class="small muted">Add Assistaa to your home screen</div></div><div class="sp"></div><button class="btn sm ghost" id="install">How</button></div>
        <div class="setting">${I('lock')}<div><b>Change PIN</b><div class="small muted">Pick a new 4-digit PIN</div></div><div class="sp"></div><button class="btn sm ghost" id="pinBtn">Change</button></div>
        ${S.team === 'store' && ['Rashed', 'Sabuj'].includes(S.name) ? `<div class="setting">${I('warn')}<div><b>Issue portal</b><div class="small muted">Issue sheet and top-5 checks</div></div><div class="sp"></div><a class="btn sm ghost" href="${ISSUES}" target="_blank" rel="noopener">Open</a></div>` : ''}
        <div class="setting">${I('history')}<div><b>History</b><div class="small muted">Reports, fines and scores</div></div><div class="sp"></div><button class="btn sm ghost" id="hist">Open</button></div>
        <div class="setting">${I('out')}<div><b>Sign out</b><div class="small muted">Use another account</div></div><div class="sp"></div><button class="btn sm ghost" id="logout">Sign out</button></div>
      </div></div>`;
  }

  function bind() {
    const r = $('#refresh');
    if (r) r.onclick = () => { r.firstChild.style.transition = 'transform .6s'; r.firstChild.style.transform = 'rotate(360deg)'; S.team === 'boss' ? loadBoss() : loadMe(); };
    $$('[data-go]').forEach((b) => b.onclick = () => { tab = b.dataset.go; location.hash = tab; render(); });
    $$('[data-act]').forEach((b) => b.onclick = () => workAction(b.dataset.act));
    $$('[data-task]').forEach((b) => b.onclick = () => busy(b, async () => {
      D = await api(S.team, { action: 'task', name: S.name, pin: S.pin, row: Number(b.dataset.task), status: b.dataset.st, title: b.dataset.title });
      if (b.dataset.st === 'Done') { confetti(); toast('Task done', b.dataset.title, 'ok'); } else toast('Task started', b.dataset.title, 'ok');
      render(true);
    }).catch((e) => toast('Could not update', e.message, 'bad')));
    $$('[data-q]').forEach((b) => b.onclick = () => { const ta = $('textarea', b.closest('.msg')); ta.value = b.dataset.q; ta.focus(); });
    $$('[data-reply]').forEach((b) => b.onclick = () => {
      const ta = $('textarea', b.closest('.msg'));
      if (!ta.value.trim()) { ta.focus(); return; }
      busy(b, async () => { D = await api(S.team, { action: 'reply', name: S.name, pin: S.pin, id: b.dataset.reply, text: ta.value }); toast('Reply sent', '', 'ok'); render(true); })
        .catch((e) => toast('Could not send', e.message, 'bad'));
    });
    const rb = $('#reqBtn');
    if (rb) rb.onclick = () => busy(rb, async () => {
      D = await api(S.team, { action: 'act', name: S.name, pin: S.pin, act: 'request', amount: $('#reqn').value });
      toast('Request sent', 'Atiq will assign more tickets.', 'ok'); render(true);
    }).catch((e) => toast('Could not request', e.message, 'bad'));
    // profile
    const ph = $('#photo');
    if (ph) ph.onchange = () => pickPhoto(ph.files[0]);
    const sp = $('#saveProfile');
    if (sp) sp.onclick = () => busy(sp, async () => { D = await api(S.team, { action: 'profile', name: S.name, pin: S.pin, about: $('#about').value, skills: $('#skills').value }); toast('Profile saved', '', 'ok'); render(true); }).catch((e) => toast('Could not save', e.message, 'bad'));
    const ps = $('#pushSw');
    if (ps) ps.onclick = () => enablePush(true);
    const ins = $('#install'); if (ins) ins.onclick = sheetInstall;
    const hi = $('#hist'); if (hi) hi.onclick = sheetHistory;
    const pb = $('#pinBtn'); if (pb) pb.onclick = sheetPin;
    const lo = $('#logout'); if (lo) lo.onclick = () => { logout(); toast('Signed out', '', 'ok'); };
  }

  function workAction(act) {
    const t = D.today;
    if (act === 'break' || act === 'breakend') {
      return run(act, '', act === 'break' ? 'Enjoy your break ☕' : 'Welcome back!');
    }
    const isStart = act === 'start';
    openSheet(`<h2>${isStart ? 'Start your day' : 'Done for today'}</h2>
      <p class="lead">${isStart ? 'Optional: what will you work on today?' : 'Your end report: what you did, and what is still pending.'}</p>
      <textarea class="field" id="wtext" placeholder="${isStart ? 'Glamstadt – 20 products, Sophia Fashion – 20 products' : 'Glamstadt – 20 products done\nSophia Fashion – 20 products done\nPending: none'}"></textarea>
      ${!isStart && !D.support ? `<label class="fl">Products listed today (total number)</label><input class="field" id="wprod" type="number" inputmode="numeric" min="0" max="2000" placeholder="e.g. 40">` : ''}
      <div class="err" id="werr"></div>
      <button class="btn ${isStart ? '' : 'amber'}" id="wgo">${I(isStart ? 'play' : 'check')} ${isStart ? 'Start now' : 'Send end report'}</button>`, (sh) => {
      setTimeout(() => $('#wtext', sh).focus(), 350);
      $('#wgo', sh).onclick = () => {
        const txt = $('#wtext', sh).value.trim();
        if (!isStart && txt.length < 5) { $('#werr', sh).textContent = 'Write what you did today and what is still pending.'; return; }
        const pe = $('#wprod', sh); let prod;
        if (pe) { prod = pe.value.trim(); if (!/^\d{1,4}$/.test(prod) || +prod > 2000) { $('#werr', sh).textContent = 'Write how many products you listed today (0 if none).'; pe.focus(); return; } prod = +prod; }
        busy($('#wgo', sh), () => run(act, txt, isStart ? 'Have a great day! 🚀' : 'Great work today! 🎉', prod)).catch(() => {});
      };
    });
    void t;
  }
  async function run(act, text, okMsg, amount) {
    try {
      D = await api(S.team, { action: 'act', name: S.name, pin: S.pin, act, text, amount });
      closeSheet();
      if (act === 'done' || act === 'start') confetti();
      toast(okMsg, '', 'ok');
      render(true);
    } catch (e) { const w = $('#werr'); if (w) w.textContent = e.message; else toast('Could not do that', e.message, 'bad'); throw e; }
  }

  function sheetMessage() {
    let type = 'Question';
    const types = ['Question', 'Leave request', 'Problem', 'Update', 'Other'];
    openSheet(`<h2>Message ${esc(C.owner)}</h2><p class="lead">He gets a notification straight away.</p>
      <div class="quick" id="types">${types.map((t) => `<button class="chip ${t === type ? 'on' : ''}" data-t="${t}">${t}</button>`).join('')}</div>
      <textarea class="field" id="mtext" style="margin-top:12px" placeholder="Write your message…"></textarea><div class="err" id="merr"></div>
      <button class="btn" id="mgo">${I('send')} Send</button>`, (sh) => {
      $$('[data-t]', sh).forEach((b) => b.onclick = () => { type = b.dataset.t; $$('[data-t]', sh).forEach((x) => x.classList.toggle('on', x === b)); });
      $('#mgo', sh).onclick = () => {
        const txt = $('#mtext', sh).value.trim();
        if (!txt) { $('#merr', sh).textContent = 'Write a message first.'; return; }
        busy($('#mgo', sh), async () => {
          D = await api(S.team, { action: 'act', name: S.name, pin: S.pin, act: 'message', text: txt, amount: type });
          closeSheet(); toast('Message sent', 'Claude and ' + C.owner + ' will reply in your reports.', 'ok'); render(true);
        }).catch((e) => { $('#merr', sh).textContent = e.message; });
      };
    });
  }

  function sheetHistory() {
    const iso = (d) => d.toISOString().slice(0, 10);
    const to = iso(new Date()), from = iso(new Date(Date.now() - 89 * 864e5));
    openSheet(`<h2>History</h2><p class="lead">Your reports, activity, fines and scores.</p>
      <div class="row"><div><label class="fl">From</label><input class="field" type="date" id="hf" value="${from}"></div><div><label class="fl">To</label><input class="field" type="date" id="ht" value="${to}"></div></div>
      <button class="btn" id="hgo" style="margin:12px 0">${I('history')} Show</button><div id="hlist"></div>`, (sh) => {
      const load = () => busy($('#hgo', sh), async () => {
        $('#hlist', sh).innerHTML = '<div class="sk" style="height:200px"></div>';
        try {
          const h = await api(S.team, { action: 'history', name: S.name, pin: S.pin, from: $('#hf', sh).value, to: $('#ht', sh).value });
          $('#hlist', sh).innerHTML = (h.totals ? `<div class="stats" style="margin-bottom:10px"><div class="stat"><span>Messages</span><b>${h.totals.messages}</b></div><div class="stat"><span>Closed</span><b>${h.totals.closed}</b></div></div>` : '') +
            (h.items.map((x) => `<div class="item"><span class="dot ${x.kind === 'Fine' ? 'bad' : x.kind === 'Score' ? 'ok' : ''}"></span><div class="body"><div class="t">${esc(x.kind)} <span class="muted small">· ${esc(x.when)}</span></div><div class="s">${esc(x.text)}</div>${x.reply ? `<div class="reply">${esc(x.reply)}</div>` : ''}</div></div>`).join('') || emptyBox('history', 'Nothing in these dates.'));
        } catch (e) { $('#hlist', sh).innerHTML = `<div class="err">${esc(e.message)}</div>`; }
      });
      $('#hgo', sh).onclick = load; load();
    });
  }

  function sheetPin() {
    const boss = S.team === 'boss', len = boss ? 6 : 4;
    openSheet(`<h2>Change PIN</h2><p class="lead">${boss ? 'Your manager PIN (6 digits). It changes for both teams.' : 'Pick a new 4-digit PIN that is easy for you to remember.'}</p>
      <label class="fl">Current PIN</label><input class="field" id="p0" type="password" inputmode="numeric" maxlength="${len}" autocomplete="off">
      <label class="fl">New PIN</label><input class="field" id="p1" type="password" inputmode="numeric" maxlength="${len}" autocomplete="off">
      <label class="fl">New PIN again</label><input class="field" id="p2" type="password" inputmode="numeric" maxlength="${len}" autocomplete="off">
      <div class="err" id="perr2"></div><button class="btn" id="pgo">${I('lock')} Save new PIN</button>`, (sh) => {
      $('#pgo', sh).onclick = () => {
        const o = $('#p0', sh).value.trim(), n1 = $('#p1', sh).value.trim(), n2 = $('#p2', sh).value.trim(), err = $('#perr2', sh);
        if (o !== S.pin) { err.textContent = 'Your current PIN is not right.'; return; }
        if (!new RegExp('^\\d{' + len + '}$').test(n1)) { err.textContent = 'The new PIN must be ' + len + ' digits.'; return; }
        if (n1 !== n2) { err.textContent = 'The two new PINs are not the same.'; return; }
        if (n1 === o) { err.textContent = 'That is your current PIN. Pick a new one.'; return; }
        busy($('#pgo', sh), async () => {
          // one backend holds every PIN now: ask once, change once
          const team = boss ? Object.keys(C.backends).find((k) => C.backends[k].url) : S.team;
          const who = boss ? C.owner : S.name;
          const free = await api(team, { action: 'pinFree', name: who, pin: o, newPin: n1 });
          if (!free.free) throw new Error('That PIN is already used. Pick another one.');
          await api(team, { action: 'changePin', name: who, pin: o, newPin: n1 });
          S.pin = n1; store.set('session', S);
          closeSheet(); confetti(); toast('PIN changed 🔐', 'Use your new PIN next time you sign in.', 'ok');
        }).catch((e) => { err.textContent = e.message; });
      };
    });
  }

  function sheetInstall() {
    const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
    openSheet(`<h2>Install Assistaa</h2><p class="lead">Get the app icon on your home screen${ios ? ' (needed for notifications on iPhone)' : ''}.</p>
      ${ios ? `<div class="item"><span class="dot"></span><div class="body"><div class="t">1. Open this page in Safari</div></div></div>
        <div class="item"><span class="dot"></span><div class="body"><div class="t">2. Tap ${I('share')} Share</div></div></div>
        <div class="item"><span class="dot"></span><div class="body"><div class="t">3. Tap “Add to Home Screen”</div></div></div>`
      : `<div class="item"><span class="dot"></span><div class="body"><div class="t">1. Open this page in Chrome</div></div></div>
        <div class="item"><span class="dot"></span><div class="body"><div class="t">2. Tap ⋮ menu → “Install app” or “Add to Home screen”</div></div></div>`}
      ${deferredInstall ? `<button class="btn" id="doInstall" style="margin-top:14px">Install now</button>` : ''}`, (sh) => {
      const b = $('#doInstall', sh);
      if (b) b.onclick = async () => { deferredInstall.prompt(); await deferredInstall.userChoice; deferredInstall = null; closeSheet(); };
    });
  }

  function pickPhoto(file) {
    if (!file) return;
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      const size = 220; c.width = c.height = size;
      const s = Math.min(img.width, img.height);
      c.getContext('2d').drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, size, size);
      let q = 0.85, data = c.toDataURL('image/jpeg', q);
      while (data.length > 40000 && q > 0.3) { q -= 0.1; data = c.toDataURL('image/jpeg', q); }
      toast('Uploading photo…', '', '', 'cam');
      api(S.team, { action: 'profile', name: S.name, pin: S.pin, photo: data })
        .then((d) => { D = d; toast('Looking good! 📸', 'Profile photo updated', 'ok'); render(true); })
        .catch((e) => toast('Could not upload', e.message, 'bad'));
    };
    img.src = URL.createObjectURL(file);
  }

  async function markSeen() {
    const ids = (D.inbox || []).filter((m) => !m.seen).map((m) => m.id);
    if (!ids.length) return;
    try { await api(S.team, { action: 'seen', name: S.name, pin: S.pin, ids }); (D.inbox || []).forEach((m) => { if (ids.includes(m.id)) m.seen = true; }); setTimeout(() => { if (tab === 'inbox') nav([{ id: 'home', icon: 'home', label: 'Home' }, { id: 'tasks', icon: D.support ? 'headset' : 'tasks', label: D.support ? 'Tickets' : 'Tasks' }, { id: 'inbox', icon: 'inbox', label: 'Inbox' }, { id: 'me', icon: 'user', label: 'Me' }]); }, 1500); } catch (e) {}
  }

  /* =========================================================
   *  BOSS VIEW (Atiq)
   * ========================================================= */
  let bossTeam = store.get('bossTeam', 'store');
  let bossTab = 'team';
  async function loadBoss(quiet) {
    const teams = Object.keys(C.backends).filter((k) => C.backends[k].url).sort((a, b) => (a === bossTeam ? -1 : b === bossTeam ? 1 : 0));
    const one = async (k) => {
      try { B[k] = await api(k, { action: 'boss', pin: S.pin }); fresh = Date.now(); store.set('bossCache.' + k, B[k]); if (k === bossTeam && !$('#sheet.on')) render(true); }
      catch (e) { if (/PIN/i.test(e.message)) { logout(); toast('Please sign in again', '', 'bad'); } else if (!quiet) toast('Could not load ' + C.backends[k].label, e.message, 'bad'); }
    };
    await Promise.all(teams.map(one));
  }
  function renderBoss(soft) {
    const d = B[bossTeam];
    $('#fabSlot').innerHTML = `<button class="fab" id="fab" aria-label="Announcement">${I('megaphone')}</button>`;
    $('#fab').onclick = () => sheetSend('all');
    const pendingReplies = Object.values(B).reduce((a, x) => a + (x.inbox || []).filter((m) => m.reply).length, 0);
    nav([{ id: 'team', icon: 'team', label: 'Team' }, { id: 'btasks', icon: 'tasks', label: 'Tasks' }, { id: 'bmsg', icon: 'inbox', label: 'Messages' }, { id: 'breports', icon: 'history', label: 'Reports' }, { id: 'badmin', icon: 'crown', label: 'Admin' }]);
    $$('#nav button').forEach((b) => b.onclick = () => { bossTab = b.dataset.tab; tab = bossTab; renderBoss(); });
    $$('#nav button').forEach((b) => b.classList.toggle('on', b.dataset.tab === bossTab));
    requestAnimationFrame(() => { const on = $('#nav button.on'), hl = $('#nav .hl'); if (on) { hl.style.left = on.offsetLeft + 'px'; hl.style.width = on.offsetWidth + 'px'; } });
    void pendingReplies;
    const teams = Object.keys(C.backends).filter((k) => C.backends[k].url);
    const head = `<div class="top">${avatar(C.owner, '', 52)}<div><div class="sub">${greet()},</div><h1>${esc(C.owner)} <span style="font-size:18px">👑</span></h1></div><div class="sp"></div><button class="iconbtn" id="refresh">${I('refresh')}</button><button class="iconbtn" id="bellB" style="margin-left:8px" aria-label="Notifications">${I('bell')}</button><button class="iconbtn" id="moreB" style="margin-left:8px" aria-label="Settings">${I('user')}</button></div>
      <div class="tabs">${teams.map((k) => `<button data-bt="${k}" class="${k === bossTeam ? 'on' : ''}">${esc(C.backends[k].label)}</button>`).join('')}</div>`;
    let body = '';
    if (!d && bossTab !== 'badmin') body = `<div class="sk" style="height:120px;margin-bottom:12px"></div><div class="sk" style="height:300px"></div>`;
    else if (bossTab === 'btasks') body = bossTasks(d);
    else if (bossTab === 'bmsg') body = bossMsgs(d);
    else if (bossTab === 'breports') body = bossReports(d);
    else if (bossTab === 'badmin') body = bossAdmin();
    else body = bossTeamView(d);
    const scroll = window.scrollY;
    app.innerHTML = `<div class="${soft ? '' : 'view'}">${head}<div class="stagger">${body}</div></div>`;
    if (soft) window.scrollTo(0, scroll);
    $$('[data-bt]').forEach((b) => b.onclick = () => { bossTeam = b.dataset.bt; store.set('bossTeam', bossTeam); renderBoss(); });
    $('#refresh').onclick = () => { loadBoss(); if (bossTab === 'badmin') loadAdmin(); };
    $('#bellB').onclick = () => enablePush(true);
    $('#moreB').onclick = () => openSheet(`<h2>Settings</h2><p class="lead">Manager account</p>
      <div class="setting">${I('lock')}<div><b>Change PIN</b><div class="small muted">Changes it for both teams</div></div><div class="sp"></div><button class="btn sm ghost" id="pinBtn2">Change</button></div>
      <div class="setting">${I('warn')}<div><b>Issue portal</b><div class="small muted">Store issue sheet</div></div><div class="sp"></div><a class="btn sm ghost" href="${ISSUES}" target="_blank" rel="noopener">Open</a></div>
      <div class="setting">${I('bell')}<div><b>Notifications</b><div class="small muted">Replies and reports from the team</div></div><div class="sp"></div><button class="btn sm ghost" id="pushB2">Turn on</button></div>
      <div class="setting">${I('out')}<div><b>Sign out</b></div><div class="sp"></div><button class="btn sm ghost" id="lo2">Sign out</button></div>`, (sh) => {
      $('#pinBtn2', sh).onclick = () => { closeSheet(); setTimeout(sheetPin, 420); };
      $('#pushB2', sh).onclick = () => { closeSheet(); enablePush(true); };
      $('#lo2', sh).onclick = () => { closeSheet(); logout(); };
    });
    $$('[data-person]').forEach((b) => b.onclick = () => sheetPerson(b.dataset.person));
    $$('[data-newtask]').forEach((b) => b.onclick = () => sheetTask({ owner: b.dataset.newtask || '' }));
    $$('[data-edit]').forEach((b) => b.onclick = () => sheetTask(d.tasks.find((t) => String(t.row) === b.dataset.edit)));
    if (bossTab === 'badmin') bindAdmin();
  }
  const stLabel = { off: 'Not started', working: 'Working', break: 'On break', done: 'Done' };
  function bossTeamView(d) {
    const working = d.people.filter((p) => p.state === 'working').length;
    const off = d.people.filter((p) => p.state === 'off').length;
    const replies = (d.inbox || []).filter((m) => m.reply).length;
    return `<div class="kpis"><div class="kpi"><b>${working}</b><span>Working</span></div><div class="kpi"><b>${off}</b><span>Not started</span></div><div class="kpi"><b>${d.support ? (d.reports || []).length : d.tasks.filter((t) => t.status !== 'Done').length}</b><span>${d.support ? 'Reports' : 'Open tasks'}</span></div></div>
      <div class="team-grid">${d.people.map((p) => `<button class="tm" data-person="${esc(p.name)}">${avatar(p.name, p.photo, 60, p.state)}<b>${esc(p.name)}</b>
        <div class="st">${stLabel[p.state]}${p.start ? ' · ' + esc(p.start) : ''}</div>
        <div class="meta">${!d.support ? `<span class="pill ${p.overdue ? 'red' : p.open ? 'amber' : 'green'}">${p.open} task${p.open === 1 ? '' : 's'}</span>` : ''}</div></button>`).join('')}</div>
      ${replies ? `<div class="card" style="margin-top:14px"><h3>${I('msg')} Latest replies</h3>${d.inbox.filter((m) => m.reply).slice(0, 5).map((m) => `<div class="item"><span class="dot ok"></span><div class="body"><div class="t">${esc(m.to)}</div><div class="s">You: ${esc(m.text)}</div><div class="reply">${esc(m.reply)}</div></div></div>`).join('')}</div>` : ''}`;
  }
  function bossTasks(d) {
    if (d.support) return `<div class="card">${emptyBox('tasks', 'Tasks are for the store team. Switch to Store team above.')}</div>`;
    const open = d.tasks.filter((t) => t.status !== 'Done');
    const done = d.tasks.filter((t) => t.status === 'Done');
    const row = (t) => `<div class="item"><span class="dot ${t.overdue ? 'bad' : t.status === 'Done' ? 'ok' : t.status === 'In progress' ? 'amber' : ''}"></span><div class="body"><div class="t">${esc(t.task)}</div><div class="s">${esc([t.store, t.owner || 'No owner', t.status, t.deadline ? 'due ' + t.deadline : ''].filter(Boolean).join(' · '))}</div></div><button class="iconbtn" data-edit="${t.row}" aria-label="Edit">${I('chev')}</button></div>`;
    return `<button class="btn" data-newtask="" style="margin-bottom:14px">${I('plus')} New task</button>
      <div class="card"><h3>${I('tasks')} Open <span class="cnt">${open.length}</span></h3>${open.map(row).join('') || emptyBox('check', 'No open tasks.')}</div>
      ${done.length ? `<div class="card"><h3>${I('check')} Done recently <span class="cnt">${done.length}</span></h3>${done.map(row).join('')}</div>` : ''}`;
  }
  function bossMsgs(d) {
    return `<button class="btn" id="sendAll" style="margin-bottom:14px" onclick="">${I('megaphone')} Message everyone</button>
      ${(d.inbox || []).map((m) => `<div class="msg"><div class="from">${avatar(m.to, '', 34)}<div><b>To ${esc(m.to)}</b><div class="small muted">${esc(m.kind)} · ${esc(m.time)} · ${m.seen ? '<span style="color:var(--blue-2)">✓✓ Seen</span>' : '✓ Sent'}</div></div></div><div class="text">${esc(m.text)}</div>${m.reply ? `<div class="reply">${esc(m.to)}: ${esc(m.reply)}</div>` : ''}</div>`).join('') || `<div class="card">${emptyBox('inbox', 'No messages sent yet. Tap a person on the Team tab to send one.')}</div>`}`;
  }
  function bossReports(d) {
    return `<div class="card"><h3>${I('history')} Reports from the team</h3>${(d.reports || []).map((r) => `<div class="item"><span class="dot ${r.reply ? 'ok' : 'amber'}"></span><div class="body"><div class="t">${esc(r.name)} · ${esc(r.type)}</div><div class="s">${esc(r.time)}</div><div style="margin-top:4px;white-space:pre-wrap">${esc(r.msg)}</div>${r.reply ? `<div class="reply">${esc(r.reply)}</div>` : ''}</div></div>`).join('') || emptyBox('history', 'No reports yet.')}</div>`;
  }

  /* ---------- Admin (manager only): people, PINs, ticket split, fines, leave, rules ---------- */
  let A = store.get('adminCache', null), adminLoading = false;
  const adm = (op, extra) => api('store', Object.assign({ action: 'admin', pin: S.pin, op }, extra || {}));
  async function loadAdmin() {
    if (adminLoading) return; adminLoading = true;
    try { A = await adm('data'); store.set('adminCache', A); if (bossTab === 'badmin' && !$('#sheet.on')) renderBoss(true); }
    catch (e) { toast('Could not load admin', e.message, 'bad'); } finally { adminLoading = false; }
  }
  function setA(r) { if (r && r.data) { A = r.data; store.set('adminCache', A); } }
  const setLabel = {
    silent_until: 'Quiet until (fines and scores hidden from the team)', work_start: 'Work start time', missed_update_fine_tk: 'Missed start/end update fine (৳)',
    client_wait_fine_tk: 'Client waited too long fine (৳)', client_wait_minutes: 'Client must be answered within (min)', start_grace_min: 'Start report grace (min)',
    missed_report_fine_tickets: 'Missed start report fine (tickets)', break_fine_after_min: 'Break fine starts after (min)', break_fine_per_min: 'Break fine per extra minute (tickets)',
    break_fine_max: 'Break fine max (tickets)', wait20_fine: 'Ticket waiting 20 h fine (tickets)', wait24_fine: 'Ticket waiting 24 h fine (tickets)',
    wait_fine_per_hour_after24: 'Each extra hour after 24 h (tickets)', wait_fine_max_per_ticket: 'Max fine per waiting ticket (tickets)',
    daily_fine_cap_tickets: 'Daily fine cap (tickets)', ticket_value_tk: 'Value of one ticket (৳)'
  };
  const dhakaToday = () => new Date(Date.now() + 6 * 36e5).toISOString().slice(0, 10);
  function bossAdmin() {
    if (!A) { loadAdmin(); return `<div class="sk" style="height:160px;margin-bottom:12px"></div><div class="sk" style="height:300px"></div>`; }
    const sup = bossTeam === 'support';
    const people = A.people.filter((p) => p.team === bossTeam);
    const unit = sup ? 'tickets' : '৳';
    const fines = A.fines.filter((f) => f.team === bossTeam);
    const activeTotal = (n) => fines.filter((f) => f.name === n && f.status === 'active').reduce((a, f) => a + f.amount, 0);
    const given = Object.fromEntries((A.assigned || []).map((x) => [x.name, x.n]));
    const sp = A.split || { shares: {}, dipon_tickets: 0 };
    const shareSum = Object.values(sp.shares || {}).reduce((a, n) => a + Number(n), 0) || 1;
    const scoreDay = (A.scores || [])[0] && A.scores[0].day;
    const scores = (A.scores || []).filter((s) => s.day === scoreDay && people.some((p) => p.name === s.name));
    const sets = (A.settings || []).filter((s) => s.scope === bossTeam || s.scope === 'global');
    return `
      ${sup ? `<div class="card"><h3>${I('headset')} Ticket split <span class="cnt">from ${esc(sp.from_date || '—')}</span></h3>
        ${Object.entries(sp.shares || {}).map(([n, v]) => `<div class="item"><span class="dot ok"></span><div class="body"><div class="t">${esc(n)} · ${esc(v)}</div><div class="s">≈ ${Math.round(v / shareSum * 100)}% of new tickets${given[n] != null ? ' · ' + given[n] + ' given today' : ''}</div></div></div>`).join('')}
        ${sp.dipon_tickets ? `<div class="item"><span class="dot"></span><div class="body"><div class="t">Dipon extra · ${esc(sp.dipon_tickets)} tickets a day</div><div class="s">On top of his share</div></div></div>` : ''}
        <div class="small muted" style="margin:8px 0">New tickets are split at 09:55, 12:55 and 15:55 (not Friday), oldest first.</div>
        ${(A.upcoming || []).length ? `<div class="label" style="margin:12px 0 6px">Planned</div>${A.upcoming.map((u) => `<div class="item"><span class="dot amber"></span><div class="body"><div class="t">From ${esc(u.from_date)}</div><div class="s">${esc(Object.entries(u.shares || {}).map(([n, v]) => n + ' ' + v + '%').join(' · '))}${u.dipon_tickets ? ' · Dipon extra ' + esc(u.dipon_tickets) : ''}${u.note ? ' · ' + esc(u.note) : ''}</div></div><button class="btn sm ghost" data-delsplit="${u.id}">Remove</button></div>`).join('')}` : ''}
        <button class="btn ghost" id="aSplit" style="margin-top:10px">${I('refresh')} Change or plan split</button></div>` : ''}
      <div class="card"><h3>${I('team')} People <span class="cnt">${people.filter((p) => p.active).length}</span></h3>
        ${people.map((p) => `<div class="item"${p.active ? '' : ' style="opacity:.5"'}>${avatar(p.name, '', 34)}<div class="body"><div class="t">${esc(p.name)}${p.active ? '' : ' · access off'}</div><div class="s">${esc([p.title, p.rate != null && sup ? '৳' + p.rate + ' per message' : '', p.joined ? 'joined ' + p.joined : ''].filter(Boolean).join(' · '))}</div></div><button class="iconbtn" data-aperson="${esc(p.id)}" aria-label="Edit">${I('chev')}</button></div>`).join('')}
        <button class="btn" id="aAdd" style="margin-top:10px">${I('plus')} Add person</button></div>
      <div class="card"><h3>${I('warn')} Fines this month <span class="cnt">${fines.filter((f) => f.status === 'active').length}</span></h3>
        <div class="small muted" style="margin-bottom:8px">${people.filter((p) => p.active).map((p) => `${esc(p.name)} ${activeTotal(p.name)} ${unit}`).join(' · ')}</div>
        ${fines.slice(0, 40).map((f) => `<div class="item"${f.status === 'active' ? '' : ' style="opacity:.5"'}><span class="dot ${f.status === 'active' ? 'bad' : ''}"></span><div class="body"><div class="t">${esc(f.name)} · ${f.amount} ${f.unit === 'bdt' ? '৳' : esc(f.unit)}${f.status === 'active' ? '' : ' · waived'}</div><div class="s">${esc(f.day)} · ${esc(f.rule)}${f.note ? ' · ' + esc(f.note) : ''}${/^auto:/.test(f.ref) ? ' · automatic' : ''}</div></div><button class="btn sm ghost" data-waive="${f.id}">${f.status === 'active' ? 'Waive' : 'Undo'}</button></div>`).join('') || emptyBox('check', 'No fines this month.')}
        <button class="btn ghost" id="aFine" style="margin-top:10px">${I('plus')} Add a fine</button></div>
      <div class="card"><h3>${I('spark')} Scores <span class="cnt">${esc(scoreDay || '')}</span></h3>
        ${scores.map((s) => `<div class="item"><span class="dot ${s.score >= 8 ? 'ok' : s.score >= 6 ? 'amber' : 'bad'}"></span><div class="body"><div class="t">${esc(s.name)} · ${s.score}/10</div><div class="s">${esc(s.why || 'All good')}</div></div></div>`).join('') || emptyBox('spark', 'Scores appear after 22:00.')}
        <button class="btn ghost" id="aRecalc" style="margin-top:10px">${I('refresh')} Recalculate today</button></div>
      <div class="card"><h3>${I('clock')} Leave</h3>
        ${A.leave.filter((l) => people.some((p) => p.name === l.name)).map((l) => `<div class="item"><span class="dot ok"></span><div class="body"><div class="t">${esc(l.name)}</div><div class="s">${esc(l.from === l.to ? l.from : l.from + ' to ' + l.to)}${l.reason ? ' · ' + esc(l.reason) : ''}</div></div><button class="btn sm ghost" data-cancelleave="${l.id}">Cancel</button></div>`).join('') || emptyBox('clock', 'No leave booked.')}
        <button class="btn ghost" id="aLeave" style="margin-top:10px">${I('plus')} Add leave</button>
        <div class="small muted" style="margin-top:8px">No fines and no score on leave days.</div></div>
      <div class="card"><h3>${I('lock')} Rules and amounts</h3>
        ${sets.map((s) => `<div class="item"><div class="body"><div class="t">${esc(setLabel[s.key] || s.key)}</div><div class="s">${esc(String(s.value).replace(/"/g, ''))}${s.scope === 'global' ? ' · both teams' : ''}</div></div><button class="btn sm ghost" data-aset="${esc(s.scope + '|' + s.key)}">Edit</button></div>`).join('')}</div>`;
  }
  function bindAdmin() {
    if (!A) return;
    const run = (btn, op, extra, msg) => busy(btn, async () => { setA(await adm(op, extra)); if (msg) toast(msg, '', 'ok'); }).then(() => renderBoss(true)).catch((e) => toast('Could not save', e.message, 'bad'));
    $$('[data-waive]').forEach((b) => b.onclick = () => run(b, 'waiveFine', { fine: Number(b.dataset.waive) }, 'Fine updated'));
    $$('[data-delsplit]').forEach((b) => b.onclick = () => run(b, 'deleteSplit', { split: Number(b.dataset.delsplit) }, 'Planned split removed'));
    $$('[data-cancelleave]').forEach((b) => b.onclick = () => run(b, 'cancelLeave', { leave: Number(b.dataset.cancelleave) }, 'Leave cancelled'));
    $$('[data-aperson]').forEach((b) => b.onclick = () => sheetAdminPerson(A.people.find((p) => p.id === b.dataset.aperson)));
    $$('[data-aset]').forEach((b) => b.onclick = () => { const [scope, key] = b.dataset.aset.split('|'); sheetAdminSetting(A.settings.find((s) => s.scope === scope && s.key === key)); });
    const on = (id, fn) => { const b = $('#' + id); if (b) b.onclick = () => fn(b); };
    on('aAdd', () => sheetAdminPerson(null));
    on('aFine', () => sheetAdminFine());
    on('aLeave', () => sheetAdminLeave());
    on('aSplit', () => sheetAdminSplit());
    on('aRecalc', (b) => run(b, 'recalc', {}, 'Fines and scores recalculated'));
  }
  function teamPeople() { return A.people.filter((p) => p.team === bossTeam && p.active); }
  function done(msg, sub) { closeSheet(); toast(msg, sub || '', 'ok'); setTimeout(() => renderBoss(true), 420); }
  function showPin(name, pin) {
    openSheet(`<div style="text-align:center"><div class="avatar" style="--s:76px">${I('lock')}</div><h2 style="margin-top:12px">${esc(name)}'s new PIN</h2>
      <div style="font:800 44px/1.2 Inter,sans-serif;letter-spacing:.3em;margin:14px 0">${esc(pin)}</div>
      <p class="lead">Tell ${esc(name)} this PIN in person or on a call. It is shown only now. They can change it later from Me → Change PIN.</p></div>
      <button class="btn" id="pinOk">${I('check')} Done</button>`, (sh) => { $('#pinOk', sh).onclick = () => { closeSheet(); setTimeout(() => renderBoss(true), 420); }; });
  }
  function sheetAdminPerson(p) {
    const sup = bossTeam === 'support';
    openSheet(`<h2>${p ? esc(p.name) : 'Add a person'}</h2><p class="lead">${p ? 'Edit details, reset a forgotten PIN, or turn off access.' : 'They get a 4-digit PIN to sign in to ' + esc(C.backends[bossTeam].label) + '.'}</p>
      ${p ? '' : `<label class="fl">Name (as shown in the app)</label><input class="field" id="an" maxlength="40" placeholder="First name">`}
      <label class="fl">Job title</label><input class="field" id="at" maxlength="80" value="${esc(p ? p.title || '' : sup ? 'Support agent' : 'Product listings')}">
      ${sup ? `<label class="fl">Pay per message (৳)</label><input class="field" id="ar" type="number" inputmode="decimal" min="0" value="${esc(p ? (p.rate == null ? '' : p.rate) : '10')}">` : ''}
      <div class="err" id="aerr"></div>
      <button class="btn" id="ago">${I('check')} ${p ? 'Save' : 'Add and make PIN'}</button>
      ${p ? `<button class="btn ghost" id="apin" style="margin-top:10px">${I('lock')} Reset PIN</button>
        <button class="btn ghost" id="aact" style="margin-top:10px">${p.active ? 'Turn off access' : 'Turn access back on'}</button>` : ''}`, (sh) => {
      const err = $('#aerr', sh), rate = () => { const r = $('#ar', sh); return r ? r.value.trim() : (p && p.rate != null ? p.rate : ''); };
      $('#ago', sh).onclick = () => busy($('#ago', sh), async () => {
        if (p) { setA(await adm('updatePerson', { id: p.id, title: $('#at', sh).value, rate: rate(), active: p.active })); done('Saved'); }
        else {
          const r = await adm('addPerson', { name: $('#an', sh).value.trim(), team: bossTeam, title: $('#at', sh).value, rate: rate() });
          setA(r); loadBoss(true);
          closeSheet(); setTimeout(() => showPin(r.name, r.pin), 420);
        }
      }).catch((e) => { err.textContent = e.message; });
      const ap = $('#apin', sh);
      if (ap) ap.onclick = () => {
        if (ap.dataset.sure !== '1') { ap.dataset.sure = '1'; ap.textContent = 'Tap again to reset ' + p.name + "'s PIN"; return; }
        busy(ap, async () => { const r = await adm('resetPin', { id: p.id }); closeSheet(); setTimeout(() => showPin(r.name, r.pin), 420); }).catch((e) => { err.textContent = e.message; });
      };
      const aa = $('#aact', sh);
      if (aa) aa.onclick = () => {
        if (aa.dataset.sure !== '1' && p.active) { aa.dataset.sure = '1'; aa.textContent = 'Tap again: ' + p.name + ' can no longer sign in'; return; }
        busy(aa, async () => { setA(await adm('updatePerson', { id: p.id, title: p.title || '', rate: p.rate == null ? '' : p.rate, active: !p.active })); loadBoss(true); done(p.active ? 'Access turned off' : 'Access back on', p.name); }).catch((e) => { err.textContent = e.message; });
      };
    });
  }
  function sheetAdminFine() {
    const sup = bossTeam === 'support', rules = (A.fineRules || {})[bossTeam] || ['Other'];
    openSheet(`<h2>Add a fine</h2><p class="lead">Automatic fines (missed reports, long breaks, waiting tickets) are added by the system. Use this for the rest.</p>
      <div class="row"><div><label class="fl">Person</label><select class="field" id="fp">${teamPeople().map((p) => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('')}</select></div>
      <div><label class="fl">Date</label><input class="field" id="fd" type="date" value="${dhakaToday()}"></div></div>
      <label class="fl">Rule</label><select class="field" id="fr">${rules.map((r) => `<option>${esc(r)}</option>`).join('')}</select>
      <label class="fl">Amount (${sup ? 'tickets' : '৳'})</label><input class="field" id="fa" type="number" inputmode="numeric" min="1" value="${sup ? 10 : 50}">
      <label class="fl">Note (ticket number, what happened)</label><input class="field" id="fn" maxlength="200">
      <div class="err" id="ferr"></div><button class="btn amber" id="fgo">${I('warn')} Add fine</button>`, (sh) => {
      $('#fgo', sh).onclick = () => busy($('#fgo', sh), async () => {
        setA(await adm('addFine', { id: $('#fp', sh).value, day: $('#fd', sh).value, rule: $('#fr', sh).value, amount: $('#fa', sh).value, note: $('#fn', sh).value }));
        done('Fine added');
      }).catch((e) => { $('#ferr', sh).textContent = e.message; });
    });
  }
  function sheetAdminLeave() {
    openSheet(`<h2>Add leave</h2><p class="lead">Approved leave. No fines and no score on these days. The person gets a notification.</p>
      <label class="fl">Person</label><select class="field" id="lp">${teamPeople().map((p) => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('')}</select>
      <div class="row"><div><label class="fl">From</label><input class="field" id="lf" type="date" value="${dhakaToday()}"></div><div><label class="fl">To</label><input class="field" id="lt" type="date" value="${dhakaToday()}"></div></div>
      <label class="fl">Reason (optional)</label><input class="field" id="lr" maxlength="200">
      <div class="err" id="lerr"></div><button class="btn" id="lgo">${I('check')} Save leave</button>`, (sh) => {
      $('#lgo', sh).onclick = () => busy($('#lgo', sh), async () => {
        setA(await adm('addLeave', { id: $('#lp', sh).value, from: $('#lf', sh).value, to: $('#lt', sh).value, reason: $('#lr', sh).value }));
        done('Leave saved');
      }).catch((e) => { $('#lerr', sh).textContent = e.message; });
    });
  }
  function sheetAdminSplit() {
    const sp = A.split || { shares: {}, dipon_tickets: 0 };
    const names = A.people.filter((p) => p.team === 'support' && p.active).map((p) => p.name);
    const tomorrow = new Date(Date.now() + 30 * 36e5).toISOString().slice(0, 10);
    openSheet(`<h2>Ticket split</h2><p class="lead">Share of new tickets for each person (%). Put 0 to give someone none. If they don't add up to 100, they are scaled.</p>
      <div class="row"><div><label class="fl">Starts on</label><input class="field" id="sfrom" type="date" min="${dhakaToday()}" value="${dhakaToday()}"></div>
      <div><label class="fl">&nbsp;</label><div class="quick"><button class="chip" data-day="${dhakaToday()}">Today</button><button class="chip" data-day="${tomorrow}">Tomorrow</button></div></div></div>
      <label class="setting" style="cursor:pointer"><input type="checkbox" id="sone" style="width:20px;height:20px"><div><b>Only for that day</b><div class="small muted">The next day it goes back to the normal split</div></div></label>
      ${names.map((n) => `<label class="fl">${esc(n)}</label><input class="field" data-share="${esc(n)}" type="number" inputmode="numeric" min="0" max="100" value="${esc((sp.shares || {})[n] ?? 0)}">`).join('')}
      <div class="small muted" id="stot" style="margin:6px 0 4px"></div>
      <label class="fl">Dipon extra (fixed tickets per day on top of his %, usually 0)</label><input class="field" id="sd" type="number" inputmode="numeric" min="0" max="500" value="${esc(sp.dipon_tickets || 0)}">
      <label class="fl">Note (optional)</label><input class="field" id="sn" maxlength="200">
      <div class="err" id="serr2"></div><button class="btn" id="sgo2">${I('check')} Save split</button>`, (sh) => {
      const total = () => { const t = $$('[data-share]', sh).reduce((a, i) => a + Number(i.value || 0), 0); $('#stot', sh).textContent = 'Total: ' + t + '%' + (t === 100 ? ' ✓' : ' (will be scaled to 100%)'); };
      $$('[data-share]', sh).forEach((i) => i.oninput = total); total();
      $$('[data-day]', sh).forEach((b) => b.onclick = () => { $('#sfrom', sh).value = b.dataset.day; });
      $('#sgo2', sh).onclick = () => busy($('#sgo2', sh), async () => {
        const shares = {}; $$('[data-share]', sh).forEach((i) => { shares[i.dataset.share] = Number(i.value || 0); });
        const from = $('#sfrom', sh).value, oneDay = $('#sone', sh).checked;
        setA(await adm('saveSplit', { shares, dipon: $('#sd', sh).value, note: $('#sn', sh).value, from, oneDay }));
        done('Split saved', from === dhakaToday() ? (oneDay ? 'For today only.' : 'Used from the next run.') : 'Starts on ' + from + (oneDay ? ', that day only.' : '.'));
      }).catch((e) => { $('#serr2', sh).textContent = e.message; });
    });
  }
  function sheetAdminSetting(s) {
    if (!s) return;
    const v = String(s.value).replace(/"/g, '');
    const type = s.key === 'silent_until' ? 'date' : s.key === 'work_start' ? 'time' : 'number';
    openSheet(`<h2>${esc(setLabel[s.key] || s.key)}</h2><p class="lead">${esc(s.meaning || '')}${s.scope === 'global' ? ' Applies to both teams.' : ''}</p>
      <input class="field" id="sv" type="${type}" ${type === 'number' ? 'inputmode="decimal" min="0" step="any"' : ''} value="${esc(v)}">
      <div class="err" id="sverr"></div><button class="btn" id="svgo">${I('check')} Save</button>`, (sh) => {
      $('#svgo', sh).onclick = () => busy($('#svgo', sh), async () => {
        setA(await adm('saveSetting', { scope: s.scope, key: s.key, value: $('#sv', sh).value }));
        done('Saved', "Today's fines and scores were recalculated.");
      }).catch((e) => { $('#sverr', sh).textContent = e.message; });
    });
  }
  function sheetPerson(name) {
    const d = B[bossTeam];
    const p = d.people.find((x) => x.name === name);
    const tasks = d.tasks.filter((t) => t.owner === name && t.status !== 'Done');
    const reps = (d.reports || []).filter((r) => r.name === name).slice(0, 3);
    openSheet(`<div style="text-align:center">${avatar(name, p.photo, 76, p.state)}<h2 style="margin-top:10px">${esc(name)}</h2><p class="lead">${esc(p.role)} · ${stLabel[p.state]}${p.start ? ' since ' + esc(p.start) : ''}</p></div>
      <div class="row" style="margin-bottom:14px"><button class="btn" id="pm">${I('send')} Message</button>${!d.support ? `<button class="btn ghost" id="pt">${I('plus')} Task</button>` : ''}</div>
      ${tasks.length ? `<div class="label" style="margin:6px 0">Open tasks</div>${tasks.map((t) => `<div class="item"><span class="dot ${t.overdue ? 'bad' : ''}"></span><div class="body"><div class="t">${esc(t.task)}</div><div class="s">${esc([t.store, t.status, t.deadline].filter(Boolean).join(' · '))}</div></div></div>`).join('')}` : ''}
      ${reps.length ? `<div class="label" style="margin:14px 0 6px">Latest reports</div>${reps.map((r) => `<div class="item"><span class="dot"></span><div class="body"><div class="t">${esc(r.type)} <span class="muted small">· ${esc(r.time)}</span></div><div class="s" style="white-space:pre-wrap">${esc(r.msg)}</div></div></div>`).join('')}` : ''}`, (sh) => {
      $('#pm', sh).onclick = () => sheetSend(name);
      const pt = $('#pt', sh); if (pt) pt.onclick = () => sheetTask({ owner: name });
    });
  }
  function sheetSend(to) {
    let kind = 'Message';
    const kinds = ['Message', 'Update', 'Reminder', 'Urgent'];
    const d = B[bossTeam];
    openSheet(`<h2>${to === 'all' ? 'Message everyone' : 'Message ' + esc(to)}</h2><p class="lead">${to === 'all' ? 'Everyone in ' + esc(C.backends[bossTeam].label) + ' gets a notification.' : 'They get a notification and can reply from the app.'}</p>
      <div class="quick">${kinds.map((k) => `<button class="chip ${k === kind ? 'on' : ''}" data-k="${k}">${k}</button>`).join('')}</div>
      <textarea class="field" id="stext" style="margin-top:12px" placeholder="Write your message…"></textarea><div class="err" id="serr"></div>
      <button class="btn" id="sgo">${I('send')} Send${to === 'all' ? ' to ' + d.people.length : ''}</button>`, (sh) => {
      $$('[data-k]', sh).forEach((b) => b.onclick = () => { kind = b.dataset.k; $$('[data-k]', sh).forEach((x) => x.classList.toggle('on', x === b)); });
      $('#sgo', sh).onclick = () => {
        const txt = $('#stext', sh).value.trim();
        if (!txt) { $('#serr', sh).textContent = 'Write a message first.'; return; }
        const team = bossTeam;
        closeSheet(); toast('Sending…', to === 'all' ? 'To everyone' : 'To ' + to, '', 'send');
        api(team, { action: 'send', pin: S.pin, to, text: txt, kind })
          .then((d) => { B[team] = d; fresh = Date.now(); toast('Sent', to === 'all' ? 'Everyone was notified.' : to + ' was notified.', 'ok'); if (!$('#sheet.on')) renderBoss(true); })
          .catch((e) => { toast('Not sent', e.message, 'bad'); setTimeout(() => { sheetSend(to); const ta = $('#stext'); if (ta) ta.value = txt; }, 450); });
      };
    });
  }
  function sheetTask(t) {
    t = t || {};
    const d = B[bossTeam];
    openSheet(`<h2>${t.row ? 'Edit task' : 'New task'}</h2><p class="lead">The owner gets a notification.</p>
      <label class="fl">What needs to be done</label><textarea class="field" id="tt" maxlength="300" placeholder="List 20 new products">${esc(t.task || '')}</textarea>
      <div class="row"><div><label class="fl">Store</label><select class="field" id="ts"><option value="">—</option>${d.stores.map((s) => `<option ${s === t.store ? 'selected' : ''}>${esc(s)}</option>`).join('')}</select></div>
      <div><label class="fl">Owner</label><select class="field" id="to"><option value="">—</option>${d.people.map((p) => `<option ${p.name === t.owner ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select></div></div>
      <div class="row"><div><label class="fl">Deadline</label><input class="field" id="td" type="date" value="${esc(t.deadline || '')}"></div>
      <div><label class="fl">Status</label><select class="field" id="tst">${d.statuses.map((s) => `<option ${s === (t.status || 'To do') ? 'selected' : ''}>${s}</option>`).join('')}</select></div></div>
      <label class="fl">Notes</label><input class="field" id="tn" value="${esc(t.notes || '')}">
      <div class="err" id="terr"></div><button class="btn" id="tgo">${I('check')} Save task</button>`, (sh) => {
      $('#tgo', sh).onclick = () => busy($('#tgo', sh), async () => {
        B[bossTeam] = await api(bossTeam, { action: 'saveTask', pin: S.pin, task: { row: t.row || '', task: $('#tt', sh).value, store: $('#ts', sh).value, owner: $('#to', sh).value, deadline: $('#td', sh).value, status: $('#tst', sh).value, notes: $('#tn', sh).value } });
        closeSheet(); toast('Task saved', $('#to', sh).value ? $('#to', sh).value + ' was notified.' : '', 'ok'); renderBoss(true);
      }).catch((e) => { $('#terr', sh).textContent = e.message; });
    });
  }
  document.addEventListener('click', (e) => { if (e.target.closest('#sendAll')) sheetSend('all'); });

  /* =========================================================
   *  PUSH NOTIFICATIONS
   * ========================================================= */
  let messaging = null, swReg = null, pushErr = '', setupP = null;
  function setupFirebase() { if (!setupP) setupP = setupFirebase_(); return setupP; }
  async function setupFirebase_() {
    if (!('serviceWorker' in navigator)) { pushErr = 'This browser has no service worker support.'; return; }
    if (!window.firebase) { pushErr = 'Firebase did not load. Check the internet connection and reopen the app.'; return; }
    try {
      swReg = await navigator.serviceWorker.register('firebase-messaging-sw.js');
      if (!firebase.apps.length) firebase.initializeApp(C.firebase);
      if (firebase.messaging.isSupported && !(await firebase.messaging.isSupported())) { pushErr = 'This browser does not support push. Use Chrome on Android, or install the app on iPhone.'; return; }
      messaging = firebase.messaging();
      messaging.onMessage((p) => {
        const d = p.data || {};
        toast(d.title || 'Assistaa', d.body || '', '', 'bell');
        if (S && S.team === 'boss') loadBoss(true); else if (S) loadMe(true);
      });
    } catch (e) { pushErr = 'Setup failed: ' + (e && e.message || e); setupP = null; console.log('push setup', e); }
  }
  async function enablePush(ask) {
    const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
    const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
    if (ios && !standalone) { sheetInstall(); return; }
    if (!messaging) await setupFirebase();
    if (!('Notification' in window) || !messaging) { toast('Notifications could not start', pushErr || 'Open the app in Chrome (Android) or install it on iPhone.', 'bad'); return; }
    if (Notification.permission !== 'granted') {
      if (!ask) return;
      const r = await Notification.requestPermission();
      if (r !== 'granted') { toast('Notifications are off', 'Allow them in your browser settings to get pings.', 'bad'); return; }
    }
    try {
      const token = await messaging.getToken({ vapidKey: C.vapidKey, serviceWorkerRegistration: swReg });
      if (!token) throw new Error('Google gave no token. Try again in a minute.');
      const device = (navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform || '';
      if (S.team === 'boss') {
        await Promise.all(Object.keys(C.backends).filter((k) => C.backends[k].url).map((k) => api(k, { action: 'token', name: C.owner, pin: S.pin, token, device, origin: BASE })));
      } else {
        await api(S.team, { action: 'token', name: S.name, pin: S.pin, token, device, origin: BASE });
      }
      store.set('pushOn.' + S.team + '.' + S.name, true);
      if (ask) {
        toast('Notifications on 🔔', 'You will get a ping for new tasks and messages.', 'ok');
        if (S.team === 'boss') api('store', { action: 'testPush', pin: S.pin, to: C.owner }).catch(() => {});
        if (tab === 'me') render(true);
      }
    } catch (e) { if (ask) toast('Could not turn on notifications', (e && (e.code || e.message)) || String(e), 'bad'); }
  }
  function nudgePush() {
    if (!messaging || !('Notification' in window) || Notification.permission === 'granted' || store.get('nudged', false)) return;
    store.set('nudged', true);
    setTimeout(() => openSheet(`<div style="text-align:center"><div class="avatar" style="--s:76px">${I('bell')}</div><h2 style="margin-top:12px">Turn on notifications?</h2>
      <p class="lead">Get a ping when ${S.team === 'boss' ? 'your team replies or sends a report' : C.owner + ' sends you a task or a message'}.</p></div>
      <button class="btn" id="yes">${I('bell')} Turn on</button><button class="btn ghost" id="no" style="margin-top:10px">Not now</button>`, (sh) => {
      $('#yes', sh).onclick = () => { closeSheet(); enablePush(true); };
      $('#no', sh).onclick = closeSheet;
    }), 1500);
  }

  /* ---------- install prompt ---------- */
  let deferredInstall = null;
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferredInstall = e; });

  /* ---------- lifecycle ---------- */
  function logout() { S = null; D = null; B = {}; A = null; store.del('session'); store.del('adminCache'); clearInterval(timer); tab = 'home'; location.hash = ''; viewWelcome(); }

  function start() {
    clearInterval(timer);
    checkVersion();
    const h = location.hash.slice(1);
    if (S.team === 'boss') {
      bossTab = ['team', 'btasks', 'bmsg', 'breports', 'badmin'].includes(h) ? h : (h === 'boss' ? 'team' : 'team');
      Object.keys(C.backends).forEach((k) => { if (!B[k]) { const c = store.get('bossCache.' + k, null); if (c) B[k] = c; } });
      renderBoss(); if (stale(20000)) loadBoss(true);
      timer = setInterval(() => { if (!document.hidden) loadBoss(true); }, 60000);
    } else {
      tab = ['home', 'tasks', 'inbox', 'me'].includes(h) ? h : 'home';
      D = store.get('cache.' + S.team + '.' + S.name, null);
      if (D) render(); else app.innerHTML = `<div class="view"><div class="sk" style="height:60px;margin-bottom:16px"></div><div class="sk" style="height:200px;margin-bottom:14px"></div><div class="sk" style="height:180px"></div></div>`;
      if (!D || stale(20000)) loadMe(!!D);
      timer = setInterval(() => { if (!document.hidden) loadMe(true); }, 60000);
    }
    setupFirebase().then(() => {
      if (('Notification' in window) && Notification.permission === 'granted') enablePush(false);
      else nudgePush();
    });
  }
  /* ---------- self-update: a phone can keep the app open for days; reload when a new version is published ---------- */
  const APP_VERSION = '14';
  let lastVersionCheck = 0;
  async function checkVersion() {
    if (Date.now() - lastVersionCheck < 5 * 60000) return;
    lastVersionCheck = Date.now();
    try {
      const v = await fetch('version.json?t=' + Date.now(), { cache: 'no-store' }).then((r) => r.json());
      if (v && v.v && String(v.v) !== APP_VERSION && !$('#sheet.on')) location.reload();
    } catch (e) {}
  }
  setInterval(() => { if (!document.hidden) checkVersion(); }, 10 * 60000);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) return;
    checkVersion();
    if (S && stale(20000)) (S.team === 'boss' ? loadBoss(true) : loadMe(true));
  });
  window.addEventListener('hashchange', () => {
    const h = location.hash.slice(1);
    if (!S) return;
    if (S.team === 'boss' && ['team', 'btasks', 'bmsg', 'breports', 'badmin'].includes(h)) { bossTab = h; renderBoss(); }
    else if (S.team !== 'boss' && ['home', 'tasks', 'inbox', 'me'].includes(h) && h !== tab) { tab = h; render(); }
  });

  let seen = false; try { seen = sessionStorage.getItem(PFX + 'splash') === '1'; sessionStorage.setItem(PFX + 'splash', '1'); } catch (e) {}
  setTimeout(() => { hideSplash(); if (S) start(); else viewWelcome(); }, seen ? 700 : 1900);
})();
