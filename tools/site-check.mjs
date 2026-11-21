// Website check: run before EVERY deploy of assistaa.com. Fails (exit 1) if anything a visitor would notice is broken.
// Usage: serve the site (python3 -m http.server 8801) then: node tools/site-check.mjs [url]
import { chromium } from "playwright";
const URL = process.argv.slice(1).find((a) => /^https?:/.test(a)) || "http://localhost:8801/";
const SIZES = [[1920, 1080], [1366, 768], [1024, 768], [390, 844], [360, 740]];
const BUDGET_P95_MS = 120; // headless software rendering; real devices are much faster
const b = await chromium.launch();
let failed = 0;
const fail = (m) => { failed++; console.log("  ✗ " + m); };
for (const [w, h] of SIZES) {
  console.log(`\n${w}×${h}`);
  const p = await b.newPage({ viewport: { width: w, height: h } });
  const errs = []; p.on("pageerror", (e) => errs.push(e.message));
  await p.goto(URL, { waitUntil: "load" });
  await p.waitForTimeout(800);
  if (errs.length) fail("JavaScript errors: " + errs.slice(0, 3).join(" | "));
  // 1. No sideways scrolling
  const sx = await p.evaluate(() => { window.scrollTo(500, 0); return scrollX; });
  if (sx > 0) fail(`page scrolls sideways by ${sx}px`);
  // 2. Sections never overlap
  const overlap = await p.evaluate(() => { const ps = [...document.querySelectorAll("#view-home .page")].map((e) => e.getBoundingClientRect()); for (let i = 1; i < ps.length; i++) if (ps[i].top < ps[i - 1].bottom - 2) return i; return 0; });
  if (overlap) fail(`section ${overlap + 1} overlaps the one before it`);
  // 3. Smooth enough while scrolling
  const fr = await p.evaluate(async () => { const f = []; let l = performance.now(), run = true; (function t() { const n = performance.now(); f.push(n - l); l = n; if (run) requestAnimationFrame(t); })();
    const H = document.documentElement.scrollHeight; for (let y = 0; y < H; y += 100) { window.scrollTo(0, y); await new Promise((r) => requestAnimationFrame(r)); } run = false; f.sort((a, b) => a - b); return f[Math.floor(f.length * 0.95)]; });
  if (fr > BUDGET_P95_MS) fail(`scrolling too heavy: p95 frame ${fr.toFixed(0)}ms > ${BUDGET_P95_MS}ms`); else console.log(`  ✓ scroll p95 ${fr.toFixed(0)}ms`);
  // 4. Review quote fully visible (no words stuck invisible)
  await p.evaluate(() => document.getElementById("reviews")?.scrollIntoView()); await p.waitForTimeout(1200);
  const hidden = await p.evaluate(() => [...document.querySelectorAll("#spotQ *")].filter((e) => getComputedStyle(e).opacity === "0").length);
  if (hidden) fail(`${hidden} words in the review quote are invisible`);
  // 5. Log in button goes to the app
  const href = await p.getAttribute(".nav-login", "href").catch(() => null);
  if (href !== "/app/login") fail("Log in button missing or wrong link");
  await p.screenshot({ path: `/tmp/site-check-${w}.png` });
  await p.close();
}
await b.close();
console.log(failed ? `\n${failed} problem(s). Do not deploy.` : "\nAll checks passed. Screenshots in /tmp/site-check-*.png");
process.exit(failed ? 1 : 0);
