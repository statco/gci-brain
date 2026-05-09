const STORE       = process.env.SHOPIFY_STORE_DOMAIN;
const TOKEN       = process.env.SHOPIFY_ADMIN_ACCESS_TOKEN;
const API_VERSION = "2024-01";
const BASE        = `https://${STORE}/admin/api/${API_VERSION}`;
const SHOPIFY_HEADERS = {
  "X-Shopify-Access-Token": TOKEN,
  "Content-Type": "application/json",
};

const SIZE_RE = /(?<![A-Za-z\d])((?:LT|ST|[PC])?)(\d{3})(\d{2})(\d{2})\/[Rr](?!\d)/gi;
function fixSizeFormat(str) {
  if (!str) return str;
  return str.replace(SIZE_RE, (_, prefix, w, a, d) => `${prefix ?? ""}${w}/${a}R${d}`);
}

const FRENCH_RE = /[àâäéèêëîïôùûüçœ]|\b(pour|chez|les|des|pneu|toutes|saisons|livraison|rapide|achetez|conçu|idéal|fiable|qualité|hiver|voiture|camion)\b/i;
function looksNonEnglish(str) { return FRENCH_RE.test(str ?? ""); }

async function translateToEnglish(text) {
  if (!looksNonEnglish(text)) return null;
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 256,
      messages: [{ role: "user", content: `Translate the following to English. Return only the translated text, no explanation:\n\n${text}` }],
    }),
  });
  const json = await res.json();
  return json.content?.[0]?.text?.trim() ?? null;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function shopifyFetch(url, options = {}) {
  await sleep(500);
  const res = await fetch(url, { headers: SHOPIFY_HEADERS, ...options });
  if (res.status === 429) { await sleep(2000); return shopifyFetch(url, options); }
  return res;
}

function parseNextLink(linkHeader) {
  if (!linkHeader) return null;
  const match = linkHeader.match(/<([^>]+)>;\s*rel="next"/);
  return match ? match[1] : null;
}

async function fixBodyHtml(product, dryRun, log) {
  const fixed = fixSizeFormat(product.body_html);
  if (fixed === product.body_html) return 0;
  log.push(`  [1] body_html size format fixed`);
  if (!dryRun) await shopifyFetch(`${BASE}/products/${product.id}.json`, { method: "PUT", body: JSON.stringify({ product: { id: product.id, body_html: fixed } }) });
  return 1;
}

async function fixVariantSizes(product, dryRun, log) {
  let count = 0;
  for (const v of product.variants ?? []) {
    const updates = {};
    for (const key of ["title", "option1", "option2", "option3"]) {
      const fixed = fixSizeFormat(v[key]);
      if (fixed && fixed !== v[key]) updates[key] = fixed;
    }
    if (!Object.keys(updates).length) continue;
    log.push(`  [2] variant ${v.id} "${v.title}" → size fixed`);
    if (!dryRun) await shopifyFetch(`${BASE}/variants/${v.id}.json`, { method: "PUT", body: JSON.stringify({ variant: { id: v.id, ...updates } }) });
    count++;
  }
  return count;
}

async function assignVariantImages(product, dryRun, log) {
  const firstImage = product.images?.[0];
  if (!firstImage) { log.push(`  [3] skipped — no images`); return 0; }
  let count = 0;
  for (const v of product.variants ?? []) {
    if (v.image_id != null) continue;
    log.push(`  [3] variant ${v.id} — assigning image ${firstImage.id}`);
    if (!dryRun) await shopifyFetch(`${BASE}/variants/${v.id}.json`, { method: "PUT", body: JSON.stringify({ variant: { id: v.id, image_id: firstImage.id } }) });
    count++;
  }
  return count;
}

async function translateSeo(product, dryRun, log) {
  const res = await shopifyFetch(`${BASE}/products/${product.id}/metafields.json?namespace=global`);
  const mfText = await res.text();
  let json;
  try {
    json = JSON.parse(mfText);
  } catch (_) {
    log.push(`  [4] ❌ Non-JSON metafield response for product ${product.id} (status ${res.status}): ${mfText.slice(0, 200)}`);
    return 0;
  }
  const mfs  = (json.metafields ?? []).filter(m => ["title_tag", "description_tag"].includes(m.key));
  let count = 0;
  for (const mf of mfs) {
    const translated = await translateToEnglish(mf.value);
    if (!translated) { log.push(`  [4] ${mf.key} — already English`); continue; }
    log.push(`  [4] ${mf.key} translated: "${translated.slice(0, 80)}"`);
    if (!dryRun) await shopifyFetch(`${BASE}/products/${product.id}/metafields/${mf.id}.json`, { method: "PUT", body: JSON.stringify({ metafield: { id: mf.id, value: translated, type: mf.type } }) });
    count++;
  }
  return count;
}

export const config = { maxDuration: 300 };

export default async function handler(req, res) {
  if (!STORE || !TOKEN) return res.status(500).json({ error: "Missing env vars" });
  const { dryRun, chunkSize = "5", offset = "0", task = "all", pageInfoUrl } = req.query;
  const isDryRun = dryRun === "true" || dryRun === "1";
  const CHUNK  = Math.min(parseInt(chunkSize, 10), 50);
  const OFFSET = parseInt(offset, 10);
  const stats  = { scanned: 0, sizeFixed: 0, variantsFixed: 0, imagesAssigned: 0, seoTranslated: 0, errors: 0 };
  const log    = [`🚀 GCI Tires Shopify Fix${isDryRun ? " [DRY RUN]" : ""} | task=${task} chunkSize=${CHUNK} offset=${OFFSET}${pageInfoUrl ? " [cursor]" : ""}`];

  // Use cursor URL if provided (avoids re-paging from the start at high offsets).
  // pageInfoUrl is the Shopify Link rel="next" URL returned by the previous call.
  let url = pageInfoUrl
    ? decodeURIComponent(pageInfoUrl)
    : `${BASE}/products.json?limit=50&fields=id,title,body_html,images,variants,options`;

  // When using a cursor we start from the right page — no skipping needed.
  const skipCount = pageInfoUrl ? 0 : OFFSET;
  let skipped = 0, processed = 0;
  let nextPageUrl = null; // cursor URL to pass to the next call

  try {
    while (url && processed < CHUNK) {
      const pageRes = await shopifyFetch(url);
      const pageText = await pageRes.text();
      let pageJson;
      try {
        pageJson = JSON.parse(pageText);
      } catch (_) {
        log.push(`❌ Non-JSON response from Shopify at offset=${OFFSET + skipped} status=${pageRes.status}\n  Raw: ${pageText.slice(0, 300)}`);
        stats.errors++;
        break;
      }
      const pageNextUrl = parseNextLink(pageRes.headers.get("link"));
      for (const product of pageJson.products ?? []) {
        if (processed >= CHUNK) break;
        if (skipped < skipCount) { skipped++; continue; }
        processed++; stats.scanned++;
        log.push(`\n[${stats.scanned}] ${product.id} — "${product.title}"`);
        try {
          if (task === "all" || task === "size")   { stats.sizeFixed += await fixBodyHtml(product, isDryRun, log); stats.variantsFixed += await fixVariantSizes(product, isDryRun, log); }
          if (task === "all" || task === "images") { stats.imagesAssigned += await assignVariantImages(product, isDryRun, log); }
          if (task === "all" || task === "seo")    { stats.seoTranslated  += await translateSeo(product, isDryRun, log); }
        } catch (err) { log.push(`  ❌ ${err.message}`); stats.errors++; }
      }
      // Save the next-page cursor after processing this page
      if (processed >= CHUNK) { nextPageUrl = pageNextUrl; break; }
      url = pageNextUrl;
    }
  } catch (err) { log.push(`❌ Fatal: ${err.message}`); stats.errors++; }

  const nextOffset = OFFSET + stats.scanned;
  const done = !nextPageUrl && processed < CHUNK;
  log.push(`\n📊 Summary${isDryRun ? " (DRY RUN)" : ""}\n  Scanned: ${stats.scanned} | Fixed: ${stats.sizeFixed} | Variants: ${stats.variantsFixed} | Images: ${stats.imagesAssigned} | SEO: ${stats.seoTranslated} | Errors: ${stats.errors}${done ? "\n✅ All products processed" : `\n▶ Next: /api/shopifyFix?chunkSize=${CHUNK}&offset=${nextOffset}&pageInfoUrl=${encodeURIComponent(nextPageUrl ?? "")}${isDryRun ? "&dryRun=true" : ""}`}`);
  return res.status(200).json({
    stats,
    nextOffset: done ? null : nextOffset,
    nextPageUrl: done ? null : nextPageUrl,
    log,
  });
}
