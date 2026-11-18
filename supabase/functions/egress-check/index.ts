// Reports the public egress IP / network of this edge function region (for Shopify IP allowlists). No data access.
Deno.serve(async () => {
  const r = await fetch("https://ipinfo.io/json").then((x) => x.json()).catch((e) => ({ error: String(e) }));
  return new Response(JSON.stringify({ ip: r.ip, org: r.org, country: r.country, city: r.city, region: Deno.env.get("SB_REGION") || "" }), { headers: { "content-type": "application/json" } });
});
