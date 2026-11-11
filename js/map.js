/* Assistaa Team · Map tab (owner only). Draws the whole business from public.command_map(). */
(() => {
  'use strict';
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const ini = (n) => String(n).split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
  const num = (v) => (v == null ? '—' : Number(v).toLocaleString('en-US'));
  const toMin = (t) => { const [h, m] = String(t).split(':').map(Number); return h * 60 + m; };

  /* agents: status is what is switched on today; update here as each workflow goes live */
  const AG = {
    support: [['Ticket splitter · 09:55 12:55 15:55', 'on'], ['20-hour watch', 'on'], ['Score + fines', 'on'], ['Reply drafter', 'off']],
    listings: [['Listing tool', 'on'], ['Listing QA', 'off'], ['Daily check-in to Slack', 'off']],
    office: [['Start, break and end reports', 'on'], ['Fines ledger', 'on'], ['Push alerts', 'on'], ['Payroll', 'off']],
    brain: [['Night brief 23:00', 'on'], ['Assistaa brain (SOPs)', 'mid'], ['Weekly review', 'off']],
    sales: [['Store X-Ray', 'on'], ['Lead capture', 'on'], ['Lead reply drafter', 'off'], ['Email outreach', 'off']],
    growth: [['Trend researcher', 'off'], ['Post maker', 'off'], ['Auto-poster', 'off'], ['Comment + DM replier', 'off']],
    disputes: [['Dispute responder', 'mid'], ['Deadline watch', 'off']],
    money: [['Pricing sheet', 'on'], ['Invoice sender', 'off'], ['Payment chaser', 'off']]
  };

  function needs(M) {
    const out = [];
    const s = M.support || {};
    const w = s.waiting || [];
    if (w.length) {
      const who = [...new Set(w.map((x) => x.who).filter(Boolean))].join(', ');
      out.push(['bad', 'Support', `${w.length} ticket${w.length > 1 ? 's' : ''} past 20 h`, `${who || 'Unassigned'} · oldest ${Math.max(...w.map((x) => x.h || 0))} h`, 'support']);
    }
    const workday = M.dow !== 5 && toMin(M.at) >= 10 * 60 + 30;
    if (workday) {
      const sp = {}; (s.people || []).forEach((p) => { sp[p.n] = p; });
      const silent = (M.people || []).filter((p) => !p.start && !(p.ev || []).length);
      const quietWorking = silent.filter((p) => sp[p.n] && sp[p.n].closed > 0).map((p) => p.n);
      const missing = silent.map((p) => p.n);
      if (missing.length) out.push(['mid', 'Back office', `No start report: ${missing.join(', ')}`, quietWorking.length ? `${quietWorking.join(', ')} is working without reporting` : 'Not started yet today', 'office']);
    }
    const low = (M.people || []).filter((p) => p.score && Number(p.score.s) < 7);
    if (low.length) out.push(['mid', 'Team', `Score under 7: ${low.map((p) => p.n + ' ' + p.score.s).join(', ')}`, low[0].score.why || '', 'office']);
    const od = (M.tasks && M.tasks.overdue) || [];
    if (od.length) out.push(['mid', 'Listings', `${od.length} overdue task${od.length > 1 ? 's' : ''}`, `${od[0].title.slice(0, 70)} · due ${od[0].due}`, 'listings']);
    const sl = M.sales || {};
    if (sl.leads_today) out.push(['info', 'Sales', `${sl.leads_today} new website lead${sl.leads_today > 1 ? 's' : ''} today`, (sl.recent && sl.recent[0]) ? `${sl.recent[0].need || ''} · ${sl.recent[0].at}` : '', 'sales']);
    return out;
  }

  const agentsBox = (k) => {
    const list = AG[k] || [];
    return `<div class="am-box am-ag"><div class="am-bh"><span>Agents</span><span class="am-lv">${list.filter((a) => a[1] === 'on').length} live</span><span class="sp"></span><small>${list.length}</small></div>
      ${list.map((a) => `<div class="am-agr"><i class="am-ic"></i><span class="sp">${esc(a[0])}</span><i class="am-tg ${a[1]}"></i></div>`).join('')}</div>`;
  };
  const avs = (names) => `<div class="am-avs">${names.map((n) => `<i class="${n[1] ? 'flag' : ''}" title="${esc(n[0])}">${esc(ini(n[0]))}</i>`).join('')}</div>`;
  const head = (no, name, right) => `<div class="am-ph"><span class="am-no">${no}</span><span class="am-pn">${esc(name)}</span><span class="sp"></span>${right || ''}</div>`;
  const panel = (id, color, inner, cls = '') => `<section class="am-p ${cls}" id="am-${id}" style="--c:${color}">${inner}</section>`;

  function spark(a) {
    if (!a || a.length < 2) return '';
    const W = 200, H = 34, mx = Math.max(...a) * 1.05, mn = Math.min(...a) * 0.9;
    const pts = a.map((v, i) => [i * (W / (a.length - 1)), H - ((v - mn) / (mx - mn || 1)) * (H - 4) - 2]);
    const d = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ');
    const l = pts[pts.length - 1];
    return `<svg class="am-spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-label="Tickets closed, last 7 days"><path d="${d} L${W} ${H} L0 ${H}Z" fill="color-mix(in srgb,var(--c) 14%,transparent)"/><path d="${d}" fill="none" stroke="var(--c)" stroke-width="1.6" vector-effect="non-scaling-stroke"/><circle cx="${l[0] - 2}" cy="${l[1]}" r="2.6" fill="var(--c)"/></svg>`;
  }

  function supportPanel(M) {
    const s = M.support || {};
    const ppl = (s.people || []).slice().sort((a, b) => (b.closed || 0) - (a.closed || 0));
    const mx = Math.max(1, ...ppl.map((p) => p.closed || 0));
    const w = s.waiting || [];
    const waitIds = new Set(w.map((x) => x.who));
    return panel('support', '#22d3ee', head('01', 'Support', `<span class="am-cnt">${num(s.closed)} closed</span>${avs(ppl.map((p) => [p.n, waitIds.has(p.n)]))}`) +
      `<div class="am-cols"><div class="am-box"><div class="am-bh"><span class="am-ic2">CL</span>Over 20 h<span class="sp"></span><span class="am-st ${w.length ? 'bad' : 'ok'}">${w.length}</span></div>
        ${w.length ? w.slice(0, 3).map((t) => `<div class="am-row"><i class="am-mini">${esc(ini(t.who || '?'))}</i><span class="sp am-num">#${esc(t.no)}</span><span class="am-st bad">${esc(t.h)}h</span></div>`).join('') + (w.length > 3 ? `<div class="am-row am-mute">+ ${w.length - 3} more</div>` : '') : `<div class="am-row am-mute">All clear${s.checked ? ' · checked ' + esc(s.checked) : ''}</div>`}</div>
      <div class="am-box"><div class="am-bh">Closed${s.day ? ' · ' + esc(String(s.day).slice(5)) : ''}</div>
        ${ppl.map((p) => `<div class="am-row"><span class="am-nm">${esc(p.n.split(' ')[0].slice(0, 8))}</span><span class="am-bar am-flex"><b style="width:${((p.closed || 0) / mx) * 100}%"></b></span><span class="am-num am-r">${num(p.closed)}</span></div>`).join('')}</div></div>
      <div class="am-box"><div class="am-bh">Tickets closed · 7 days<span class="sp"></span><small>${num(s.msgs)} messages</small></div>${spark(s.spark)}
        <div class="am-row am-mute" style="border:0">First reply: ${ppl.map((p) => `<b class="${(p.frh || 0) > 20 ? 'am-bad' : ''}">${esc(p.n.split(' ')[0])} ${p.frh == null ? '—' : p.frh + 'h'}</b>`).join(' · ')}</div></div>` +
      agentsBox('support'));
  }

  function listingsPanel(M) {
    const ppl = (M.people || []).filter((p) => p.team === 'store');
    const rows = [];
    ppl.forEach((p) => {
      const re = /([A-Za-zÀ-ÿ'&. ]{2,40}?)\s*[-=:]\s*(\d+)\s*products?/gi; let m;
      while ((m = re.exec(p.start || ''))) rows.push([m[1].trim(), Number(m[2]), p.n]);
    });
    const mx = Math.max(1, ...rows.map((r) => r[1]));
    const od = (M.tasks && M.tasks.overdue) || [];
    return panel('listings', '#34d399', head('02', 'Listings', `<span class="am-cnt">${num(M.stores)} stores</span>${avs(ppl.map((p) => [p.n, !p.start && !(p.ev || []).length]))}`) +
      `<div class="am-box"><div class="am-bh"><span class="am-ic2">SH</span>Today's plan<span class="sp"></span><small>from start reports</small></div>
        ${rows.length ? rows.slice(0, 6).map((r) => `<div class="am-row"><i class="am-mini">${esc(ini(r[2]))}</i><span class="sp">${esc(r[0])}</span><span class="am-bar"><b style="width:${(r[1] / mx) * 100}%;opacity:${r[1] ? 1 : 0.3}"></b></span><span class="am-num am-r">${r[1]}</span></div>`).join('') : `<div class="am-row am-mute">No store plans reported yet today</div>`}
        ${rows.length > 6 ? `<div class="am-row am-mute">+ ${rows.length - 6} more stores</div>` : ''}</div>
      <div class="am-cols"><div class="am-box"><div class="am-bh">Open tasks</div><div class="am-big">${num(M.tasks && M.tasks.open)}</div></div>
        <div class="am-box"><div class="am-bh">Overdue</div><div class="am-big ${od.length ? 'am-bad' : ''}">${od.length}</div></div></div>` +
      agentsBox('listings'));
  }

  function officePanel(M) {
    const ppl = M.people || [];
    const S = 10 * 60, E = 22 * 60, now = toMin(M.at), x = (t) => Math.max(0, Math.min(100, ((t - S) / (E - S)) * 100));
    const line = (p) => {
      const ev = p.ev || [];
      if (!ev.length) return `<span class="am-none" style="left:0;width:${x(Math.min(now, E))}%"></span>`;
      let out = '', on = null, br = null;
      ev.forEach((e) => {
        const t = toMin(e.t);
        if (e.e === 'start') on = t;
        else if (e.e === 'break_start') { if (on != null) out += `<span style="left:${x(on)}%;width:${x(t) - x(on)}%"></span>`; on = null; br = t; }
        else if (e.e === 'break_end') { if (br != null) out += `<span class="brk" style="left:${x(br)}%;width:${x(t) - x(br)}%"></span>`; br = null; on = t; }
        else if (e.e === 'done') { if (on != null) out += `<span style="left:${x(on)}%;width:${x(t) - x(on)}%"></span>`; on = null; }
      });
      if (on != null) out += `<span class="live" style="left:${x(on)}%;width:${x(Math.min(now, E)) - x(on)}%"></span>`;
      if (br != null) out += `<span class="brk live" style="left:${x(br)}%;width:${x(Math.min(now, E)) - x(br)}%"></span>`;
      return out;
    };
    const missing = ppl.filter((p) => !(p.ev || []).length && !p.start).length;
    const o = M.office || {};
    return panel('office', '#a78bfa', head('03', 'Back office', `<span class="am-cnt">${ppl.filter((p) => (p.ev || []).length).length}/${ppl.length} started</span>`) +
      `<div class="am-box"><div class="am-bh"><span class="am-ic2">AT</span>Shifts today<span class="sp"></span>${missing && M.dow !== 5 ? `<span class="am-st bad">${missing} no report</span>` : `<span class="am-st ok">all in</span>`}</div>
        ${ppl.map((p) => `<div class="am-tlr"><span class="am-tln ${!(p.ev || []).length ? 'am-bad' : ''}">${esc(p.n.split(' ')[0].slice(0, 8))}</span><div class="am-tl">${line(p)}<i class="am-now" style="left:${x(now)}%"></i></div><span class="am-sc ${p.score && p.score.s < 7 ? 'am-bad' : ''}">${p.score ? esc(p.score.s) : ''}</span></div>`).join('')}
        <div class="am-axis"><span>10</span><span>13</span><span>16</span><span>19</span><span>22</span></div></div>
      <div class="am-cols3"><div class="am-box"><div class="am-big">${num(o.reports_today)}</div><small>reports today</small></div><div class="am-box"><div class="am-big">${num(o.fines_month)}</div><small>fines this month</small></div><div class="am-box"><div class="am-big">${num(o.devices)}</div><small>phones linked</small></div></div>` +
      agentsBox('office'));
  }

  function brainPanel(M) {
    const runs = M.runs || [];
    return panel('brain', '#60a5fa', head('04', 'Agent activity', `<span class="am-cnt">${runs.length} logged</span>`) +
      `<div class="am-box am-grow"><div class="am-bh"><span class="am-ic2">AI</span>What the agents did<span class="sp"></span><small>runs log</small></div>
        ${runs.length ? runs.slice(0, 5).map((r) => `<div class="am-row am-run"><span class="am-st ${r.needs_atiq ? 'mid' : 'ok'}">${esc(r.agent)}</span><span class="sp">${esc(r.job)}</span><span class="am-mute am-num">${esc(r.at)}</span></div>`).join('') : `<div class="am-row am-mute">The night brief logs its first run at 23:00 tonight. Every finished agent job appears here.</div>`}</div>` +
      agentsBox('brain'));
  }

  function salesPanel(M) {
    const s = M.sales || {};
    return panel('sales', '#fb923c', head('05', 'Sales', `<span class="am-cnt">assistaa.com</span>`) +
      `<div class="am-cols"><div class="am-box"><div class="am-bh"><span class="am-ic2">XR</span>Store X-Ray</div><div class="am-big">${num(s.scans)}</div><small>${num(s.scans_today)} today</small></div>
        <div class="am-box"><div class="am-bh"><span class="am-ic2">LD</span>Leads</div><div class="am-big">${num(s.leads)}</div><small>${num(s.leads_today)} today</small></div></div>
      <div class="am-box"><div class="am-bh">Latest</div>
        ${(s.recent || []).slice(0, 2).map((l) => `<div class="am-row"><span class="am-st">lead</span><span class="sp">${esc(l.need || 'Lead')} · ${esc((l.name || '').slice(0, 18))}</span><span class="am-mute am-num">${esc(l.at)}</span></div>`).join('')}
        ${(s.recent_scans || []).slice(0, 2).map((l) => `<div class="am-row"><span class="am-st">scan</span><span class="sp">${esc(l.domain)}</span><span class="am-num">${esc(l.score)}/100</span></div>`).join('')}
        ${!(s.recent || []).length && !(s.recent_scans || []).length ? `<div class="am-row am-mute">Nothing yet</div>` : ''}</div>` +
      agentsBox('sales'));
  }

  function examplePanel(id, no, name, color, inner) {
    return panel(id, color, head(no, name, `<span class="am-tagx">Not connected</span>`) + inner + agentsBox(id), 'ex');
  }

  function html(M) {
    if (!M) return `<div class="sk" style="height:220px;margin-bottom:12px"></div><div class="sk" style="height:300px"></div>`;
    const N = needs(M);
    const ag = Object.values(AG).flat();
    const live = ag.filter((a) => a[1] === 'on').length;
    const onShift = (M.people || []).filter((p) => (p.ev || []).length && !(p.ev || []).some((e) => e.e === 'done')).length;
    const brief = (M.runs || []).find((r) => r.agent === 'night-brief');
    return `<div class="amap">
      <div class="am-hub"><canvas id="amCv" aria-hidden="true"></canvas>
        <div class="am-hubtx"><div class="am-eye">Assistaa · live · ${esc(M.at)}</div><h2 class="am-title">THE ASSISTAA MAP</h2>
        <div class="am-chips"><span class="am-chip"><i class="am-led"></i>On shift <b>${onShift}/${(M.people || []).length}</b></span><span class="am-chip">Agents live <b>${live}/${ag.length}</b></span><span class="am-chip ${N.length ? 'bad' : ''}"><i class="am-led"></i>Needs you <b>${N.length}</b></span></div></div></div>
      ${panel('needs', '#ff6b7a', head('!', 'Needs you', `<span class="am-cnt">${N.length} open</span>`) +
        `<div class="am-box">${N.length ? N.map((n) => `<button class="am-need" data-go="${n[4]}"><span class="am-st ${n[0]}">${esc(n[1])}</span><span class="sp"><b>${esc(n[2])}</b><small>${esc(n[3])}</small></span></button>`).join('') : `<div class="am-row am-mute">Nothing needs you right now.</div>`}</div>`, N.length ? 'hot' : '')}
      <div class="am-grid">
        ${supportPanel(M)}${listingsPanel(M)}${officePanel(M)}${brainPanel(M)}${salesPanel(M)}
        ${examplePanel('growth', '06', 'Growth', '#f472b6', `<div class="am-box"><div class="am-bh"><span class="am-ic2">IG</span>Instagram + socials</div><div class="am-row am-mute" style="border:0">Connect your Instagram Business account to switch these agents on.</div></div>`)}
        ${examplePanel('disputes', '07', 'Disputes', '#f87171', `<div class="am-box"><div class="am-bh"><span class="am-ic2">PP</span>PayPal + Shopify cases</div><div class="am-row am-mute" style="border:0">You paste a case, Claude drafts the response. Case tracking comes next.</div></div>`)}
        ${panel('money', '#facc15', head('08', 'Finance', `<span class="am-cnt">${num(M.clients)} clients</span>`) +
          `<div class="am-box"><div class="am-bh"><span class="am-ic2">$</span>Rate card<span class="sp"></span><small>pay per result</small></div>
            ${[['Support ticket', '$0.40 → $0.22'], ['Listing', '$0.65 · premium $2'], ['Dispute won', '20% · $10–150'], ['Creative', '$5 · 20 for $79']].map((r) => `<div class="am-row"><span class="sp">${r[0]}</span><span class="am-num">${r[1]}</span></div>`).join('')}</div>` + agentsBox('money'))}
        ${panel('brief', '#e7e2d8', `<div class="am-phone"><div class="am-notch"></div><div class="am-eye">23:00 · Night brief</div><div class="am-gm">Good night,<br>Atiq</div>
          ${brief ? `<div class="am-briefx">${esc(brief.summary).replace(/\n/g, '<br>')}</div><div class="am-eye" style="margin-top:auto;text-align:center">Sent ${esc(brief.at)}</div>`
          : `<div class="am-kpi"><b class="am-num" style="color:#22d3ee">${num((M.support || {}).closed)}</b><span>Tickets closed today</span></div><div class="am-kpi"><b class="am-num" style="color:#ff6b7a">${((M.support || {}).waiting || []).length}</b><span>Over 20 hours</span></div><div class="am-eye" style="margin-top:auto;text-align:center">First brief tonight at 23:00</div>`}</div>`, 'am-phonep')}
      </div></div>`;
  }

  /* glowing bag emblem */
  function emblem(cv) {
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const fit = () => { const r = cv.getBoundingClientRect(); cv.width = r.width * 2; cv.height = r.height * 2; };
    fit();
    const pts = [], fil = [];
    const k = () => Math.min(cv.width, cv.height * 1.6) / 900;
    const add = (x, y, edge) => pts.push({ x, y, p: Math.random() * 6.28, s: 0.6 + Math.random() * 1.4, edge });
    for (let i = 0; i <= 50; i++) { const t = i / 50; add(-130 + t * 260, -70, 1); add(-150 + t * 300, 170, 1); }
    for (let i = 0; i <= 44; i++) { const t = i / 44; add(-130 - 20 * t, -70 + 240 * t, 1); add(130 + 20 * t, -70 + 240 * t, 1); }
    for (let i = 0; i <= 34; i++) { const a = Math.PI + (i / 34) * Math.PI; add(Math.cos(a) * 62, -70 + Math.sin(a) * 72, 1); }
    for (let i = 0; i < 110; i++) { const t = Math.random(), u = Math.random(); add((-140 + u * 280) * (0.9 + t * 0.12), -60 + t * 225, 0); }
    for (let i = 0; i < 40; i++) fil.push({ a: Math.random() * 6.28, r1: 170 + Math.random() * 30, r2: 260 + Math.random() * 520, p: Math.random() * 6.28 });
    const cx = cv.getContext('2d');
    function draw(t) {
      if (!cv.isConnected) return;
      const K = k(), ox = cv.width * 0.5, oy = cv.height * 0.5 - 50 * K;
      cx.clearRect(0, 0, cv.width, cv.height);
      const g = cx.createRadialGradient(ox, oy + 50 * K, 10, ox, oy + 50 * K, 380 * K);
      g.addColorStop(0, 'rgba(34,211,238,.24)'); g.addColorStop(1, 'rgba(34,211,238,0)');
      cx.fillStyle = g; cx.fillRect(0, 0, cv.width, cv.height);
      fil.forEach((f) => {
        const x1 = ox + Math.cos(f.a) * f.r1 * K, y1 = oy + 50 * K + Math.sin(f.a) * f.r1 * 0.7 * K, x2 = ox + Math.cos(f.a) * f.r2 * K * 1.6, y2 = oy + 50 * K + Math.sin(f.a) * f.r2 * 0.42 * K;
        const al = 0.08 + 0.08 * Math.sin(t / 900 + f.p), lg = cx.createLinearGradient(x1, y1, x2, y2);
        lg.addColorStop(0, `rgba(125,211,252,${al * 2})`); lg.addColorStop(1, 'rgba(125,211,252,0)');
        cx.strokeStyle = lg; cx.lineWidth = 1.2; cx.beginPath(); cx.moveTo(x1, y1); cx.lineTo(x2, y2); cx.stroke();
      });
      pts.forEach((q) => {
        const a = q.edge ? 0.55 + 0.45 * Math.sin(t / 500 + q.p) : 0.25 + 0.35 * Math.sin(t / 700 + q.p);
        cx.fillStyle = q.edge ? `rgba(165,243,252,${a})` : `rgba(125,211,252,${a * 0.7})`;
        cx.shadowColor = '#22d3ee'; cx.shadowBlur = q.edge ? 12 : 4;
        cx.beginPath(); cx.arc(ox + q.x * K * 1.15, oy + q.y * K * 1.15, (q.edge ? q.s + 1 : q.s) * Math.max(1, K * 1.4), 0, 6.28); cx.fill();
      });
      cx.shadowBlur = 0;
      if (!reduce) requestAnimationFrame(draw);
    }
    requestAnimationFrame(draw);
    addEventListener('resize', fit, { passive: true });
  }

  function mount(root) {
    const cv = root.querySelector('#amCv');
    if (cv) emblem(cv);
    root.querySelectorAll('[data-go]').forEach((b) => b.onclick = () => {
      const el = root.querySelector('#am-' + b.dataset.go);
      if (!el) return;
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.classList.add('flash'); setTimeout(() => el.classList.remove('flash'), 1600);
    });
  }

  window.AMap = { html, mount };
})();
