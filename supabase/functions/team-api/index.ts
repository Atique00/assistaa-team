// Assistaa · api  (Supabase twin of the Apps Script "Team API v1")
// Same request/response contract as backend/api.gs so the app works unchanged:
//   POST /functions/v1/api?team=store|support   body: {action, name?, pin?, ...}
//   reply: {ok:true, data, ms} | {ok:false, error, ms}
// Body is sent as text/plain (no CORS preflight), exactly like the Apps Script calls.
// Talks to Postgres directly (≈2 ms per query) instead of the REST API (≈50–120 ms per query).
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import postgres from "npm:postgres@3.4.5";
import { importPKCS8, SignJWT } from "npm:jose@5.9.6";

const sql = postgres(Deno.env.get("SUPABASE_DB_URL")!, { prepare: false, max: 4, idle_timeout: 60, connect_timeout: 10 });
const OWNER = "Atiq";
const TZ = "Asia/Dhaka";
const ORIGINS = ["https://team.assistaa.com", "https://atique00.github.io"];

class UserError extends Error {}
const fail = (m: string): never => { throw new UserError(m); };

/* small in-memory cache per worker: things that rarely change */
const memo = new Map<string, { v: Promise<any>; exp: number }>();
function cached<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
  const hit = memo.get(key);
  if (hit && hit.exp > Date.now()) return hit.v;
  const v = fn().catch((e) => { memo.delete(key); throw e; });
  memo.set(key, { v, exp: Date.now() + ttlMs });
  return v;
}
const forget = (prefix: string) => { for (const k of memo.keys()) if (k.startsWith(prefix)) memo.delete(k); };

/* ---------------- time helpers (Dhaka) ---------------- */
const fmt = new Intl.DateTimeFormat("en-US", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", weekday: "long", hour12: false });
function parts(d: Date) {
  const o: Record<string, string> = {};
  for (const p of fmt.formatToParts(d)) o[p.type] = p.value;
  if (o.hour === "24") o.hour = "00";
  return o;
}
const ymd = (d: Date) => { const p = parts(d); return `${p.year}-${p.month}-${p.day}`; };
const hm = (d: Date) => { const p = parts(d); return `${p.hour}:${p.minute}`; };
const ymdhm = (d: Date) => `${ymd(d)} ${hm(d)}`;
const sheetTime = (d: Date) => { const p = parts(d); return `${+p.month}/${+p.day}/${p.year} ${+p.hour}:${p.minute}:${p.second}`; };
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const shortTime = (d: Date) => { const p = parts(d); return `${MON[+p.month - 1]} ${+p.day}, ${p.hour}:${p.minute}`; };
const dayStart = (day: string) => new Date(`${day}T00:00:00+06:00`);
const addDays = (day: string, n: number) => ymd(new Date(dayStart(day).getTime() + n * 864e5 + 3 * 36e5));

/* ---------------- people & PINs ---------------- */
type Emp = { id: string; display_name: string; role: string; job_title: string | null; team_id: number | null; rate_per_unit: string | null; photo_data: string | null; about: string | null; skills: string[]; joined_on: string | null };
type Team = { id: number; key: string; name: string };

function teamRow(key: string): Promise<Team> {
  return cached("team:" + key, 600_000, async () => {
    const [t] = await sql`select id, key, name from public.teams where key = ${key}`;
    if (!t) fail("This team is not connected yet.");
    return t as Team;
  });
}
const EMP = sql`id::text, display_name, role::text, job_title, team_id, rate_per_unit::text, photo_data, about, skills, joined_on::text`;
function members(teamId: number): Promise<Emp[]> {
  return cached("people:" + teamId, 30_000, async () =>
    (await sql`select ${EMP} from public.employees where team_id = ${teamId} and active order by created_at`) as unknown as Emp[]);
}
function owner(): Promise<Emp> {
  return cached("owner", 60_000, async () => {
    const [o] = await sql`select ${EMP} from public.employees where role = 'owner' and active limit 1`;
    return o as Emp;
  });
}
async function pinOk(empId: string, pin: string) {
  if (!/^\d{4,8}$/.test(pin)) return false;
  const [r] = await sql`select public.pin_check(${empId}::uuid, ${pin}) ok`;
  return r.ok === true;
}
async function tooMany(ip: string) {
  const [r] = await sql`select count(*) filter (where ip_hash = ${ip})::int mine, count(*)::int total
    from public.login_attempts where not ok and at > now() - interval '10 minutes'`;
  if (r.mine >= 30 || r.total >= 300) fail("Too many wrong PINs. Wait 10 minutes and try again.");
}
const logTry = (empId: string | null, ok: boolean, ip: string) =>
  sql`insert into public.login_attempts (employee_id, ok, ip_hash) values (${empId}, ${ok}, ${ip})`;

async function verify(e: Emp, pin: string, ip: string) {
  const [ok] = await Promise.all([pinOk(e.id, pin), tooMany(ip)]);
  if (!ok) { await logTry(e.id, false, ip); fail("Wrong PIN"); }
  return e;
}
async function findMember(team: Team, name: string): Promise<Emp> {
  const m = (await members(team.id)).find((x) => x.display_name === name);
  if (!m) fail("Unknown name");
  return m!;
}
const checkMember = async (team: Team, name: string, pin: string, ip: string) => verify(await findMember(team, name), pin, ip);
const checkOwner = async (pin: string, ip: string) => verify(await owner(), pin, ip);
/* read actions: check the PIN while the data loads; nothing is returned unless the PIN is right */
async function authedRead<T>(who: Emp, pin: string, ip: string, fn: () => Promise<T>): Promise<T> {
  const [, out] = await Promise.all([verify(who, pin, ip), fn()]);
  return out;
}

function settings(scope: string): Promise<Record<string, unknown>> {
  return cached("settings:" + scope, 60_000, async () => {
    const rows = await sql`select key, value from public.settings where scope in ('global', ${scope})`;
    const s: Record<string, unknown> = {};
    for (const r of rows) s[r.key] = r.value;
    return s;
  });
}

/* ---------------- push (FCM HTTP v1; needs secret FIREBASE_SERVICE_ACCOUNT) ---------------- */
let fcmTok: { t: string; exp: number } | null = null;
async function fcmToken() {
  const raw = Deno.env.get("FIREBASE_SERVICE_ACCOUNT");
  if (!raw) return null;
  if (fcmTok && fcmTok.exp > Date.now() + 60_000) return fcmTok.t;
  const sa = JSON.parse(raw);
  const key = await importPKCS8(sa.private_key, "RS256");
  const now = Math.floor(Date.now() / 1000);
  const jwt = await new SignJWT({ scope: "https://www.googleapis.com/auth/firebase.messaging" })
    .setProtectedHeader({ alg: "RS256", typ: "JWT" }).setIssuer(sa.client_email).setAudience("https://oauth2.googleapis.com/token")
    .setIssuedAt(now).setExpirationTime(now + 3600).sign(key);
  const r = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: jwt }) });
  const j = await r.json();
  if (!j.access_token) { console.log("fcm auth failed", JSON.stringify(j).slice(0, 300)); return null; }
  fcmTok = { t: j.access_token, exp: Date.now() + (j.expires_in ?? 3600) * 1000 };
  return fcmTok.t;
}
async function pushNow(empIds: string[], title: string, body: string, path: string): Promise<number> {
  if (!empIds.length) return 0;
  const rows = empIds.map((id) => ({ employee_id: id, kind: "push", title, body: body.slice(0, 500), link: path }));
  await sql`insert into public.notifications ${sql(rows, "employee_id", "kind", "title", "body", "link")}`;
  try {
    const tok = await fcmToken();
    if (!tok) return 0;
    const project = JSON.parse(Deno.env.get("FIREBASE_SERVICE_ACCOUNT")!).project_id;
    const toks = await sql`select token, app_address from public.push_tokens where employee_id in ${sql(empIds)}`;
    let sent = 0;
    await Promise.all(toks.map(async (t) => {
      const r = await fetch(`https://fcm.googleapis.com/v1/projects/${project}/messages:send`, {
        method: "POST", headers: { Authorization: `Bearer ${tok}`, "Content-Type": "application/json" },
        body: JSON.stringify({ message: { token: t.token, data: { title, body: body || "", link: (t.app_address || ORIGINS[0]) + (path || "/") },
          webpush: { headers: { Urgency: "high", TTL: "86400" } } } }),
      });
      if (r.ok) sent++;
      else {
        const txt = await r.text();
        if (r.status === 404 || /UNREGISTERED|INVALID_ARGUMENT/.test(txt)) await sql`delete from public.push_tokens where token = ${t.token}`;
        else console.log("push failed", r.status, txt.slice(0, 300));
      }
    }));
    if (sent) await sql`update public.notifications set pushed_at = now() where employee_id in ${sql(empIds)} and pushed_at is null and title = ${title}`;
    return sent;
  } catch (e) { console.log("push error", String(e)); return 0; }
}
/* notifications must not slow the answer down: send them after replying */
function push(empIds: string[], title: string, body: string, path: string) {
  const p = pushNow(empIds, title, body, path).catch((e) => console.log("push error", String(e)));
  try { (globalThis as any).EdgeRuntime?.waitUntil?.(p); } catch (_) { /* ignore */ }
}

/* ---------------- task helpers (sheet-style labels) ---------------- */
function label(t: { status: string; recurrence: string | null }) {
  if (t.status === "completed") return "Done";
  if (t.status === "under_review") return "To check";
  if (t.recurrence === "FREQ=DAILY" && t.status !== "pending") return "Daily";
  if (t.status === "in_progress") return "In progress";
  return "To do";
}
function unlabel(s: string): { status: string; recurrence?: string | null } {
  switch (s) {
    case "Done": return { status: "completed" };
    case "To check": return { status: "under_review" };
    case "Daily": return { status: "in_progress", recurrence: "FREQ=DAILY" };
    case "In progress": return { status: "in_progress" };
    default: return { status: "pending" };
  }
}
type Task = { row: number; task: string; store: string; owner: string; ownerId: string; by: string; added: string; deadline: string; status: string; notes: string; days: number | ""; overdue: boolean };
async function teamTasks(teamId: number): Promise<Task[]> {
  const rows = await sql`
    select t.id::int, t.title, t.notes, t.status::text, t.area, t.requested_by_name, t.due_at, t.recurrence, t.created_at,
           a.employee_id::text owner_id, e.display_name owner_name
    from public.tasks t
    left join public.task_assignments a on a.task_id = t.id and a.ended_at is null
    left join public.employees e on e.id = a.employee_id
    where t.team_id = ${teamId} and t.status <> 'cancelled'
    order by t.created_at, t.id`;
  const today = ymd(new Date());
  return rows.map((t) => {
    const st = label(t as any);
    const deadline = t.due_at ? ymd(t.due_at) : "";
    const added = ymd(t.created_at);
    const days = st === "Done" ? "" : Math.max(0, Math.round((dayStart(today).getTime() - dayStart(added).getTime()) / 864e5));
    return { row: t.id, task: t.title, store: t.area || "", owner: t.owner_name || "", ownerId: t.owner_id || "", by: t.requested_by_name || "",
      added, deadline, status: st, notes: t.notes || "", days, overdue: st !== "Done" && !!deadline && deadline < today } as Task;
  });
}

/* ---------------- today's state from work events ---------------- */
type Ev = { event: string; at: Date; amount: number | null; status: string | null; note: string | null };
function stateOf(evs: Ev[]) {
  const t = { state: "off", start: "", done: "", breakStart: "", breakUsed: false, requests: [] as { time: string; amount: number | null; status: string; note: string }[] };
  for (const e of evs) {
    if (e.event === "start" && !t.start) { t.start = hm(e.at); t.state = "working"; }
    else if (e.event === "break_start") { t.breakStart = hm(e.at); t.breakUsed = true; if (t.state === "working") t.state = "break"; }
    else if (e.event === "break_end") { if (t.state === "break") t.state = "working"; }
    else if (e.event === "done") { t.done = hm(e.at); t.state = "done"; }
    else if (e.event === "request_tickets") t.requests.push({ time: hm(e.at), amount: e.amount, status: e.status || "New", note: e.note || "" });
  }
  return t;
}
async function todayEvents(empIds: string[]) {
  const by: Record<string, Ev[]> = {};
  if (!empIds.length) return by;
  const rows = await sql`select employee_id::text, event, at, amount, status, note from public.work_events
    where employee_id in ${sql(empIds)} and at >= ${dayStart(ymd(new Date()))} order by at`;
  for (const e of rows) (by[e.employee_id] ??= []).push(e as unknown as Ev);
  return by;
}

/* ---------------- member view ---------------- */
async function me(team: Team, m: Emp) {
  const support = team.key === "support";
  const now = new Date(), today = ymd(now), month0 = today.slice(0, 8) + "01";
  const [s, evs, reps, inbox, stats, fines, scores, tasks, waiting] = await Promise.all([
    settings(team.key),
    todayEvents([m.id]),
    sql`select kind, body, reply, status, created_at from public.reports where employee_id = ${m.id} order by created_at desc limit 10`,
    inboxOf(m.id),
    sql`select day::text, metric, value::float8 v from public.daily_stats where employee_id = ${m.id} and day >= ${month0}::date`,
    sql`select day::text, rule, ref, amount::float8, unit from public.fines where employee_id = ${m.id} and day >= ${month0}::date and status = 'active' order by day desc`,
    sql`select day::text, score::float8, why from public.scores where employee_id = ${m.id} and day >= ${addDays(today, -6)}::date order by day desc`,
    support ? Promise.resolve([] as Task[]) : teamTasks(team.id),
    support ? sql`select ticket_no, hours::float8, link from public.tickets_waiting where employee_id = ${m.id} order by hours desc` : Promise.resolve([]),
  ]);
  const quiet = !!s.silent_until && today <= String(s.silent_until);
  const t = stateOf(evs[m.id] ?? []);
  const sum = (metric: string, day?: string) => stats.filter((r) => r.metric === metric && (!day || r.day === day)).reduce((a, r) => a + Number(r.v), 0);
  const todayRep = (k: string) => reps.find((r) => r.kind === k && ymd(r.created_at) === today);
  const mine = (tasks as Task[]).filter((x) => x.ownerId === m.id && x.status !== "Done");
  const startRep = todayRep("Start report"), endRep = todayRep("End report");
  const statList = support
    ? [{ label: "Start report", value: startRep ? hm(startRep.created_at) : "Not yet" },
       { label: "Messages today", value: String(sum("messages_sent", today)) },
       { label: "Messages this month", value: String(sum("messages_sent")) },
       { label: "Earned (৳)", value: (sum("messages_sent") * Number(m.rate_per_unit ?? 0)).toLocaleString("en-US") },
       { label: "Waiting 20 h+", value: String(waiting.length) }]
    : [{ label: "Start report", value: startRep ? hm(startRep.created_at) : "Not yet" },
       { label: "End report", value: endRep ? hm(endRep.created_at) : "Not yet" },
       { label: "Products today", value: String(sum("products_listed", today)) },
       { label: "Products this month", value: String(sum("products_listed")) },
       { label: "Open tasks", value: String(mine.length) },
       { label: "Overdue", value: String(mine.filter((x) => x.overdue).length) }];
  return {
    name: m.display_name, team: team.name, support, quiet, status: "", hour: +parts(now).hour, day: parts(now).weekday,
    role: m.job_title || "", warn: "",
    today: t, stats: statList,
    score: quiet || !scores.length ? null : { today: String(scores[0].day === today ? scores[0].score : "—"), week: (scores.reduce((a, r) => a + Number(r.score), 0) / scores.length).toFixed(1), why: scores[0].why || "" },
    fines: quiet ? null : { total: fines.reduce((a, f) => a + Number(f.amount), 0), unit: support ? "tickets" : "৳", list: fines.map((f) => ({ date: f.day, rule: f.rule, ref: f.ref || "", amount: f.amount })) },
    reports: reps.slice(0, 6).map((r) => ({ type: r.kind, time: sheetTime(r.created_at), msg: r.body, reply: r.reply || "", status: r.status })),
    items: support
      ? waiting.map((w: any) => ({ title: "#" + w.ticket_no, sub: `${w.hours} h waiting`, bad: true, link: w.link }))
      : mine.map((x) => ({ row: x.row, title: x.task, status: x.status, bad: x.overdue, sub: [x.store, x.deadline ? "due " + x.deadline : "", x.days !== "" ? x.days + " days open" : ""].filter(Boolean).join(" · ") })),
    inbox,
    profile: { photo: m.photo_data || "", about: m.about || "", skills: (m.skills || []).join(", "), joined: m.joined_on || "" },
  };
}
async function inboxOf(empId: string) {
  const rows = await sql`select i.id::text, i.body, i.kind, i.seen_at, i.reply, i.replied_at, i.created_at, f.display_name from_name
    from public.inbox_messages i left join public.employees f on f.id = i.from_id
    where i.to_id = ${empId} order by i.created_at desc limit 30`;
  return rows.map((r) => ({ id: r.id, time: ymdhm(r.created_at), from: r.from_name || OWNER, text: r.body, kind: r.kind,
    seen: !!r.seen_at, reply: r.reply || "", replyTime: r.replied_at ? hm(r.replied_at) : "" }));
}

/* ---------------- boss view ---------------- */
async function boss(team: Team) {
  const support = team.key === "support";
  const people = await members(team.id);
  const ids = people.map((p) => p.id);
  const [evs, tasks, inbox, reps, s] = await Promise.all([
    todayEvents(ids),
    support ? Promise.resolve([] as Task[]) : teamTasks(team.id),
    sql`select i.id::text, i.body, i.kind, i.seen_at, i.reply, i.created_at, e.display_name to_name
      from public.inbox_messages i join public.employees e on e.id = i.to_id
      where e.team_id = ${team.id} order by i.created_at desc limit 60`,
    sql`select r.kind, r.body, r.reply, r.created_at, e.display_name from public.reports r join public.employees e on e.id = r.employee_id
      where e.team_id = ${team.id} order by r.created_at desc limit 40`,
    settings(team.key),
  ]);
  const since14 = addDays(ymd(new Date()), -14);
  const stores = support ? [] : [...new Set([...String(s.stores || "").split(",").map((x) => x.trim()).filter(Boolean), ...tasks.map((t) => t.store).filter(Boolean)])].sort();
  return {
    team: team.name, support,
    people: people.map((p) => {
      const st = stateOf(evs[p.id] ?? []);
      const mine = tasks.filter((t) => t.ownerId === p.id && t.status !== "Done");
      return { name: p.display_name, role: p.job_title || "", state: st.state, start: st.start, done: st.done, photo: p.photo_data || "", open: mine.length, overdue: mine.filter((t) => t.overdue).length };
    }),
    inbox: inbox.map((r) => ({ id: r.id, to: r.to_name || "", time: shortTime(r.created_at), text: r.body, kind: r.kind, seen: !!r.seen_at, reply: r.reply || "" })),
    reports: reps.map((r) => ({ time: sheetTime(r.created_at), name: r.display_name, type: r.kind, msg: r.body, reply: r.reply || "" })),
    tasks: tasks.filter((t) => t.status !== "Done" || t.added >= since14).map(({ ownerId: _o, ...t }) => t),
    stores, statuses: ["To do", "In progress", "To check", "Daily", "Done"],
  };
}

/* ---------------- history ---------------- */
async function history(team: Team, m: Emp, from: string, to: string) {
  const support = team.key === "support";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) fail("Pick both dates.");
  const a = dayStart(from), b = dayStart(addDays(to, 1));
  const [reps, evs, stats, fines, scores] = await Promise.all([
    sql`select kind, body, reply, created_at from public.reports where employee_id = ${m.id} and created_at >= ${a} and created_at < ${b}`,
    sql`select event, at, amount, status from public.work_events where employee_id = ${m.id} and at >= ${a} and at < ${b} and event not in ('start','done')`,
    sql`select day::text, metric, value::float8 v from public.daily_stats where employee_id = ${m.id} and day between ${from}::date and ${to}::date`,
    sql`select day::text, rule, ref, amount::float8, unit from public.fines where employee_id = ${m.id} and day between ${from}::date and ${to}::date`,
    sql`select day::text, score::float8, why from public.scores where employee_id = ${m.id} and day between ${from}::date and ${to}::date`,
  ]);
  const names: Record<string, string> = { break_start: "Break start", break_end: "Break end", request_tickets: "Request tickets" };
  const items: { when: string; kind: string; text: string; reply: string }[] = [];
  for (const r of reps) items.push({ when: ymdhm(r.created_at), kind: r.kind, text: r.body, reply: r.reply || "" });
  for (const e of evs) items.push({ when: ymdhm(e.at), kind: names[e.event] || e.event, text: e.event === "request_tickets" ? `${e.amount} · ${e.status || "New"}` : "", reply: "" });
  for (const f of fines) items.push({ when: `${f.day} 23:58`, kind: "Fine", text: `${f.rule}${f.ref ? " · " + f.ref : ""} · ${f.amount} ${f.unit === "bdt" ? "৳" : f.unit}`, reply: "" });
  for (const s of scores) items.push({ when: `${s.day} 23:59`, kind: "Score", text: `${s.score}/10${s.why ? " · " + s.why : ""}`, reply: "" });
  let totals = null;
  if (support) {
    const days: Record<string, { m: number; c: number }> = {};
    for (const r of stats) {
      const d = (days[r.day] ??= { m: 0, c: 0 });
      if (r.metric === "messages_sent") d.m += Number(r.v);
      if (r.metric === "tickets_closed") d.c += Number(r.v);
    }
    for (const [d, v] of Object.entries(days)) items.push({ when: `${d} 23:57`, kind: "Day", text: `${v.m} messages · ${v.c} closed`, reply: "" });
    totals = { days: Object.keys(days).length, messages: Object.values(days).reduce((x, v) => x + v.m, 0), closed: Object.values(days).reduce((x, v) => x + v.c, 0) };
  }
  items.sort((x, y) => (x.when < y.when ? 1 : x.when > y.when ? -1 : 0));
  return { from, to, totals, items };
}

/* ---------------- writes ---------------- */
async function act(team: Team, m: Emp, a: string, text: string, amount: unknown) {
  const support = team.key === "support";
  const [evs, o] = await Promise.all([todayEvents([m.id]), owner()]);
  const t = stateOf(evs[m.id] ?? []);
  const txt = String(text || "").trim().slice(0, 4000);
  const ev = (event: string, amt: number | null = null, status: string | null = null) =>
    sql`insert into public.work_events (employee_id, event, amount, status) values (${m.id}, ${event}, ${amt}, ${status})`;
  const rep = (kind: string, body: string) => sql`insert into public.reports (employee_id, kind, body) values (${m.id}, ${kind}, ${body || "(no note)"})`;
  switch (a) {
    case "start":
      if (t.state !== "off") fail("You already started today.");
      await sql.begin((tx) => [tx`insert into public.work_events (employee_id, event) values (${m.id}, 'start')`,
        tx`insert into public.reports (employee_id, kind, body) values (${m.id}, 'Start report', ${txt || "(no note)"})`]);
      push([o.id], `${m.display_name} started`, txt.slice(0, 140), "/#breports");
      break;
    case "done":
      if (t.state === "off") fail("Start your day first.");
      if (t.state === "done") fail("You already finished today.");
      if (txt.length < 5) fail("Write what you did today and what is still pending.");
      await sql.begin((tx) => [
        ...(t.state === "break" ? [tx`insert into public.work_events (employee_id, event) values (${m.id}, 'break_end')`] : []),
        tx`insert into public.work_events (employee_id, event) values (${m.id}, 'done')`,
        tx`insert into public.reports (employee_id, kind, body) values (${m.id}, 'End report', ${txt})`]);
      push([o.id], `${m.display_name} finished`, txt.slice(0, 140), "/#breports");
      break;
    case "break":
      if (!support) fail("Breaks are tracked for the support team only.");
      if (t.state !== "working") fail("You can only take a break while working.");
      if (t.breakUsed) fail("You already took your break today.");
      await ev("break_start");
      break;
    case "breakend":
      if (t.state !== "break") fail("You are not on a break.");
      await ev("break_end");
      break;
    case "request": {
      const n = Math.round(Number(amount));
      if (!support) fail("Ticket requests are for the support team.");
      if (!(n >= 1 && n <= 200)) fail("Ask for 1 to 200 tickets.");
      await ev("request_tickets", n, "New");
      push([o.id], `${m.display_name} wants ${n} more tickets`, "", "/#team");
      break;
    }
    case "message": {
      if (!txt) fail("Write a message first.");
      const kind = ["Question", "Leave request", "Problem", "Update", "Other"].includes(String(amount)) ? String(amount) : "Question";
      await rep(kind, txt);
      push([o.id], `${m.display_name} · ${kind}`, txt.slice(0, 140), "/#inbox");
      break;
    }
    default: fail("Unknown action.");
  }
}

async function setMyTask(m: Emp, row: number, status: string) {
  if (!["In progress", "Done"].includes(status)) fail("Pick In progress or Done.");
  const [a] = await sql`select id from public.task_assignments where task_id = ${row} and employee_id = ${m.id} and ended_at is null`;
  if (!a) fail("That task is not yours.");
  const u = unlabel(status);
  await sql.begin((tx) => [
    tx`update public.tasks set status = ${u.status}::public.task_status, completed_at = ${status === "Done" ? new Date() : null} where id = ${row}`,
    tx`update public.task_assignments set ack = 'responded', first_response_at = coalesce(first_response_at, now()) where id = ${a.id}`,
    tx`insert into public.task_activity (task_id, actor_id, event, detail) values (${row}, ${m.id}, 'status_changed', ${sql.json({ to: status })})`]);
}

async function saveTask(team: Team, o: Emp, t: Record<string, string>) {
  const title = String(t.task || "").trim().slice(0, 300);
  if (!title) fail("Write what needs to be done.");
  const people = await members(team.id);
  const ownerEmp = t.owner ? people.find((p) => p.display_name === t.owner) : null;
  if (t.owner && !ownerEmp) fail("Pick a person from the team.");
  const u = unlabel(t.status || "To do");
  const [store] = t.store ? await sql`select id::int, client_id::int from public.client_stores where name = ${t.store} limit 1` : [];
  const due = /^\d{4}-\d{2}-\d{2}$/.test(t.deadline || "") ? new Date(`${t.deadline}T22:00:00+06:00`) : null;
  const notes = String(t.notes || "").slice(0, 1000) || null;
  const doneAt = u.status === "completed" ? new Date() : null;
  let id = Number(t.row) || 0, before: string | null = null;
  if (id) {
    const [cur] = await sql`select t.id, (select employee_id::text from public.task_assignments a where a.task_id = t.id and a.ended_at is null limit 1) owner_id
      from public.tasks t where t.id = ${id} and t.team_id = ${team.id}`;
    if (!cur) fail("Task not found.");
    before = cur.owner_id ?? null;
    await sql`update public.tasks set title = ${title}, area = ${t.store || null}, notes = ${notes}, status = ${u.status}::public.task_status,
      due_at = ${due}, store_id = ${store?.id ?? null}, completed_at = ${doneAt},
      recurrence = ${u.recurrence === undefined ? sql`recurrence` : u.recurrence} where id = ${id}`;
  } else {
    const [r] = await sql`insert into public.tasks (title, area, notes, status, due_at, store_id, completed_at, recurrence, team_id, kind, created_by, requested_by_name, client_id)
      values (${title}, ${t.store || null}, ${notes}, ${u.status}::public.task_status, ${due}, ${store?.id ?? null}, ${doneAt}, ${u.recurrence ?? null},
              ${team.id}, 'store_management', ${o.id}, ${OWNER}, ${store?.client_id ?? null}) returning id::int`;
    id = r.id;
  }
  if ((ownerEmp?.id ?? null) !== before) {
    if (before) await sql`update public.task_assignments set ended_at = now() where task_id = ${id} and ended_at is null`;
    if (ownerEmp) {
      await sql`insert into public.task_assignments (task_id, employee_id, assigned_by) values (${id}, ${ownerEmp.id}, ${o.id})`;
      push([ownerEmp.id], "New task from " + OWNER, title.slice(0, 140) + (t.store ? " · " + t.store : ""), "/#tasks");
    }
  }
  await sql`insert into public.task_activity (task_id, actor_id, event, detail) values (${id}, ${o.id}, ${Number(t.row) ? "updated" : "created"}, ${sql.json({ status: t.status ?? null, owner: t.owner || null })})`;
}

async function sendInbox(team: Team, o: Emp, to: string, text: string, kind: string) {
  const msg = String(text || "").trim().slice(0, 2000);
  if (!msg) fail("Write a message first.");
  const people = await members(team.id);
  const targets = to === "all" ? people : people.filter((p) => p.display_name === String(to || "").trim());
  if (!targets.length) fail("Pick a person.");
  const k = String(kind || "Message").slice(0, 30);
  const rows = targets.map((p) => ({ to_id: p.id, from_id: o.id, body: msg, kind: k }));
  await sql`insert into public.inbox_messages ${sql(rows, "to_id", "from_id", "body", "kind")}`;
  push(targets.map((p) => p.id), `${k} from ${OWNER}`, msg.slice(0, 140), "/#inbox");
}

async function changePin(team: Team, name: string, oldPin: string, newPin: string, ip: string) {
  const who = name === OWNER ? await checkOwner(oldPin, ip) : await checkMember(team, name, oldPin, ip);
  const [r] = await sql`select public.pin_set(${who.id}::uuid, ${newPin}) res`;
  const msg: Record<string, string> = {
    owner_pin_6_digits: "Your manager PIN must be 6 digits.", pin_4_digits: "Your PIN must be 4 digits.",
    pin_too_easy: "That PIN is too easy to guess. Pick another one.", pin_taken: "That PIN is already used. Pick another one.",
  };
  if (r.res === "pin_taken") await logTry(who.id, false, ip);
  if (r.res !== "ok") fail(msg[r.res] || "Could not change the PIN.");
  await sql`insert into public.audit_logs (actor_id, table_name, row_id, action) values (${who.id}, 'employee_pins', ${who.id}, 'update')`;
  return { changed: true };
}

/* ---------------- router ---------------- */
async function route(teamKey: string, b: Record<string, any>, ip: string) {
  const team = await teamRow(teamKey);
  const n = String(b.name || "").trim(), p = String(b.pin || "").trim();
  switch (b.action) {
    case "login": {
      if (!/^\d{4,8}$/.test(p)) fail("Wrong PIN");
      const [[found], o, people] = await Promise.all([sql`select public.pin_find(${p})::text id`, owner(), members(team.id), tooMany(ip)]);
      const id = found?.id ?? null;
      const e = !id ? null : id === o.id ? o : people.find((x) => x.id === id) ?? null;
      if (!e) {
        // a PIN of the other team is not a failure for the counter
        if (!id) await logTry(null, false, ip);
        fail("Wrong PIN");
      }
      const who: Record<string, unknown> = { role: e!.role === "owner" ? "owner" : "member", name: e!.display_name, team: team.name, support: team.key === "support" };
      const [, data] = await Promise.all([logTry(e!.id, true, ip), b.withData ? (e!.role === "owner" ? boss(team) : me(team, e!)) : null]);
      if (b.withData) who.data = data;
      return who;
    }
    case "pinFree": {
      // only a signed-in person may ask, and every "taken" answer counts as a failed try (no PIN guessing)
      const who = n === OWNER ? await checkOwner(p, ip) : await checkMember(team, n, p, ip);
      const want = String(b.newPin || "").trim();
      if (!/^\d{4,8}$/.test(want)) return { free: false };
      const [r] = await sql`select public.pin_find(${want})::text id`;
      const free = !r?.id || r.id === who.id;
      if (!free) await logTry(who.id, false, ip);
      return { free };
    }
    case "changePin": return changePin(team, n, p, String(b.newPin || "").trim(), ip);
    case "info": return { team: team.name, support: team.key === "support", names: (await members(team.id)).map((x) => x.display_name), owner: OWNER };
    case "me": { const m = await findMember(team, n); return authedRead(m, p, ip, () => me(team, m)); }
    case "act": { const m = await checkMember(team, n, p, ip); await act(team, m, String(b.act || ""), b.text, b.amount); return me(team, m); }
    case "task": {
      const m = await checkMember(team, n, p, ip);
      await setMyTask(m, Number(b.row), String(b.status || ""));
      push([(await owner()).id], `${n} updated a task`, `${b.status}: ${b.title || ""}`, "/#btasks");
      return me(team, m);
    }
    case "history": { const m = await findMember(team, n); return authedRead(m, p, ip, () => history(team, m, String(b.from || ""), String(b.to || ""))); }
    case "token": {
      const who = n === OWNER ? await checkOwner(p, ip) : await checkMember(team, n, p, ip);
      const token = String(b.token || "").trim();
      if (!token) fail("No token.");
      await sql`insert into public.push_tokens (token, employee_id, device, app_address, updated_at)
        values (${token}, ${who.id}, ${String(b.device || "").slice(0, 120)}, ${String(b.origin || "").slice(0, 120)}, now())
        on conflict (token) do update set employee_id = excluded.employee_id, device = excluded.device, app_address = excluded.app_address, updated_at = now()`;
      return { saved: true };
    }
    case "reply": {
      const m = await checkMember(team, n, p, ip);
      const t = String(b.text || "").trim().slice(0, 2000);
      if (!t) fail("Write a reply first.");
      const done = await sql`update public.inbox_messages set reply = ${t}, replied_at = now(), seen_at = coalesce(seen_at, now())
        where id = ${Number(b.id) || 0} and to_id = ${m.id} returning id`;
      if (!done.length) fail("Message not found.");
      push([(await owner()).id], `${n} replied`, t.slice(0, 140), "/#bmsg");
      return me(team, m);
    }
    case "seen": {
      const m = await checkMember(team, n, p, ip);
      const ids = (Array.isArray(b.ids) ? b.ids : []).map(Number).filter(Boolean).slice(0, 50);
      if (ids.length) await sql`update public.inbox_messages set seen_at = now() where id in ${sql(ids)} and to_id = ${m.id} and seen_at is null`;
      return { ok: true };
    }
    case "profile": {
      const m = await checkMember(team, n, p, ip);
      let photo = m.photo_data, about = m.about, skills = m.skills || [];
      if (b.photo !== undefined) {
        const ph = String(b.photo || "");
        if (ph && (!/^data:image\/(jpeg|png|webp);base64,/.test(ph) || ph.length > 45000)) fail("Photo is too big. Pick a smaller one.");
        photo = ph || null;
      }
      if (b.about !== undefined) about = String(b.about).slice(0, 300);
      if (b.skills !== undefined) skills = String(b.skills).slice(0, 200).split(",").map((s) => s.trim()).filter(Boolean);
      const [fresh] = await sql`update public.employees set photo_data = ${photo}, about = ${about}, skills = (select coalesce(array_agg(x), '{}') from jsonb_array_elements_text(${sql.json(skills)}) x),
        joined_on = coalesce(joined_on, ${ymd(new Date())}::date) where id = ${m.id} returning ${EMP}`;
      forget("people:");
      return me(team, fresh as Emp);
    }
    case "boss": return authedRead(await owner(), p, ip, () => boss(team));
    case "send": { const o = await checkOwner(p, ip); await sendInbox(team, o, String(b.to || ""), b.text, b.kind); return boss(team); }
    case "saveTask": { const o = await checkOwner(p, ip); await saveTask(team, o, b.task || {}); return boss(team); }
    case "testPush": {
      const o = await checkOwner(p, ip);
      const to = b.to && b.to !== OWNER ? (await members(team.id)).find((x) => x.display_name === b.to) : o;
      return { sent: to ? await pushNow([to.id], "Assistaa", "Notifications are working 🎉", "/") : 0 };
    }
    default: fail("Unknown action.");
  }
}

async function sha(s: string) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(d)).map((x) => x.toString(16).padStart(2, "0")).join("").slice(0, 32);
}

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");
  const h = {
    "Access-Control-Allow-Origin": origin && (ORIGINS.includes(origin) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) ? origin : ORIGINS[0],
    "Access-Control-Allow-Headers": "content-type", "Access-Control-Allow-Methods": "POST, OPTIONS", Vary: "Origin",
    "Content-Type": "application/json",
  };
  if (req.method === "OPTIONS") return new Response("ok", { headers: h });
  let out: Record<string, unknown>;
  const t0 = Date.now();
  try {
    if (req.method !== "POST") fail("Use POST.");
    const team = new URL(req.url).searchParams.get("team") || "store";
    const b = JSON.parse((await req.text()) || "{}");
    const ip = await sha((req.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? "?") + "|assistaa");
    out = { ok: true, data: await route(team, b, ip) };
  } catch (e) {
    if (!(e instanceof UserError)) console.error(e);
    out = { ok: false, error: e instanceof UserError ? e.message : "Something went wrong on the server." };
  }
  out.ms = Date.now() - t0;
  return new Response(JSON.stringify(out), { status: 200, headers: h });
});
