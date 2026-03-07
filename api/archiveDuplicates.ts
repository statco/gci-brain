// api/archiveDuplicates.ts
// ============================================================
// Archive duplicate Shopify products by normalized title
//
// For each group of duplicate products (same normalized title), keeps the
// product with the lowest numeric ID (oldest) and archives all others by
// setting status: "draft" via Shopify PUT.
//
// Skips any product whose title contains: installation, service, balancing, mounting
//
// GET /api/archiveDuplicates                             — dry run by default (preview)
// GET /api/archiveDuplicates?dry=true                   — explicit dry run
// GET /api/archiveDuplicates?dry=false                  — perform real archival
// GET /api/archiveDuplicates?chunkSize=25&offset=0      — pagination over groups
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

async function shopifyFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await shopifyFetchRaw(`${SHOPIFY.baseUrl}${path}`, options);
  if (res.status === 204 || res.headers.get('content-length') === '0') return {} as T;
  return res.json() as Promise<T>;
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
    console.log(`  [archiveDuplicates] page ${page}: fetched ${products.length} products (running total: ${all.length})`);

    const link = response.headers.get('Link') || '';
    const next = link.match(/<([^>]+)>;\s*rel="next"/);
    url = next ? next[1] : '';
  }

  console.log(`  [archiveDuplicates] done — ${page} page(s), ${all.length} total products`);
  return all;
}

// ─── NORMALIZATION ────────────────────────────────────────────────────────────

function normalizeTitle(title: string): string {
  return title.toLowerCase().trim().replace(/\s+/g, ' ');
}

const SKIP_KEYWORDS = ['installation', 'service', 'balancing', 'mounting'];

function shouldSkip(title: string): boolean {
  const lower = title.toLowerCase();
  return SKIP_KEYWORDS.some(kw => lower.includes(kw));
}

// ─── HANDLER ──────────────────────────────────────────────────────────────────

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Content-Type', 'application/json');

  const dryRun    = req.query.dry       !== 'false';  // default true (safe)
  const chunkSize = req.query.chunkSize ? parseInt(req.query.chunkSize as string, 10) : 25;
  const offset    = req.query.offset    ? parseInt(req.query.offset    as string, 10) : 0;

  if (!SHOPIFY.domain || !SHOPIFY.token) {
    return res.status(500).json({ error: 'Missing SHOPIFY_STORE_DOMAIN or SHOPIFY_ADMIN_ACCESS_TOKEN' });
  }

  console.log(`🗂️  archiveDuplicates — dry=${dryRun} chunkSize=${chunkSize} offset=${offset}`);

  let allProducts: ShopifyProduct[];
  try {
    allProducts = await fetchAllProducts();
  } catch (err) {
    return res.status(500).json({ error: `Failed to fetch products: ${String(err)}` });
  }

  // Group by normalized title (skip service/install products entirely)
  const grouped = new Map<string, ShopifyProduct[]>();
  let skipped = 0;

  for (const product of allProducts) {
    if (shouldSkip(product.title)) {
      skipped++;
      continue;
    }
    const key = normalizeTitle(product.title);
    const group = grouped.get(key);
    if (group) {
      group.push(product);
    } else {
      grouped.set(key, [product]);
    }
  }

  // Collect duplicate groups (2+ products), sorted by normalized title for stable pagination
  const duplicateGroups = Array.from(grouped.entries())
    .filter(([, products]) => products.length >= 2)
    .sort(([a], [b]) => a.localeCompare(b));

  // Apply offset/chunkSize pagination over groups
  const chunk = duplicateGroups.slice(offset, offset + chunkSize);
  const nextOffset = (offset + chunkSize) < duplicateGroups.length ? offset + chunkSize : null;

  let archived = 0;
  const errors: string[] = [];
  const changes: Array<{ id: number; title: string; action: 'archived' }> = [];

  for (const [, products] of chunk) {
    // Sort by id ascending so lowest id (oldest) is first
    products.sort((a, b) => a.id - b.id);
    const [_kept, ...toArchive] = products;

    for (const product of toArchive) {
      // Skip if already archived
      if (product.status === 'draft') {
        skipped++;
        console.log(`  [skip already draft] ${product.id} "${product.title}"`);
        continue;
      }

      console.log(`  [archive] ${product.id} "${product.title}"`);
      changes.push({ id: product.id, title: product.title, action: 'archived' });

      if (!dryRun) {
        try {
          await shopifyFetch(`/products/${product.id}.json`, {
            method: 'PUT',
            body: JSON.stringify({ product: { id: product.id, status: 'draft' } }),
          });
        } catch (err) {
          const msg = `Product ${product.id} ("${product.title}"): ${String(err)}`;
          console.error(`  ❌ ${msg}`);
          errors.push(msg);
          continue;
        }
      }

      archived++;
    }
  }

  const summary = {
    dryRun,
    total: allProducts.length,
    archived,
    skipped,
    errors,
    changes,
    offset,
    chunkSize,
    nextOffset,
  };

  console.log(`✅ Done — archived:${archived} skipped:${skipped} errors:${errors.length} nextOffset:${nextOffset}`);
  return res.status(200).json(summary);
}
