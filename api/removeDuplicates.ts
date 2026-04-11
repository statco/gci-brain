// api/removeDuplicates.ts
// ============================================================
// Remove duplicate Shopify tire products identified by handle suffix
//
// Products are duplicates when their handle matches another product's
// handle with a trailing -1 / -2 / -3 / -4 suffix stripped.
//
//   Canonical:  nexen-winguard-sport-2-21545r17
//   Duplicate:  nexen-winguard-sport-2-21545r17-1
//
// GET /api/removeDuplicates               — chunk 0 (50 duplicates)
// GET /api/removeDuplicates?cursor=50     — next chunk
// GET /api/removeDuplicates?preview=true  — first 20, no deletes
//
// RESPONSE
//   { deleted, skipped, total, nextCursor, preview, errors }
//   deleted    — products permanently deleted (or would-be in preview)
//   skipped    — skipped because already archived, higher stock, or no canonical found
//   total      — total duplicate products identified across all pages
//   nextCursor — numeric offset for the next call; null when done
//   preview    — up to 20 items { duplicateHandle, canonicalHandle, priceDiff, … }
//   errors     — per-product error strings
//
// SAFETY RULES
//   - Only deletes when a no-suffix canonical product exists
//   - Never deletes the canonical (no-suffix) product itself
//   - Skips duplicates whose total inventory exceeds the canonical's
//   - Skips already-archived (status: draft) products
// ============================================================

import type { VercelRequest, VercelResponse } from '@vercel/node';

export const config = { maxDuration: 300 };

// ─── SHOPIFY CONFIG ───────────────────────────────────────────────────────────

const SHOPIFY = {
  domain:     process.env.SHOPIFY_STORE_DOMAIN       || '',
  token:      process.env.SHOPIFY_ADMIN_ACCESS_TOKEN || process.env.SHOPIFY_ADMIN_API_TOKEN || '',
  apiVersion: '2024-01',
  get baseUrl() { return `https://${this.domain}/admin/api/${this.apiVersion}`; },
};

const CHUNK_SIZE = 50;

// ─── HELPERS ──────────────────────────────────────────────────────────────────

function delay(ms: number) { return new Promise(r => setTimeout(r, ms)); }

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
    if (res.status === 429) { await delay(wait); wait = Math.min(wait * 2, 16000); continue; }
    if (!res.ok) throw new Error(`Shopify ${res.status} — ${url}: ${(await res.text()).slice(0, 200)}`);
    return res;
  }
}

async function shopifyFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await shopifyFetchRaw(`${SHOPIFY.baseUrl}${path}`, options);
  if (res.status === 204 || res.headers.get('content-length') === '0') return {} as T;
  return res.json() as Promise<T>;
}

// ─── TYPES ────────────────────────────────────────────────────────────────────

interface ShopifyVariant { price: string; inventory_quantity: number; }
interface ShopifyProduct {
  id:       number;
  handle:   string;
  title:    string;
  status:   string;
  variants: ShopifyVariant[];
}

// ─── PRODUCT FETCHER ──────────────────────────────────────────────────────────

async function fetchAllProducts(): Promise<ShopifyProduct[]> {
  const all: ShopifyProduct[] = [];
  let url: string | null =
    `${SHOPIFY.baseUrl}/products.json?limit=250&fields=id,handle,title,status,variants`;
  let page = 0;
  while (url) {
    page++;
    const res = await shopifyFetchRaw(url);
    const data: any = await res.json();
    const products: ShopifyProduct[] = data.products ?? [];
    all.push(...products);
    console.log(`[removeDuplicates] page ${page}: ${products.length} products (total: ${all.length})`);
    const link  = res.headers.get('Link') ?? '';
    const nextM = link.match(/<([^>]+)>;\s*rel="next"/);
    url = nextM ? nextM[1] : null;
  }
  return all;
}

// ─── DUPLICATE DETECTION ──────────────────────────────────────────────────────

/** Strip -1 / -2 / -3 / -4 suffix from a handle to get the canonical base handle */
function baseHandle(handle: string): string {
  return handle.replace(/-[1-4]$/, '');
}

function totalStock(product: ShopifyProduct): number {
  return product.variants.reduce((sum, v) => sum + (v.inventory_quantity ?? 0), 0);
}

function firstPrice(product: ShopifyProduct): number {
  return parseFloat(product.variants[0]?.price ?? '0');
}

function formatPriceDiff(duplicate: ShopifyProduct, canonical: ShopifyProduct): string {
  const diff = firstPrice(duplicate) - firstPrice(canonical);
  if (Math.abs(diff) < 0.01) return 'same price';
  const abs = Math.abs(diff).toFixed(2);
  return diff > 0 ? `+$${abs}` : `-$${abs}`;
}

interface DuplicatePair { canonical: ShopifyProduct; duplicate: ShopifyProduct; }

function findDuplicatePairs(products: ShopifyProduct[]): DuplicatePair[] {
  // Build handle → product lookup
  const byHandle = new Map<string, ShopifyProduct>();
  for (const p of products) byHandle.set(p.handle, p);

  const pairs: DuplicatePair[] = [];
  for (const product of products) {
    const base = baseHandle(product.handle);
    // This product is already canonical (no suffix) — skip
    if (product.handle === base) continue;
    // Only pair when a canonical (no-suffix) product actually exists
    const canonical = byHandle.get(base);
    if (!canonical) continue;
    pairs.push({ canonical, duplicate: product });
  }

  // Stable sort by duplicate handle for consistent pagination across calls
  pairs.sort((a, b) => a.duplicate.handle.localeCompare(b.duplicate.handle));
  return pairs;
}

// ─── HANDLER ──────────────────────────────────────────────────────────────────

export interface PreviewItem {
  duplicateHandle: string;
  canonicalHandle: string;
  priceDiff:       string;
  duplicateStock:  number;
  canonicalStock:  number;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Content-Type', 'application/json');

  if (!SHOPIFY.domain || !SHOPIFY.token) {
    return res.status(500).json({ error: 'Missing SHOPIFY_STORE_DOMAIN or SHOPIFY_ADMIN_ACCESS_TOKEN' });
  }

  const cursor  = req.query.cursor  ? parseInt(req.query.cursor as string, 10) : 0;
  const preview = req.query.preview === 'true';

  let allProducts: ShopifyProduct[];
  try {
    allProducts = await fetchAllProducts();
  } catch (err) {
    return res.status(500).json({ error: `Failed to fetch products: ${String(err)}` });
  }

  const allPairs   = findDuplicatePairs(allProducts);
  const total      = allPairs.length;
  const chunk      = allPairs.slice(cursor, cursor + CHUNK_SIZE);
  const nextCursor = (cursor + CHUNK_SIZE) < total ? cursor + CHUNK_SIZE : null;

  let deleted = 0;
  let skipped = 0;
  const errors: string[]       = [];
  const previewItems: PreviewItem[] = [];

  for (const { canonical, duplicate } of chunk) {
    const dupStock = totalStock(duplicate);
    const canStock = totalStock(canonical);

    // Skip already-archived duplicates
    if (duplicate.status === 'draft') {
      skipped++;
      continue;
    }

    // Skip if duplicate holds more stock than the canonical (safety guard)
    if (dupStock > canStock) {
      console.log(`[removeDuplicates] skip higher-stock dup: ${duplicate.handle} (dup=${dupStock} can=${canStock})`);
      skipped++;
      continue;
    }

    previewItems.push({
      duplicateHandle: duplicate.handle,
      canonicalHandle: canonical.handle,
      priceDiff:       formatPriceDiff(duplicate, canonical),
      duplicateStock:  dupStock,
      canonicalStock:  canStock,
    });
    deleted++;

    if (!preview) {
      try {
        await shopifyFetch(`/products/${duplicate.id}.json`, { method: 'DELETE' });
        console.log(`[removeDuplicates] deleted ${duplicate.handle} (id=${duplicate.id})`);
      } catch (err) {
        errors.push(`${duplicate.handle} (id=${duplicate.id}): ${String(err)}`);
        deleted--;
      }
    }
  }

  console.log(
    `[removeDuplicates] cursor=${cursor} total=${total} deleted=${deleted} ` +
    `skipped=${skipped} errors=${errors.length} preview=${preview} nextCursor=${nextCursor}`,
  );

  return res.status(200).json({
    deleted,
    skipped,
    total,
    nextCursor,
    preview: previewItems.slice(0, 20),
    errors,
  });
}
