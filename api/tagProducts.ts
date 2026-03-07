// api/tagProducts.ts
// ============================================================
// Shopify Product Tagger — derive and backfill classification tags
//
// For each product, derives season / vehicle-type / brand tags from
// its title using classifyTire(), then merges them with existing tags
// (never removes existing tags, only adds new ones).
//
// GET /api/tagProducts                               — first chunk (chunkSize=25)
// GET /api/tagProducts?dry=true                      — preview (no saves)
// GET /api/tagProducts?force=true                    — re-tag even if tags already present
// GET /api/tagProducts?offset=25&chunkSize=25        — next batch
// GET /api/tagProducts?productId=123456789           — single product
// GET /api/tagProducts?removeTags=tag1,tag2          — strip tags before merging
// ============================================================

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { classifyTire } from '../lib/classifyTire.js';

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
    console.log(`  [tagProducts] page ${page}: fetched ${products.length} products (running total: ${all.length})`);

    const link = response.headers.get('Link') || '';
    const next = link.match(/<([^>]+)>;\s*rel="next"/);
    url = next ? next[1] : '';
  }

  console.log(`  [tagProducts] done — ${page} page(s), ${all.length} total products`);
  return all;
}

// ─── TAG NORMALIZATION ────────────────────────────────────────────────────────

const TAG_NORMALIZE: Record<string, string> = {
  'Winter': 'winter',
  'hiver': 'winter',
  'Winter_Rated_3PMSF': 'winter',
  'all-season-tire': 'all-season',
  'Season_All-Season': 'all-season',
  'VREDESTEIN': 'brand-vredestein',
  'tire-type-passenger': 'passenger',
  'Passenger': 'passenger',
  'truck': 'light-truck',
};

// ─── STRIP TAGS ───────────────────────────────────────────────────────────────

function stripTags(existing: string, tagsToRemove: string[]): { stripped: string; removed: string[] } {
  if (tagsToRemove.length === 0) return { stripped: existing, removed: [] };
  const removeSet = new Set(tagsToRemove);
  const parsed = existing.split(',').map(t => t.trim()).filter(Boolean);
  const removed: string[] = [];
  const kept: string[] = [];
  for (const tag of parsed) {
    if (removeSet.has(tag)) {
      removed.push(tag);
    } else {
      kept.push(tag);
    }
  }
  return { stripped: kept.join(', '), removed };
}

// ─── DERIVE TAGS ──────────────────────────────────────────────────────────────

const SEASON_TAGS = ['winter', 'all-weather', 'all-season', 'all-terrain', 'summer'];
const VEHICLE_TAGS = ['passenger', 'suv', 'light-truck', 'tire-type-passenger', 'Passenger', 'truck'];

interface Classified { season: string | null; vehicleType: string | null; brand: string | null; }

function deriveTags(title: string): { tags: string[]; classified: Classified } {
  const classified = classifyTire(title);
  const tags = [classified.season, classified.vehicleType, classified.brand].filter((t): t is string => t !== null);
  return { tags, classified };
}

function mergeTags(existing: string, newTags: string[], classified: Classified): { merged: string; added: string[] } {
  // Parse existing tags and normalize legacy/inconsistent ones
  const rawTags = existing.split(',').map(t => t.trim()).filter(Boolean);
  let normalizedTags = rawTags.map(t => TAG_NORMALIZE[t] ?? t);

  // If classifyTire gave us a definitive season, strip conflicting season tags
  if (classified.season) {
    normalizedTags = normalizedTags.filter(tag => !SEASON_TAGS.includes(tag) || tag === classified.season);
  }

  // If classifyTire gave us a definitive vehicleType, strip conflicting vehicle tags
  if (classified.vehicleType) {
    normalizedTags = normalizedTags.filter(tag => !VEHICLE_TAGS.includes(tag) || tag === classified.vehicleType);
  }

  const normalized = normalizedTags.join(', ');
  const normalizationChanged = normalized !== rawTags.join(', ');

  const existingSet = new Set(normalizedTags);
  const added: string[] = [];

  // Track normalization changes as "added" for change detection
  if (normalizationChanged) {
    for (const orig of rawTags) {
      const norm = TAG_NORMALIZE[orig];
      if (norm && norm !== orig) {
        added.push(`${orig}→${norm}`);
      }
    }
  }

  for (const tag of newTags) {
    if (!existingSet.has(tag)) {
      existingSet.add(tag);
      added.push(tag);
    }
  }
  return { merged: [...existingSet].join(', '), added };
}

// ─── HANDLER ──────────────────────────────────────────────────────────────────

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Content-Type', 'application/json');

  const dryRun     = req.query.dry        === 'true';
  const force      = req.query.force      === 'true';
  const productId  = req.query.productId  ? String(req.query.productId) : null;
  const offset     = req.query.offset     ? parseInt(req.query.offset    as string, 10) : 0;
  const chunkSize  = req.query.chunkSize  ? parseInt(req.query.chunkSize as string, 10) : 25;
  const removeTags = req.query.removeTags
    ? String(req.query.removeTags).split(',').map(t => t.trim()).filter(Boolean)
    : [];

  if (!SHOPIFY.domain || !SHOPIFY.token) {
    return res.status(500).json({ error: 'Missing SHOPIFY_STORE_DOMAIN or SHOPIFY_ADMIN_ACCESS_TOKEN' });
  }

  // ── Single-product mode ────────────────────────────────────────────────────
  if (productId) {
    console.log(`🏷️  tagProducts — single product mode productId=${productId} dry=${dryRun} force=${force}`);

    let product: ShopifyProduct;
    try {
      const data: any = await shopifyFetch<any>(`/products/${productId}.json?fields=id,title,tags`);
      product = data.product as ShopifyProduct;
      if (!product) throw new Error('Product not found');
    } catch (err) {
      return res.status(404).json({ error: `Failed to fetch product ${productId}: ${String(err)}` });
    }

    const { stripped, removed } = stripTags(product.tags, removeTags);
    const { tags: newTags, classified } = deriveTags(product.title);
    const { merged, added } = mergeTags(stripped, newTags, classified);
    const changed = removed.length > 0 || added.length > 0;

    if (changed && !dryRun) {
      try {
        await shopifyFetch(`/products/${product.id}.json`, {
          method: 'PUT',
          body: JSON.stringify({ product: { id: product.id, tags: merged } }),
        });
      } catch (err) {
        return res.status(500).json({ error: `Failed to update product ${productId}: ${String(err)}` });
      }
    }

    return res.status(200).json({
      dryRun,
      force,
      total: 1,
      updated: (changed || force) && !dryRun ? 1 : 0,
      skipped: !changed && !force ? 1 : 0,
      errors: [],
      changes: changed || force
        ? [{ id: product.id, title: product.title, removed, added, mergedTags: merged }]
        : [],
    });
  }

  // ── Batch mode ─────────────────────────────────────────────────────────────
  console.log(`🏷️  tagProducts — dry=${dryRun} force=${force} offset=${offset} chunkSize=${chunkSize}`);

  let allProducts: ShopifyProduct[];
  try {
    allProducts = await fetchAllProducts();
  } catch (err) {
    return res.status(500).json({ error: `Failed to fetch products: ${String(err)}` });
  }

  const products = allProducts.slice(offset, offset + chunkSize);
  const nextOffset = (offset + chunkSize) < allProducts.length ? offset + chunkSize : null;

  let updated = 0;
  let skipped = 0;
  const errors: string[] = [];
  const changes: Array<{ id: number; title: string; removed: string[]; added: string[]; mergedTags: string }> = [];

  const NON_TIRE_TITLES = ['installation', 'service', 'balancing', 'mounting'];

  for (const product of products) {
    const titleLower = product.title.toLowerCase();
    if (NON_TIRE_TITLES.some(kw => titleLower.includes(kw))) {
      skipped++;
      continue;
    }

    const { stripped, removed } = stripTags(product.tags, removeTags);
    const { tags: newTags, classified } = deriveTags(product.title);
    const { merged, added } = mergeTags(stripped, newTags, classified);
    const changed = removed.length > 0 || added.length > 0;

    if (!force && !changed) {
      skipped++;
      continue;
    }

    console.log(`  ${product.title} — removed: [${removed.join(', ')}] adding: [${added.join(', ')}]`);
    changes.push({ id: product.id, title: product.title, removed, added, mergedTags: merged });

    if (!dryRun) {
      try {
        await shopifyFetch(`/products/${product.id}.json`, {
          method: 'PUT',
          body: JSON.stringify({ product: { id: product.id, tags: merged } }),
        });
      } catch (err) {
        const msg = `Product ${product.id} ("${product.title}"): ${String(err)}`;
        console.error(`  ❌ ${msg}`);
        errors.push(msg);
        continue;
      }
    }

    updated++;
  }

  const summary = {
    dryRun,
    total: allProducts.length,
    offset,
    chunkSize,
    nextOffset,
    updated,
    skipped,
    errors,
    changes,
  };

  console.log(`✅ Done — offset:${offset} scanned:${products.length} updated:${updated} skipped:${skipped} errors:${errors.length} nextOffset:${nextOffset}`);
  return res.status(200).json(summary);
}
