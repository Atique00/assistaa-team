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

async function getProducts(origin) {
  const tries = [`${origin}/products.json?limit=250`, `${origin}/collections/all/products.json?limit=250`, `${origin}/products.json`];
  let last = null;
  for (const u of tries) {
    const r = await get(u);
    last = r;
    const j = r.ok ? json(r.text) : null;
    if (j && Array.isArray(j.products)) return r;
  }
  return last;
}
function findLink(html, origin, re) {
  const hrefs = [...String(html || '').matchAll(/href=["']([^"'#]+)["']/gi)].map(m => m[1]);
  for (const h of hrefs) {
    let u; try { u = new URL(h, origin); } catch { continue; }
    if (u.origin !== origin) continue;
    if (re.test(u.pathname)) return u.href;
  }
  return null;
}
async function fallback(page, html, origin, re) {
  if (page && page.ok && words(policyText(page)) >= 30) return page;
  const link = findLink(html, origin, re);
  return link ? await get(link) : page;
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
const PROMO_TITLE = /free shipping|\b\d{1,2}\s?% off\b|\bsale\b|\bbuy \d+ get\b|limited time|best price|\bcheap(est)?\b|\bhot deal\b|\bclearance\b/i;
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
  if (/^\/password/.test(new URL(home.url).pathname)) {
    return { error: 'This store is password protected, so shoppers and Google cannot see it yet. Google Merchant Center will not approve a locked store.' };
  }
  // Headless or custom storefronts redirect to a checkout host or serve an empty shell we cannot read fairly.
  if (/(^|\.)checkout\./i.test(new URL(home.url).hostname) || (!/<title[^>]*>[^<]+</i.test(html) && Buffer.byteLength(html) < 8000)) {
    return { error: 'This store uses a custom storefront the X-Ray cannot read reliably. Book a call and we will review it by hand.' };
  }
  const shopify = /cdn\.shopify\.com|Shopify\.theme|shopify-section|myshopify\.com/i.test(html) || !!home.headers.get('x-shopid') || /shopify/i.test(home.headers.get('powered-by') || '');

  const [prodRes, refund, shipping, privacy, terms, contact] = await Promise.all([
    shopify ? getProducts(origin) : Promise.resolve(null),
    get(`${origin}/policies/refund-policy`),
    get(`${origin}/policies/shipping-policy`),
    get(`${origin}/policies/privacy-policy`),
    get(`${origin}/policies/terms-of-service`),
    get(`${origin}/pages/contact`),
  ]);

  // ---- Policies ----
  // Some stores keep policies or contact info on their own pages; follow homepage links when the standard URL is missing.
  const [refundP, shippingP, contactP] = await Promise.all([
    fallback(refund, html, origin, /refund|return/i),
    fallback(shipping, html, origin, /shipping|delivery/i),
    contact.ok ? contact : (async () => { const l = findLink(html, origin, /contact/i); return l ? await get(l) : contact; })(),
  ]);
  const refundT = policyText(refundP), shipT = policyText(shippingP);
  if (!refundP.ok || words(refundT) < 40) add('hi', 'Policies', 'We could not find a refund policy at the standard address or in the homepage links. Missing policies are a common reason disputes are lost.');
  else if (!/\b\d{1,3}\s*(-|–|to)?\s*\d{0,3}\s*(calendar |business |working )?(day|days|week|weeks)\b/i.test(refundT)) add('hi', 'Policies', 'Refund policy gives no clear timeframe (for example "30 days"), a common trigger for disputes.');
  else passed.push('Refund policy with a clear timeframe');

  if (!shippingP.ok || words(shipT) < 30) add('hi', 'Policies', 'We could not find a shipping policy at the standard address or in the homepage links. Customers and payment processors look for delivery times.');
  else if (!/\b\d{1,2}\s*(-|–|to)\s*\d{1,2}\s*(business |working )?(day|days)\b|\b\d{1,2}\+?\s*(business |working )?days\b/i.test(shipT)) add('md', 'Policies', 'Shipping policy does not state delivery times in days.');
  else passed.push('Shipping policy states delivery times');

  if (!privacy.ok) add('md', 'Policies', 'We could not find a privacy policy page.'); else passed.push('Privacy policy');
  if (!terms.ok) add('lo', 'Policies', 'We could not find a terms of service page.'); else passed.push('Terms of service');

  // Apps like reviews and size charts often load only on product pages, so check one too.
  let appHtml = html;
  const firstHandle = (html.match(/href=["'](?:https?:\/\/[^"']+)?\/(?:collections\/[^\/"']+\/)?products\/([a-z0-9][a-z0-9\-_%.]*)/i) || [])[1];
  let productPage = null;
  if (firstHandle) { productPage = await get(`${origin}/products/${firstHandle}`); if (productPage.ok) appHtml += productPage.text; }

  // ---- Support ----
  if (!APPS.chat.test(appHtml)) add('md', 'Support', 'No live chat or help desk widget detected.');
  else passed.push('Live chat or help desk widget');
  if (!contactP.ok) add('md', 'Support', 'We could not find a contact page linked from the homepage.');
  else {
    const ct = strip(contactP.text);
    if (!/within\s+\d+|\d+\s*(-|–|to)?\s*\d*\s*(hours|hrs|business days)|24\s*\/\s*7|same day/i.test(ct)) add('md', 'Support', 'Contact page shows no expected response time.');
    else passed.push('Contact page with response time');
  }

  // ---- Trust and marketing ----
  if (!APPS.reviews.test(appHtml)) add('md', 'Trust', 'No product reviews found on the homepage or a product page.');
  else passed.push('Product reviews app');
  if (!APPS.email.test(appHtml)) add('lo', 'Marketing', 'No email signup or email marketing tool detected.');
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
  let productCount = 0, promoTitles = 0, bigDiscount = 0, productsSeen = 0;
  if (shopify) {
    const pj = prodRes && prodRes.ok ? json(prodRes.text) : null;
    const products = (pj && Array.isArray(pj.products)) ? pj.products : null;
    if (!products) {
      add('lo', 'Listings', 'Product data is not public, so listing checks were skipped.');
    } else {
      productCount = products.length; productsSeen = products.length;
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
        for (const i of im) { if ('alt' in i) { imgs++; if (!i.alt || !String(i.alt).trim()) noAlt++; } }
        if (!p.product_type) noType++;
        if (PROMO_TITLE.test(t)) promoTitles++;
        if ((Array.isArray(p.variants) ? p.variants : []).some(v => { const c = parseFloat(v.compare_at_price), pr = parseFloat(v.price); return c > 0 && pr > 0 && pr / c <= 0.3; })) bigDiscount++;
        const vars = Array.isArray(p.variants) ? p.variants : [];
        if (vars.length && vars.every(v => v.available === false)) soldOut++;
        const opts = Array.isArray(p.options) ? p.options : [];
        if (opts.some(o => /size/i.test(o && o.name || ''))) { sizeProducts++; if (!SIZE_IN_TEXT.test(body)) noSize++; }
      }
      let dupes = 0; for (const c of bodies.values()) if (c > 1) dupes += c;

      if (thin) add(pct(thin, n) >= 60 ? 'hi' : 'md', 'Listings', `${thin} of ${productCount} products have under 40 words in their main description. Thin pages convert and rank worse.`);
      else passed.push('Product descriptions have enough detail');
      if (dupes) add('md', 'Listings', `${dupes} of ${productCount} products reuse the same description as another product.`);
      if (noImg) add('hi', 'Listings', `${np(noImg, 'product has', 'products have')} no images at all.`);
      if (fewImg) add(pct(fewImg, n) >= 30 ? 'md' : 'lo', 'Listings', `${fewImg} of ${productCount} products have fewer than 3 images.`);
      if (!noImg && !fewImg) passed.push('Every product has 3+ images');
      if (imgs && pct(noAlt, imgs) >= 30) add('lo', 'SEO', `${pct(noAlt, imgs)}% of product images have no alt text, which hurts Google Images and accessibility.`);
      if (longTitle) add('lo', 'Listings', `${np(longTitle, 'product title is', 'product titles are')} over 80 characters.`);
      if (caps) add('lo', 'Listings', `${np(caps, 'product title is', 'product titles are')} written in ALL CAPS.`);
      if (noType && pct(noType, n) >= 20) add('lo', 'Listings', `${np(noType, 'product has', 'products have')} no product type, which makes collections and filters harder.`);
      if (soldOut && pct(soldOut, n) >= 15) add('md', 'Listings', `${np(soldOut, 'product', 'products')} (${pct(soldOut, n)}%) ${soldOut === 1 ? 'is' : 'are'} fully sold out but still listed.`);
      if (sizeProducts && noSize && !APPS.sizing.test(appHtml)) {
        add(pct(noSize, sizeProducts) >= 30 ? 'hi' : 'md', 'Listings', `${noSize} of ${sizeProducts} products with sizes ${noSize === 1 ? 'has' : 'have'} no size chart in the description. Wrong sizes are a top cause of returns.`);
      } else if (sizeProducts) passed.push('Size info on sized products');
    }
  } else {
    add('lo', 'Listings', 'This does not look like a Shopify store, so product checks were skipped.');
  }

  // ---- Google Merchant Center readiness ----
  // Based on Google's Merchant Center misrepresentation, checkout and landing page requirements.
  const google = [];
  const g = (name, ok, sev, text) => { google.push({ name, ok: !!ok }); if (!ok && text) add(sev, 'Google', text); };
  const rootDomain = new URL(origin).hostname.replace(/^www\./, '');
  const contactHtml = contactP && contactP.ok ? contactP.text : '';
  const siteText = strip(html) + ' ' + strip(contactHtml);
  const emails = [...new Set(((html + ' ' + contactHtml).match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi) || [])
    .map(e => e.toLowerCase())
    .filter(e => !/\.(png|jpe?g|gif|webp|svg|js|css)$/.test(e) && !/example\.|sentry|wixpress|shopify\.com|domain\.com|email\.com|@[0-9]x/.test(e)))];
  const ownEmail = emails.some(e => { const d = e.split('@')[1]; return d === rootDomain || d.endsWith('.' + rootDomain); });
  const freeEmail = emails.some(e => /@(gmail|yahoo|hotmail|outlook|live|icloud|aol|proton(mail)?)\./.test(e));
  const phone = /href=["']tel:/i.test(html + contactHtml) || /(phone|call us|tel)[^\d+]{0,20}\+?\d[\d\s().-]{7,}\d/i.test(siteText);
  const contactForm = /form_type["']?\s*(value=)?["']?contact|<form[^>]+contact/i.test(contactHtml || html);
  const social = /href=["']https?:\/\/(www\.)?(instagram|facebook|tiktok|x|twitter)\.com\/[a-z0-9_.-]+/i.test(html);
  const address = /\b\d{1,5}[a-z]?\s+([a-z0-9.'-]+\s){0,4}(street|st|road|rd|avenue|ave|lane|ln|drive|dr|boulevard|blvd|way|court|ct|place|pl|parade|pde|highway|hwy|terrace|close|crescent|cres)\b|\b(suite|unit|level|floor)\s?\d+/i.test(siteText);
  const linkedRefund = /href=["'][^"']*(refund|return)/i.test(html);
  const linkedShip = /href=["'][^"']*(shipping|delivery)/i.test(html);
  const linkedPrivacy = /href=["'][^"']*privacy/i.test(html);
  const pp = productPage && productPage.ok ? productPage.text : '';
  const ld = (pp.match(/<script[^>]+application\/ld\+json[^>]*>[\s\S]*?<\/script>/gi) || []).join(' ');
  const schemaOk = /"@type"\s*:\s*"Product"/i.test(ld) && /"offers"/i.test(ld) && /"price"/i.test(ld) && /"availability"/i.test(ld);
  const addToCart = /action=["'][^"']*\/cart\/add|name=["']add["']|add[\s_-]?to[\s_-]?(cart|bag|basket)/i.test(pp);
  const placeholder = /lorem ipsum|dolor sit amet|your (text|content|tagline|heading) (here|goes here)|under construction|this is a demo store|sample product/i.test(strip(html) + ' ' + strip(pp));
  const refundOk = refundP.ok && words(refundT) >= 40 && /\b\d{1,3}\s*(-|–|to)?\s*\d{0,3}\s*(calendar |business |working )?(day|days|week|weeks)\b/i.test(refundT);
  const returnCost = /return shipping|return postage|free returns?|customer (is|will be) responsible|responsible for (the )?(cost|return)|pay(s)? for (the )?return|prepaid (return )?label|return label|shipping costs? (are|is) non-?refundable/i.test(refundT);
  const shipCost = /free shipping|free delivery|[$€£]\s?\d|\b(aud|usd|cad|nzd|gbp|eur)\s?\d|shipping (cost|fee|rate|charge)s?|flat rate|calculated at checkout/i.test(shipT);

  g('Secure HTTPS website', origin.startsWith('https://'), 'hi', 'The store does not load over HTTPS. Google requires a valid SSL certificate.');
  g('Clear refund and return policy', refundOk, null, null);
  const refundFound = refundP.ok && words(refundT) >= 40, shipFound = shippingP.ok && words(shipT) >= 30;
  // When the policy itself is missing, that is already reported above, so only the readiness meter records it.
  g('Return shipping costs explained', refundFound && returnCost, 'md', refundFound ? 'The refund policy does not say who pays for return shipping. Google asks stores to disclose return costs before purchase.' : null);
  g('Shipping policy with costs', shipFound && shipCost, 'md', shipFound ? 'The shipping policy does not state shipping costs (for example "Free shipping over $50"). Google requires all shipping costs to be disclosed.' : null);
  g('Privacy policy and terms', privacy.ok && terms.ok, null, null);
  g('Policies linked on every page', linkedRefund && linkedShip && linkedPrivacy, 'md', 'Refund, shipping and privacy policies are not all linked from the homepage. Google reviewers look for them in the footer.');
  g('Ways for shoppers to contact you', emails.length || phone || contactForm || social, 'hi', 'No email, phone, contact form or social link found. Google flags stores with insufficient contact information.');
  g('Email on your own domain', ownEmail, 'lo', freeEmail ? 'The store uses a free email address (like Gmail). Google recommends an email on your own domain, such as support@yourstore.com.' : 'No email address on your own domain was found. Google recommends one, such as support@yourstore.com.');
  g('Business address shown', address, 'lo', 'No business address found on the homepage or contact page. Google recommends a street address that matches your business registration.');
  g('No placeholder or demo text', !placeholder, 'hi', 'Placeholder or demo text was found (for example "lorem ipsum"). Google rejects stores that look unfinished.');
  g('Mobile-friendly pages', /<meta[^>]+name=["']viewport/i.test(html), 'md', 'The homepage has no mobile viewport tag. Google requires mobile-friendly product pages.');
  if (pp) {
    g('Add to cart on product pages', addToCart, 'hi', 'We could not find an Add to cart button on a product page. Google requires in-stock products to be purchasable.');
    g('Product data Google can read', schemaOk, 'md', 'Product pages are missing structured data for price and availability. Google uses it to check that your listings match your site.');
  }
  if (productsSeen) {
    g('No promotional text in product titles', !promoTitles, 'lo', `${np(promoTitles, 'product title has', 'product titles have')} promotional words like "Sale" or "Free shipping". Google Shopping does not allow promotional text in titles.`);
    g('Realistic discounts', pct(bigDiscount, productsSeen) < 20, 'md', `${bigDiscount} of ${productsSeen} products show discounts of 70% or more. Offers that look too good to be true can trigger a misrepresentation review.`);
  }
  for (const c of google) if (c.ok) passed.push('Google: ' + c.name);

  const weight = { hi: 12, md: 6, lo: 2 };
  const order = { hi: 0, md: 1, lo: 2 };
  issues.sort((a, b) => order[a.sev] - order[b.sev]);
  const score = Math.max(5, Math.round(100 - issues.reduce((s, i) => s + weight[i.sev] * (i.area === 'Google' ? 0.5 : 1), 0)));
  return { domain, origin, shopify, score, productsChecked: productCount, google: { passed: google.filter(c => c.ok).length, total: google.length, checks: google }, diag: { productsStatus: prodRes ? prodRes.status : null, productPage: productPage ? productPage.status : null }, issues, passed, ms: Date.now() - t0, scannedAt: new Date().toISOString() };
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
