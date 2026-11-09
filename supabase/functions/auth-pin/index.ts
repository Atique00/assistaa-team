// Assistaa · auth-pin
// POST {action:"login", pin}            -> { session, me }      (no sign-in needed)
// POST {action:"change", pin, newPin}   -> { ok }               (needs the signed-in user's token)
// PINs are checked against bcrypt hashes in private.employee_pins. Each employee
// gets a hidden Supabase Auth user on first login; the session returned is a normal
// Supabase session, so Row Level Security applies to everything the app reads.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const URL_ = Deno.env.get("SUPABASE_URL")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const ALLOWED = ["https://team.assistaa.com", "https://atique00.github.io", "http://localhost:8080", "http://127.0.0.1:8080"];

const admin = createClient(URL_, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });

function cors(origin: string | null) {
  const o = origin && (ALLOWED.includes(origin) || origin.startsWith("http://localhost")) ? origin : ALLOWED[0];
  return {
    "Access-Control-Allow-Origin": o,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}
const json = (body: unknown, status: number, h: Record<string, string>) =>
  new Response(JSON.stringify(body), { status, headers: { ...h, "Content-Type": "application/json" } });

async function sha(s: string) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(d)).map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 32);
}

async function tooMany(ipHash: string) {
  const since = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  const [{ count: mine }, { count: all }] = await Promise.all([
    admin.from("login_attempts").select("id", { count: "exact", head: true }).eq("ok", false).eq("ip_hash", ipHash).gte("at", since),
    admin.from("login_attempts").select("id", { count: "exact", head: true }).eq("ok", false).gte("at", since),
  ]);
  return (mine ?? 0) >= 15 || (all ?? 0) >= 60;
}

async function ensureAuthUser(emp: { id: string; auth_user_id: string | null; display_name: string }) {
  const email = `emp-${emp.id}@pin.assistaa.com`;
  if (emp.auth_user_id) return email;
  const { data, error } = await admin.auth.admin.createUser({
    email, email_confirm: true, password: crypto.randomUUID() + crypto.randomUUID(),
    app_metadata: { employee_id: emp.id }, user_metadata: { name: emp.display_name },
  });
  if (error) throw error;
  await admin.from("employees").update({ auth_user_id: data.user.id }).eq("id", emp.id);
  return email;
}

async function sessionFor(email: string) {
  const { data, error } = await admin.auth.admin.generateLink({ type: "magiclink", email });
  if (error) throw error;
  const pub = createClient(URL_, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: v, error: e2 } = await pub.auth.verifyOtp({ token_hash: data.properties.hashed_token, type: "magiclink" });
  if (e2 || !v.session) throw e2 ?? new Error("no session");
  return v.session;
}

Deno.serve(async (req) => {
  const h = cors(req.headers.get("origin"));
  if (req.method === "OPTIONS") return new Response("ok", { headers: h });
  if (req.method !== "POST") return json({ error: "method" }, 405, h);

  let b: { action?: string; pin?: string; newPin?: string };
  try { b = await req.json(); } catch { return json({ error: "bad_json" }, 400, h); }
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? "?";
  const ipHash = await sha(ip + "|assistaa");

  try {
    if (b.action === "login") {
      const pin = String(b.pin ?? "");
      if (!/^\d{4}(\d{2})?$/.test(pin)) return json({ error: "wrong_pin" }, 401, h);
      if (await tooMany(ipHash)) return json({ error: "too_many_tries", wait_minutes: 10 }, 429, h);

      const { data: id, error } = await admin.rpc("pin_find", { p_pin: pin });
      if (error) throw error;
      await admin.from("login_attempts").insert({ employee_id: id ?? null, ok: !!id, ip_hash: ipHash });
      if (!id) return json({ error: "wrong_pin" }, 401, h);

      const { data: emp, error: e1 } = await admin.from("employees")
        .select("id, auth_user_id, display_name, role, team_id, teams:team_id(key,name)").eq("id", id).single();
      if (e1) throw e1;
      const email = await ensureAuthUser(emp);
      const session = await sessionFor(email);
      return json({
        session: { access_token: session.access_token, refresh_token: session.refresh_token, expires_at: session.expires_at },
        me: { id: emp.id, name: emp.display_name, role: emp.role, team: (emp as any).teams?.key ?? null },
      }, 200, h);
    }

    if (b.action === "change") {
      const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
      if (!token) return json({ error: "sign_in_first" }, 401, h);
      const { data: u, error: ue } = await admin.auth.getUser(token);
      if (ue || !u.user) return json({ error: "sign_in_first" }, 401, h);
      const { data: emp } = await admin.from("employees").select("id").eq("auth_user_id", u.user.id).single();
      if (!emp) return json({ error: "sign_in_first" }, 401, h);

      if (await tooMany(ipHash)) return json({ error: "too_many_tries", wait_minutes: 10 }, 429, h);
      const { data: who } = await admin.rpc("pin_find", { p_pin: String(b.pin ?? "") });
      if (who !== emp.id) {
        await admin.from("login_attempts").insert({ employee_id: emp.id, ok: false, ip_hash: ipHash });
        return json({ error: "old_pin_wrong" }, 401, h);
      }
      const { data: res, error } = await admin.rpc("pin_set", { p_employee: emp.id, p_pin: String(b.newPin ?? "") });
      if (error) throw error;
      if (res !== "ok") return json({ error: res }, 400, h);
      await admin.from("audit_logs").insert({ actor_id: emp.id, table_name: "employee_pins", row_id: emp.id, action: "update" });
      return json({ ok: true }, 200, h);
    }

    return json({ error: "unknown_action" }, 400, h);
  } catch (e) {
    console.error(e);
    return json({ error: "server_error" }, 500, h);
  }
});
