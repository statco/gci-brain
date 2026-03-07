// api/auditTags.ts
// ============================================================
// Shopify Tag Auditor
//
// Fetches all products and collects every unique tag with a count
// of how many products carry that tag, plus a sample of 3 titles.
//
// GET /api/auditTags                  — all tags (minCount=1)
// GET /api/auditTags?minCount=5       — only tags on 5+ products
// ============================================================

import type { VercelRequest, VercelResponse } from '@vercel/node';

export const config = { maxDuration: 300 };

// ─── SHOPIFY CONFIG ───────────────────────────────────────────────────────────

const SHOPIFY = {
  domain:     process.env.SHOPIFY_STORE_DOMAIN       || '',
  token:      process.env.SHOPIFY_ADMIN_ACCESS_TOKEN || '',
  apiVersion: '2024-01',
  get baseUrl() { return `https://${this.domain}/admin/api/${this.apiVersion}`; },
};

// ─── HELPERS ──────────────────────────────────────────────────────────────────

function delay(ms: number) { return new Promise(r => setTimeout(r, ms)); }

async function shopifyFetchRaw(url: string, options: RequestInit = {}): Promise<Response> {
  const res = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': SHOPIFY.token,
      ...(options.headers || {}),
    },
  });
  if (res.status === 429) { await delay(2000); return shopifyFetchRaw(url, options); }
  if (!res.ok) throw new Error(`Shopify ${res.status} on ${url}: ${(await res.text()).slice(0, 200)}`);
  return res;
}

// ─── FETCH ALL PRODUCTS ───────────────────────────────────────────────────────

interface ShopifyProduct { id: number; title: string; tags: string; }

async function fetchAllProducts(): Promise<ShopifyProduct[]> {
  const all: ShopifyProduct[] = [];
  let url: string = `${SHOPIFY.baseUrl}/products.json?limit=250&fields=id,title,tags`;
  let page = 0;

  while (url) {
    page++;
    const response = await shopifyFetchRaw(url);
    const data: any = await response.json();
    const products: ShopifyProduct[] = data.products || [];
    all.push(...products);
    console.log(`  [auditTags] page ${page}: fetched ${products.length} products (running total: ${all.length})`);

    const link = response.headers.get('Link') || '';
    const next = link.match(/<([^>]+)>;\s*rel="next"/);
    url = next ? next[1] : '';
  }

  console.log(`  [auditTags] done — ${page} page(s), ${all.length} total products`);
  return all;
}

// ─── HANDLER ──────────────────────────────────────────────────────────────────

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Content-Type', 'application/json');

  if (!SHOPIFY.domain || !SHOPIFY.token) {
    return res.status(500).json({ error: 'Missing SHOPIFY_STORE_DOMAIN or SHOPIFY_ADMIN_ACCESS_TOKEN' });
  }

  const minCount = req.query.minCount ? parseInt(req.query.minCount as string, 10) : 1;

  console.log(`🏷️  auditTags — minCount=${minCount}`);

  let products: ShopifyProduct[];
  try {
    products = await fetchAllProducts();
  } catch (err) {
    return res.status(500).json({ error: `Failed to fetch products: ${String(err)}` });
  }

  // Collect tag stats
  const tagMap: Record<string, { count: number; sample: string[] }> = {};

  for (const product of products) {
    const tags = (product.tags || '')
      .split(',')
      .map(t => t.trim())
      .filter(Boolean);

    for (const tag of tags) {
      if (!tagMap[tag]) tagMap[tag] = { count: 0, sample: [] };
      tagMap[tag].count++;
      if (tagMap[tag].sample.length < 3) tagMap[tag].sample.push(product.title);
    }
  }

  // Apply minCount filter
  const uniqueTags: Record<string, { count: number; sample: string[] }> = {};
  for (const [tag, data] of Object.entries(tagMap)) {
    if (data.count >= minCount) uniqueTags[tag] = data;
  }

  const total = Object.keys(uniqueTags).length;
  console.log(`✅ auditTags done — ${products.length} products, ${total} unique tags (minCount=${minCount})`);

  return res.status(200).json({ total, uniqueTags });
}
