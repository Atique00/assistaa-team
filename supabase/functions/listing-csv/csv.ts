// Assistaa · Shopify product CSV generator (batch listing tool)
// Competitor product links -> one Shopify import CSV, following the "Shopify Product Batch" playbook (MODE B):
//   title "Unique name | Descriptive name", Caren HTML layout, Type = XXS, Shopify taxonomy category,
//   8–15 tags, SEO fields, all real variants and images, status draft, prices in the store currency.
// Used by Atiq and the people in setting store.csv_tool_people (Sabuj). Flow, driven by the app so no request runs long:
//   csvStart -> csvItem (one call per link, a few in parallel) -> csvFinish (builds the CSV) ; csvList / csvGet for history.
// Facts come only from the competitor page. Anything missing or unsure goes into the batch report, never into the copy.

type Dict = Record<string, any>;
type Deps = {
  sql: any;
  fail: (m: string) => never;
  settings: (scope: string) => Promise<Dict>;
  readSupplier: (url: string) => Promise<Dict>;
  safeUrl: (u: string) => URL | null;
  shortTime: (d: Date) => string;
  model: string;
};

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";
const LABELS: Record<string, [string, string, string]> = {
  English: ["Key Style Features", "Specifications", "Styling Suggestions"],
  German: ["Wichtige Style-Merkmale", "Spezifikationen", "Styling-Vorschläge"],
  Dutch: ["Belangrijkste stijlkenmerken", "Specificaties", "Stylingtips"],
};
const HEADERS = ["Title", "URL handle", "Description", "Vendor", "Product category", "Type", "Tags", "Published on online store", "Status",
  "SKU", "Option1 name", "Option1 value", "Option2 name", "Option2 value", "Option3 name", "Option3 value",
  "Price", "Compare-at price", "Charge tax", "Inventory tracker", "Inventory quantity", "Continue selling when out of stock",
  "Weight value (grams)", "Weight unit for display", "Requires shipping", "Fulfillment service",
  "Product image URL", "Image position", "Image alt text", "Variant image URL", "Gift card", "SEO title", "SEO description"];

const esc = (s: unknown) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const strip = (h: string) => String(h || "").replace(/<style[\s\S]*?<\/style>|<script[\s\S]*?<\/script>/gi, " ").replace(/<br\s*\/?>|<\/(p|li|div|h\d|tr)>/gi, "\n")
  .replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n").trim();
const cell = (v: unknown) => { const s = String(v ?? ""); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
const money = (n: number) => (Math.round(n * 100) / 100).toFixed(2);
const slug = (s: string) => String(s || "").toLowerCase().replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss")
  .normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80).replace(/-+$/, "");
const storeCode = (name: string) => { const w = name.replace(/[^A-Za-z ]/g, "").trim().split(/\s+/); return (w.length > 1 ? w.map((x) => x[0]).join("") : w[0].slice(0, 3)).toUpperCase().slice(0, 3); };

async function getJson(url: string, ms = 12000): Promise<any> {
  const ctl = new AbortController(); const tm = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(url, { signal: ctl.signal, redirect: "follow", headers: { "User-Agent": UA, Accept: "application/json" } });
    if (!r.ok) return null;
    const t = await r.text();
    return t.trim().startsWith("{") ? JSON.parse(t) : null;
  } catch { return null; } finally { clearTimeout(tm); }
}

/* -------- read a competitor product -------- */
async function readShopify(u: URL) {
  const m = u.pathname.match(/^(.*?)\/products\/([^/?#]+)/);
  if (!m) return null;
  const base = u.origin + m[1], handle = decodeURIComponent(m[2]);
  const [pj, js, meta] = await Promise.all([
    getJson(`${base}/products/${encodeURIComponent(handle)}.json`),
    getJson(`${base}/products/${encodeURIComponent(handle)}.js`),
    getJson(`${u.origin}/meta.json`, 8000),
  ]);
  const p = pj?.product;
  if (!p || !Array.isArray(p.variants)) return null;
  const avail = new Map<number, boolean>((js?.variants || []).map((v: any) => [v.id, !!v.available]));
  const imgById = new Map<number, string>((p.images || []).map((i: any) => [i.id, String(i.src || "").split("?")[0]]));
  const options = (p.options || []).map((o: any) => ({ name: String(o.name), values: (o.values || []).map(String) }));
  const variants = p.variants.map((v: any) => ({
    options: [v.option1, v.option2, v.option3].filter((x) => x != null).map(String),
    price: Number(v.price), compare_at: v.compare_at_price ? Number(v.compare_at_price) : null,
    grams: Number(v.grams) || 0, available: avail.has(v.id) ? avail.get(v.id) : null,
    image: v.image_id ? imgById.get(v.image_id) || "" : "",
    presentment: (v.presentment_prices || []).map((x: any) => ({ cur: x.price?.currency_code, price: Number(x.price?.amount), compare_at: x.compare_at_price?.amount ? Number(x.compare_at_price.amount) : null })),
  }));
  return {
    kind: "shopify", url: u.toString(), host: u.hostname, title: String(p.title || ""), text: strip(p.body_html || "").slice(0, 7000),
    product_type: String(p.product_type || ""), tags: String(p.tags || "").split(",").map((x: string) => x.trim()).filter(Boolean).slice(0, 25),
    options, variants, images: [...new Set((p.images || []).map((i: any) => String(i.src || "").split("?")[0]).filter(Boolean))].slice(0, 20) as string[],
    currency: String(p.variants[0]?.price_currency || meta?.currency || "").toUpperCase(),
  };
}
async function readProduct(d: Deps, url: string) {
  const u = d.safeUrl(url);
  if (!u) return { error: "Not a valid product link" };
  const s = await readShopify(u);
  if (s) return s;
  const page = await d.readSupplier(url).catch(() => null);
  if (!page || (!page.title && (page.text || "").length < 200)) return { error: "The page could not be read (blocked, removed or not a product page)" };
  const cur = (page.jsonld.match(/"priceCurrency"\s*:\s*"([A-Z]{3})"/) || [])[1] || "";
  return { kind: "page", url: u.toString(), host: u.hostname, title: page.title, text: `${page.description}\n${page.text}`.slice(0, 8000),
    jsonld: page.jsonld, images: page.images, currency: cur, options: [], variants: [] };
}

/* -------- prices -------- */
async function rate(d: Deps, batchId: number, from: string, to: string, fx: Dict) {
  const k = `${from}>${to}`;
  if (fx[k]) return fx[k];
  const j = await getJson(`https://api.frankfurter.dev/v1/latest?base=${from}&symbols=${to}`) || await getJson(`https://open.er-api.com/v6/latest/${from}`);
  const r = j?.rates?.[to];
  if (!r) return null;
  fx[k] = { rate: Number(r), date: j.date || (j.time_last_update_utc || "").slice(0, 16), source: j.base ? "ECB (frankfurter)" : "open.er-api.com" };
  await d.sql`update public.listing_batches set fx = coalesce(fx, '{}'::jsonb) || ${d.sql.json({ [k]: fx[k] })} where id = ${batchId}`;
  return fx[k];
}
const endPrice = (n: number, cur: string) => {
  if (!(n > 0)) return n;
  if (cur === "AUD") return Math.max(4.99, Math.round((n + 0.01) / 5) * 5 - 0.01); // x4.99 / x9.99
  return n < 2 ? n : Math.round(n) - 0.01;                                      // x.99
};

/* -------- copy from Claude -------- */
let baseCats: Promise<string> | null = null;
const baseCategories = (d: Deps) => baseCats ??= d.sql`select id, path from public.shopify_categories
  where id like 'aa-%' or id like 'hg-3-%' or id like 'hg-13-%' or id in ('hg-3', 'hg-13') order by id`
  .then((r: any[]) => r.map((x) => `${x.id} ${x.path}`).join("\n"));

function system(cats: string) {
  return `You are Assistaa's Shopify batch product-content specialist. You write one product at a time for a client store, from a competitor product page. Follow these rules exactly.

TITLE: "Unique Name | Descriptive Product Name" (exactly one " | "). The unique name is short, memorable, easy to read and is NOT the competitor's name.
- Fashion products (clothing, shoes, bags, jewelry, accessories worn by people): a human first name or collection-style name that suits the store's language and market (e.g. "Caren | Casual Women's Sandals"). Gender words only when they truly describe the product.
- Non-fashion products (decor, lighting, trees, wreaths, garlands, home accents, ornaments, gifts, gadgets): a neutral name inspired by the design, motif, light effect, material or purpose. NEVER a human first name, never "Men"/"Women". Examples: "Frostglow | Snow-Dusted Fairy Light Tree", "Hearthleaf | Decorative Olive Wreath", "Mooncrest | Crescent Pendant Necklace".
- The right-hand part says plainly what the product is. No clickbait, no superlatives you can't prove. Never copy the competitor title.

DESCRIPTION (you return the parts; the layout is built for you):
- heading: benefit-led, names the product, e.g. "Experience Effortless Summer Style with Caren".
- intro: 2–4 natural sentences: purpose, distinctive design, verified features, everyday use. Original wording, never the competitor's text.
- features: EXACTLY 5 specific, verified feature bullets.
- specs: only confirmed facts as "Label: value" (material, dimensions, care, power, fit, closure, style...). Leave out anything not in the source. Never write "unknown" or placeholders.
- styling: EXACTLY 3 practical styling, pairing, placement or occasion ideas.
- final_note: one short bold recommendation only if the source supports it (e.g. "Runs small – we recommend sizing up"), otherwise "".
FACTS: use ONLY what the source says or what the product images clearly show (e.g. colour). Never invent material, dimensions, batteries, waterproofing, medical/orthopedic claims, ratings, stock, delivery promises, discounts or variants. Do not mention the competitor, the source site, dropshipping or suppliers.

LANGUAGE: write title, description parts, tags, SEO title/description, image alt text and translated option names/values in the store's language, natively and naturally (not word-for-word). Sizes stay as they are (S, M, 38, EU 40...). Colours and option names are translated.

CATEGORY: choose the single best Shopify Standard Product Taxonomy category by its id, from the CANDIDATES in the message or from the BASE LIST below. Use the function of the product first. Pick the most specific correct one. Return its id exactly; if nothing fits, return "" and add "category needs review" to flags.

TAGS: 8–15 short, unique tags in the store's language grounded in the product: item, material (only if verified), colour (only if verified), style, placement, purpose, occasion. Never "XXS".
SEO: seo_title max 70 characters; seo_description 140–160 characters, natural, no keyword stuffing.
HANDLE: handle_words = the product's URL words in the store language, lowercase, hyphens, ASCII only, based on the descriptive name (e.g. "caren-casual-sandals").

Return ONLY one JSON object, no markdown:
{"product_kind":"fashion"|"non_fashion","unique_name":"","descriptive_name":"","handle_words":"","heading":"","intro":"","features":["","","","",""],"specs":[""],"styling":["","",""],"final_note":"","category_id":"","tags":[""],"seo_title":"","seo_description":"","image_alt":"",
"options":[{"name":"translated option name","values":{"original value":"translated value"}}],
"extracted":null,
"flags":["things the team must check before publishing"],"missing":["useful facts the source did not give"]}
"options" follows the source option order. For a page source (no Shopify data), also fill "extracted": {"options":["option names in source order"],"variants":[{"options":["values"],"price":number,"compare_at":number|null}],"currency":"ISO code or empty"} using ONLY prices and variants clearly present in the page's structured data or text; if prices are unclear use [] and flag it.

BASE LIST (id path):
${cats}`;
}

async function writeCopy(d: Deps, key: string, store: Dict, notes: string, src: Dict, cands: { id: string; path: string }[]) {
  const variantsTxt = (src.variants || []).slice(0, 60).map((v: Dict) => v.options.join(" / ") + (v.available === false ? " (sold out)" : "")).join("; ");
  const msg = `STORE: ${store.name} · language ${store.language} · currency ${store.currency}
${notes ? `INSTRUCTIONS FROM THE TEAM (follow them unless they break the rules): ${notes}\n` : ""}
SOURCE (${src.kind === "shopify" ? "Shopify product data" : "web page"}): ${src.url}
Title: ${src.title}
${src.product_type ? `Competitor product type: ${src.product_type}\n` : ""}${src.tags?.length ? `Competitor tags: ${src.tags.join(", ")}\n` : ""}Options: ${(src.options || []).map((o: Dict) => `${o.name}: ${o.values.join(", ")}`).join(" | ") || "none"}
${variantsTxt ? `Variants: ${variantsTxt}\n` : ""}Description text:
${src.text}
${src.jsonld ? `Structured data:\n${String(src.jsonld).slice(0, 6000)}\n` : ""}
CANDIDATES (id path):
${cands.map((c) => `${c.id} ${c.path}`).join("\n")}`;
  const imgs = (src.images || []).filter((u: string) => /^https:\/\//.test(u)).slice(0, 2);
  const call = (withImages: boolean) => fetch("https://api.anthropic.com/v1/messages", {
    method: "POST", headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model: d.model, max_tokens: 3500,
      system: [{ type: "text", text: system(baseCatsText), cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: [...(withImages ? imgs.map((u: string) => ({ type: "image", source: { type: "url", url: u } })) : []), { type: "text", text: msg }] }],
    }),
  });
  const baseCatsText = await baseCategories(d);
  let r = await call(imgs.length > 0);
  if (!r.ok && imgs.length && r.status === 400) r = await call(false);
  const j = await r.json();
  if (!r.ok) { console.log("csv ai error", r.status, JSON.stringify(j).slice(0, 300)); throw new Error(r.status === 401 ? "The AI key is not valid" : "The AI was busy – run this link again"); }
  const raw = (j.content || []).map((c: Dict) => c.text || "").join("");
  let out: Dict;
  try { out = JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1)); } catch { throw new Error("The AI answer was incomplete – run this link again"); }
  return { out, tin: (j.usage?.input_tokens ?? 0) + (j.usage?.cache_read_input_tokens ?? 0) + (j.usage?.cache_creation_input_tokens ?? 0), tout: j.usage?.output_tokens ?? 0 };
}

function html(c: Dict, imgs: string[], language: string) {
  const [lf, ls, lt] = LABELS[language] || LABELS.English;
  const img = (u: string) => `<div style="display: flex; justify-content: center;">\n  <img src="${esc(u)}" style="max-height: 500px; max-width: 500px;" width="400" height="400">\n</div>`;
  const ul = (xs: string[]) => `<ul>\n${xs.map((x) => `  <li>${esc(x)}</li>`).join("\n")}\n</ul>`;
  return [
    `<h3>${esc(c.heading)}</h3>`, `<p>${esc(c.intro)}</p>`, imgs[0] ? img(imgs[0]) : "",
    `<p><strong>${lf}</strong></p>`, ul(c.features), imgs[1] ? img(imgs[1]) : "",
    c.specs.length ? `<p><strong>${ls}</strong></p>\n${ul(c.specs)}` : "",
    `<p><strong>${lt}</strong></p>`, ul(c.styling), c.final_note ? `<p><strong>${esc(c.final_note)}</strong></p>` : "",
  ].filter(Boolean).join("\n");
}

/* -------- the tool -------- */
export function csvTool(d: Deps) {
  const { sql, fail } = d;
  async function allowed(who: Dict) {
    if (who.role === "owner") return;
    const s = await d.settings("store");
    const people = (Array.isArray(s.csv_tool_people) ? s.csv_tool_people : []).map((x: string) => String(x).toLowerCase());
    if (!people.includes(String(who.display_name).toLowerCase())) fail("The CSV generator is only for Atiq and Sabuj.");
  }
  async function stores() {
    const s = await d.settings("store");
    return { stores: (s.csv_stores || []) as Dict[], max: Number(s.csv_batch_max ?? 30) };
  }
  async function batchOf(who: Dict, id: number) {
    const [b] = await sql`select * from public.listing_batches where id = ${id}`;
    if (!b) fail("This batch was not found.");
    return b;
  }

  async function start(who: Dict, b: Dict) {
    await allowed(who);
    const { stores: list, max } = await stores();
    const store = list.find((x) => x.name === String(b.store || "")) as Dict;
    if (!store) fail("Choose a store.");
    const links = [...new Set(String(b.links || "").split(/\s+/).map((x) => x.trim()).filter(Boolean))];
    if (!links.length) fail("Paste at least one product link.");
    if (links.length > max) fail(`Up to ${max} links per batch. Split it into two batches.`);
    const bad = links.find((l) => !d.safeUrl(l));
    if (bad) fail(`Not a valid link: ${bad.slice(0, 60)}`);
    if (!Deno.env.get("ANTHROPIC_API_KEY")) fail("The AI key is missing. Atiq needs to add it.");
    const notes = String(b.notes || "").trim().slice(0, 1000);
    const [row] = await sql`insert into public.listing_batches (employee_id, store, language, currency, notes)
      values (${who.id}, ${store.name}, ${store.language}, ${store.currency}, ${notes || null}) returning id::int`;
    await sql`insert into public.listing_batch_items ${sql(links.map((url, i) => ({ batch_id: row.id, pos: i + 1, url })), "batch_id", "pos", "url")}`;
    return get(who, { id: row.id });
  }

  async function item(who: Dict, b: Dict) {
    await allowed(who);
    const batch = await batchOf(who, Number(b.id) || 0);
    const [it] = await sql`update public.listing_batch_items set status = 'working', error = null, updated_at = now()
      where batch_id = ${batch.id} and pos = ${Number(b.pos) || 0} and status <> 'done' returning *`;
    if (!it) fail("This link is already done.");
    try {
      const out = await buildItem(batch, it);
      await sql`update public.listing_batch_items set status = 'done', source = ${sql.json(out.source)}, output = ${sql.json(out.product)},
        tokens_in = ${out.tin}, tokens_out = ${out.tout}, updated_at = now() where id = ${it.id}`;
      await sql`update public.listing_batches set tokens_in = tokens_in + ${out.tin}, tokens_out = tokens_out + ${out.tout} where id = ${batch.id}`;
      return { pos: it.pos, status: "done", title: out.product.title, flags: out.product.flags.length };
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      await sql`update public.listing_batch_items set status = 'failed', error = ${m.slice(0, 300)}, updated_at = now() where id = ${it.id}`;
      return { pos: it.pos, status: "failed", error: m };
    }
  }

  async function buildItem(batch: Dict, it: Dict) {
    const key = Deno.env.get("ANTHROPIC_API_KEY")!;
    const src = await readProduct(d, it.url) as Dict;
    if (src.error) throw new Error(src.error);
    const cands = await sql`select id, path from public.category_candidates(${[src.title, src.product_type, (src.tags || []).join(" ")].join(" ").slice(0, 400)}, 40)`;
    const store = { name: batch.store, language: batch.language, currency: batch.currency };
    const { out: c, tin, tout } = await writeCopy(d, key, store, batch.notes || "", src, cands);
    const flags: string[] = (Array.isArray(c.flags) ? c.flags : []).map(String).filter(Boolean);
    const missing: string[] = (Array.isArray(c.missing) ? c.missing : []).map(String).filter(Boolean);

    // options and variants: Shopify data when we have it, otherwise what the AI read from the page
    let optNames: string[] = (src.options || []).map((o: Dict) => o.name);
    let variants: Dict[] = src.variants || [];
    let srcCur = String(src.currency || "");
    if (src.kind === "page") {
      const x = c.extracted || {};
      optNames = (x.options || []).map(String);
      variants = (x.variants || []).filter((v: Dict) => Number(v.price) > 0).map((v: Dict) => ({ options: (v.options || []).map(String), price: Number(v.price), compare_at: v.compare_at ? Number(v.compare_at) : null, grams: 0, available: null, image: "", presentment: [] }));
      srcCur = srcCur || String(x.currency || "").toUpperCase();
      flags.push("Not a Shopify store: variants and prices were read from the page – check them");
    }
    if (!variants.length) throw new Error("No price or variants could be verified on this page");
    if (optNames.length === 1 && /^title$/i.test(optNames[0]) && variants.length === 1) optNames = [];

    // translated option names and values (same order as the source)
    const tr: Dict[] = Array.isArray(c.options) ? c.options : [];
    const optNamesOut = optNames.map((n, i) => String(tr[i]?.name || n));
    const tv = (i: number, v: string) => String(tr[i]?.values?.[v] ?? v);

    // prices in the store currency
    const fx: Dict = batch.fx || {};
    const notes: string[] = [];
    let conv: Dict | null = null;
    if (!srcCur) flags.push(`Competitor currency unknown – prices copied as numbers, check them in ${batch.currency}`);
    else if (srcCur !== batch.currency) {
      const own = variants.every((v) => v.presentment?.some((p: Dict) => p.cur === batch.currency && p.price > 0));
      if (!own) {
        conv = await rate(d, batch.id, srcCur, batch.currency, fx);
        if (!conv) throw new Error(`Could not get today's ${srcCur}→${batch.currency} exchange rate – run this link again`);
        notes.push(`Converted from ${srcCur} at ${conv.rate} (${conv.source}, ${conv.date}) and rounded to ${batch.currency === "AUD" ? "x4.99/x9.99" : "x.99"}`);
      } else notes.push(`Competitor's own ${batch.currency} prices`);
    } else notes.push(`Competitor's own ${batch.currency} prices`);
    const priced = variants.map((v) => {
      const own = v.presentment?.find((p: Dict) => p.cur === batch.currency && p.price > 0);
      let price = own ? own.price : v.price, cmp = own ? own.compare_at : v.compare_at;
      if (!own && conv) { price = endPrice(v.price * conv.rate, batch.currency); cmp = v.compare_at ? endPrice(v.compare_at * conv.rate, batch.currency) : null; }
      if (cmp != null && !(cmp > price)) cmp = null;
      return { ...v, price, compare_at: cmp } as Dict;
    });
    const sold = variants.filter((v) => v.available === false).length;
    if (sold) flags.push(`${sold} of ${variants.length} variants are sold out on the competitor site`);

    // images, category, title
    const images: string[] = (src.images || []).filter((u: string) => /^https:\/\//.test(u));
    if (!images.length) flags.push("No product image found – add images before publishing");
    else if (images.length < 2) flags.push("Only one product image – the description shows one image");
    const [cat] = c.category_id ? await sql`select id, path from public.shopify_categories where id = ${String(c.category_id)}` : [];
    if (!cat) flags.push("Category needs review");
    const kind = c.product_kind === "non_fashion" ? "non_fashion" : "fashion";
    const title = `${String(c.unique_name || "").replace(/\|/g, "").trim()} | ${String(c.descriptive_name || "").replace(/\|/g, "").trim()}`;
    if (!c.unique_name || !c.descriptive_name) throw new Error("The AI did not return a complete title – run this link again");
    const feats = (c.features || []).map(String).filter(Boolean), styl = (c.styling || []).map(String).filter(Boolean);
    if (feats.length < 5) flags.push(`Only ${feats.length} verified features (5 expected)`);
    if (styl.length < 3) flags.push(`Only ${styl.length} styling suggestions (3 expected)`);
    const copy = { heading: c.heading, intro: c.intro, features: feats.slice(0, 5), specs: (c.specs || []).map(String).filter((x: string) => x && !/unknown|n\/a|not specified/i.test(x)), styling: styl.slice(0, 3), final_note: String(c.final_note || "") };
    const tags = [...new Set((c.tags || []).map((t: string) => String(t).replace(/,/g, " ").trim()).filter((t: string) => t && !/^xxs$/i.test(t)))].slice(0, 15);

    return {
      tin, tout,
      source: { kind: src.kind, host: src.host, title: src.title, currency: srcCur, options: src.options, variants: variants.length, images: images.length },
      product: {
        title, kind, handle: slug(c.handle_words || `${c.unique_name}-${c.descriptive_name}`) || slug(title),
        html: html(copy, images.slice(0, 2), batch.language), category: cat ? { id: cat.id, path: cat.path } : null,
        tags, seo_title: String(c.seo_title || "").slice(0, 70), seo_description: String(c.seo_description || "").slice(0, 320),
        alt: String(c.image_alt || title), images: images.slice(0, 20),
        options: optNamesOut,
        variants: priced.map((v) => ({ options: v.options.map((x: string, i: number) => tv(i, x)), price: v.price, compare_at: v.compare_at, grams: v.grams, image: v.image, available: v.available })),
        price_note: notes.join("; "), flags, missing,
      },
    };
  }

  async function finish(who: Dict, b: Dict) {
    await allowed(who);
    const batch = await batchOf(who, Number(b.id) || 0);
    const items = await sql`select pos, url, status, output, error from public.listing_batch_items where batch_id = ${batch.id} order by pos`;
    if (items.some((x: Dict) => x.status === "pending" || x.status === "working") && !b.force) fail("Some links are still running.");
    const done = items.filter((x: Dict) => x.status === "done" && x.output);
    if (!done.length) fail("No product could be created from these links.");
    const code = storeCode(batch.store), used = new Set<string>(), rows: string[][] = [];
    const blank = () => HEADERS.map(() => "");
    const set = (r: string[], h: string, v: unknown) => { r[HEADERS.indexOf(h)] = v == null ? "" : String(v); };
    for (const it of done) {
      const p = it.output as Dict;
      let h = p.handle || `product-${it.pos}`, n = 2;
      while (used.has(h)) h = `${p.handle}-${n++}`;
      used.add(h); p.handle_final = h;
      const n_rows = Math.max(p.variants.length, p.images.length);
      for (let i = 0; i < n_rows; i++) {
        const r = blank(); set(r, "URL handle", h);
        if (i === 0) {
          set(r, "Title", p.title); set(r, "Description", p.html); set(r, "Vendor", batch.store);
          set(r, "Product category", p.category?.id || ""); set(r, "Type", "XXS"); set(r, "Tags", p.tags.join(", "));
          set(r, "Published on online store", "true"); set(r, "Status", "draft"); set(r, "Gift card", "false");
          set(r, "SEO title", p.seo_title); set(r, "SEO description", p.seo_description);
        }
        const v = p.variants[i];
        if (v) {
          const names = p.options.length ? p.options : ["Title"], vals = p.options.length ? v.options : ["Default Title"];
          names.slice(0, 3).forEach((nm: string, k: number) => { if (i === 0) set(r, `Option${k + 1} name`, nm); set(r, `Option${k + 1} value`, vals[k] ?? ""); });
          set(r, "SKU", `${code}-${batch.id}-${it.pos}-${i + 1}`);
          set(r, "Price", money(v.price)); set(r, "Compare-at price", v.compare_at ? money(v.compare_at) : "");
          set(r, "Charge tax", "true"); set(r, "Continue selling when out of stock", "deny");
          if (v.grams > 0) { set(r, "Weight value (grams)", v.grams); set(r, "Weight unit for display", "g"); }
          set(r, "Requires shipping", "true"); set(r, "Fulfillment service", "manual"); set(r, "Variant image URL", v.image || "");
        }
        if (p.images[i]) { set(r, "Product image URL", p.images[i]); set(r, "Image position", i + 1); set(r, "Image alt text", p.alt); }
        rows.push(r);
      }
    }
    const csv = "\ufeff" + [HEADERS, ...rows].map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n";
    const report = {
      products: done.length, rows: rows.length, links: items.length, fx: batch.fx || {},
      items: items.map((x: Dict) => x.status === "done"
        ? { pos: x.pos, url: x.url, ok: true, title: x.output.title, handle: x.output.handle_final || x.output.handle, category: x.output.category?.path || "", variants: x.output.variants.length, images: x.output.images.length, price_note: x.output.price_note, flags: x.output.flags, missing: x.output.missing }
        : { pos: x.pos, url: x.url, ok: false, error: x.error || "Not run" }),
      always: ["Competitor images are linked from their store – confirm you may use them commercially",
        "Import with \"Overwrite products with matching handles\" left OFF so no existing product is changed",
        "All products import as Draft – review, then set Active"],
    };
    await sql`update public.listing_batches set status = 'done', csv = ${csv}, report = ${sql.json(report)}, products = ${done.length}, finished_at = now() where id = ${batch.id}`;
    return { id: batch.id, filename: fileName(batch), csv, report };
  }

  const fileName = (b: Dict) => `${slug(b.store)}-batch-${b.id}-${new Date(b.created_at).toISOString().slice(0, 10)}.csv`;

  async function get(who: Dict, b: Dict) {
    await allowed(who);
    const batch = await batchOf(who, Number(b.id) || 0);
    const items = await sql`select pos, url, status, error, output->>'title' title, jsonb_array_length(coalesce(output->'flags', '[]')) flags from public.listing_batch_items where batch_id = ${batch.id} order by pos`;
    return {
      id: batch.id, store: batch.store, language: batch.language, currency: batch.currency, notes: batch.notes || "", status: batch.status,
      time: d.shortTime(batch.created_at), filename: fileName(batch), csv: b.withCsv ? batch.csv : undefined, report: batch.report,
      items: items.map((x: Dict) => ({ pos: x.pos, url: x.url, status: x.status, error: x.error || "", title: x.title || "", flags: x.flags || 0 })),
    };
  }

  async function list(who: Dict) {
    await allowed(who);
    const rows = await sql`select b.id::int, b.store, b.status, b.products, b.created_at, e.display_name who,
      (select count(*)::int from public.listing_batch_items i where i.batch_id = b.id) links
      from public.listing_batches b join public.employees e on e.id = b.employee_id order by b.created_at desc limit 30`;
    return { ...(await stores()), batches: rows.map((r: Dict) => ({ id: r.id, store: r.store, status: r.status, products: r.products, links: r.links, who: r.who, time: d.shortTime(r.created_at) })) };
  }

  return { allowed, start, item, finish, get, list };
}
