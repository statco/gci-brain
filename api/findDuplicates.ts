// api/findDuplicates.ts
// ============================================================
// Find duplicate Shopify products by normalized title
//
// GET /api/findDuplicates                    — all groups with 2+ products
// GET /api/findDuplicates?minCount=3         — groups with 3+ products
// GET /api/findDuplicates?activeOnly=true    — only active products; groups with <2 active excluded
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

interface ShopifyProduct { id: number; title: string; status: string; }

async function fetchAllProducts(): Promise<ShopifyProduct[]> {
  const all: ShopifyProduct[] = [];
  let url: string = `${SHOPIFY.baseUrl}/products.json?limit=250&fields=id,title,status`;
  let page = 0;

  while (url) {
    page++;
    const response = await shopifyFetchRaw(url);
    const data: any = await response.json();
    const products: ShopifyProduct[] = data.products || [];
    all.push(...products);
    console.log(`  [findDuplicates] page ${page}: fetched ${products.length} products (running total: ${all.length})`);

    const link = response.headers.get('Link') || '';
    const next = link.match(/<([^>]+)>;\s*rel="next"/);
    url = next ? next[1] : '';
  }

  console.log(`  [findDuplicates] done — ${page} page(s), ${all.length} total products`);
  return all;
}

// ─── NORMALIZATION ────────────────────────────────────────────────────────────

function normalizeTitle(title: string): string {
  return title.toLowerCase().trim().replace(/\s+/g, ' ');
}

// ─── HANDLER ──────────────────────────────────────────────────────────────────

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Content-Type', 'application/json');

  const minCount  = req.query.minCount  ? parseInt(req.query.minCount as string, 10) : 2;
  const activeOnly = req.query.activeOnly === 'true';

  if (!SHOPIFY.domain || !SHOPIFY.token) {
    return res.status(500).json({ error: 'Missing SHOPIFY_STORE_DOMAIN or SHOPIFY_ADMIN_ACCESS_TOKEN' });
  }

  console.log(`🔍 findDuplicates — minCount=${minCount} activeOnly=${activeOnly}`);

  let allProducts: ShopifyProduct[];
  try {
    allProducts = await fetchAllProducts();
  } catch (err) {
    return res.status(500).json({ error: `Failed to fetch products: ${String(err)}` });
  }

  // Group by normalized title
  const grouped = new Map<string, ShopifyProduct[]>();
  for (const product of allProducts) {
    const key = normalizeTitle(product.title);
    const group = grouped.get(key);
    if (group) {
      group.push(product);
    } else {
      grouped.set(key, [product]);
    }
  }

  // Filter groups with count >= minCount, sort by count descending
  const groups = Array.from(grouped.entries())
    .map(([normalizedTitle, products]) => {
      const filtered = activeOnly ? products.filter(p => p.status === 'active') : products;
      return { normalizedTitle, products: filtered };
    })
    .filter(({ products }) => products.length >= minCount)
    .sort(({ products: a }, { products: b }) => b.length - a.length)
    .map(({ normalizedTitle, products }) => ({
      normalizedTitle,
      count: products.length,
      products: products.map(p => ({ id: p.id, title: p.title, status: p.status })),
    }));

  const totalDuplicates = groups.reduce((sum, g) => sum + g.count, 0);

  console.log(`✅ Done — totalProducts:${allProducts.length} totalGroups:${groups.length} totalDuplicates:${totalDuplicates} activeOnly:${activeOnly}`);

  return res.status(200).json({
    totalProducts: allProducts.length,
    totalGroups: groups.length,
    totalDuplicates,
    groups,
  });
}
