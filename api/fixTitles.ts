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
// GET /api/fixTitles?force=true                 — Re-process all (skip equality check)
// GET /api/fixTitles?limit=10                   — Legacy: first N products
// GET /api/fixTitles?productId=123456789        — Fix a single product by ID (bypasses pagination)
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

async function shopifyFetchRaw(url: string, options: RequestInit = {}): Promise<Response> {
  let wait = 2000;
  while (true) {
    const res = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': SHOPIFY.token,
        ...(options.headers || {}),
      },
    });
    if (res.status === 429) { await delay(wait); wait = Math.min(wait * 2, 16000); continue; }
    if (!res.ok) throw new Error(`Shopify ${res.status} on ${url}: ${(await res.text()).slice(0, 200)}`);
    return res;
  }
}

async function shopifyFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await shopifyFetchRaw(`${SHOPIFY.baseUrl}${path}`, options);
  if (res.status === 204 || res.headers.get('content-length') === '0') return {} as T;
  return res.json() as Promise<T>;
}

function convertToken(token: string): string {
  // Fix tire size format: 235/65r17 → 235/65R17
  if (/^\d+\/\d+[rR]\d+$/.test(token)) {
    return token.replace(/[rR](\d)/, 'R$1');
  }
  if (/^[A-Z]*[0-9]+[A-Z0-9]*$/.test(token)) return token;
  const upper = token.toUpperCase();
  if (/^(XL|XLT|SUV|ATX|4X4|4WD|AWD|AW|WS|HP|UHP|HT|LT|ST|GT|GTS|LE|SE|EV|SRX|OE|OEM|M\+S|3PMSF|OWL|BSW|VSB|STT|MTX|GTX|HL|AU|RU|RH|HI|CP|RS3)$/.test(upper)) return upper;
  return token.charAt(0).toUpperCase() + token.slice(1).toLowerCase();
}

function toTitleCase(original: string): string {
  return original.split(' ').map(word => {
    // Handle hyphenated words like SRX-LE
    if (word.includes('-')) {
      return word.split('-').map(part => convertToken(part)).join('-');
    }
    return convertToken(word);
  }).join(' ')
    .replace(/\/r\b/g, '/R'); // Restore /R in tire sizes (e.g. 225/60R17)
}

// ─── FETCH A SLICE OF TAGGED PRODUCTS (early-exit, no full-scan) ─────────────

interface ShopifyProduct { id: number; title: string; }

/**
 * Fetches only the products needed for the current batch (offset…offset+count).
 * Stops fetching Shopify pages as soon as the slice is full, avoiding the
 * long "idle" that occurred when the entire catalogue was loaded up-front.
 *
 * Returns the slice and a `hasMore` flag (true when a next batch exists).
 */
async function fetchTaggedProductSlice(
  offset: number,
  count: number,
): Promise<{ slice: ShopifyProduct[]; hasMore: boolean }> {
  let url: string = `${SHOPIFY.baseUrl}/products.json?tag=${SYNC_TAG}&limit=250&fields=id,title`;
  let seen = 0;
  const slice: ShopifyProduct[] = [];
  let page = 0;

  while (url) {
    page++;
    const response = await shopifyFetchRaw(url);
    const data: any = await response.json();
    const products: ShopifyProduct[] = data.products || [];
    console.log(`  [fetchTaggedProductSlice] page ${page}: +${products.length} products`);

    for (const p of products) {
      if (seen < offset) { seen++; continue; }
      if (slice.length < count) { slice.push(p); seen++; }
      else {
        // One extra product beyond the slice confirms a next batch exists.
        console.log(`  [fetchTaggedProductSlice] done — ${page} page(s), slice=${slice.length}, hasMore=true`);
        return { slice, hasMore: true };
      }
    }

    const link = response.headers.get('Link') || '';
    const next = link.match(/<([^>]+)>;\s*rel="next"/);
    url = next ? next[1] : '';
  }

  console.log(`  [fetchTaggedProductSlice] done — ${page} page(s), slice=${slice.length}, hasMore=false`);
  return { slice, hasMore: false };
}

// ─── HANDLER ──────────────────────────────────────────────────────────────────

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Content-Type', 'application/json');

  const dryRun    = req.query.dry   === 'true';
  const force     = req.query.force === 'true';
  const productId = req.query.productId ? String(req.query.productId) : null;
  const limit     = req.query.limit     ? parseInt(req.query.limit     as string, 10) : null;
  const offset    = req.query.offset    ? parseInt(req.query.offset    as string, 10) : 0;
  const chunkSize = req.query.chunkSize ? parseInt(req.query.chunkSize as string, 10) : 200;

  if (!SHOPIFY.domain || !SHOPIFY.token) {
    return res.status(500).json({ error: 'Missing SHOPIFY_STORE_DOMAIN or SHOPIFY_ADMIN_ACCESS_TOKEN' });
  }

  // ── Single-product mode ────────────────────────────────────────────────────
  if (productId) {
    console.log(`🔤 fixTitles — single product mode productId=${productId} dry=${dryRun} force=${force}`);

    let product: ShopifyProduct;
    try {
      const data: any = await shopifyFetch<any>(`/products/${productId}.json?fields=id,title`);
      product = data.product as ShopifyProduct;
      if (!product) throw new Error('Product not found');
    } catch (err) {
      return res.status(404).json({ error: `Failed to fetch product ${productId}: ${String(err)}` });
    }

    const newTitle = toTitleCase(product.title);
    const changed  = newTitle !== product.title;

    console.log(`  ${product.title} → ${newTitle}`);

    let didUpdate = false;
    if (changed && !dryRun) {
      try {
        await shopifyFetch(`/products/${product.id}.json`, {
          method: 'PUT',
          body: JSON.stringify({ product: { id: product.id, title: newTitle } }),
        });
        didUpdate = true;
      } catch (err) {
        return res.status(500).json({ error: `Failed to update product ${productId}: ${String(err)}` });
      }
    }

    return res.status(200).json({
      dryRun,
      force,
      productId: product.id,
      originalTitle: product.title,
      newTitle,
      changed,
      updated: didUpdate ? 1 : 0,
      skipped: didUpdate ? 0 : 1,
      errors: [],
    });
  }

  // ── Batch mode ─────────────────────────────────────────────────────────────
  console.log(`🔤 fixTitles — dry=${dryRun} force=${force} offset=${offset} chunkSize=${chunkSize} limit=${limit ?? 'all'}`);

  // When ?limit is set, cap the slice so we never exceed it.
  const effectiveCount = (limit !== null && !isNaN(limit))
    ? Math.max(0, Math.min(chunkSize, limit - offset))
    : chunkSize;

  let products: ShopifyProduct[];
  let hasMore: boolean;
  try {
    ({ slice: products, hasMore } = await fetchTaggedProductSlice(offset, effectiveCount));
  } catch (err) {
    return res.status(500).json({ error: `Failed to fetch products: ${String(err)}` });
  }

  // If ?limit caused us to clip, there is no next offset beyond the limit.
  const nextOffset = hasMore && (limit === null || isNaN(limit) || offset + chunkSize < limit)
    ? offset + chunkSize
    : null;

  let updated = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (const product of products) {
    const newTitle = toTitleCase(product.title);

    if (!force && newTitle === product.title) {
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
    force,
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
