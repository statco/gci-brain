// api/fixVendors.ts
// ============================================================
// Normalises Shopify product vendor names from ALL-CAPS to
// Title Case for the three brands currently affected:
//   NEXEN      → Nexen
//   COOPER     → Cooper
//   VREDESTEIN → Vredestein
//
// MODES
//   GET /api/fixVendors              — chunk 0 (50 products)
//   GET /api/fixVendors?cursor=50    — next chunk
//   GET /api/fixVendors?preview=true — dry run, no writes
//
// RESPONSE
//   { fixed, skipped, total, nextCursor, errors, preview }
//   preview — first 20 pairs { id, before, after }
// ============================================================

import type { VercelRequest, VercelResponse } from '@vercel/node';

export const config = { maxDuration: 300 };

// ─── CONFIG ───────────────────────────────────────────────────────────────────

const SHOPIFY = {
  domain:     process.env.SHOPIFY_STORE_DOMAIN       || '',
  token:      process.env.SHOPIFY_ADMIN_ACCESS_TOKEN || process.env.SHOPIFY_ADMIN_API_TOKEN || '',
  apiVersion: '2024-01',
  get baseUrl() { return `https://${this.domain}/admin/api/${this.apiVersion}`; },
};

const CHUNK_SIZE  = 50;
const WRITE_BATCH = 10;

// Exact-match vendor corrections (key = current ALL-CAPS value)
const VENDOR_MAP: Record<string, string> = {
  'NEXEN':      'Nexen',
  'COOPER':     'Cooper',
  'VREDESTEIN': 'Vredestein',
};

function delay(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

// ─── SHOPIFY ──────────────────────────────────────────────────────────────────

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
    if (!res.ok) throw new Error(`Shopify ${res.status}: ${(await res.text()).slice(0, 200)}`);
    return res;
  }
}

interface ShopifyProduct {
  id:     number;
  vendor: string;
}

async function fetchAllProducts(): Promise<ShopifyProduct[]> {
  const all: ShopifyProduct[] = [];
  let url: string | null =
    `${SHOPIFY.baseUrl}/products.json?limit=250&fields=id,vendor`;

  while (url) {
    const res  = await shopifyFetchRaw(url);
    const data: any = await res.json();
    all.push(...(data.products ?? []));
    const link = res.headers.get('Link') ?? '';
    const next = link.match(/<([^>]+)>;\s*rel="next"/);
    url = next ? next[1] : null;
  }

  return all;
}

async function updateVendor(productId: number, vendor: string): Promise<void> {
  await shopifyFetchRaw(`${SHOPIFY.baseUrl}/products/${productId}.json`, {
    method: 'PUT',
    body:   JSON.stringify({ product: { id: productId, vendor } }),
  });
}

// ─── HANDLER ──────────────────────────────────────────────────────────────────

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Content-Type', 'application/json');

  if (!SHOPIFY.domain || !SHOPIFY.token) {
    return res.status(500).json({ error: 'Missing SHOPIFY_STORE_DOMAIN or SHOPIFY_ADMIN_ACCESS_TOKEN' });
  }

  const preview = req.query.preview === 'true';
  const cursor  = req.query.cursor ? parseInt(String(req.query.cursor), 10) : 0;

  console.log(`fixVendors: preview=${preview} cursor=${cursor}`);

  // ── Fetch all products (fields: id, vendor only) ───────────────────────────
  let allProducts: ShopifyProduct[];
  try {
    allProducts = await fetchAllProducts();
  } catch (err) {
    return res.status(500).json({ error: `Failed to fetch products: ${String(err)}` });
  }

  // ── Filter to only products that need fixing ───────────────────────────────
  const needsFix = allProducts.filter(p => VENDOR_MAP[p.vendor] !== undefined);
  const total      = needsFix.length;
  const chunk      = needsFix.slice(cursor, cursor + CHUNK_SIZE);
  const nextCursor = (cursor + CHUNK_SIZE) < total ? cursor + CHUNK_SIZE : null;
  const skipped    = allProducts.length - total;

  console.log(`fixVendors: ${total} to fix (${skipped} already correct) | chunk=${chunk.length} cursor=${cursor} nextCursor=${nextCursor}`);

  // ── Preview mode ──────────────────────────────────────────────────────────
  if (preview) {
    const previewItems = needsFix.slice(0, 20).map(p => ({
      id:     p.id,
      before: p.vendor,
      after:  VENDOR_MAP[p.vendor],
    }));
    return res.status(200).json({ fixed: 0, skipped, total, nextCursor: null, errors: [], preview: previewItems });
  }

  // ── Write: batch concurrent PUTs ──────────────────────────────────────────
  let fixed = 0;
  const errors: string[] = [];

  for (let i = 0; i < chunk.length; i += WRITE_BATCH) {
    const batch = chunk.slice(i, i + WRITE_BATCH);

    await Promise.all(batch.map(async (product) => {
      const corrected = VENDOR_MAP[product.vendor]!;
      try {
        await updateVendor(product.id, corrected);
        fixed++;
        console.log(`  ✓ [${product.id}] "${product.vendor}" → "${corrected}"`);
      } catch (err) {
        const msg = `Product ${product.id} (vendor "${product.vendor}"): ${String(err)}`;
        console.error(`  ✗ ${msg}`);
        errors.push(msg);
      }
    }));

    if (i + WRITE_BATCH < chunk.length) await delay(200);
  }

  const report = { fixed, skipped, total, nextCursor, errors, preview: [] };
  console.log(`fixVendors: chunk done — fixed:${fixed} nextCursor:${nextCursor} errors:${errors.length}`);
  return res.status(200).json(report);
}
