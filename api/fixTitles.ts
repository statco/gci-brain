// api/fixTitles.ts
// ============================================================
// Shopify Product Title Fixer — Title Case Normalizer
//
// Fetches all products tagged `ct-sync` and converts their
// titles to Title Case.
//
// GET /api/fixTitles                            — First batch (chunkSize=200)
// GET /api/fixTitles?dry=true                   — Preview changes (no saves)
// GET /api/fixTitles?offset=200&chunkSize=200   — Next batch
// GET /api/fixTitles?limit=10                   — Legacy: first N products
//
// Pagination: pass offset/chunkSize to process in batches without
// hitting the Vercel timeout. The response includes nextOffset
// (null when all products have been processed).
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

// Preserve model codes (tokens containing digits, e.g. WS90, P225, 4X4)
// and known short acronyms. Plain all-caps words like COOPER/COBRA won't
// match and will be title-cased normally.
const PRESERVE_TOKEN =
  /^[A-Z]*[0-9]+[A-Z0-9]*$|^(XL|XLT|SUV|ATX|4X4|4WD|AWD|AW|WS|HP|UHP|HT|LT|ST|GT|GTS|LE|SE|EV|SRX|OE|OEM|M\+S|3PMSF|OWL|BSW|VSB)$/;

function toTitleCase(original: string): string {
  return original.split(' ').map(word => {
    if (PRESERVE_TOKEN.test(word)) return word;
    return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
  }).join(' ')
    .replace(/\/r\b/g, '/R'); // Restore /R in tire sizes (e.g. 225/60R17)
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

  const dryRun    = req.query.dry === 'true';
  const limit     = req.query.limit     ? parseInt(req.query.limit     as string, 10) : null;
  const offset    = req.query.offset    ? parseInt(req.query.offset    as string, 10) : 0;
  const chunkSize = req.query.chunkSize ? parseInt(req.query.chunkSize as string, 10) : 200;

  if (!SHOPIFY.domain || !SHOPIFY.token) {
    return res.status(500).json({ error: 'Missing SHOPIFY_STORE_DOMAIN or SHOPIFY_ADMIN_ACCESS_TOKEN' });
  }

  console.log(`🔤 fixTitles — dry=${dryRun} offset=${offset} chunkSize=${chunkSize} limit=${limit ?? 'all'}`);

  let allProducts: ShopifyProduct[];
  try {
    allProducts = await fetchAllTaggedProducts();
  } catch (err) {
    return res.status(500).json({ error: `Failed to fetch products: ${String(err)}` });
  }

  // Apply legacy ?limit first, then window the pool by offset/chunkSize
  const pool     = (limit !== null && !isNaN(limit)) ? allProducts.slice(0, limit) : allProducts;
  const products = pool.slice(offset, offset + chunkSize);
  const nextOffset = (offset + chunkSize) < pool.length ? offset + chunkSize : null;

  let updated = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (const product of products) {
    const newTitle = toTitleCase(product.title);

    if (newTitle === product.title) {
      skipped++;
      continue;
    }

    console.log(`  ${product.title} → ${newTitle}`);

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
    total: pool.length,
    offset,
    chunkSize,
    nextOffset,
    totalScanned: products.length,
    updated,
    skipped,
    errors,
  };

  console.log(`✅ Done — offset:${offset} scanned:${products.length} updated:${updated} skipped:${skipped} errors:${errors.length} nextOffset:${nextOffset}`);
  return res.status(200).json(summary);
}
