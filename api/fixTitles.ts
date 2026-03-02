// api/fixTitles.ts
// ============================================================
// Shopify Product Title Fixer — Title Case Normalizer
//
// Fetches all products tagged `ct-sync` and converts their
// titles to Title Case.
//
// GET /api/fixTitles             — Run and apply all changes
// GET /api/fixTitles?dry=true    — Preview changes (no saves)
// GET /api/fixTitles?limit=10    — Process only first N products
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

const SYNC_TAG = 'ct-sync';

// ─── HELPERS ──────────────────────────────────────────────────────────────────

function delay(ms: number) { return new Promise(r => setTimeout(r, ms)); }

async function shopifyFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`${SHOPIFY.baseUrl}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': SHOPIFY.token,
      ...(options.headers || {}),
    },
  });
  if (res.status === 429) { await delay(2000); return shopifyFetch<T>(path, options); }
  if (!res.ok) throw new Error(`Shopify ${res.status} on ${path}: ${(await res.text()).slice(0, 200)}`);
  if (res.status === 204 || res.headers.get('content-length') === '0') return {} as T;
  return res.json() as Promise<T>;
}

function toTitleCase(original: string): string {
  return original.split(' ').map(word => {
    // Preserve fully-uppercase short tokens (model codes, acronyms e.g. WS90, ATX, SUV, XL, 4X4)
    if (/^[A-Z0-9]{2,6}$/.test(word)) return word;
    return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
  }).join(' ');
}

// ─── FETCH ALL TAGGED PRODUCTS (paginated) ────────────────────────────────────

interface ShopifyProduct { id: number; title: string; }

async function fetchAllTaggedProducts(): Promise<ShopifyProduct[]> {
  const all: ShopifyProduct[] = [];
  let sinceId = 0;

  while (true) {
    const q = `tag=${SYNC_TAG}&limit=250&fields=id,title${sinceId ? `&since_id=${sinceId}` : ''}`;
    const data: any = await shopifyFetch<any>(`/products.json?${q}`);
    const products: ShopifyProduct[] = data.products || [];
    all.push(...products);
    if (products.length < 250) break;
    sinceId = products[products.length - 1].id;
  }

  return all;
}

// ─── HANDLER ──────────────────────────────────────────────────────────────────

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Content-Type', 'application/json');

  const dryRun = req.query.dry === 'true';
  const limit  = req.query.limit ? parseInt(req.query.limit as string, 10) : null;

  if (!SHOPIFY.domain || !SHOPIFY.token) {
    return res.status(500).json({ error: 'Missing SHOPIFY_STORE_DOMAIN or SHOPIFY_ADMIN_ACCESS_TOKEN' });
  }

  console.log(`🔤 fixTitles — dry=${dryRun} limit=${limit ?? 'all'}`);

  let products: ShopifyProduct[];
  try {
    products = await fetchAllTaggedProducts();
  } catch (err) {
    return res.status(500).json({ error: `Failed to fetch products: ${String(err)}` });
  }

  if (limit !== null && !isNaN(limit)) {
    products = products.slice(0, limit);
  }

  let updated = 0;
  let skipped = 0;
  const errors: string[] = [];
  const changes: Array<{ id: number; old: string; new: string }> = [];

  for (const product of products) {
    const newTitle = toTitleCase(product.title);

    if (newTitle === product.title) {
      skipped++;
      continue;
    }

    console.log(`  ${product.title} → ${newTitle}`);
    changes.push({ id: product.id, old: product.title, new: newTitle });

    if (!dryRun) {
      try {
        await shopifyFetch(`/products/${product.id}.json`, {
          method: 'PUT',
          body: JSON.stringify({ product: { id: product.id, title: newTitle } }),
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
    totalScanned: products.length,
    updated,
    skipped,
    errors,
    changes,
  };

  console.log(`✅ Done — updated:${updated} skipped:${skipped} errors:${errors.length}`);
  return res.status(200).json(summary);
}
