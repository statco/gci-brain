// api/shopifyFix.js — GCI Tires Shopify Fix as Vercel API Route
// Trigger via browser:
//   /api/shopifyFix?dryRun=true&chunkSize=10
//   /api/shopifyFix?chunkSize=50&offset=0
//   /api/shopifyFix?task=seo&chunkSize=20
//   /api/shopifyFix?task=size&chunkSize=20
//   /api/shopifyFix?task=images&chunkSize=20

const STORE       = process.env.SHOPIFY_STORE;
const TOKEN       = process.env.SHOPIFY_ADMIN_TOKEN;
const API_VERSION = "2024-01";
const BASE        = `https://${STORE}/admin/api/${API_VERSION}`;
const HEADERS     = {
  "X-Shopify-Access-Token": TOKEN,
  "Content-Type": "application/json",
};

// ─── Regex ───────────────────────────────────────────────────────────────────
const SIZE_RE = /(?<![A-Za-z\d])((?:LT|ST|[PC])?)(\d{3})(\d{2})(\d{2})\/[Rr](?!\d)/gi;
function fixSizeFormat(str) {
  if (!str) return str;
  return str.replace(SIZE_RE, (_, prefix, w, a, d) =>
    `${prefix ?? ""}${w}/${a}R${d}`
  );
}

// ─── French heuristic ────────────────────────────────────────────────────────
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
      messages: [{
        role: "user",
        content: `Translate the following to English. Return only the translated text, no explanation:\n\n${text}`,
      }],
    }),
  });
  const json = await res.json();
  return json.content?.[0]?.text?.trim() ?? null;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function shopifyFetch(url, options = {}) {
  await sleep(500);
  const res = await fetch(url, { headers: HEADERS, ...options });
  if (res.status === 429) {
    await sleep(2000);
    return shopifyFetch(url, options);
  }
  return res;
}

function parseNextLink(linkHeader) {
  if (!linkHeader) return null;
  const match = linkHeader.match(/<([^>]+)>;\s*rel="next"/);
  return match ? match[1] : null;
}

// ─── Task 1 — Fix body_html ──────────────────────────────────────────────────
async function fixBodyHtml(product, dryRun, log) {
  const fixed = fixSizeFormat(product.body_html);
  if (fixed === product.body_html) return 0;
  log.push(`  [1] body_html size format fixed`);
  if (!dryRun) {
    await shopifyFetch(`${BASE}/products/${product.id}.json`, {
      method: "PUT",
      body: JSON.stringify({ product: { id: product.id, body_html: fixed } }),
    });
  }
  return 1;
}

// ─── Task 2 — Fix variant sizes ──────────────────────────────────────────────
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
    if (!dryRun) {
      await shopifyFetch(`${BASE}/variants/${v.id}.json`, {
        method: "PUT",
        body: JSON.stringify({ variant: { id: v.id, ...updates } }),
      });
    }
    count++;
  }
  return count;
}

// ─── Task 3 — Assign variant images ──────────────────────────────────────────
async function assignVariantImages(product, dryRun, log) {
  const firstImage = product.images?.[0];
  if (!firstImage) {
    log.push(`  [3] skipped — product has no images`);
    return 0;
  }
  let count = 0;
  for (const v of product.variants ?? []) {
    if (v.image_id != null) continue;
    log.push(`  [3] variant ${v.id} — assigning image ${firstImage.id}`);
    if (!dryRun) {
      await shopifyFetch(`${BASE}/variants/${v.id}.json`, {
        method: "PUT",
        body: JSON.stringify({ variant: { id: v.id, image_id: firstImage.id } }),
      });
    }
    count++;
  }
  return count;
}

// ─── Task 4 — Translate SEO metafields ───────────────────────────────────────
async function translateSeo(product, dryRun, log) {
  const res  = await shopifyFetch(
    `${BASE}/products/${product.id}/metafields.json?namespace=global`
  );
  const json = await res.json();
  const mfs  = (json.metafields ?? []).filter(m =>
    ["title_tag", "description_tag"].includes(m.key)
  );
  let count = 0;
  for (const mf of mfs) {
    const translated = await translateToEnglish(mf.value);
    if (!translated) {
      log.push(`  [4] ${mf.key} — already English, skipped`);
      continue;
    }
    log.push(`  [4] ${mf.key} translated: "${translated.slice(0, 80)}"`);
    if (!dryRun) {
      await shopifyFetch(
        `${BASE}/products/${product.id}/metafields/${mf.id}.json`,
        {
          method: "PUT",
          body: JSON.stringify({
            metafield: { id: mf.id, value: translated, type: mf.type },
          }),
        }
      );
    }
    count++;
  }
  return count;
}

// ─── Handler ──────────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  if (!STORE || !TOKEN) {
    return res.status(500).json({ error: "Missing SHOPIFY_STORE or SHOPIFY_ADMIN_TOKEN" });
  }

  const {
    dryRun,
    chunkSize = "20",
    offset    = "0",
    task      = "all",
  } = req.query;

  const isDryRun = dryRun === "true" || dryRun === "1";
  const CHUNK    = Math.min(parseInt(chunkSize, 10), 50);
  const OFFSET   = parseInt(offset, 10);

  const stats = {
    scanned: 0, sizeFixed: 0, variantsFixed: 0,
    imagesAssigned: 0, seoTranslated: 0, errors: 0,
  };
  const log = [
    `🚀 GCI Tires Shopify Fix${isDryRun ? " [DRY RUN]" : ""}`,
    `   task=${task} | chunkSize=${CHUNK} | offset=${OFFSET}`,
  ];

  if (OFFSET > 0) {
    log.push(
      `ℹ️  offset=${OFFSET}: cursor pagination has no native seek — ` +
      `streaming through ${OFFSET} preceding products first.`
    );
  }

  let url       = `${BASE}/products.json?limit=50&fields=id,title,body_html,images,variants,options`;
  let skipped   = 0;
  let processed = 0;

  try {
    while (url && processed < CHUNK) {
      const pageRes  = await shopifyFetch(url);
      const pageJson = await pageRes.json();
      const products = pageJson.products ?? [];

      for (const product of products) {
        if (processed >= CHUNK) break;
        if (skipped < OFFSET) { skipped++; continue; }

        processed++;
        stats.scanned++;
        log.push(`\n[${stats.scanned}] ${product.id} — "${product.title}"`);

        try {
          if (task === "all" || task === "size") {
            stats.sizeFixed     += await fixBodyHtml(product, isDryRun, log);
            stats.variantsFixed += await fixVariantSizes(product, isDryRun, log);
          }
          if (task === "all" || task === "images") {
            stats.imagesAssigned += await assignVariantImages(product, isDryRun, log);
          }
          if (task === "all" || task === "seo") {
            stats.seoTranslated += await translateSeo(product, isDryRun, log);
          }
        } catch (err) {
          log.push(`  ❌ Error: ${err.message}`);
          stats.errors++;
        }
      }

      url = parseNextLink(pageRes.headers.get("link"));
    }
  } catch (err) {
    log.push(`\n❌ Fatal error: ${err.message}`);
    stats.errors++;
  }

  const nextOffset = OFFSET + stats.scanned;
  log.push(`
──────────────────────────────
📊 Summary${isDryRun ? " (DRY RUN — no writes)" : ""}
  Products scanned  : ${stats.scanned}
  body_html fixed   : ${stats.sizeFixed}
  Variants fixed    : ${stats.variantsFixed}
  Images assigned   : ${stats.imagesAssigned}
  SEO translated    : ${stats.seoTranslated}
  Errors            : ${stats.errors}
──────────────────────────────
▶ Next chunk URL:
  /api/shopifyFix?chunkSize=${CHUNK}&offset=${nextOffset}${isDryRun ? "&dryRun=true" : ""}
`);

  return res.status(200).json({ stats, nextOffset, log });
}
