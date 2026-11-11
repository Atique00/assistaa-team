// Assistaa OS · workflow 02 · new website lead
// Called by the website_leads insert trigger with {id}. For a real (non-spam) lead:
// 1) finds or runs a Store X-Ray, 2) asks Claude to qualify it and draft a reply with a call offer,
// 3) saves the result on the lead (ai), 4) pushes a heads-up to the owner, 5) logs a run.
// Never emails the lead: Atiq sends the reply himself.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import postgres from "npm:postgres@3.4.5";
import { importPKCS8, SignJWT } from "npm:jose@5.9.6";

const sql = postgres(Deno.env.get("SUPABASE_DB_URL")!, { prepare: false, max: 2 });
const MODEL = "claude-sonnet-5-5";
const APP = "https://team.assistaa.com";

const KNOWLEDGE = `Assistaa: ecommerce support and operations agency (Bangladesh team, clients in 16+ countries) for Shopify dropshippers and DTC/fashion stores.
Services: customer support in the client's helpdesk; disputes and chargebacks (PayPal, Shopify Payments/Stripe, Klarna); product listings and store management; product research; ad creatives.
Proof: since 2019, 1,000,000+ tickets resolved, $2,000,000+ recovered in disputes, 300,000+ fashion products published; 100+ projects for 60+ clients, all five-star on Fiverr (125 reviews).
Pricing (pay for results, not hours): Support $300/month + per ticket $0.40 (first 2,000), $0.30 (to 10,000), $0.22 above. Disputes 20% of recovered, min $10, max $150 per case, no win no fee. Listings $0.65 standard, $2 premium, minimum 500/month. Creatives $5 each or 20 for $79.
Process: free 30-minute call with a plan, live within a week, month to month.
Voice: plain, confident, short sentences, numbers over adjectives, calm, never hype. Speak to the owner's pain (time, lost disputes, slow replies, messy listings). Sign off as Atiq, Founder, Assistaa.`;

async function fcmToken() {
  const raw = Deno.env.get("FIREBASE_SERVICE_ACCOUNT");
  if (!raw) return null;
  const sa = JSON.parse(raw);
  const key = await importPKCS8(sa.private_key, "RS256");
  const now = Math.floor(Date.now() / 1000);
  const jwt = await new SignJWT({ scope: "https://www.googleapis.com/auth/firebase.messaging" })
    .setProtectedHeader({ alg: "RS256", typ: "JWT" }).setIssuer(sa.client_email).setAudience("https://oauth2.googleapis.com/token")
    .setIssuedAt(now).setExpirationTime(now + 3600).sign(key);
  const r = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: jwt }) });
  return (await r.json()).access_token ?? null;
}
async function pushOwner(title: string, body: string) {
  const [o] = await sql`select id from public.employees where role='owner' and active limit 1`;
  await sql`insert into public.notifications (employee_id, kind, title, body, link) values (${o.id}, 'push', ${title}, ${body.slice(0, 500)}, '/#bmap')`;
  const tok = await fcmToken(); if (!tok) return 0;
  const project = JSON.parse(Deno.env.get("FIREBASE_SERVICE_ACCOUNT")!).project_id;
  let sent = 0;
  for (const t of await sql`select token, app_address from public.push_tokens where employee_id = ${o.id}`) {
    const r = await fetch(`https://fcm.googleapis.com/v1/projects/${project}/messages:send`, { method: "POST",
      headers: { Authorization: `Bearer ${tok}`, "Content-Type": "application/json" },
      body: JSON.stringify({ message: { token: t.token, data: { title, body: body.slice(0, 500), link: (t.app_address || APP) + "/#bmap" }, webpush: { headers: { Urgency: "high", TTL: "86400" } } } }) });
    if (r.ok) sent++; else if (r.status === 404) await sql`delete from public.push_tokens where token = ${t.token}`;
  }
  return sent;
}
const norm = (u: string | null) => (u || "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").split(/[/?#]/)[0];

async function xray(domain: string) {
  if (!domain || !domain.includes(".")) return null;
  const [hit] = await sql`select score, result from public.xray_scans where domain = ${domain} and created_at > now() - interval '7 days' order by created_at desc limit 1`;
  if (hit && hit.result) return { ...hit.result, score: hit.result.score ?? hit.score };
  try {
    const r = await fetch(`https://assistaa.com/api/xray?store=${encodeURIComponent(domain)}`, { signal: AbortSignal.timeout(25000) });
    const j = await r.json();
    return r.ok ? j : { error: j.error || `scan failed (${r.status})` };
  } catch (e) { return { error: "scan failed: " + String(e).slice(0, 120) }; }
}

Deno.serve(async (req) => {
  try {
    const { id } = JSON.parse((await req.text()) || "{}");
    if (!id) return Response.json({ ok: false, error: "no id" }, { status: 400 });
    const [lead] = await sql`select * from public.website_leads where id = ${id}`;
    if (!lead || lead.spam || lead.handled_at) return Response.json({ ok: true, skipped: true });
    await sql`update public.website_leads set handled_at = now() where id = ${id} and handled_at is null`;

    const domain = norm(lead.store_url);
    const xr = domain ? await xray(domain) : null;
    const xrText = !xr ? "No store URL given." : xr.error ? `X-Ray could not scan it: ${xr.error}` :
      `X-Ray score ${xr.score}/100. Top issues: ${(xr.issues || []).slice(0, 6).map((i: any) => `[${i.sev}/${i.area}] ${i.text}`).join(" | ")}` +
      (xr.google ? ` Google Merchant readiness ${xr.google.passed}/${xr.google.total}.` : "");

    const prompt = `${KNOWLEDGE}

A new lead came in through assistaa.com:
Name: ${lead.name}
Email: ${lead.email}
Store: ${lead.store_url || "(none)"}
Needs most: ${lead.need}
Their note: ${lead.note || "(none)"}
${xrText}

Return ONLY a JSON object with these keys:
"fit": "hot" | "warm" | "cold" (hot = real store with clear need we sell; cold = no store, wrong fit or unclear),
"summary": one sentence for Atiq: who this is and what they want,
"angle": one sentence: the strongest thing to lead with on the call,
"subject": email subject line,
"reply": the email reply from Atiq. Under 140 words. Thank them, show you looked at their store (mention 1-2 specific X-Ray findings if available, phrased helpfully), say how Assistaa would handle their need with the relevant price in one line, and offer a free 30-minute call asking for two times that suit them this week. Plain text, no markdown, sign off "Atiq\\nFounder, Assistaa".`;

    const key = Deno.env.get("ANTHROPIC_API_KEY");
    let ai: any = { fit: "warm", summary: `${lead.name} wants ${lead.need}`, angle: "", subject: "Your Assistaa request", reply: "" };
    if (key) {
      const r = await fetch("https://api.anthropic.com/v1/messages", { method: "POST",
        headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
        body: JSON.stringify({ model: MODEL, max_tokens: 1200, messages: [{ role: "user", content: prompt }] }) });
      const j = await r.json();
      const txt = (j.content || []).map((c: any) => c.text || "").join("");
      const m = txt.match(/\{[\s\S]*\}/);
      if (m) { try { ai = { ...ai, ...JSON.parse(m[0]) }; } catch (_) { ai.error = "could not read Claude's answer"; } }
      else ai.error = j.error?.message || "no answer from Claude";
    } else ai.error = "ANTHROPIC_API_KEY missing";
    if (!ai.reply) {
      const first = String(lead.name || "there").split(" ")[0];
      const top = xr && !xr.error ? (xr.issues || []).slice(0, 2).map((i: any) => i.text).join("; ") : "";
      const price = /dispute|charge/i.test(lead.need || "") ? "Disputes are 20% of what we recover (min $10, max $150 a case), so no win means no fee."
        : /list|catalog|product/i.test(lead.need || "") ? "Listings start at $0.65 each, with a 500 a month minimum."
        : "Support is $300 a month plus $0.40 per ticket, dropping as volume grows.";
      ai.subject = "Your Assistaa request";
      ai.reply = `Hi ${first},\n\nThanks for reaching out. ${top ? "I had a quick look at your store and noticed: " + top + ".\n\n" : ""}For ${lead.need || "what you described"}, here is how we would handle it: ${price} We have resolved over 1,000,000 tickets and recovered $2,000,000+ in disputes since 2019.\n\nWant a free 30-minute call this week? Send me two times that suit you and I will confirm one.\n\nAtiq\nFounder, Assistaa`;
      ai.template = true;
    }
    ai.xray = xr && !xr.error ? { score: xr.score, issues: (xr.issues || []).length, google: xr.google ? `${xr.google.passed}/${xr.google.total}` : null } : (xr ? { error: xr.error } : null);
    ai.at = new Date().toISOString();

    await sql`update public.website_leads set ai = ${sql.json(ai)} where id = ${id}`;
    const fit = String(ai.fit || "warm").toUpperCase();
    const sent = await pushOwner(`New lead · ${fit} · ${lead.need || "website"}`, `${ai.summary || lead.name}${domain ? " · " + domain : ""}${ai.xray?.score != null ? " · X-Ray " + ai.xray.score + "/100" : ""}. Reply draft ready in Map.`);
    await sql`insert into public.runs (agent, job, summary, data, needs_atiq)
      values ('lead-agent', ${`Lead qualified: ${fit}`}, ${`${lead.name} · ${lead.need}${domain ? " · " + domain : ""}. ${ai.summary || ""}`}, ${sql.json({ lead: id, fit: ai.fit, pushed_to: sent, error: ai.error || null })}, true)`;
    return Response.json({ ok: true, fit: ai.fit, sent });
  } catch (e) {
    console.log("lead-agent error", String(e));
    return Response.json({ ok: false, error: String(e) }, { status: 500 });
  }
});
