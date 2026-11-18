// Assistaa · tools-api  (backend of tools.assistaa.com)
//   POST /functions/v1/tools-api   Authorization: Bearer <Supabase session>   body {action, ...}
//     -> {ok:true, data} | {ok:false, error}
//   GET  /functions/v1/tools-api/shopify/install?s=<state>   one-click install link for a store owner
//   GET  /functions/v1/tools-api/shopify/callback            Shopify OAuth redirect (and app launch from the store admin)
// Who can use it: Supabase Auth users listed in public.tools_members (Atiq = owner). Owner-only: members, stores, deleting products.
// Store access: each store has its own "Assistaa Products" app (Shopify custom distribution = one store per app);
// client id in shop_connections, client secret and Admin API token in Supabase Vault. Products are created as DRAFT.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import postgres from "npm:postgres@3.4.5";
import { csvTool, money, storeCode } from "./csv.ts";

const sql = postgres(Deno.env.get("SUPABASE_DB_URL")!, { prepare: false, max: 3, idle_timeout: 60, connect_timeout: 10 });
const SUPA = Deno.env.get("SUPABASE_URL")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SITE = "https://tools.assistaa.com";
const FN = `${SUPA}/functions/v1/tools-api`;
const CALLBACK = `${FN}/shopify/callback`;
const API = "2026-10";
const SCOPES = "read_products,write_products,write_files";
const MODEL = "claude-sonnet-5-5";

type Dict = Record<string, any>;
class UserError extends Error {}
const fail = (m: string): never => { throw new UserError(m); };

/* ---------- small helpers ---------- */
const settingsCache = new Map<string, { v: Promise<Dict>; exp: number }>();
function settings(scope: string) {
  const hit = settingsCache.get(scope);
  if (hit && hit.exp > Date.now()) return hit.v;
  const v = sql`select key, value from public.settings where scope in ('global', ${scope})`.then((rows) => {
    const s: Dict = {};
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
const csv = csvTool({ sql, fail, settings, readSupplier, safeUrl, shortTime, model: MODEL });
const rnd = (n = 24) => Array.from(crypto.getRandomValues(new Uint8Array(n))).map((x) => x.toString(16).padStart(2, "0")).join("");
const esc = (s: unknown) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));

/* ---------- who is calling ---------- */
type Who = { id: string; email: string; display_name: string; role: "owner" | "member"; tools: true };
async function whoami(req: Request): Promise<Who> {
  const tok = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!tok) fail("Please log in.");
  const r = await fetch(`${SUPA}/auth/v1/user`, { headers: { apikey: ANON, Authorization: `Bearer ${tok}` } });
  if (!r.ok) fail("Your login has expired. Log in again.");
  const u = await r.json();
  const [m] = await sql`select name, role from public.tools_members where user_id = ${u.id} and active`;
  if (!m) fail("This account doesn't have access to Assistaa Tools.");
  return { id: u.id, email: u.email, display_name: m.name, role: m.role, tools: true };
}
const ownerOnly = (w: Who) => { if (w.role !== "owner") fail("Only Atiq can do this."); };

/* ---------- Supabase Auth admin (owner manages logins) ---------- */
async function authAdmin(path: string, method: string, body?: Dict) {
  const r = await fetch(`${SUPA}/auth/v1/admin/${path}`, { method, headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) fail(j.msg || j.message || j.error_description || "Could not update the login.");
  return j;
}
async function members() {
  return (await sql`select user_id::text id, email, name, role, active, created_at from public.tools_members order by created_at`)
    .map((m: Dict) => ({ id: m.id, email: m.email, name: m.name, role: m.role, active: m.active, since: shortTime(m.created_at) }));
}
async function memberAdd(b: Dict) {
  const email = String(b.email || "").trim().toLowerCase(), name = String(b.name || "").trim().slice(0, 60), pw = String(b.password || "");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail("Enter a valid email.");
  if (!name) fail("Enter a name.");
  if (pw.length < 8) fail("The password needs at least 8 characters.");
  const role = b.role === "owner" ? "owner" : "member";
  const [ex] = await sql`select id::text from auth.users where lower(email) = ${email}`;
  let id = ex?.id;
  if (id) await authAdmin(`users/${id}`, "PUT", { password: pw, email_confirm: true });
  else id = (await authAdmin("users", "POST", { email, password: pw, email_confirm: true, user_metadata: { name } })).id;
  await sql`insert into public.tools_members (user_id, email, name, role) values (${id}, ${email}, ${name}, ${role})
    on conflict (user_id) do update set name = excluded.name, role = excluded.role, active = true`;
  return members();
}

/* ---------- stores and their Shopify apps ---------- */
async function stores(): Promise<Dict[]> {
  const s = await settings("store");
  const list = (s.csv_stores || []) as Dict[];
  const con = await sql`select store, shop_domain, client_id, status, installed_at, secret_id is not null has_secret from public.shop_connections`;
  return list.map((x) => {
    const c = con.find((r: Dict) => r.store === x.name);
    return { ...x, shop: c?.shop_domain || "", connected: c?.status === "connected", pending: c?.status === "pending", has_app: !!(c?.client_id && c?.has_secret) };
  });
}
const shopOk = (s: string) => /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(s);
async function storeSave(w: Who, b: Dict) {
  ownerOnly(w);
  const store = String(b.store || ""), shop = String(b.shop || "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  if (!(await stores()).some((x) => x.name === store)) fail("Unknown store.");
  if (!shopOk(shop)) fail("Enter the store's .myshopify.com address, e.g. druhnn.myshopify.com");
  const cid = String(b.client_id || "").trim(), secret = String(b.client_secret || "").trim();
  if (!/^[a-f0-9]{20,64}$/i.test(cid)) fail("Paste the app's Client ID from the Dev Dashboard.");
  await sql`insert into public.shop_connections (store, shop_domain, client_id, status) values (${store}, ${shop}, ${cid}, 'pending')
    on conflict (store) do update set shop_domain = excluded.shop_domain, client_id = excluded.client_id,
      status = case when public.shop_connections.client_id = excluded.client_id and public.shop_connections.shop_domain = excluded.shop_domain then public.shop_connections.status else 'pending' end, updated_at = now()`;
  if (secret) await sql`select public.shop_secret_put(${store}, 'secret', ${secret})`;
  else { const [c] = await sql`select secret_id from public.shop_connections where store = ${store}`; if (!c?.secret_id) fail("Paste the app's Client secret too."); }
  return { stores: await stores(), link: await installLink(w, { store }) };
}
async function installLink(w: Who, b: Dict) {
  ownerOnly(w);
  const [c] = await sql`select store, shop_domain from public.shop_connections where store = ${String(b.store || "")}`;
  if (!c) fail("Add the store's app first.");
  const state = rnd(18);
  await sql`delete from public.shop_oauth_states where created_at < now() - interval '14 days'`;
  await sql`insert into public.shop_oauth_states (state, store, shop, created_by) values (${state}, ${c.store}, ${c.shop_domain}, ${w.id})`;
  return `${FN}/shopify/install?s=${state}`;
}
async function storeRemove(w: Who, b: Dict) {
  ownerOnly(w);
  await sql`update public.shop_connections set status = 'removed', updated_at = now() where store = ${String(b.store || "")}`;
  return stores();
}

/* Shopify tokens: {t: access token, r?: refresh token, e?: expiry ms} kept in Vault */
async function shopToken(store: string): Promise<{ shop: string; token: string }> {
  const [c] = await sql`select shop_domain, client_id, status from public.shop_connections where store = ${store}`;
  if (!c || c.status !== "connected") fail(`${store} isn't connected yet. Atiq can connect it under Stores.`);
  const [{ v }] = await sql`select public.shop_secret_get(${store}, 'token') v`;
  if (!v) fail(`${store} isn't connected yet.`);
  let tk: Dict; try { tk = JSON.parse(v); } catch { tk = { t: v }; }
  if (tk.e && tk.r && Date.now() > tk.e - 300_000) {
    const [{ v: secret }] = await sql`select public.shop_secret_get(${store}, 'secret') v`;
    const r = await fetch(`https://${c.shop_domain}/admin/oauth/access_token`, { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ client_id: c.client_id, client_secret: secret, grant_type: "refresh_token", refresh_token: tk.r }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.access_token) fail(`${store}: the store login expired. Atiq needs to reconnect it.`);
    tk = { t: j.access_token, r: j.refresh_token || tk.r, e: j.expires_in ? Date.now() + j.expires_in * 1000 : 0 };
    await sql`select public.shop_secret_put(${store}, 'token', ${JSON.stringify(tk)})`;
  }
  return { shop: c.shop_domain, token: tk.t };
}
async function gql(shop: string, token: string, query: string, variables: Dict) {
  const r = await fetch(`https://${shop}/admin/api/${API}/graphql.json`, { method: "POST",
    headers: { "content-type": "application/json", "X-Shopify-Access-Token": token }, body: JSON.stringify({ query, variables }) });
  const j = await r.json().catch(() => ({}));
  if (r.status === 401) fail("Shopify refused the store login. Atiq needs to reconnect the store.");
  if (r.status === 403) fail("Shopify blocked the request (403): check the app's IP allowlist and that it has the products permission.");
  if (!r.ok || j.errors) fail(`Shopify error: ${JSON.stringify(j.errors || j).slice(0, 200)}`);
  return j.data;
}

/* ---------- preview edits ---------- */
const H = (s: unknown, n: number) => String(s ?? "").trim().slice(0, n);
async function saveItem(w: Who, b: Dict) {
  const batch = await csv.batchOf(w, Number(b.id) || 0);
  const [it] = await sql`select id, output, shopify_product_id from public.listing_batch_items where batch_id = ${batch.id} and pos = ${Number(b.pos) || 0} and status = 'done'`;
  if (!it) fail("This product isn't ready.");
  if (it.shopify_product_id) fail("Already uploaded to the store. Edit it in Shopify, or ask Atiq to delete it there first.");
  const p = it.output as Dict, e = (b.patch || {}) as Dict;
  if (e.title != null) { const t = H(e.title, 255); if (!t) fail("The title can't be empty."); p.title = t; }
  if (e.html != null) p.html = String(e.html).slice(0, 60000).replace(/<script[\s\S]*?<\/script>/gi, "");
  if (e.tags != null) p.tags = [...new Set(String(e.tags).split(",").map((x) => x.trim()).filter(Boolean))].slice(0, 40);
  if (e.seo_title != null) p.seo_title = H(e.seo_title, 70);
  if (e.seo_description != null) p.seo_description = H(e.seo_description, 320);
  if (e.handle != null) { const h = String(e.handle).toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 120); if (!h) fail("The URL handle can't be empty."); p.handle = h; }
  if (e.category != null) {
    if (!e.category) p.category = null;
    else { const [c] = await sql`select id, path from public.shopify_categories where id = ${String(e.category)}`; if (!c) fail("Unknown category."); p.category = { id: c.id, path: c.path }; }
  }
  if (Array.isArray(e.images)) { const keep = new Set(p.images); p.images = e.images.filter((u: string) => keep.has(u)); }
  if (Array.isArray(e.options) && e.options.length === p.options.length) p.options = e.options.map((x: string, i: number) => H(x, 60) || p.options[i]);
  if (Array.isArray(e.variants) && e.variants.length === p.variants.length) {
    p.variants = p.variants.map((v: Dict, i: number) => {
      const n = e.variants[i] || {};
      const price = Number(n.price ?? v.price), cmp = n.compare_at === "" || n.compare_at == null ? null : Number(n.compare_at);
      if (!(price > 0)) fail(`Variant ${i + 1}: enter a price above 0.`);
      return { ...v, options: Array.isArray(n.options) ? n.options.map((x: string, k: number) => H(x, 60) || v.options[k]) : v.options,
        price: Math.round(price * 100) / 100, compare_at: cmp && cmp > price ? Math.round(cmp * 100) / 100 : null };
    });
  }
  if (Array.isArray(e.remove_variants) && e.remove_variants.length) {
    const drop = new Set(e.remove_variants.map(Number));
    const left = p.variants.filter((_: Dict, i: number) => !drop.has(i));
    if (!left.length) fail("Keep at least one variant.");
    p.variants = left;
  }
  await sql`update public.listing_batch_items set output = ${sql.json(p)}, edited_by = ${w.id}, edited_at = now() where id = ${it.id}`;
  return { output: p };
}

/* ---------- upload / delete in Shopify ---------- */
const CREATE = `mutation create($input: ProductSetInput!) { productSet(synchronous: true, input: $input) {
  product { id handle title status } userErrors { field message code } } }`;
async function upload(w: Who, b: Dict) {
  const batch = await csv.batchOf(w, Number(b.id) || 0);
  const [it] = await sql`select id, pos, output, shopify_product_id from public.listing_batch_items where batch_id = ${batch.id} and pos = ${Number(b.pos) || 0} and status = 'done'`;
  if (!it) fail("This product isn't ready.");
  if (it.shopify_product_id) return { pos: it.pos, product_id: it.shopify_product_id, already: true };
  const { shop, token } = await shopToken(batch.store);
  const p = it.output as Dict, code = storeCode(batch.store);
  const opts: string[] = p.options.length ? p.options : ["Title"];
  const vals = (v: Dict) => (p.options.length ? v.options : ["Default Title"]);
  const imgs: string[] = p.images || [];
  const file = (u: string) => ({ originalSource: u, alt: String(p.alt || p.title).slice(0, 500), contentType: "IMAGE" });
  const input: Dict = {
    title: p.title, descriptionHtml: p.html, vendor: batch.store, productType: "XXS", tags: p.tags, status: "DRAFT", handle: p.handle,
    seo: { title: p.seo_title || p.title, description: p.seo_description || "" },
    ...(p.category?.id ? { category: `gid://shopify/TaxonomyCategory/${p.category.id}` } : {}),
    productOptions: opts.map((n, i) => ({ name: n, values: [...new Set(p.variants.map((v: Dict) => String(vals(v)[i] ?? "")))].filter(Boolean).map((x) => ({ name: x })) })),
    files: imgs.map(file),
    variants: p.variants.map((v: Dict, i: number) => ({
      optionValues: opts.map((n, k) => ({ optionName: n, name: String(vals(v)[k] ?? "") })),
      price: money(v.price), ...(v.compare_at ? { compareAtPrice: money(v.compare_at) } : {}),
      sku: `${code}-${batch.id}-${it.pos}-${i + 1}`, taxable: true, inventoryPolicy: "DENY",
      inventoryItem: { tracked: false, requiresShipping: true, ...(v.grams > 0 ? { measurement: { weight: { value: v.grams, unit: "GRAMS" } } } : {}) },
      ...(v.image && imgs.includes(v.image) ? { file: file(v.image) } : {}),
    })),
  };
  let d = await gql(shop, token, CREATE, { input });
  let errs = d?.productSet?.userErrors || [];
  if (errs.some((x: Dict) => /handle/i.test(`${x.field} ${x.message}`))) {
    input.handle = `${p.handle}-${batch.id}${it.pos}`;
    d = await gql(shop, token, CREATE, { input });
    errs = d?.productSet?.userErrors || [];
  }
  const prod = d?.productSet?.product;
  if (errs.length || !prod) {
    const msg = errs.map((x: Dict) => `${(x.field || []).join(".")}: ${x.message}`).join("; ").slice(0, 400) || "Shopify did not create the product.";
    await sql`update public.listing_batch_items set upload_error = ${msg} where id = ${it.id}`;
    await sql`insert into public.shop_actions (user_id, store, action, title, batch_id, ok, error) values (${w.id}, ${batch.store}, 'create', ${p.title}, ${batch.id}, false, ${msg})`;
    return { pos: it.pos, error: msg };
  }
  const pid = String(prod.id).split("/").pop()!;
  await sql`update public.listing_batch_items set shopify_product_id = ${pid}, uploaded_at = now(), upload_error = null where id = ${it.id}`;
  await sql`insert into public.shop_actions (user_id, store, action, product_id, title, batch_id, ok) values (${w.id}, ${batch.store}, 'create', ${pid}, ${p.title}, ${batch.id}, true)`;
  return { pos: it.pos, product_id: pid, handle: prod.handle, admin_url: `https://${shop}/admin/products/${pid}` };
}
async function deleteProduct(w: Who, b: Dict) {
  ownerOnly(w);
  const batch = await csv.batchOf(w, Number(b.id) || 0);
  const [it] = await sql`select id, output->>'title' title, shopify_product_id pid from public.listing_batch_items where batch_id = ${batch.id} and pos = ${Number(b.pos) || 0}`;
  if (!it?.pid) fail("This product isn't in the store.");
  const { shop, token } = await shopToken(batch.store);
  const d = await gql(shop, token, `mutation del($input: ProductDeleteInput!) { productDelete(input: $input) { deletedProductId userErrors { field message } } }`,
    { input: { id: `gid://shopify/Product/${it.pid}` } });
  const errs = d?.productDelete?.userErrors || [];
  const gone = errs.length === 0 || errs.some((x: Dict) => /not exist|not found/i.test(x.message));
  await sql`insert into public.shop_actions (user_id, store, action, product_id, title, batch_id, ok, error) values (${w.id}, ${batch.store}, 'delete', ${it.pid}, ${it.title}, ${batch.id}, ${gone}, ${gone ? null : JSON.stringify(errs).slice(0, 300)})`;
  if (!gone) fail(`Shopify did not delete it: ${errs.map((x: Dict) => x.message).join("; ")}`);
  await sql`update public.listing_batch_items set shopify_product_id = null, uploaded_at = null where id = ${it.id}`;
  return { pos: Number(b.pos) };
}
async function activity() {
  return (await sql`select a.store, a.action, a.product_id, a.title, a.ok, a.error, a.at, m.name from public.shop_actions a left join public.tools_members m on m.user_id = a.user_id order by a.at desc limit 60`)
    .map((r: Dict) => ({ store: r.store, action: r.action, product_id: r.product_id || "", title: r.title || "", ok: r.ok, error: r.error || "", who: r.name || "?", time: shortTime(r.at) }));
}

/* ---------- Shopify OAuth (install link + callback) ---------- */
async function hmacOk(params: URLSearchParams, secret: string) {
  const given = params.get("hmac") || "";
  const msg = [...params.entries()].filter(([k]) => k !== "hmac" && k !== "signature").sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join("&");
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = Array.from(new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(msg)))).map((x) => x.toString(16).padStart(2, "0")).join("");
  return sig.length === given.length && sig === given.toLowerCase();
}
const page = (title: string, body: string, ok = true) => new Response(
  `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title>
  <body style="font-family:system-ui,sans-serif;background:#05070d;color:#e8eef7;display:grid;place-items:center;min-height:100vh;margin:0">
  <div style="max-width:420px;padding:28px;border-radius:18px;background:#0d1320;border:1px solid #1f2a3c;text-align:center">
  <div style="font-size:40px">${ok ? "✅" : "⚠️"}</div><h2 style="margin:8px 0">${esc(title)}</h2><p style="color:#9fb0c8;line-height:1.5">${body}</p>
  <a href="${SITE}/#stores" style="color:#38bdf8">Open Assistaa Tools</a></div></body>`, { status: ok ? 200 : 400, headers: { "content-type": "text/html; charset=utf-8" } });
async function authorizeUrl(store: string, shop: string) {
  const [c] = await sql`select client_id from public.shop_connections where store = ${store}`;
  const state = rnd(18);
  await sql`insert into public.shop_oauth_states (state, store, shop) values (${state}, ${store}, ${shop})`;
  return `https://${shop}/admin/oauth/authorize?client_id=${encodeURIComponent(c.client_id)}&scope=${SCOPES}&redirect_uri=${encodeURIComponent(CALLBACK)}&state=${state}`;
}
async function shopifyGet(url: URL) {
  const q = url.searchParams;
  if (url.pathname.endsWith("/shopify/install")) {
    const [s] = await sql`select store, shop from public.shop_oauth_states where state = ${q.get("s") || ""} and created_at > now() - interval '14 days'`;
    if (!s) return page("Link expired", "Ask Atiq for a new install link.", false);
    await sql`delete from public.shop_oauth_states where state = ${q.get("s") || ""}`;
    return Response.redirect(await authorizeUrl(s.store, s.shop), 302);
  }
  if (!url.pathname.endsWith("/shopify/callback")) return page("Not found", "", false);
  const shop = String(q.get("shop") || "").toLowerCase();
  if (!shopOk(shop)) return page("Something is wrong", "The store address is missing.", false);
  const [c] = await sql`select store, client_id, status from public.shop_connections where shop_domain = ${shop}`;
  if (!c) return page("Store not set up", "Atiq needs to add this store's app in Assistaa Tools first.", false);
  const [{ v: secret }] = await sql`select public.shop_secret_get(${c.store}, 'secret') v`;
  if (!secret || !(await hmacOk(q, secret))) return page("Request not verified", "Shopify's signature did not match. Try the install link again.", false);
  const code = q.get("code");
  if (!code) {
    // opened from the store admin or installed from the Dev Dashboard: start (or skip) the authorization
    if (c.status === "connected") return Response.redirect(`${SITE}/#stores`, 302);
    return Response.redirect(await authorizeUrl(c.store, shop), 302);
  }
  const [st] = await sql`delete from public.shop_oauth_states where state = ${q.get("state") || ""} and shop = ${shop} returning store`;
  if (!st || st.store !== c.store) return page("Link expired", "Ask Atiq for a new install link.", false);
  const r = await fetch(`https://${shop}/admin/oauth/access_token`, { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ client_id: c.client_id, client_secret: secret, code }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) return page("Shopify said no", `Could not finish connecting ${esc(c.store)}. ${esc(j.error_description || j.error || "")}`, false);
  const scopes = String(j.scope || "");
  await sql`select public.shop_secret_put(${c.store}, 'token', ${JSON.stringify({ t: j.access_token, r: j.refresh_token || "", e: j.expires_in ? Date.now() + j.expires_in * 1000 : 0 })})`;
  await sql`update public.shop_connections set status = 'connected', scopes = ${scopes}, installed_at = now(), updated_at = now() where store = ${c.store}`;
  if (!scopes.includes("write_products")) return page(`${c.store} connected, but…`, "The app did not get the products permission. In the Dev Dashboard, add write_products, release a new version and reinstall.", false);
  return page(`${c.store} is connected`, "Assistaa Tools can now add products to this store as drafts. You can close this page.");
}

/* ---------- router ---------- */
async function route(req: Request, b: Dict) {
  if (b.action === "bootstrap") {
    // first owner login only: needs the one-time TOOLS_BOOTSTRAP secret and works only while no owner exists
    const code = Deno.env.get("TOOLS_BOOTSTRAP") || "";
    if (!code || req.headers.get("x-bootstrap") !== code) fail("Not allowed.");
    const [o] = await sql`select 1 from public.tools_members where role = 'owner' and active`;
    if (o) fail("An owner already exists.");
    return memberAdd({ ...b, role: "owner" });
  }
  const w = await whoami(req);
  switch (b.action) {
    case "me": return { name: w.display_name, email: w.email, role: w.role };
    case "stores": return stores();
    case "list": return csv.list(w);
    case "start": return csv.start(w, b);
    case "item": return csv.item(w, b);
    case "finish": return csv.finish(w, b);
    case "get": return csv.get(w, { ...b, full: true });
    case "save": return saveItem(w, b);
    case "upload": return upload(w, b);
    case "deleteProduct": return deleteProduct(w, b);
    case "activity": return activity();
    case "categories": {
      const q = String(b.q || "").trim().slice(0, 80);
      if (q.length < 2) return [];
      return sql`select id, path from public.shopify_categories where path ilike ${"%" + q + "%"} order by depth, path limit 30`;
    }
    case "members": ownerOnly(w); return members();
    case "memberAdd": ownerOnly(w); return memberAdd(b);
    case "memberActive": {
      ownerOnly(w);
      if (b.id === w.id) fail("You can't switch off your own login.");
      await sql`update public.tools_members set active = ${!!b.active} where user_id = ${String(b.id)}::uuid`;
      return members();
    }
    case "storeSave": return storeSave(w, b);
    case "storeLink": return { link: await installLink(w, b) };
    case "storeRemove": return storeRemove(w, b);
  }
  fail("Unknown action");
}

const ORIGIN_OK = (o: string) => /^https:\/\/([a-z0-9-]+\.)*assistaa\.com$/.test(o) || /^https:\/\/assistaa-tools[a-z0-9-]*\.vercel\.app$/.test(o) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(o);
Deno.serve(async (req) => {
  const url = new URL(req.url);
  if (req.method === "GET" && url.pathname.includes("/shopify/")) {
    try { return await shopifyGet(url); } catch (e) { console.error(e); return page("Something went wrong", e instanceof UserError ? e.message : "Try the link again in a minute.", false); }
  }
  const origin = req.headers.get("origin") || "";
  const h = { "Access-Control-Allow-Origin": ORIGIN_OK(origin) ? origin : SITE, "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info",
    "Access-Control-Allow-Methods": "POST, OPTIONS", Vary: "Origin", "Content-Type": "application/json" };
  if (req.method === "OPTIONS") return new Response("ok", { headers: h });
  let out: Dict;
  try {
    if (req.method !== "POST") fail("Use POST.");
    out = { ok: true, data: await route(req, JSON.parse((await req.text()) || "{}")) };
  } catch (e) {
    if (!(e instanceof UserError)) console.error(e);
    out = { ok: false, error: e instanceof UserError ? e.message : "Something went wrong on the server." };
  }
  return new Response(JSON.stringify(out), { status: 200, headers: h });
});
