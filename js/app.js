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
      <div class="err" id="werr"></div>
      <button class="btn ${isStart ? '' : 'amber'}" id="wgo">${I(isStart ? 'play' : 'check')} ${isStart ? 'Start now' : 'Send end report'}</button>`, (sh) => {
      setTimeout(() => $('#wtext', sh).focus(), 350);
      $('#wgo', sh).onclick = () => {
        const txt = $('#wtext', sh).value.trim();
        if (!isStart && txt.length < 5) { $('#werr', sh).textContent = 'Write what you did today and what is still pending.'; return; }
        busy($('#wgo', sh), () => run(act, txt, isStart ? 'Have a great day! 🚀' : 'Great work today! 🎉')).catch(() => {});
      };
    });
    void t;
  }
  async function run(act, text, okMsg) {
    try {
      D = await api(S.team, { action: 'act', name: S.name, pin: S.pin, act, text });
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
          const teams = Object.keys(C.backends).filter((k) => C.backends[k].url);
          const free = await Promise.all(teams.map((k) => api(k, { action: 'pinFree', pin: n1 })));
          if (free.some((f) => !f.free)) throw new Error('That PIN is already used. Pick another one.');
          if (boss) await Promise.all(teams.map((k) => api(k, { action: 'changePin', name: C.owner, pin: o, newPin: n1 })));
          else await api(S.team, { action: 'changePin', name: S.name, pin: o, newPin: n1 });
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
    nav([{ id: 'team', icon: 'team', label: 'Team' }, { id: 'btasks', icon: 'tasks', label: 'Tasks' }, { id: 'bmsg', icon: 'inbox', label: 'Messages' }, { id: 'breports', icon: 'history', label: 'Reports' }]);
    $$('#nav button').forEach((b) => b.onclick = () => { bossTab = b.dataset.tab; tab = bossTab; renderBoss(); });
    $$('#nav button').forEach((b) => b.classList.toggle('on', b.dataset.tab === bossTab));
    requestAnimationFrame(() => { const on = $('#nav button.on'), hl = $('#nav .hl'); if (on) { hl.style.left = on.offsetLeft + 'px'; hl.style.width = on.offsetWidth + 'px'; } });
    void pendingReplies;
    const teams = Object.keys(C.backends).filter((k) => C.backends[k].url);
    const head = `<div class="top">${avatar(C.owner, '', 52)}<div><div class="sub">${greet()},</div><h1>${esc(C.owner)} <span style="font-size:18px">👑</span></h1></div><div class="sp"></div><button class="iconbtn" id="refresh">${I('refresh')}</button><button class="iconbtn" id="bellB" style="margin-left:8px" aria-label="Notifications">${I('bell')}</button><button class="iconbtn" id="moreB" style="margin-left:8px" aria-label="Settings">${I('user')}</button></div>
      <div class="tabs">${teams.map((k) => `<button data-bt="${k}" class="${k === bossTeam ? 'on' : ''}">${esc(C.backends[k].label)}</button>`).join('')}</div>`;
    let body = '';
    if (!d) body = `<div class="sk" style="height:120px;margin-bottom:12px"></div><div class="sk" style="height:300px"></div>`;
    else if (bossTab === 'btasks') body = bossTasks(d);
    else if (bossTab === 'bmsg') body = bossMsgs(d);
    else if (bossTab === 'breports') body = bossReports(d);
    else body = bossTeamView(d);
    const scroll = window.scrollY;
    app.innerHTML = `<div class="${soft ? '' : 'view'}">${head}<div class="stagger">${body}</div></div>`;
    if (soft) window.scrollTo(0, scroll);
    $$('[data-bt]').forEach((b) => b.onclick = () => { bossTeam = b.dataset.bt; store.set('bossTeam', bossTeam); renderBoss(); });
    $('#refresh').onclick = () => loadBoss();
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
  function logout() { S = null; D = null; B = {}; store.del('session'); clearInterval(timer); tab = 'home'; location.hash = ''; viewWelcome(); }

  function start() {
    clearInterval(timer);
    const h = location.hash.slice(1);
    if (S.team === 'boss') {
      bossTab = ['team', 'btasks', 'bmsg', 'breports'].includes(h) ? h : (h === 'boss' ? 'team' : 'team');
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
  document.addEventListener('visibilitychange', () => { if (!document.hidden && S && stale(20000)) (S.team === 'boss' ? loadBoss(true) : loadMe(true)); });
  window.addEventListener('hashchange', () => {
    const h = location.hash.slice(1);
    if (!S) return;
    if (S.team === 'boss' && ['team', 'btasks', 'bmsg', 'breports'].includes(h)) { bossTab = h; renderBoss(); }
    else if (S.team !== 'boss' && ['home', 'tasks', 'inbox', 'me'].includes(h) && h !== tab) { tab = h; render(); }
  });

  let seen = false; try { seen = sessionStorage.getItem(PFX + 'splash') === '1'; sessionStorage.setItem(PFX + 'splash', '1'); } catch (e) {}
  setTimeout(() => { hideSplash(); if (S) start(); else viewWelcome(); }, seen ? 700 : 1900);
})();
