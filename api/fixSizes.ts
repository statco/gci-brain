// api/fixSizes.ts
// ============================================================
// Shopify Product Size Fixer
//
// Finds products whose titles still contain a compact CT size code
// (e.g. "2256016/R") and rewrites them to standard format (225/60R16).
// Also adds the formatted size as a plain Shopify tag if missing.
//
// GET /api/fixSizes                            — First batch (chunkSize=200)
// GET /api/fixSizes?dry=true                   — Preview changes (no saves)
// GET /api/fixSizes?offset=200&chunkSize=200   — Next batch
// GET /api/fixSizes?force=true                 — Re-process all (skip equality check)
//
// Response shape matches fixTitles.ts:
//   { dryRun, force, total, offset, chunkSize, nextOffset,
//     totalScanned, updated, skipped, errors, changes }
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

// Matches compact CT size codes: exactly 7 digits followed by /R or /r (e.g. 2256016/R)
// Non-standard LT codes like 3713/R or 310/R have fewer digits and won't match.
const COMPACT_SIZE_RE = /\d{7}\/[Rr]/;

// "2256016/R" → "225/60R16"  (normalises to uppercase before matching)
function formatTireSize(code: string): string {
  const match = code.toUpperCase().match(/^(\d{3})(\d{2})(\d{2})\/R$/);
  if (!match) return code; // already formatted or unrecognised — leave alone
  return `${match[1]}/${match[2]}R${match[3]}`;
}

// ─── FETCH ALL TAGGED PRODUCTS ────────────────────────────────────────────────

interface ShopifyProduct { id: number; title: string; tags: string; }

async function fetchAllTaggedProducts(): Promise<ShopifyProduct[]> {
  const all: ShopifyProduct[] = [];
  let sinceId = 0;

  while (true) {
    const q = `tag=${SYNC_TAG}&limit=250&fields=id,title,tags${sinceId ? `&since_id=${sinceId}` : ''}`;
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

  const dryRun    = req.query.dry   === 'true';
  const force     = req.query.force === 'true';
  const offset    = req.query.offset    ? parseInt(req.query.offset    as string, 10) : 0;
  const chunkSize = req.query.chunkSize ? parseInt(req.query.chunkSize as string, 10) : 200;

  if (!SHOPIFY.domain || !SHOPIFY.token) {
    return res.status(500).json({ error: 'Missing SHOPIFY_STORE_DOMAIN or SHOPIFY_ADMIN_ACCESS_TOKEN' });
  }

  console.log(`📐 fixSizes — dry=${dryRun} force=${force} offset=${offset} chunkSize=${chunkSize}`);

  let allProducts: ShopifyProduct[];
  try {
    allProducts = await fetchAllTaggedProducts();
  } catch (err) {
    return res.status(500).json({ error: `Failed to fetch products: ${String(err)}` });
  }

  const pool       = allProducts;
  const products   = pool.slice(offset, offset + chunkSize);
  const nextOffset = (offset + chunkSize) < pool.length ? offset + chunkSize : null;

  let updated = 0;
  let skipped = 0;
  const errors:  string[] = [];
  const changes: Array<{ id: number; before: string; after: string; tagAdded: string | null }> = [];

  for (const product of products) {
    const compactMatch = product.title.match(COMPACT_SIZE_RE);

    if (!compactMatch && !force) {
      // No compact code in title — nothing to fix
      skipped++;
      continue;
    }

    const compactCode   = compactMatch?.[0] ?? null;
    const formattedSize = compactCode ? formatTireSize(compactCode) : null;
    // Replace compact code if found, then fix any remaining /r followed by a digit
    // (e.g. 305/65r17 → 305/65R17) — case-insensitive so previous partial runs are healed.
    const newTitle      = (compactCode ? product.title.replace(compactCode, formattedSize!) : product.title)
                            .replace(/\/r(\d)/gi, '/R$1');

    // Check whether the size tag is already present
    const existingTags  = product.tags ? product.tags.split(',').map(t => t.trim()) : [];
    const sizeTagNeeded = formattedSize && !existingTags.includes(formattedSize);
    const newTags       = sizeTagNeeded
      ? [...existingTags, formattedSize!].join(', ')
      : product.tags;

    const titleChanged = newTitle !== product.title;
    const tagsChanged  = newTags  !== product.tags;

    if (!force && !titleChanged && !tagsChanged) {
      skipped++;
      continue;
    }

    console.log(`  [${product.id}] "${product.title}" → "${newTitle}"${sizeTagNeeded ? ` +tag:${formattedSize}` : ''}`);
    changes.push({ id: product.id, before: product.title, after: newTitle, tagAdded: sizeTagNeeded ? formattedSize! : null });

    if (!dryRun) {
      try {
        const body: Record<string, any> = { id: product.id };
        if (titleChanged) body.title = newTitle;
        if (tagsChanged)  body.tags  = newTags;
        await shopifyFetch(`/products/${product.id}.json`, {
          method: 'PUT',
          body: JSON.stringify({ product: body }),
        });
      } catch (err) {
        const msg = `Product ${product.id} ("${product.title}"): ${String(err)}`;
        console.error(`  ❌ ${msg}`);
        errors.push(msg);
        changes.pop();
        continue;
      }
    }

    updated++;
  }

  const summary = {
    dryRun,
    force,
    total: pool.length,
    offset,
    chunkSize,
    nextOffset,
    totalScanned: products.length,
    updated,
    skipped,
    errors,
    changes,
  };

  console.log(`✅ Done — offset:${offset} scanned:${products.length} updated:${updated} skipped:${skipped} errors:${errors.length} nextOffset:${nextOffset}`);
  return res.status(200).json(summary);
}
