// Assistaa Store X-Ray: scans a store using only public pages and public Shopify JSON.
// GET /api/xray?store=example.com
const crypto = require('crypto');

const UA = 'AssistaaXRay/1.0 (+https://assistaa.com/#xray)';
const SB_URL = 'https://zciuchdximmzwiisdkqu.supabase.co';
const SB_KEY = 'sb_publishable_WMggW823F5JaQWI5tZUn3A_2RCcqKcA';
const MAX_PER_HOUR = 12;

// ---------- helpers ----------
function normDomain(input) {
  let s = String(input || '').trim().toLowerCase();
  s = s.replace(/^[a-z]+:\/\//, '').replace(/[\/?#].*$/, '').replace(/:\d+$/, '').replace(/\.$/, '');
  if (!/^(?=.{4,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(s)) return null;
  if (/^\d+\.\d+\.\d+\.\d+$/.test(s)) return null;
  if (/(^|\.)(localhost|local|internal|lan|home|corp|intranet|vercel\.app)$/.test(s)) return null;
  return s;
}

async function get(url, ms = 7000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  const t0 = Date.now();
  try {
    const r = await fetch(url, { headers: { 'user-agent': UA, accept: '*/*' }, redirect: 'follow', signal: ctl.signal });
    const text = await r.text();
    return { ok: r.ok, status: r.status, url: r.url, text: text.slice(0, 3_000_000), ms: Date.now() - t0, headers: r.headers };
  } catch (e) {
    return { ok: false, status: 0, url, text: '', ms: Date.now() - t0, error: String(e && e.name || e) };
  } finally { clearTimeout(t); }
}

function json(text) { try { return JSON.parse(text); } catch { return null; } }
function strip(html) {
  return String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&[a-z#0-9]+;/gi, ' ')
    .replace(/\s+/g, ' ').trim();
}
function words(t) { return t ? t.split(/\s+/).filter(Boolean).length : 0; }
function np(n, one, many) { return `${n} ${n === 1 ? one : many}`; }
function pct(a, b) { return b ? Math.round((a / b) * 100) : 0; }
function has(re, s) { return re.test(s || ''); }
function attr(html, re) { const m = (html || '').match(re); return m ? m[1].trim() : ''; }

// Shopify policy pages render inside the theme; pull the policy body when we can.
function policyText(page) {
  if (!page || !page.ok) return '';
  const m = page.text.match(/<div[^>]+class="[^"]*(?:shopify-policy__body|rte)[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<\/div>/i);
  return strip(m ? m[1] : page.text);
}

const APPS = {
  reviews: /judge\.me|judgeme|loox\.io|okendo|yotpo|stamped\.io|reviews\.io|junip|product-reviews|reviewsio|trustpilot|ali-reviews|rivyo|air-reviews|kudobuzz/i,
  chat: /gorgias|tidio|zendesk|zdassets|intercom|crisp\.chat|tawk\.to|richpanel|reamaze|commslayer|shopify-chat|shopify_chat|inbox\.shopify|freshchat|livechatinc|helpscout|chatra|re:amaze|delightchat|willdesk/i,
  email: /klaviyo|omnisend|privy|mailchimp|chimpstatic|contact\[tags\][^>]*newsletter|form_type"? value="customer"|newsletter|sendlane|drip\.com|attentive|postscript/i,
  sizing: /kiwisizing|kiwi-sizing|size-chart|sizechart|size_chart|sizeguide|size-guide|esc-size|ilm-size|virtusize|truefit/i,
};
const SIZE_IN_TEXT = /size\s*(chart|guide)|sizing|measurement|bust|waist|hip|chest|inseam|shoulder|\b(cm|inch|inches)\b/i;

// ---------- scan ----------
async function scan(domain) {
  const t0 = Date.now();
  const issues = [];
  const passed = [];
  const add = (sev, area, text) => issues.push({ sev, area, text });

  const home = await get(`https://${domain}/`, 8000);
  if (!home.ok) {
    return { error: home.status ? `The store answered with status ${home.status}. It may be password protected or blocking scans.` : 'We could not reach that store. Check the address and try again.' };
  }
  const origin = new URL(home.url).origin;
  const html = home.text;
  const shopify = /cdn\.shopify\.com|Shopify\.theme|shopify-section|myshopify\.com/i.test(html) || !!home.headers.get('x-shopid') || /shopify/i.test(home.headers.get('powered-by') || '');

  const [prodRes, refund, shipping, privacy, terms, contact] = await Promise.all([
    shopify ? get(`${origin}/products.json?limit=250`) : Promise.resolve(null),
    get(`${origin}/policies/refund-policy`),
    get(`${origin}/policies/shipping-policy`),
    get(`${origin}/policies/privacy-policy`),
    get(`${origin}/policies/terms-of-service`),
    get(`${origin}/pages/contact`),
  ]);

  // ---- Policies ----
  const refundT = policyText(refund), shipT = policyText(shipping);
  if (!refund.ok || words(refundT) < 40) add('hi', 'Policies', 'No refund policy page found. Missing policies are a common reason PayPal and card disputes are lost.');
  else if (!/\b\d{1,3}\s*(-|–|to)?\s*\d{0,3}\s*(calendar |business |working )?(day|days|week|weeks)\b/i.test(refundT)) add('hi', 'Policies', 'Refund policy gives no clear timeframe (for example "30 days"), a common trigger for disputes.');
  else passed.push('Refund policy with a clear timeframe');

  if (!shipping.ok || words(shipT) < 30) add('hi', 'Policies', 'No shipping policy page found. Customers and payment processors look for delivery times.');
  else if (!/\b\d{1,2}\s*(-|–|to)\s*\d{1,2}\s*(business |working )?(day|days)\b|\b\d{1,2}\+?\s*(business |working )?days\b/i.test(shipT)) add('md', 'Policies', 'Shipping policy does not state delivery times in days.');
  else passed.push('Shipping policy states delivery times');

  if (!privacy.ok) add('md', 'Policies', 'No privacy policy page found.'); else passed.push('Privacy policy');
  if (!terms.ok) add('lo', 'Policies', 'No terms of service page found.'); else passed.push('Terms of service');

  // ---- Support ----
  if (!APPS.chat.test(html)) add('md', 'Support', 'No live chat or help desk widget found on the homepage.');
  else passed.push('Live chat or help desk widget');
  if (!contact.ok) add('md', 'Support', 'No contact page at /pages/contact.');
  else {
    const ct = strip(contact.text);
    if (!/within\s+\d+|\d+\s*(-|–|to)?\s*\d*\s*(hours|hrs|business days)|24\s*\/\s*7|same day/i.test(ct)) add('md', 'Support', 'Contact page shows no expected response time.');
    else passed.push('Contact page with response time');
  }

  // ---- Trust and marketing ----
  if (!APPS.reviews.test(html)) add('md', 'Trust', 'No product reviews app detected on the homepage.');
  else passed.push('Product reviews app');
  if (!APPS.email.test(html)) add('lo', 'Marketing', 'No email signup or email marketing tool detected.');
  else passed.push('Email signup');

  // ---- SEO basics ----
  const title = strip(attr(html, /<title[^>]*>([\s\S]*?)<\/title>/i));
  const desc = attr(html, /<meta[^>]+name=["']description["'][^>]*content=["']([^"']*)["']/i) || attr(html, /<meta[^>]+content=["']([^"']*)["'][^>]*name=["']description["']/i);
  const ogImg = /<meta[^>]+property=["']og:image["']/i.test(html);
  if (!title) add('md', 'SEO', 'Homepage has no title tag.');
  else if (title.length > 70) add('lo', 'SEO', `Homepage title is ${title.length} characters; Google shows about 60.`);
  else passed.push('Homepage title');
  if (!desc) add('md', 'SEO', 'Homepage has no meta description for Google results.');
  else passed.push('Homepage meta description');
  if (!ogImg) add('lo', 'SEO', 'No social share image (og:image), so links look bare on Facebook and WhatsApp.');

  // ---- Speed ----
  const scripts = (html.match(/<script[^>]+src=/gi) || []).length;
  const kb = Math.round(Buffer.byteLength(html) / 1024);
  if (home.ms > 3000) add('md', 'Speed', `Homepage took ${(home.ms / 1000).toFixed(1)}s to load its HTML.`);
  if (scripts > 40) add('md', 'Speed', `${scripts} scripts load on the homepage; extra apps slow every page.`);
  else if (scripts > 25) add('lo', 'Speed', `${scripts} scripts load on the homepage; worth checking for unused apps.`);
  if (kb > 700) add('lo', 'Speed', `Homepage HTML is ${kb} KB, which is heavy.`);
  if (home.ms <= 3000 && scripts <= 25) passed.push('Homepage loads quickly');

  // ---- Listings (Shopify only) ----
  let productCount = 0;
  if (shopify) {
    const pj = prodRes && prodRes.ok ? json(prodRes.text) : null;
    const products = (pj && Array.isArray(pj.products)) ? pj.products : null;
    if (!products) {
      add('lo', 'Listings', 'Product data is not public, so listing checks were skipped.');
    } else {
      productCount = products.length;
      const n = products.length || 1;
      let thin = 0, longTitle = 0, caps = 0, fewImg = 0, noImg = 0, noType = 0, soldOut = 0, sizeProducts = 0, noSize = 0;
      let imgs = 0, noAlt = 0;
      const bodies = new Map();
      for (const p of products) {
        const body = strip(p.body_html);
        const w = words(body);
        if (w < 40) thin++;
        if (w >= 15) { const k = body.toLowerCase().slice(0, 400); bodies.set(k, (bodies.get(k) || 0) + 1); }
        const t = String(p.title || '');
        if (t.length > 80) longTitle++;
        if (t.length > 12 && t === t.toUpperCase() && /[A-Z]/.test(t)) caps++;
        const im = Array.isArray(p.images) ? p.images : [];
        if (im.length === 0) noImg++; else if (im.length < 3) fewImg++;
        for (const i of im) { imgs++; if (!i.alt || !String(i.alt).trim()) noAlt++; }
        if (!p.product_type) noType++;
        const vars = Array.isArray(p.variants) ? p.variants : [];
        if (vars.length && vars.every(v => v.available === false)) soldOut++;
        const opts = Array.isArray(p.options) ? p.options : [];
        if (opts.some(o => /size/i.test(o && o.name || ''))) { sizeProducts++; if (!SIZE_IN_TEXT.test(body)) noSize++; }
      }
      let dupes = 0; for (const c of bodies.values()) if (c > 1) dupes += c;

      const sampleNote = productCount >= 250 ? ' (first 250 products checked)' : '';
      if (thin) add(pct(thin, n) >= 30 ? 'hi' : 'md', 'Listings', `${thin} of ${productCount} products ${thin === 1 ? 'has a thin description' : 'have thin descriptions'} (under 40 words)${sampleNote}.`);
      else passed.push('Product descriptions have enough detail');
      if (dupes) add('md', 'Listings', `${np(dupes, 'product shares', 'products share')} a copied description with another product.`);
      if (noImg) add('hi', 'Listings', `${np(noImg, 'product has', 'products have')} no images at all.`);
      if (fewImg) add(pct(fewImg, n) >= 30 ? 'md' : 'lo', 'Listings', `${np(fewImg, 'product has', 'products have')} fewer than 3 images.`);
      if (!noImg && !fewImg) passed.push('Every product has 3+ images');
      if (imgs && pct(noAlt, imgs) >= 30) add('lo', 'SEO', `${pct(noAlt, imgs)}% of product images have no alt text, which hurts Google Images and accessibility.`);
      if (longTitle) add('lo', 'Listings', `${np(longTitle, 'product title is', 'product titles are')} over 80 characters.`);
      if (caps) add('lo', 'Listings', `${np(caps, 'product title is', 'product titles are')} written in ALL CAPS.`);
      if (noType && pct(noType, n) >= 20) add('lo', 'Listings', `${np(noType, 'product has', 'products have')} no product type, which makes collections and filters harder.`);
      if (soldOut && pct(soldOut, n) >= 15) add('md', 'Listings', `${np(soldOut, 'product', 'products')} (${pct(soldOut, n)}%) ${soldOut === 1 ? 'is' : 'are'} fully sold out but still listed.`);
      if (sizeProducts && noSize && !APPS.sizing.test(html)) {
        add(pct(noSize, sizeProducts) >= 30 ? 'hi' : 'md', 'Listings', `${noSize} of ${sizeProducts} products with sizes ${noSize === 1 ? 'has' : 'have'} no size chart in the description. Wrong sizes are a top cause of returns.`);
      } else if (sizeProducts) passed.push('Size info on sized products');
    }
  } else {
    add('lo', 'Listings', 'This does not look like a Shopify store, so product checks were skipped.');
  }

  const weight = { hi: 12, md: 6, lo: 2 };
  const order = { hi: 0, md: 1, lo: 2 };
  issues.sort((a, b) => order[a.sev] - order[b.sev]);
  const score = Math.max(5, 100 - issues.reduce((s, i) => s + weight[i.sev], 0));
  return { domain, origin, shopify, score, productsChecked: productCount, issues, passed, ms: Date.now() - t0, scannedAt: new Date().toISOString() };
}

// ---------- Supabase (log + rate limit) ----------
async function rpc(fn, body) {
  try {
    const r = await fetch(`${SB_URL}/rest/v1/rpc/${fn}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', apikey: SB_KEY, authorization: `Bearer ${SB_KEY}` },
      body: JSON.stringify(body),
    });
    return r.ok ? await r.json().catch(() => null) : null;
  } catch { return null; }
}

module.exports = async (req, res) => {
  res.setHeader('content-type', 'application/json; charset=utf-8');
  const q = req.query || {};
  const domain = normDomain(q.store || q.url);
  if (!domain) { res.statusCode = 400; return res.end(JSON.stringify({ error: 'Enter a store address like yourstore.com' })); }

  const ip = String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '').split(',')[0].trim();
  const ipHash = crypto.createHash('sha256').update('assistaa-xray|' + ip).digest('hex').slice(0, 32);
  const recent = await rpc('xray_recent', { p_ip_hash: ipHash });
  if (typeof recent === 'number' && recent >= MAX_PER_HOUR) {
    res.statusCode = 429;
    return res.end(JSON.stringify({ error: 'You have run a lot of scans this hour. Please try again later.' }));
  }

  const result = await scan(domain);
  if (result.error) { res.statusCode = 422; return res.end(JSON.stringify(result)); }

  await rpc('xray_log', { p_domain: domain, p_ip_hash: ipHash, p_shopify: result.shopify, p_score: result.score, p_issues: result.issues.length, p_result: result });
  res.setHeader('cache-control', 'public, s-maxage=900, stale-while-revalidate=3600');
  res.statusCode = 200;
  res.end(JSON.stringify(result));
};
