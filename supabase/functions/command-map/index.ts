// Assistaa · command-map
// Owner-only feed for the Map (team app tab and map.assistaa.com).
//   POST {pin}   -> {ok, token, data}   (PIN check + lockout, same rules as team-api; token lasts 8 h)
//   POST {token} -> {ok, data}          (session from an earlier PIN login)
//   POST {token, action:'ask_done', id}        -> marks a "Needs you" item done, returns fresh data
//   POST {token, action:'task', id, done:bool} -> ticks a Task Shield item, returns fresh data
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import postgres from "npm:postgres@3.4.5";
import { jwtVerify, SignJWT } from "npm:jose@5.9.6";

const sql = postgres(Deno.env.get("SUPABASE_DB_URL")!, { prepare: false, max: 2, idle_timeout: 60 });
const ORIGINS = ["https://team.assistaa.com", "https://atique00.github.io", "https://map.assistaa.com", "https://assistaa-map.vercel.app"];
class UserError extends Error {}
const fail = (m: string): never => { throw new UserError(m); };

async function sha(s: string) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(d)).map((x) => x.toString(16).padStart(2, "0")).join("");
}
let keyP: Promise<Uint8Array> | null = null;
const key = () => keyP ??= sha(Deno.env.get("SUPABASE_DB_URL")! + "|map-session-v1").then((h) => new TextEncoder().encode(h));

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
    const [o] = await sql`select id from public.employees where role = 'owner' and active limit 1`;
    let token: string | undefined;
    if (b.token) {
      try {
        const { payload } = await jwtVerify(String(b.token), await key(), { issuer: "assistaa-map" });
        if (payload.sub !== o.id) fail("expired");
      } catch (_e) { fail("Session expired. Sign in again."); }
    } else {
      if (b.action) fail("Sign in first.");
      const pin = String(b.pin || "");
      const ip = (await sha((req.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? "?") + "|assistaa")).slice(0, 32);
      const [lim] = await sql`select count(*) filter (where ip_hash = ${ip})::int mine, count(*)::int total
        from public.login_attempts where not ok and at > now() - interval '10 minutes'`;
      if (lim.mine >= 30 || lim.total >= 300) fail("Too many wrong PINs. Wait 10 minutes and try again.");
      const ok = /^\d{4,8}$/.test(pin) && (await sql`select public.pin_check(${o.id}::uuid, ${pin}) ok`)[0].ok === true;
      if (!ok) { await sql`insert into public.login_attempts (employee_id, ok, ip_hash) values (${o.id}, false, ${ip})`; fail("Wrong PIN"); }
      token = await new SignJWT({}).setProtectedHeader({ alg: "HS256" }).setSubject(o.id).setIssuer("assistaa-map").setIssuedAt().setExpirationTime("8h").sign(await key());
    }
    if (b.action === "ask_done") {
      const id = Number(b.id);
      if (!Number.isInteger(id) || id <= 0) fail("Bad item.");
      await sql`update public.os_asks set status = 'done', done_at = now() where id = ${id} and status = 'open'`;
    } else if (b.action === "task") {
      const id = String(b.id || "");
      if (!/^[a-z0-9_-]{1,32}$/i.test(id)) fail("Bad task.");
      const done = b.done === true;
      await sql`update public.os_tasks set done = ${done}, done_at = case when ${done} then now() else null end where id = ${id}`;
    } else if (b.action) fail("Unknown action.");
    const [{ m }] = await sql`select public.command_map() as m`;
    out = { ok: true, data: m };
    if (token) out.token = token;
  } catch (e) {
    if (!(e instanceof UserError)) console.error(e);
    out = { ok: false, error: e instanceof UserError ? e.message : "Something went wrong on the server." };
  }
  out.ms = Date.now() - t0;
  return new Response(JSON.stringify(out), { status: 200, headers: h });
});
