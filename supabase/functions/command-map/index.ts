// Assistaa · command-map
// Owner-only feed for the Map tab: POST {pin} -> {ok, data: public.command_map()}
// Same PIN check and lockout rules as team-api (pin_check + login_attempts).
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import postgres from "npm:postgres@3.4.5";

const sql = postgres(Deno.env.get("SUPABASE_DB_URL")!, { prepare: false, max: 2, idle_timeout: 60 });
const ORIGINS = ["https://team.assistaa.com", "https://atique00.github.io"];
class UserError extends Error {}
const fail = (m: string): never => { throw new UserError(m); };

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
    const b = JSON.parse((await req.text()) || "{}");
    const pin = String(b.pin || "");
    const ip = await sha((req.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? "?") + "|assistaa");
    const [lim] = await sql`select count(*) filter (where ip_hash = ${ip})::int mine, count(*)::int total
      from public.login_attempts where not ok and at > now() - interval '10 minutes'`;
    if (lim.mine >= 30 || lim.total >= 300) fail("Too many wrong PINs. Wait 10 minutes and try again.");
    const [o] = await sql`select id from public.employees where role = 'owner' and active limit 1`;
    const ok = /^\d{4,8}$/.test(pin) && (await sql`select public.pin_check(${o.id}::uuid, ${pin}) ok`)[0].ok === true;
    if (!ok) { await sql`insert into public.login_attempts (employee_id, ok, ip_hash) values (${o.id}, false, ${ip})`; fail("Wrong PIN"); }
    const [{ m }] = await sql`select public.command_map() as m`;
    out = { ok: true, data: m };
  } catch (e) {
    if (!(e instanceof UserError)) console.error(e);
    out = { ok: false, error: e instanceof UserError ? e.message : "Something went wrong on the server." };
  }
  out.ms = Date.now() - t0;
  return new Response(JSON.stringify(out), { status: 200, headers: h });
});
