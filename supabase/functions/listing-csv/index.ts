// Assistaa · listing-csv  (Shopify product CSV generator for Atiq and Sabuj)
// Separate from team-api so it can change without touching the live team app backend.
//   POST /functions/v1/listing-csv   body (text/plain JSON): {action, name, pin, ...}
//   actions: csvAccess (name only: may this person use it?), csvList, csvStart, csvItem, csvFinish, csvGet
//   reply: {ok:true, data, ms} | {ok:false, error, ms}  — same contract as team-api
// Logins use the same PINs, lockout and login log as team-api.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import postgres from "npm:postgres@3.4.5";
import { csvTool } from "./csv.ts";

const sql = postgres(Deno.env.get("SUPABASE_DB_URL")!, { prepare: false, max: 3, idle_timeout: 60, connect_timeout: 10 });
const OWNER = "Atiq";
const ORIGINS = ["https://team.assistaa.com", "https://atique00.github.io"];
const MODEL = "claude-sonnet-5-5";

class UserError extends Error {}
const fail = (m: string): never => { throw new UserError(m); };

const settingsCache = new Map<string, { v: Promise<Record<string, any>>; exp: number }>();
function settings(scope: string) {
  const hit = settingsCache.get(scope);
  if (hit && hit.exp > Date.now()) return hit.v;
  const v = sql`select key, value from public.settings where scope in ('global', ${scope})`.then((rows) => {
    const s: Record<string, any> = {};
    for (const r of rows) s[r.key] = r.value;
    return s;
  });
  settingsCache.set(scope, { v, exp: Date.now() + 60_000 });
  return v;
}

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const fmt = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Dhaka", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });
function shortTime(d: Date) {
  const o: Record<string, string> = {};
  for (const p of fmt.formatToParts(new Date(d))) o[p.type] = p.value;
  return `${MON[+o.month - 1]} ${+o.day}, ${o.hour === "24" ? "00" : o.hour}:${o.minute}`;
}

/* -------- reading a web page (non-Shopify competitors) -------- */
const strip = (h: string) => h.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ")
  .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, " ").trim();
function safeUrl(u: string) {
  try {
    const x = new URL(u);
    if (!/^https?:$/.test(x.protocol)) return null;
    if (/^(localhost|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|\[?::1|0\.)/.test(x.hostname) || x.hostname.endsWith(".internal")) return null;
    return x;
  } catch { return null; }
}
async function readSupplier(url: string) {
  const u = safeUrl(url);
  if (!u) fail("That link does not look right.");
  const ctl = new AbortController(); const tm = setTimeout(() => ctl.abort(), 12000);
  let html = "";
  try {
    const r = await fetch(u!.toString(), { signal: ctl.signal, redirect: "follow", headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36",
      "Accept-Language": "en-US,en;q=0.9", Accept: "text/html,application/xhtml+xml" } });
    html = (await r.text()).slice(0, 1_500_000);
  } catch (_) { /* blocked or slow */ } finally { clearTimeout(tm); }
  const meta = (p: string) => html.match(new RegExp(`<meta[^>]+(?:property|name)=["']${p}["'][^>]*content=["']([^"']+)`, "i"))?.[1] ?? "";
  const imgs = new Set<string>();
  for (const k of ["og:image", "twitter:image"]) { const m = meta(k); if (m) imgs.add(m); }
  const ld: string[] = [];
  for (const m of html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    ld.push(m[1].slice(0, 6000));
    for (const i of m[1].matchAll(/"image"\s*:\s*\[?\s*"([^"]+)"/g)) imgs.add(i[1]);
  }
  for (const m of html.matchAll(/https?:\/\/[^"'\s)]+?\.(?:jpe?g|png|webp)/gi)) { if (imgs.size >= 12) break; if (!/sprite|icon|logo|avatar|flag|\d{2}x\d{2}\./i.test(m[0])) imgs.add(m[0]); }
  const title = meta("og:title") || html.match(/<title[^>]*>([^<]+)/i)?.[1] || "";
  return {
    host: u!.hostname, title: strip(title).slice(0, 300), description: strip(meta("og:description") || meta("description")).slice(0, 1500),
    jsonld: ld.join("\n").slice(0, 8000), text: strip(html).slice(0, 9000), images: [...imgs].map((x) => x.replace(/^\/\//, "https://")).slice(0, 12),
  };
}

/* -------- people and PINs (same rules as team-api) -------- */
type Emp = { id: string; display_name: string; role: string };
async function person(name: string): Promise<Emp> {
  const [e] = name === OWNER
    ? await sql`select id::text, display_name, role::text from public.employees where role = 'owner' and active limit 1`
    : await sql`select id::text, display_name, role::text from public.employees where display_name = ${name} and active and role <> 'owner' limit 1`;
  if (!e) fail("Unknown name");
  return e as Emp;
}
async function login(name: string, pin: string, ip: string) {
  const e = await person(name);
  const [lim] = await sql`select count(*) filter (where ip_hash = ${ip})::int mine, count(*)::int total
    from public.login_attempts where not ok and at > now() - interval '10 minutes'`;
  if (lim.mine >= 30 || lim.total >= 300) fail("Too many wrong PINs. Wait 10 minutes and try again.");
  const ok = /^\d{4,8}$/.test(pin) && (await sql`select public.pin_check(${e.id}::uuid, ${pin}) ok`)[0].ok === true;
  if (!ok) { await sql`insert into public.login_attempts (employee_id, ok, ip_hash) values (${e.id}, false, ${ip})`; fail("Wrong PIN"); }
  return e;
}
async function sha(s: string) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(d)).map((x) => x.toString(16).padStart(2, "0")).join("").slice(0, 32);
}

const csv = csvTool({ sql, fail, settings, readSupplier, safeUrl, shortTime, model: MODEL });

async function route(b: Record<string, any>, ip: string) {
  const name = String(b.name || "").trim(), pin = String(b.pin || "").trim();
  if (b.action === "csvAccess") {
    if (name === OWNER) return true;
    const s = await settings("store");
    return (Array.isArray(s.csv_tool_people) ? s.csv_tool_people : []).some((x: string) => String(x).toLowerCase() === name.toLowerCase());
  }
  const who = await login(name, pin, ip);
  switch (b.action) {
    case "csvList": return csv.list(who);
    case "csvStart": return csv.start(who, b);
    case "csvItem": return csv.item(who, b);
    case "csvFinish": return csv.finish(who, b);
    case "csvGet": return csv.get(who, b);
  }
  fail("Unknown action");
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
    const b = JSON.parse((await req.text()) || "{}");
    const ip = await sha((req.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? "?") + "|assistaa");
    out = { ok: true, data: await route(b, ip) };
  } catch (e) {
    if (!(e instanceof UserError)) console.error(e);
    out = { ok: false, error: e instanceof UserError ? e.message : "Something went wrong on the server." };
  }
  out.ms = Date.now() - t0;
  return new Response(JSON.stringify(out), { status: 200, headers: h });
});
