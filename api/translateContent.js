// api/translateContent.js
// Bulk FR→EN translation tool for GCI Tires Shopify store
// Supports: audit (scan only) and translate (paginated chunks)

const STORE = process.env.SHOPIFY_STORE_DOMAIN;
const TOKEN = process.env.SHOPIFY_ADMIN_ACCESS_TOKEN;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const API_VERSION = "2024-01";
const BASE = `https://${STORE}/admin/api/${API_VERSION}`;

const SHOPIFY_HEADERS = {
  "X-Shopify-Access-Token": TOKEN,
  "Content-Type": "application/json",
};

// ── French detection ──────────────────────────────────────────────────

const FRENCH_ACCENTS_RE = /[àâäéèêëîïôùûüçœæ]/i;
const FRENCH_WORDS_RE = /\b(hiver|été|automne|printemps|pneu|pneus|toutes[- ]saisons|quatre[- ]saisons|toutes|saisons|camion|tourisme|tout[- ]terrain|livraison|gratuite|en[- ]stock|accueil|magasinez|conçu|idéal|fiable|qualité|voiture|notre|nous|pour|chez|les|des|avec|une|sur|par|de|du|la|le|les|un|en|est|qui|que|ce|il|elle|ils|elles|nous|vous|se|sa|son|ses|leur|leurs|mais|car|donc|si|ou|et|ne|pas|plus|très|bien|aussi|déjà|encore|toujours|souvent|jamais|ici|là|même|tout|tous|toute|toutes)\b/i;

function isFrench(str) {
  if (!str) return false;
  const text = str.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  return FRENCH_ACCENTS_RE.test(text) || FRENCH_WORDS_RE.test(text);
}

function stripHtml(html) {
  return (html ?? "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

// ── Tag static mapping ────────────────────────────────────────────────

const TAG_MAP = {
  hiver: "winter",
  "hiver-2024": "winter-2024",
  "hiver-2025": "winter-2025",
  été: "summer",
  "ete": "summer",
  "toutes-saisons": "all-season",
  "toutes_saisons": "all-season",
  "quatre-saisons": "all-season",
  "4-saisons": "all-season",
  camion: "truck",
  tourisme: "passenger",
  "tout-terrain": "all-terrain",
  "tout_terrain": "all-terrain",
  pneu: "tire",
  pneus: "tires",
  "livraison-gratuite": "free-shipping",
  livraison: "shipping",
  "en-stock": "in-stock",
  "en_stock": "in-stock",
  "nouvelle-arrivee": "new-arrival",
  "solde": "sale",
  "promotion": "promotion",
  "marque": "brand",
  "haute-performance": "high-performance",
  "performance": "performance",
  "VUS": "SUV",
  "vus": "suv",
  "camionnette": "pickup",
};

function translateTag(tag) {
  const lower = tag.toLowerCase().trim();
  if (TAG_MAP[lower]) return TAG_MAP[lower];
  if (TAG_MAP[tag.trim()]) return TAG_MAP[tag.trim()];
  return null; // not in static map
}

// ── Shopify fetch helpers ─────────────────────────────────────────────

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function shopifyGet(path, retries = 4) {
  const res = await fetch(`${BASE}${path}`, { headers: SHOPIFY_HEADERS });
  if (res.status === 429) {
    const retryAfter = parseInt(res.headers.get("Retry-After") ?? "2", 10);
    await sleep(retryAfter * 1000);
    if (retries > 0) return shopifyGet(path, retries - 1);
    throw new Error("Shopify rate limit exceeded after retries");
  }
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Shopify GET ${path} failed: ${res.status} ${text.slice(0, 200)}`);
  }
  return res.json();
}

async function shopifyPut(path, body, retries = 4) {
  await sleep(300);
  const res = await fetch(`${BASE}${path}`, {
    method: "PUT",
    headers: SHOPIFY_HEADERS,
    body: JSON.stringify(body),
  });
  if (res.status === 429) {
    const retryAfter = parseInt(res.headers.get("Retry-After") ?? "2", 10);
    await sleep(retryAfter * 1000);
    if (retries > 0) return shopifyPut(path, body, retries - 1);
    throw new Error("Shopify rate limit exceeded after retries");
  }
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Shopify PUT ${path} failed: ${res.status} ${text.slice(0, 200)}`);
  }
  return res.json();
}

// ── Claude Haiku translation ──────────────────────────────────────────

async function callClaude(text) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1024,
      system:
        "Translate French to English. If already English, return UNCHANGED. Preserve HTML tags. Keep tire sizes, brand names, part numbers unchanged. Return ONLY the translated content.",
      messages: [{ role: "user", content: text }],
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Claude API error: ${res.status} ${err.slice(0, 200)}`);
  }
  const json = await res.json();
  const result = json.content?.[0]?.text?.trim() ?? null;
  if (result === "UNCHANGED") return null;
  return result;
}

// ── Batch helper (3 items, 500ms between batches) ─────────────────────

async function processBatch(items, fn) {
  const results = [];
  const BATCH_SIZE = 3;
  for (let i = 0; i < items.length; i += BATCH_SIZE) {
    const batch = items.slice(i, i + BATCH_SIZE);
    const batchResults = await Promise.all(batch.map(fn));
    results.push(...batchResults);
    if (i + BATCH_SIZE < items.length) await sleep(500);
  }
  return results;
}

// ── SEO metafields helper ─────────────────────────────────────────────

async function fetchSeoMetafields(resourceType, resourceId) {
  try {
    const data = await shopifyGet(
      `/${resourceType}/${resourceId}/metafields.json?namespace=global`
    );
    return data.metafields ?? [];
  } catch {
    return [];
  }
}

async function updateMetafield(metafieldId, value) {
  return shopifyPut(`/metafields/${metafieldId}.json`, {
    metafield: { id: metafieldId, value },
  });
}

// ── AUDIT handlers ───────────────────────────────────────────────────

async function auditProducts() {
  let allProducts = [];
  let sinceId = 0;
  // Paginate using since_id
  while (true) {
    const url = `/products.json?limit=250&since_id=${sinceId}&fields=id,title,body_html,tags`;
    const data = await shopifyGet(url);
    const products = data.products ?? [];
    if (products.length === 0) break;
    allProducts = allProducts.concat(products);
    sinceId = products[products.length - 1].id;
    if (products.length < 250) break;
  }

  const french = allProducts.filter(
    (p) => isFrench(p.title) || isFrench(stripHtml(p.body_html)) || (p.tags && isFrench(p.tags))
  );

  return {
    total: allProducts.length,
    frenchCount: french.length,
    samples: french.slice(0, 5).map((p) => ({ id: p.id, title: p.title })),
  };
}

async function auditCollections() {
  let allCollections = [];
  for (const kind of ["custom_collections", "smart_collections"]) {
    const data = await shopifyGet(`/${kind}.json?limit=250`);
    allCollections = allCollections.concat(data[kind] ?? []);
  }

  const french = allCollections.filter(
    (c) => isFrench(c.title) || isFrench(stripHtml(c.body_html))
  );

  return {
    total: allCollections.length,
    frenchCount: french.length,
    samples: french.slice(0, 5).map((c) => ({ id: c.id, title: c.title })),
  };
}

async function auditPages() {
  const data = await shopifyGet("/pages.json?limit=250");
  const pages = data.pages ?? [];

  const french = pages.filter(
    (p) => isFrench(p.title) || isFrench(stripHtml(p.body_html))
  );

  return {
    total: pages.length,
    frenchCount: french.length,
    samples: french.slice(0, 5).map((p) => ({ id: p.id, title: p.title })),
  };
}

async function auditTags() {
  // Sample products for tags
  const data = await shopifyGet("/products.json?limit=250&fields=id,tags");
  const products = data.products ?? [];

  const allTags = new Set();
  for (const p of products) {
    if (!p.tags) continue;
    for (const tag of p.tags.split(",").map((t) => t.trim())) {
      if (tag) allTags.add(tag);
    }
  }

  const frenchTags = [];
  const mappingPreview = [];

  for (const tag of allTags) {
    const mapped = translateTag(tag);
    if (mapped) {
      frenchTags.push(tag);
      mappingPreview.push({ fr: tag, en: mapped });
    } else if (isFrench(tag)) {
      frenchTags.push(tag);
      mappingPreview.push({ fr: tag, en: "(needs Claude)" });
    }
  }

  return {
    total: allTags.size,
    frenchCount: frenchTags.length,
    samples: frenchTags.slice(0, 10).map((t) => ({ id: t, title: t })),
    mappingPreview: mappingPreview.slice(0, 20),
  };
}

// ── TRANSLATE handlers ───────────────────────────────────────────────

async function translateProducts({ offset, chunkSize, dryRun }) {
  // Build paginated product list using since_id
  // We need to skip `offset` products first
  let sinceId = 0;
  let skipped = 0;

  // Fetch until we reach offset
  while (skipped < offset) {
    const toFetch = Math.min(250, offset - skipped);
    const data = await shopifyGet(
      `/products.json?limit=${toFetch}&since_id=${sinceId}&fields=id`
    );
    const products = data.products ?? [];
    if (products.length === 0) break;
    sinceId = products[products.length - 1].id;
    skipped += products.length;
    if (products.length < toFetch) break;
  }

  // Now fetch the chunk
  const data = await shopifyGet(
    `/products.json?limit=${chunkSize}&since_id=${sinceId}&fields=id,title,body_html,tags`
  );
  const products = data.products ?? [];

  // Count total products
  const countData = await shopifyGet("/products/count.json");
  const totalProducts = countData.count ?? 0;

  const fixed = [];
  const errors = [];
  let skippedCount = 0;

  await processBatch(products, async (product) => {
    try {
      const changes = [];
      const updates = {};
      let previewTitle = product.title;

      // Title
      if (isFrench(product.title)) {
        const translated = await callClaude(product.title);
        if (translated && translated !== product.title) {
          changes.push(`title: "${product.title}" → "${translated}"`);
          updates.title = translated;
          previewTitle = translated;
        }
      }

      // Body HTML
      const bodyText = stripHtml(product.body_html);
      if (bodyText && isFrench(bodyText)) {
        const translated = await callClaude(product.body_html);
        if (translated && translated !== product.body_html) {
          changes.push("body_html: translated");
          updates.body_html = translated;
        }
      }

      // Tags
      if (product.tags) {
        const tagList = product.tags.split(",").map((t) => t.trim()).filter(Boolean);
        const newTags = [];
        let tagsChanged = false;

        for (const tag of tagList) {
          const mapped = translateTag(tag);
          if (mapped) {
            newTags.push(mapped);
            tagsChanged = true;
          } else if (isFrench(tag)) {
            const translated = await callClaude(tag);
            if (translated && translated !== tag) {
              newTags.push(translated.toLowerCase().replace(/\s+/g, "-"));
              tagsChanged = true;
            } else {
              newTags.push(tag);
            }
          } else {
            newTags.push(tag);
          }
        }

        if (tagsChanged) {
          changes.push(`tags: updated ${tagList.filter((t, i) => newTags[i] !== t).length} tags`);
          updates.tags = newTags.join(", ");
        }
      }

      // SEO metafields
      const metafields = await fetchSeoMetafields("products", product.id);
      const seoMeta = {};
      for (const mf of metafields) {
        if (mf.key === "title_tag" && isFrench(mf.value)) {
          const translated = await callClaude(mf.value);
          if (translated) seoMeta[mf.id] = { key: "title_tag", value: translated, original: mf.value };
        }
        if (mf.key === "description_tag" && isFrench(mf.value)) {
          const translated = await callClaude(mf.value);
          if (translated) seoMeta[mf.id] = { key: "description_tag", value: translated, original: mf.value };
        }
      }

      if (Object.keys(seoMeta).length > 0) {
        const seoKeys = Object.values(seoMeta).map((m) => m.key);
        changes.push(`seo: updated ${seoKeys.join(", ")}`);
      }

      if (changes.length === 0) {
        skippedCount++;
        return;
      }

      if (!dryRun) {
        if (Object.keys(updates).length > 0) {
          await shopifyPut(`/products/${product.id}.json`, {
            product: { id: product.id, ...updates },
          });
        }
        for (const [mfId, mfData] of Object.entries(seoMeta)) {
          await updateMetafield(parseInt(mfId), mfData.value);
        }
      }

      fixed.push({
        id: product.id,
        title: product.title,
        changes,
        preview: previewTitle !== product.title ? previewTitle : undefined,
      });
    } catch (err) {
      errors.push({ id: product.id, title: product.title, error: err.message });
    }
  });

  const nextOffset = offset + products.length;
  const done = products.length < chunkSize || nextOffset >= totalProducts;

  return {
    success: true,
    action: "translate",
    type: "products",
    dryRun,
    totalProducts,
    chunk: { offset, size: products.length, nextOffset, done },
    summary: { fixed: fixed.length, skipped: skippedCount, errors: errors.length },
    fixed,
    errors,
  };
}

async function translateCollections({ offset, chunkSize, dryRun }) {
  let allCollections = [];
  for (const kind of ["custom_collections", "smart_collections"]) {
    const data = await shopifyGet(`/${kind}.json?limit=250`);
    const cols = (data[kind] ?? []).map((c) => ({ ...c, _kind: kind }));
    allCollections = allCollections.concat(cols);
  }

  const chunk = allCollections.slice(offset, offset + chunkSize);
  const fixed = [];
  const errors = [];
  let skippedCount = 0;

  await processBatch(chunk, async (col) => {
    try {
      const changes = [];
      const updates = {};
      let previewTitle = col.title;

      if (isFrench(col.title)) {
        const translated = await callClaude(col.title);
        if (translated && translated !== col.title) {
          changes.push(`title: "${col.title}" → "${translated}"`);
          updates.title = translated;
          previewTitle = translated;
        }
      }

      const bodyText = stripHtml(col.body_html);
      if (bodyText && isFrench(bodyText)) {
        const translated = await callClaude(col.body_html);
        if (translated && translated !== col.body_html) {
          changes.push("body_html: translated");
          updates.body_html = translated;
        }
      }

      const metafields = await fetchSeoMetafields(
        col._kind === "smart_collections" ? "smart_collections" : "custom_collections",
        col.id
      );
      const seoMeta = {};
      for (const mf of metafields) {
        if (mf.key === "title_tag" && isFrench(mf.value)) {
          const translated = await callClaude(mf.value);
          if (translated) seoMeta[mf.id] = { value: translated };
        }
        if (mf.key === "description_tag" && isFrench(mf.value)) {
          const translated = await callClaude(mf.value);
          if (translated) seoMeta[mf.id] = { value: translated };
        }
      }

      if (Object.keys(seoMeta).length > 0) changes.push("seo: updated metafields");

      if (changes.length === 0) {
        skippedCount++;
        return;
      }

      if (!dryRun) {
        if (Object.keys(updates).length > 0) {
          const singular =
            col._kind === "smart_collections" ? "smart_collection" : "custom_collection";
          const endpoint =
            col._kind === "smart_collections" ? "smart_collections" : "custom_collections";
          await shopifyPut(`/${endpoint}/${col.id}.json`, {
            [singular]: { id: col.id, ...updates },
          });
        }
        for (const [mfId, mfData] of Object.entries(seoMeta)) {
          await updateMetafield(parseInt(mfId), mfData.value);
        }
      }

      fixed.push({
        id: col.id,
        title: col.title,
        changes,
        preview: previewTitle !== col.title ? previewTitle : undefined,
      });
    } catch (err) {
      errors.push({ id: col.id, title: col.title, error: err.message });
    }
  });

  const nextOffset = offset + chunk.length;
  const done = nextOffset >= allCollections.length;

  return {
    success: true,
    action: "translate",
    type: "collections",
    dryRun,
    totalCollections: allCollections.length,
    chunk: { offset, size: chunk.length, nextOffset, done },
    summary: { fixed: fixed.length, skipped: skippedCount, errors: errors.length },
    fixed,
    errors,
  };
}

async function translatePages({ offset, chunkSize, dryRun }) {
  const data = await shopifyGet("/pages.json?limit=250");
  const pages = data.pages ?? [];
  const chunk = pages.slice(offset, offset + chunkSize);

  const fixed = [];
  const errors = [];
  let skippedCount = 0;

  await processBatch(chunk, async (page) => {
    try {
      const changes = [];
      const updates = {};
      let previewTitle = page.title;

      if (isFrench(page.title)) {
        const translated = await callClaude(page.title);
        if (translated && translated !== page.title) {
          changes.push(`title: "${page.title}" → "${translated}"`);
          updates.title = translated;
          previewTitle = translated;
        }
      }

      const bodyText = stripHtml(page.body_html);
      if (bodyText && isFrench(bodyText)) {
        const translated = await callClaude(page.body_html);
        if (translated && translated !== page.body_html) {
          changes.push("body_html: translated");
          updates.body_html = translated;
        }
      }

      const metafields = await fetchSeoMetafields("pages", page.id);
      const seoMeta = {};
      for (const mf of metafields) {
        if (mf.key === "title_tag" && isFrench(mf.value)) {
          const translated = await callClaude(mf.value);
          if (translated) seoMeta[mf.id] = { value: translated };
        }
        if (mf.key === "description_tag" && isFrench(mf.value)) {
          const translated = await callClaude(mf.value);
          if (translated) seoMeta[mf.id] = { value: translated };
        }
      }

      if (Object.keys(seoMeta).length > 0) changes.push("seo: updated metafields");

      if (changes.length === 0) {
        skippedCount++;
        return;
      }

      if (!dryRun) {
        if (Object.keys(updates).length > 0) {
          await shopifyPut(`/pages/${page.id}.json`, { page: { id: page.id, ...updates } });
        }
        for (const [mfId, mfData] of Object.entries(seoMeta)) {
          await updateMetafield(parseInt(mfId), mfData.value);
        }
      }

      fixed.push({
        id: page.id,
        title: page.title,
        changes,
        preview: previewTitle !== page.title ? previewTitle : undefined,
      });
    } catch (err) {
      errors.push({ id: page.id, title: page.title, error: err.message });
    }
  });

  const nextOffset = offset + chunk.length;
  const done = nextOffset >= pages.length;

  return {
    success: true,
    action: "translate",
    type: "pages",
    dryRun,
    totalPages: pages.length,
    chunk: { offset, size: chunk.length, nextOffset, done },
    summary: { fixed: fixed.length, skipped: skippedCount, errors: errors.length },
    fixed,
    errors,
  };
}

async function translateTags({ offset, chunkSize, dryRun }) {
  // Collect products with French tags
  let allProducts = [];
  let sinceId = 0;
  while (true) {
    const data = await shopifyGet(`/products.json?limit=250&since_id=${sinceId}&fields=id,title,tags`);
    const products = data.products ?? [];
    if (products.length === 0) break;
    allProducts = allProducts.concat(products);
    sinceId = products[products.length - 1].id;
    if (products.length < 250) break;
  }

  // Filter products with French tags
  const productsWithFrenchTags = allProducts.filter((p) => {
    if (!p.tags) return false;
    return p.tags.split(",").some((t) => {
      const tag = t.trim();
      return translateTag(tag) !== null || isFrench(tag);
    });
  });

  const chunk = productsWithFrenchTags.slice(offset, offset + chunkSize);
  const fixed = [];
  const errors = [];
  let skippedCount = 0;

  await processBatch(chunk, async (product) => {
    try {
      const tagList = product.tags.split(",").map((t) => t.trim()).filter(Boolean);
      const newTags = [];
      let tagsChanged = false;

      for (const tag of tagList) {
        const mapped = translateTag(tag);
        if (mapped) {
          newTags.push(mapped);
          if (mapped !== tag) tagsChanged = true;
        } else if (isFrench(tag)) {
          const translated = await callClaude(tag);
          if (translated && translated !== tag) {
            newTags.push(translated.toLowerCase().replace(/\s+/g, "-"));
            tagsChanged = true;
          } else {
            newTags.push(tag);
          }
        } else {
          newTags.push(tag);
        }
      }

      if (!tagsChanged) {
        skippedCount++;
        return;
      }

      if (!dryRun) {
        await shopifyPut(`/products/${product.id}.json`, {
          product: { id: product.id, tags: newTags.join(", ") },
        });
      }

      fixed.push({
        id: product.id,
        title: product.title,
        changes: [`tags: [${tagList.join(", ")}] → [${newTags.join(", ")}]`],
      });
    } catch (err) {
      errors.push({ id: product.id, title: product.title, error: err.message });
    }
  });

  const nextOffset = offset + chunk.length;
  const done = nextOffset >= productsWithFrenchTags.length;

  return {
    success: true,
    action: "translate",
    type: "tags",
    dryRun,
    totalProducts: productsWithFrenchTags.length,
    chunk: { offset, size: chunk.length, nextOffset, done },
    summary: { fixed: fixed.length, skipped: skippedCount, errors: errors.length },
    fixed,
    errors,
  };
}

// ── Main handler ─────────────────────────────────────────────────────

export default async function handler(req, res) {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.status(200).end();
    return;
  }

  if (req.method !== "GET") {
    res.status(405).json({ error: "Method Not Allowed" });
    return;
  }

  const {
    action = "audit",
    type = "products",
    offset: offsetParam = "0",
    chunkSize: chunkSizeParam = "10",
    dryRun: dryRunParam = "true",
  } = req.query ?? {};

  const offset = Math.max(0, parseInt(offsetParam, 10) || 0);
  const chunkSize = Math.min(50, Math.max(1, parseInt(chunkSizeParam, 10) || 10));
  const dryRun = dryRunParam !== "false";

  try {
    if (action === "audit") {
      let result;
      if (type === "products") result = await auditProducts();
      else if (type === "collections") result = await auditCollections();
      else if (type === "pages") result = await auditPages();
      else if (type === "tags") result = await auditTags();
      else {
        res.status(400).json({ error: `Unknown type: ${type}` });
        return;
      }
      res.status(200).json({ success: true, action: "audit", type, ...result });
      return;
    }

    if (action === "translate") {
      let result;
      if (type === "products") result = await translateProducts({ offset, chunkSize, dryRun });
      else if (type === "collections") result = await translateCollections({ offset, chunkSize, dryRun });
      else if (type === "pages") result = await translatePages({ offset, chunkSize, dryRun });
      else if (type === "tags") result = await translateTags({ offset, chunkSize, dryRun });
      else {
        res.status(400).json({ error: `Unknown type: ${type}` });
        return;
      }
      res.status(200).json(result);
      return;
    }

    res.status(400).json({ error: `Unknown action: ${action}` });
  } catch (err) {
    console.error("[translateContent] Fatal error:", err);
    res.status(500).json({ success: false, error: err.message });
  }
}
