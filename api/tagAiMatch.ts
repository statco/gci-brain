// api/tagAiMatch.ts
// ============================================================
// AI-Match Tag Auditor & Backfiller
//
// Ensures every real tire product in the store has the "ai-match" tag
// so the AI Match finder (match.gcitires.com) can discover all brands.
//
// USAGE
//   GET /api/tagAiMatch?preview=true   → audit only, no writes
//   GET /api/tagAiMatch                → live run, adds tag where missing
//   GET /api/tagAiMatch?cursor=250     → continue pagination (250/chunk)
//
// RESPONSE
//   {
//     total:      number,   // total products in store
//     tireCount:  number,   // tire products found
//     tagged:     number,   // already had ai-match
//     added:      number,   // tag added this run
//     skipped:    number,   // non-tire products skipped
//     errors:     string[], // per-product errors
//     nextCursor: number | null,
//     preview:    { id, title, tags }[]  // first 50 products actioned
//   }
// ============================================================

import type { VercelRequest, VercelResponse } from '@vercel/node';

export const config = { maxDuration: 300 };

// ─── Shopify config ───────────────────────────────────────────────────────────
const SHOPIFY = {
  domain:     process.env.SHOPIFY_STORE_DOMAIN       || '',
  token:      process.env.SHOPIFY_ADMIN_ACCESS_TOKEN || '',
  apiVersion: '2024-01',
  get baseUrl() {
    return `https://${this.domain}/admin/api/${this.apiVersion}`;
  },
};

const CHUNK_SIZE = 250;

// ─── Non-tire blocklist ───────────────────────────────────────────────────────
const NON_TIRE_KEYWORDS = [
  'installation', 'service', 'balancing', 'mounting', 'valve', 'tpms',
  'bottle', 'vacuum', 'cleaner', 'massager', 'cervical', 'neck',
  'shoulder', 'relaxer', 'nuproz', 'water', 'gym', 'sports drinking',
  'home appliance', 'cordless', 'handheld', 'suction',
  'wheel', 'rim', 'hub cap',
];

// Tire product must match at least one of these
const TIRE_PATTERN = /tire|tyre|pneu|R1[5-9]|R2[0-2]|\bLT\b|\bXL\b|3PMSF|\d{3}\/\d{2}R\d{2}/i;

// ─── Helpers ──────────────────────────────────────────────────────────────────
function delay(ms: number) { return new Promise(r => setTimeout(r, ms)); }

interface ShopifyProduct {
  id: number;
  title: string;
  vendor: string;
  tags: string;
  product_type: string;
}

async function shopifyFetchRaw(url: string, options: RequestInit = {}): Promise<Response> {
  let wait = 2000;
  while (true) {
    const res = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': SHOPIFY.token,
        ...(options.headers ?? {}),
      },
    });
    if (res.status === 429) {
      console.log(`[tagAiMatch] Rate limited — waiting ${wait}ms`);
      await delay(wait);
      wait = Math.min(wait * 2, 16000);
      continue;
    }
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Shopify ${res.status} on ${url}: ${body.slice(0, 300)}`);
    }
    return res;
  }
}

async function fetchAllProducts(): Promise<ShopifyProduct[]> {
  const all: ShopifyProduct[] = [];
  let url: string | null =
    `${SHOPIFY.baseUrl}/products.json?limit=250&fields=id,title,vendor,tags,product_type`;
  let page = 0;

  while (url) {
    page++;
    const res  = await shopifyFetchRaw(url);
    const data: { products: ShopifyProduct[] } = await res.json();
    all.push(...(data.products ?? []));
    console.log(`[tagAiMatch] page ${page}: ${data.products?.length ?? 0} products (total so far: ${all.length})`);

    const link  = res.headers.get('Link') ?? '';
    const nextM = link.match(/<([^>]+)>;\s*rel="next"/);
    url = nextM ? nextM[1] : null;
  }

  return all;
}

async function addTagToProduct(product: ShopifyProduct, newTag: string): Promise<void> {
  const existing = product.tags.split(',').map(t => t.trim()).filter(Boolean);
  if (existing.includes(newTag)) return; // already there (double-check)

  const merged = [...existing, newTag].join(', ');

  await shopifyFetchRaw(`${SHOPIFY.baseUrl}/products/${product.id}.json`, {
    method: 'PUT',
    body: JSON.stringify({ product: { id: product.id, tags: merged } }),
  });
}

// ─── Handler ──────────────────────────────────────────────────────────────────
export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Content-Type', 'application/json');

  if (!SHOPIFY.domain || !SHOPIFY.token) {
    return res.status(500).json({
      error: 'Missing SHOPIFY_STORE_DOMAIN or SHOPIFY_ADMIN_ACCESS_TOKEN env vars',
    });
  }

  const preview   = req.query.preview === 'true';
  const cursor    = req.query.cursor ? parseInt(req.query.cursor as string, 10) : 0;
  const TAG       = 'ai-match';

  // ── Fetch all products ─────────────────────────────────────────────────────
  let allProducts: ShopifyProduct[];
  try {
    allProducts = await fetchAllProducts();
  } catch (err) {
    return res.status(500).json({ error: `Failed to fetch products: ${String(err)}` });
  }

  const total = allProducts.length;

  // ── Classify products ──────────────────────────────────────────────────────
  const tireProducts   = allProducts.filter(p => {
    const titleLow = p.title.toLowerCase();
    const isBlocked = NON_TIRE_KEYWORDS.some(kw => titleLow.includes(kw));
    const isTire    = TIRE_PATTERN.test(p.title);
    return !isBlocked && isTire;
  });

  const skipped     = total - tireProducts.length;
  const alreadyTagged = tireProducts.filter(p => {
    const tags = p.tags.split(',').map(t => t.trim());
    return tags.includes(TAG);
  });
  const needsTag    = tireProducts.filter(p => {
    const tags = p.tags.split(',').map(t => t.trim());
    return !tags.includes(TAG);
  });

  // ── Paginate the needsTag chunk ────────────────────────────────────────────
  const chunk      = needsTag.slice(cursor, cursor + CHUNK_SIZE);
  const nextCursor = (cursor + CHUNK_SIZE) < needsTag.length
    ? cursor + CHUNK_SIZE
    : null;

  // ── Brand breakdown (for the audit report) ─────────────────────────────────
  const brandCount: Record<string, { total: number; missing: number }> = {};
  for (const p of tireProducts) {
    const v = p.vendor || 'Unknown';
    if (!brandCount[v]) brandCount[v] = { total: 0, missing: 0 };
    brandCount[v].total++;
  }
  for (const p of needsTag) {
    const v = p.vendor || 'Unknown';
    if (!brandCount[v]) brandCount[v] = { total: 0, missing: 0 };
    brandCount[v].missing++;
  }

  // ── Apply tags (unless preview) ────────────────────────────────────────────
  let added   = 0;
  const errors: string[] = [];
  const previewItems: { id: number; title: string; vendor: string; tags: string }[] = [];

  for (const product of chunk) {
    previewItems.push({
      id:     product.id,
      title:  product.title,
      vendor: product.vendor,
      tags:   product.tags,
    });

    if (!preview) {
      try {
        await addTagToProduct(product, TAG);
        added++;
      } catch (err) {
        errors.push(`#${product.id} "${product.title}": ${String(err)}`);
      }
      // Polite pause — avoid hammering rate limits
      await delay(150);
    } else {
      added++; // count as "would add" in preview
    }
  }

  const summary = {
    preview,
    cursor,
    nextCursor,
    total,
    tireProducts:   tireProducts.length,
    alreadyTagged:  alreadyTagged.length,
    needsTagTotal:  needsTag.length,
    processedThisRun: chunk.length,
    added,
    skippedNonTire: skipped,
    errors,
    brandBreakdown: Object.entries(brandCount)
      .sort((a, b) => b[1].missing - a[1].missing)
      .map(([brand, counts]) => ({ brand, ...counts })),
    previewSample: previewItems.slice(0, 50),
  };

  console.log(`[tagAiMatch] Done — total=${total} tires=${tireProducts.length} needsTag=${needsTag.length} added=${added} errors=${errors.length} preview=${preview}`);

  return res.status(200).json(summary);
}
