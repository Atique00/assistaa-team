// Assistaa · api  (Supabase twin of the Apps Script "Team API v1")
// Same request/response contract as backend/api.gs so the app works unchanged:
//   POST /functions/v1/api?team=store|support   body: {action, name?, pin?, ...}
//   reply: {ok:true, data} | {ok:false, error}
// Body is sent as text/plain (no CORS preflight), exactly like the Apps Script calls.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2.45.4";
import { importPKCS8, SignJWT } from "npm:jose@5.9.6";

const db: SupabaseClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const OWNER = "Atiq";
const TZ = "Asia/Dhaka";
const ORIGINS = ["https://team.assistaa.com", "https://atique00.github.io"];

class UserError extends Error {}
const fail = (m: string): never => { throw new UserError(m); };

/* ---------------- time helpers (Dhaka) ---------------- */
function parts(d: Date) {
  const f = new Intl.DateTimeFormat("en-US", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", weekday: "long", hour12: false });
  const o: Record<string, string> = {};
  for (const p of f.formatToParts(d)) o[p.type] = p.value;
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
const D = (s: string | null) => (s ? new Date(s) : null);

/* ---------------- people & PINs ---------------- */
type Emp = { id: string; display_name: string; role: string; job_title: string | null; team_id: number | null; rate_per_unit: number | null; photo_data: string | null; about: string | null; skills: string[]; joined_on: string | null; active: boolean };
const EMP_COLS = "id, display_name, role, job_title, team_id, rate_per_unit, photo_data, about, skills, joined_on, active";

async function teamRow(key: string) {
  const { data } = await db.from("teams").select("id, key, name").eq("key", key).single();
  if (!data) fail("This team is not connected yet.");
  return data!;
}
async function members(teamId: number): Promise<Emp[]> {
  const { data } = await db.from("employees").select(EMP_COLS).eq("team_id", teamId).eq("active", true).order("created_at");
  return (data ?? []) as Emp[];
}
async function owner(): Promise<Emp> {
  const { data } = await db.from("employees").select(EMP_COLS).eq("role", "owner").eq("active", true).limit(1).single();
  return data as Emp;
}
async function pinOk(empId: string, pin: string) {
  if (!/^\d{4,8}$/.test(pin)) return false;
  const { data } = await db.rpc("pin_check", { p_employee: empId, p_pin: pin });
  return data === true;
}
async function tooMany(ip: string) {
  const since = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  const [{ count: mine }, { count: all }] = await Promise.all([
    db.from("login_attempts").select("id", { count: "exact", head: true }).eq("ok", false).eq("ip_hash", ip).gte("at", since),
    db.from("login_attempts").select("id", { count: "exact", head: true }).eq("ok", false).gte("at", since),
  ]);
  if ((mine ?? 0) >= 30 || (all ?? 0) >= 100) fail("Too many wrong PINs. Wait 10 minutes and try again.");
}
const logTry = (empId: string | null, ok: boolean, ip: string) => db.from("login_attempts").insert({ employee_id: empId, ok, ip_hash: ip });

async function checkMember(team: { id: number }, name: string, pin: string, ip: string): Promise<Emp> {
  const m = (await members(team.id)).find((x) => x.display_name === name);
  if (!m) fail("Unknown name");
  await tooMany(ip);
  if (!(await pinOk(m!.id, pin))) { await logTry(m!.id, false, ip); fail("Wrong PIN"); }
  return m!;
}
async function checkOwner(pin: string, ip: string): Promise<Emp> {
  const o = await owner();
  await tooMany(ip);
  if (!(await pinOk(o.id, pin))) { await logTry(o.id, false, ip); fail("Wrong PIN"); }
  return o;
}

/* ---------------- settings ---------------- */
async function settings(scope: string) {
  const { data } = await db.from("settings").select("key, value").in("scope", ["global", scope]);
  const s: Record<string, unknown> = {};
  for (const r of data ?? []) s[r.key] = r.value;
  return s;
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
async function push(empIds: string[], title: string, body: string, path: string): Promise<number> {
  if (!empIds.length) return 0;
  // always keep an in-app record
  await db.from("notifications").insert(empIds.map((id) => ({ employee_id: id, kind: "push", title, body: body.slice(0, 500), link: path })));
  try {
    const tok = await fcmToken();
    if (!tok) return 0;
    const project = JSON.parse(Deno.env.get("FIREBASE_SERVICE_ACCOUNT")!).project_id;
    const { data: toks } = await db.from("push_tokens").select("token, app_address, employee_id").in("employee_id", empIds);
    let sent = 0;
    await Promise.all((toks ?? []).map(async (t) => {
      const r = await fetch(`https://fcm.googleapis.com/v1/projects/${project}/messages:send`, {
        method: "POST", headers: { Authorization: `Bearer ${tok}`, "Content-Type": "application/json" },
        body: JSON.stringify({ message: { token: t.token, data: { title, body: body || "", link: (t.app_address || ORIGINS[0]) + (path || "/") },
          webpush: { headers: { Urgency: "high", TTL: "86400" } } } }),
      });
      if (r.ok) sent++;
      else {
        const txt = await r.text();
        if (r.status === 404 || /UNREGISTERED|INVALID_ARGUMENT/.test(txt)) await db.from("push_tokens").delete().eq("token", t.token);
        else console.log("push failed", r.status, txt.slice(0, 300));
      }
    }));
    if (sent) await db.from("notifications").update({ pushed_at: new Date().toISOString() }).in("employee_id", empIds).is("pushed_at", null).eq("title", title);
    return sent;
  } catch (e) { console.log("push error", String(e)); return 0; }
}

/* ---------------- task helpers (sheet-style labels) ---------------- */
type TaskRow = { id: number; title: string; notes: string | null; status: string; area: string | null; requested_by_name: string | null; due_at: string | null; recurrence: string | null; created_at: string; completed_at: string | null; task_assignments: { employee_id: string; ended_at: string | null; employees: { display_name: string } | null }[] };
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
async function teamTasks(teamId: number) {
  const { data } = await db.from("tasks")
    .select("id, title, notes, status, area, requested_by_name, due_at, recurrence, created_at, completed_at, task_assignments(employee_id, ended_at, employees:employee_id(display_name))")
    .eq("team_id", teamId).neq("status", "cancelled").order("created_at");
  const today = ymd(new Date());
  return ((data ?? []) as unknown as TaskRow[]).map((t) => {
    const a = t.task_assignments.find((x) => !x.ended_at);
    const st = label(t);
    const deadline = t.due_at ? ymd(new Date(t.due_at)) : "";
    const added = ymd(new Date(t.created_at));
    const days = st === "Done" ? "" : Math.max(0, Math.round((dayStart(today).getTime() - dayStart(added).getTime()) / 864e5));
    return { row: t.id, task: t.title, store: t.area || "", owner: a?.employees?.display_name || "", ownerId: a?.employee_id || "", by: t.requested_by_name || "",
      added, deadline, status: st, notes: t.notes || "", days, overdue: st !== "Done" && !!deadline && deadline < today };
  });
}

/* ---------------- today's state from work events ---------------- */
type Ev = { event: string; at: string; amount: number | null; status: string | null; note: string | null };
function stateOf(evs: Ev[]) {
  const t = { state: "off", start: "", done: "", breakStart: "", breakUsed: false, requests: [] as { time: string; amount: number | null; status: string; note: string }[] };
  for (const e of evs) {
    const d = new Date(e.at);
    if (e.event === "start" && !t.start) { t.start = hm(d); t.state = "working"; }
    else if (e.event === "break_start") { t.breakStart = hm(d); t.breakUsed = true; if (t.state === "working") t.state = "break"; }
    else if (e.event === "break_end") { if (t.state === "break") t.state = "working"; }
    else if (e.event === "done") { t.done = hm(d); t.state = "done"; }
    else if (e.event === "request_tickets") t.requests.push({ time: hm(d), amount: e.amount, status: e.status || "New", note: e.note || "" });
  }
  return t;
}
async function todayEvents(empIds: string[]) {
  const since = dayStart(ymd(new Date())).toISOString();
  const { data } = await db.from("work_events").select("employee_id, event, at, amount, status, note").in("employee_id", empIds).gte("at", since).order("at");
  const by: Record<string, Ev[]> = {};
  for (const e of data ?? []) (by[e.employee_id] ??= []).push(e);
  return by;
}

/* ---------------- member view ---------------- */
async function me(team: { id: number; key: string; name: string }, m: Emp) {
  const support = team.key === "support";
  const now = new Date(), today = ymd(now), month0 = today.slice(0, 8) + "01";
  const s = await settings(team.key);
  const quiet = !!s.silent_until && today <= String(s.silent_until);
  const [evs, reps, inbox, stats, fines, scores, tasks, waiting] = await Promise.all([
    todayEvents([m.id]),
    db.from("reports").select("kind, body, reply, status, created_at").eq("employee_id", m.id).order("created_at", { ascending: false }).limit(10),
    inboxOf(m.id),
    db.from("daily_stats").select("day, metric, value").eq("employee_id", m.id).gte("day", month0),
    db.from("fines").select("day, rule, ref, amount, unit, status").eq("employee_id", m.id).gte("day", month0).eq("status", "active").order("day", { ascending: false }),
    db.from("scores").select("day, score, why").eq("employee_id", m.id).gte("day", addDays(today, -6)).order("day", { ascending: false }),
    support ? Promise.resolve([]) : teamTasks(team.id),
    support ? db.from("tickets_waiting").select("ticket_no, hours, link").eq("employee_id", m.id).order("hours", { ascending: false }) : Promise.resolve({ data: [] }),
  ]);
  const t = stateOf(evs[m.id] ?? []);
  const sum = (metric: string, day?: string) => (stats.data ?? []).filter((r) => r.metric === metric && (!day || r.day === day)).reduce((a, r) => a + Number(r.value), 0);
  const myReps = reps.data ?? [];
  const todayRep = (k: string) => myReps.find((r) => r.kind === k && ymd(new Date(r.created_at)) === today);
  const mine = (tasks as Awaited<ReturnType<typeof teamTasks>>).filter((x) => x.ownerId === m.id && x.status !== "Done");
  const fmtN = (n: number) => n.toLocaleString("en-US");
  const statList = support
    ? [{ label: "Start report", value: todayRep("Start report") ? hm(new Date(todayRep("Start report")!.created_at)) : "Not yet" },
       { label: "Messages today", value: String(sum("messages_sent", today)) },
       { label: "Messages this month", value: String(sum("messages_sent")) },
       { label: "Earned (৳)", value: fmtN(sum("messages_sent") * Number(m.rate_per_unit ?? 0)) },
       { label: "Waiting 20 h+", value: String((waiting.data ?? []).length) }]
    : [{ label: "Start report", value: todayRep("Start report") ? hm(new Date(todayRep("Start report")!.created_at)) : "Not yet" },
       { label: "End report", value: todayRep("End report") ? hm(new Date(todayRep("End report")!.created_at)) : "Not yet" },
       { label: "Products today", value: String(sum("products_listed", today)) },
       { label: "Products this month", value: String(sum("products_listed")) },
       { label: "Open tasks", value: String(mine.length) },
       { label: "Overdue", value: String(mine.filter((x) => x.overdue).length) }];
  const fl = fines.data ?? [], sc = scores.data ?? [];
  return {
    name: m.display_name, team: team.name, support, quiet, status: "", hour: +parts(now).hour, day: parts(now).weekday,
    role: m.job_title || "", warn: "",
    today: t, stats: statList,
    score: quiet || !sc.length ? null : { today: String(sc[0].day === today ? sc[0].score : "—"), week: (sc.reduce((a, r) => a + Number(r.score), 0) / sc.length).toFixed(1), why: sc[0].why || "" },
    fines: quiet ? null : { total: fl.reduce((a, f) => a + Number(f.amount), 0), unit: support ? "tickets" : "৳", list: fl.map((f) => ({ date: f.day, rule: f.rule, ref: f.ref || "", amount: f.amount })) },
    reports: myReps.slice(0, 6).map((r) => ({ type: r.kind, time: sheetTime(new Date(r.created_at)), msg: r.body, reply: r.reply || "", status: r.status })),
    items: support
      ? (waiting.data ?? []).map((w) => ({ title: "#" + w.ticket_no, sub: `${w.hours} h waiting`, bad: true, link: w.link }))
      : mine.map((x) => ({ row: x.row, title: x.task, status: x.status, bad: x.overdue, sub: [x.store, x.deadline ? "due " + x.deadline : "", x.days !== "" ? x.days + " days open" : ""].filter(Boolean).join(" · ") })),
    inbox,
    profile: { photo: m.photo_data || "", about: m.about || "", skills: (m.skills || []).join(", "), joined: m.joined_on || "" },
  };
}
async function inboxOf(empId: string) {
  const { data } = await db.from("inbox_messages").select("id, body, kind, seen_at, reply, replied_at, created_at, from:from_id(display_name)")
    .eq("to_id", empId).order("created_at", { ascending: false }).limit(30);
  return (data ?? []).map((r: any) => ({ id: String(r.id), time: ymdhm(new Date(r.created_at)), from: r.from?.display_name || OWNER, text: r.body, kind: r.kind,
    seen: !!r.seen_at, reply: r.reply || "", replyTime: r.replied_at ? hm(new Date(r.replied_at)) : "" }));
}

/* ---------------- boss view ---------------- */
async function boss(team: { id: number; key: string; name: string }) {
  const support = team.key === "support";
  const people = await members(team.id);
  const ids = people.map((p) => p.id);
  const [evs, tasks, inbox, reps, s] = await Promise.all([
    todayEvents(ids),
    support ? Promise.resolve([] as Awaited<ReturnType<typeof teamTasks>>) : teamTasks(team.id),
    db.from("inbox_messages").select("id, body, kind, seen_at, reply, created_at, to:to_id(display_name)").in("to_id", ids).order("created_at", { ascending: false }).limit(60),
    db.from("reports").select("kind, body, reply, created_at, employee_id").in("employee_id", ids).order("created_at", { ascending: false }).limit(40),
    settings(team.key),
  ]);
  const name = (id: string) => people.find((p) => p.id === id)?.display_name || "";
  const since14 = addDays(ymd(new Date()), -14);
  const stores = support ? [] : [...new Set([...String(s.stores || "").split(",").map((x) => x.trim()).filter(Boolean), ...tasks.map((t) => t.store).filter(Boolean)])].sort();
  return {
    team: team.name, support,
    people: people.map((p) => {
      const st = stateOf(evs[p.id] ?? []);
      const mine = tasks.filter((t) => t.ownerId === p.id && t.status !== "Done");
      return { name: p.display_name, role: p.job_title || "", state: st.state, start: st.start, done: st.done, photo: p.photo_data || "", open: mine.length, overdue: mine.filter((t) => t.overdue).length };
    }),
    inbox: (inbox.data ?? []).map((r: any) => ({ id: String(r.id), to: r.to?.display_name || "", time: shortTime(new Date(r.created_at)), text: r.body, kind: r.kind, seen: !!r.seen_at, reply: r.reply || "" })),
    reports: (reps.data ?? []).map((r) => ({ time: sheetTime(new Date(r.created_at)), name: name(r.employee_id), type: r.kind, msg: r.body, reply: r.reply || "" })),
    tasks: tasks.filter((t) => t.status !== "Done" || t.added >= since14).map(({ ownerId: _o, ...t }) => t),
    stores, statuses: ["To do", "In progress", "To check", "Daily", "Done"],
  };
}

/* ---------------- history ---------------- */
async function history(team: { key: string }, m: Emp, from: string, to: string) {
  const support = team.key === "support";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) fail("Pick both dates.");
  const a = dayStart(from).toISOString(), b = dayStart(addDays(to, 1)).toISOString();
  const [reps, evs, stats, fines, scores] = await Promise.all([
    db.from("reports").select("kind, body, reply, created_at").eq("employee_id", m.id).gte("created_at", a).lt("created_at", b),
    db.from("work_events").select("event, at, amount, status").eq("employee_id", m.id).gte("at", a).lt("at", b).not("event", "in", "(start,done)"),
    db.from("daily_stats").select("day, metric, value").eq("employee_id", m.id).gte("day", from).lte("day", to),
    db.from("fines").select("day, rule, ref, amount, unit, created_at").eq("employee_id", m.id).gte("day", from).lte("day", to),
    db.from("scores").select("day, score, why").eq("employee_id", m.id).gte("day", from).lte("day", to),
  ]);
  const names: Record<string, string> = { break_start: "Break start", break_end: "Break end", request_tickets: "Request tickets" };
  const items: { when: string; kind: string; text: string; reply: string }[] = [];
  for (const r of reps.data ?? []) items.push({ when: ymdhm(new Date(r.created_at)), kind: r.kind, text: r.body, reply: r.reply || "" });
  for (const e of evs.data ?? []) items.push({ when: ymdhm(new Date(e.at)), kind: names[e.event] || e.event, text: e.event === "request_tickets" ? `${e.amount} · ${e.status || "New"}` : "", reply: "" });
  for (const f of fines.data ?? []) items.push({ when: `${f.day} 23:58`, kind: "Fine", text: `${f.rule}${f.ref ? " · " + f.ref : ""} · ${f.amount} ${f.unit === "bdt" ? "৳" : f.unit}`, reply: "" });
  for (const s of scores.data ?? []) items.push({ when: `${s.day} 23:59`, kind: "Score", text: `${s.score}/10${s.why ? " · " + s.why : ""}`, reply: "" });
  let totals = null;
  if (support) {
    const days: Record<string, { m: number; c: number }> = {};
    for (const r of stats.data ?? []) {
      const d = (days[r.day] ??= { m: 0, c: 0 });
      if (r.metric === "messages_sent") d.m += Number(r.value);
      if (r.metric === "tickets_closed") d.c += Number(r.value);
    }
    for (const [d, v] of Object.entries(days)) items.push({ when: `${d} 23:57`, kind: "Day", text: `${v.m} messages · ${v.c} closed`, reply: "" });
    totals = { days: Object.keys(days).length, messages: Object.values(days).reduce((a, v) => a + v.m, 0), closed: Object.values(days).reduce((a, v) => a + v.c, 0) };
  }
  items.sort((x, y) => (x.when < y.when ? 1 : x.when > y.when ? -1 : 0));
  return { from, to, totals, items };
}

/* ---------------- writes ---------------- */
async function act(team: { id: number; key: string; name: string }, m: Emp, a: string, text: string, amount: unknown) {
  const support = team.key === "support";
  const t = stateOf((await todayEvents([m.id]))[m.id] ?? []);
  const o = await owner();
  const txt = String(text || "").trim().slice(0, 4000);
  const ev = (event: string, extra: Record<string, unknown> = {}) => db.from("work_events").insert({ employee_id: m.id, event, ...extra }).then(({ error }) => { if (error) throw error; });
  const rep = (kind: string, body: string) => db.from("reports").insert({ employee_id: m.id, kind, body: body || "(no note)" }).then(({ error }) => { if (error) throw error; });
  switch (a) {
    case "start":
      if (t.state !== "off") fail("You already started today.");
      await ev("start"); await rep("Start report", txt);
      await push([o.id], `${m.display_name} started`, txt.slice(0, 140), "/#breports");
      break;
    case "done":
      if (t.state === "off") fail("Start your day first.");
      if (t.state === "done") fail("You already finished today.");
      if (txt.length < 5) fail("Write what you did today and what is still pending.");
      if (t.state === "break") await ev("break_end");
      await ev("done"); await rep("End report", txt);
      await push([o.id], `${m.display_name} finished`, txt.slice(0, 140), "/#breports");
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
      await ev("request_tickets", { amount: n, status: "New" });
      await push([o.id], `${m.display_name} wants ${n} more tickets`, "", "/#team");
      break;
    }
    case "message": {
      if (!txt) fail("Write a message first.");
      const kind = ["Question", "Leave request", "Problem", "Update", "Other"].includes(String(amount)) ? String(amount) : "Question";
      await rep(kind, txt);
      await push([o.id], `${m.display_name} · ${kind}`, txt.slice(0, 140), "/#inbox");
      break;
    }
    default: fail("Unknown action.");
  }
}

async function setMyTask(m: Emp, row: number, status: string) {
  const { data: a } = await db.from("task_assignments").select("id").eq("task_id", row).eq("employee_id", m.id).is("ended_at", null).maybeSingle();
  if (!a) fail("That task is not yours.");
  if (!["In progress", "Done"].includes(status)) fail("Pick In progress or Done.");
  const u = unlabel(status);
  await db.from("tasks").update({ status: u.status, completed_at: status === "Done" ? new Date().toISOString() : null }).eq("id", row);
  await db.from("task_assignments").update({ ack: "responded", first_response_at: new Date().toISOString() }).eq("id", a!.id).is("first_response_at", null);
  await db.from("task_activity").insert({ task_id: row, actor_id: m.id, event: "status_changed", detail: { to: status } });
}

async function saveTask(team: { id: number }, o: Emp, t: Record<string, string>) {
  const title = String(t.task || "").trim().slice(0, 300);
  if (!title) fail("Write what needs to be done.");
  const people = await members(team.id);
  const ownerEmp = t.owner ? people.find((p) => p.display_name === t.owner) : null;
  if (t.owner && !ownerEmp) fail("Pick a person from the team.");
  const u = unlabel(t.status || "To do");
  const { data: store } = t.store ? await db.from("client_stores").select("id, client_id").eq("name", t.store).maybeSingle() : { data: null };
  const fields: Record<string, unknown> = {
    title, area: t.store || null, notes: String(t.notes || "").slice(0, 1000) || null, status: u.status,
    due_at: /^\d{4}-\d{2}-\d{2}$/.test(t.deadline || "") ? new Date(`${t.deadline}T22:00:00+06:00`).toISOString() : null,
    store_id: store?.id ?? null, completed_at: u.status === "completed" ? new Date().toISOString() : null,
  };
  if (u.recurrence !== undefined) fields.recurrence = u.recurrence;
  let id = Number(t.row) || 0, before: string | null = null;
  if (id) {
    const { data: cur } = await db.from("tasks").select("id, task_assignments(employee_id, ended_at)").eq("id", id).eq("team_id", team.id).maybeSingle();
    if (!cur) fail("Task not found.");
    before = (cur as any).task_assignments.find((x: any) => !x.ended_at)?.employee_id ?? null;
    const { error } = await db.from("tasks").update(fields).eq("id", id);
    if (error) throw error;
  } else {
    const { data, error } = await db.from("tasks").insert({ ...fields, team_id: team.id, kind: "store_management", created_by: o.id, requested_by_name: OWNER, client_id: store?.client_id ?? null }).select("id").single();
    if (error) throw error;
    id = data.id;
  }
  const now = new Date().toISOString();
  if ((ownerEmp?.id ?? null) !== before) {
    if (before) await db.from("task_assignments").update({ ended_at: now }).eq("task_id", id).is("ended_at", null);
    if (ownerEmp) {
      await db.from("task_assignments").insert({ task_id: id, employee_id: ownerEmp.id, assigned_by: o.id });
      await push([ownerEmp.id], "New task from " + OWNER, title.slice(0, 140) + (t.store ? " · " + t.store : ""), "/#tasks");
    }
  }
  await db.from("task_activity").insert({ task_id: id, actor_id: o.id, event: Number(t.row) ? "updated" : "created", detail: { status: t.status, owner: t.owner || null } });
}

async function sendInbox(team: { id: number }, o: Emp, to: string, text: string, kind: string) {
  const msg = String(text || "").trim().slice(0, 2000);
  if (!msg) fail("Write a message first.");
  const people = await members(team.id);
  const targets = to === "all" ? people : people.filter((p) => p.display_name === String(to || "").trim());
  if (!targets.length) fail("Pick a person.");
  const k = kind || "Message";
  const { error } = await db.from("inbox_messages").insert(targets.map((p) => ({ to_id: p.id, from_id: o.id, body: msg, kind: k })));
  if (error) throw error;
  await push(targets.map((p) => p.id), `${k} from ${OWNER}`, msg.slice(0, 140), "/#inbox");
}

async function changePin(team: { id: number }, name: string, oldPin: string, newPin: string, ip: string) {
  const who = name === OWNER ? await checkOwner(oldPin, ip) : await checkMember(team, name, oldPin, ip);
  const { data: res, error } = await db.rpc("pin_set", { p_employee: who.id, p_pin: newPin });
  if (error) throw error;
  const msg: Record<string, string> = {
    owner_pin_6_digits: "Your manager PIN must be 6 digits.", pin_4_digits: "Your PIN must be 4 digits.",
    pin_too_easy: "That PIN is too easy to guess. Pick another one.", pin_taken: "That PIN is already used. Pick another one.",
  };
  if (res !== "ok") fail(msg[res as string] || "Could not change the PIN.");
  await db.from("audit_logs").insert({ actor_id: who.id, table_name: "employee_pins", row_id: who.id, action: "update" });
  return { changed: true };
}

/* ---------------- router ---------------- */
async function route(teamKey: string, b: Record<string, any>, ip: string) {
  const team = await teamRow(teamKey);
  const n = String(b.name || "").trim(), p = String(b.pin || "").trim();
  switch (b.action) {
    case "login": {
      await tooMany(ip);
      const { data: id } = await db.rpc("pin_find", { p_pin: p });
      const { data: emp } = id ? await db.from("employees").select(EMP_COLS).eq("id", id).single() : { data: null };
      const e = emp as Emp | null;
      const ok = !!e && (e.role === "owner" || e.team_id === team.id);
      if (!ok) {
        // a teammate of the other team is not a failure for the counter
        if (!e) await logTry(null, false, ip);
        fail("Wrong PIN");
      }
      await logTry(e!.id, true, ip);
      const who: Record<string, unknown> = { role: e!.role === "owner" ? "owner" : "member", name: e!.display_name, team: team.name, support: team.key === "support" };
      if (b.withData) who.data = e!.role === "owner" ? await boss(team) : await me(team, e!);
      return who;
    }
    case "pinFree": {
      const { data: id } = await db.rpc("pin_find", { p_pin: p });
      return { free: !id };
    }
    case "changePin": return changePin(team, n, p, String(b.newPin || "").trim(), ip);
    case "info": return { team: team.name, support: team.key === "support", names: (await members(team.id)).map((x) => x.display_name), owner: OWNER };
    case "me": return me(team, await checkMember(team, n, p, ip));
    case "act": { const m = await checkMember(team, n, p, ip); await act(team, m, String(b.act || ""), b.text, b.amount); return me(team, m); }
    case "task": {
      const m = await checkMember(team, n, p, ip);
      await setMyTask(m, Number(b.row), String(b.status || ""));
      await push([(await owner()).id], `${n} updated a task`, `${b.status}: ${b.title || ""}`, "/#btasks");
      return me(team, m);
    }
    case "history": return history(team, await checkMember(team, n, p, ip), String(b.from || ""), String(b.to || ""));
    case "token": {
      const who = n === OWNER ? await checkOwner(p, ip) : await checkMember(team, n, p, ip);
      const token = String(b.token || "").trim();
      if (!token) fail("No token.");
      await db.from("push_tokens").upsert({ token, employee_id: who.id, device: String(b.device || "").slice(0, 120), app_address: String(b.origin || "").slice(0, 120), updated_at: new Date().toISOString() });
      return { saved: true };
    }
    case "reply": {
      const m = await checkMember(team, n, p, ip);
      const t = String(b.text || "").trim().slice(0, 2000);
      if (!t) fail("Write a reply first.");
      const now = new Date().toISOString();
      const { data } = await db.from("inbox_messages").update({ reply: t, replied_at: now, seen_at: now }).eq("id", Number(b.id)).eq("to_id", m.id).select("id");
      if (!data?.length) fail("Message not found.");
      await push([(await owner()).id], `${n} replied`, t.slice(0, 140), "/#bmsg");
      return me(team, m);
    }
    case "seen": {
      const m = await checkMember(team, n, p, ip);
      const ids = (Array.isArray(b.ids) ? b.ids : []).map(Number).filter(Boolean).slice(0, 50);
      if (ids.length) await db.from("inbox_messages").update({ seen_at: new Date().toISOString() }).in("id", ids).eq("to_id", m.id).is("seen_at", null);
      return { ok: true };
    }
    case "profile": {
      const m = await checkMember(team, n, p, ip);
      const u: Record<string, unknown> = {};
      if (b.photo !== undefined) {
        const ph = String(b.photo || "");
        if (ph && (!/^data:image\/(jpeg|png|webp);base64,/.test(ph) || ph.length > 45000)) fail("Photo is too big. Pick a smaller one.");
        u.photo_data = ph || null;
      }
      if (b.about !== undefined) u.about = String(b.about).slice(0, 300);
      if (b.skills !== undefined) u.skills = String(b.skills).slice(0, 200).split(",").map((s) => s.trim()).filter(Boolean);
      if (!m.joined_on) u.joined_on = ymd(new Date());
      if (Object.keys(u).length) await db.from("employees").update(u).eq("id", m.id);
      const { data: fresh } = await db.from("employees").select(EMP_COLS).eq("id", m.id).single();
      return me(team, fresh as Emp);
    }
    case "boss": await checkOwner(p, ip); return boss(team);
    case "send": { const o = await checkOwner(p, ip); await sendInbox(team, o, String(b.to || ""), b.text, b.kind); return boss(team); }
    case "saveTask": { const o = await checkOwner(p, ip); await saveTask(team, o, b.task || {}); return boss(team); }
    case "testPush": {
      const o = await checkOwner(p, ip);
      const to = b.to && b.to !== OWNER ? (await members(team.id)).find((x) => x.display_name === b.to) : o;
      return { sent: to ? await push([to.id], "Assistaa", "Notifications are working 🎉", "/") : 0 };
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
  let out: unknown;
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
  return new Response(JSON.stringify(out), { status: 200, headers: h });
});
