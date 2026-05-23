// api/duplicateSkuAudit.ts
// ============================================================
// Duplicate SKU Audit — find and optionally clear duplicate TIRE- SKUs
//
// GET /api/duplicateSkuAudit?action=scan                        — all products
// GET /api/duplicateSkuAudit?action=scan&ctSyncOnly=true        — ct-sync tagged products only
// GET /api/duplicateSkuAudit?action=fix                        — clear duplicate SKUs (live write)
// GET /api/duplicateSkuAudit?action=fix&dry=true               — fix dry run (no writes)
// GET /api/duplicateSkuAudit?action=fix&offset=0&chunkSize=20  — chunked execution
//
// Only considers SKUs that start with 'TIRE-'.
// For each duplicate SKU group, the variant on the product with the lowest
// numeric productId is kept; all others have their SKU cleared to "".
// ============================================================

import type { VercelRequest, VercelResponse } from '@vercel/node';

export const config = { maxDuration: 300 };

// ─── CONFIG ───────────────────────────────────────────────────────────────────

const SHOPIFY = {
  domain:     process.env.SHOPIFY_STORE_DOMAIN       || '',
  token:      process.env.SHOPIFY_ADMIN_ACCESS_TOKEN || '',
  apiVersion: '2024-01',
  get baseUrl() { return `https://${this.domain}/admin/api/${this.apiVersion}`; },
};

// ─── HELPERS ──────────────────────────────────────────────────────────────────

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

async function shopifyFetchRaw(url: string, options: RequestInit = {}): Promise<Response> {
  const res = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': SHOPIFY.token,
      ...(options.headers || {}),
    },
  });
  if (res.status === 429) { await sleep(2000); return shopifyFetchRaw(url, options); }
  if (!res.ok) throw new Error(`Shopify ${res.status} on ${url}: ${(await res.text()).slice(0, 1000)}`);
  return res;
}

async function shopifyFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await shopifyFetchRaw(`${SHOPIFY.baseUrl}${path}`, options);
  if (res.status === 204 || res.headers.get('content-length') === '0') return {} as T;
  return res.json() as Promise<T>;
}

// ─── TYPES ────────────────────────────────────────────────────────────────────

interface ShopifyVariant {
  id: number;
  sku: string;
  price: string;
}

interface ShopifyProduct {
  id: number;
  title: string;
  status: string;
  variants: ShopifyVariant[];
}

interface VariantEntry {
  productId: number;
  productTitle: string;
  variantId: number;
  price: string;
  status: string;
}

interface DuplicateGroup {
  sku: string;
  count: number;
  variants: VariantEntry[];
}

// ─── FETCH ALL PRODUCTS ───────────────────────────────────────────────────────

async function fetchAllProducts(ctSyncOnly: boolean): Promise<ShopifyProduct[]> {
  const all: ShopifyProduct[] = [];
  const tagParam = ctSyncOnly ? '&tag=ct-sync' : '';
  let url: string = `${SHOPIFY.baseUrl}/products.json?limit=250${tagParam}&fields=id,title,status,variants`;
  let page = 0;

  while (url) {
    page++;
    const response = await shopifyFetchRaw(url);
    const data: any = await response.json();
    const products: ShopifyProduct[] = data.products || [];
    all.push(...products);
    console.log(`  [duplicateSkuAudit] page ${page}: fetched ${products.length} products (running total: ${all.length})`);

    const link = response.headers.get('Link') || '';
    const next = link.match(/<([^>]+)>;\s*rel="next"/);
    url = next ? next[1] : '';
  }

  console.log(`  [duplicateSkuAudit] done — ${page} page(s), ${all.length} total products`);
  return all;
}

// ─── BUILD DUPLICATE GROUPS ───────────────────────────────────────────────────

function buildDuplicateGroups(products: ShopifyProduct[]): {
  groups: DuplicateGroup[];
  totalVariants: number;
} {
  const skuMap = new Map<string, VariantEntry[]>();
  let totalVariants = 0;

  for (const product of products) {
    for (const variant of product.variants || []) {
      totalVariants++;
      const sku = (variant.sku || '').trim().toUpperCase();
      if (!sku.startsWith('TIRE-')) continue;

      const entry: VariantEntry = {
        productId:    product.id,
        productTitle: product.title,
        variantId:    variant.id,
        price:        variant.price,
        status:       product.status,
      };

      const existing = skuMap.get(sku);
      if (existing) { existing.push(entry); } else { skuMap.set(sku, [entry]); }
    }
  }

  const groups: DuplicateGroup[] = [];
  for (const [sku, variants] of skuMap.entries()) {
    if (variants.length < 2) continue;

    // Only flag as duplicate if the SKU spans more than one product
    const distinctProducts = new Set(variants.map(v => v.productId));
    if (distinctProducts.size < 2) continue;

    groups.push({ sku, count: variants.length, variants });
  }

  // Sort: count desc, then sku asc for stable output
  groups.sort((a, b) => b.count - a.count || a.sku.localeCompare(b.sku));

  return { groups, totalVariants };
}

// ─── HANDLER ──────────────────────────────────────────────────────────────────

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Content-Type', 'application/json');

  if (!SHOPIFY.domain || !SHOPIFY.token) {
    return res.status(500).json({ error: 'Missing SHOPIFY_STORE_DOMAIN or SHOPIFY_ADMIN_ACCESS_TOKEN' });
  }

  const action      = (req.query.action as string) || 'scan';
  // dryRun defaults to false for action=fix so writes happen unless caller passes dry=true
  const dryRun      = req.query.dry        === 'true';
  const ctSyncOnly  = req.query.ctSyncOnly === 'true';
  const chunkSize   = req.query.chunkSize ? parseInt(req.query.chunkSize as string, 10) : 20;
  const offset      = req.query.offset    ? parseInt(req.query.offset    as string, 10) : 0;

  console.log(`🔍 duplicateSkuAudit — action=${action} dry=${dryRun} ctSyncOnly=${ctSyncOnly} chunkSize=${chunkSize} offset=${offset}`);

  let allProducts: ShopifyProduct[];
  try {
    allProducts = await fetchAllProducts(ctSyncOnly);
  } catch (err) {
    return res.status(500).json({ error: `Failed to fetch products: ${String(err)}` });
  }

  const { groups, totalVariants } = buildDuplicateGroups(allProducts);
  const totalAffectedVariants = groups.reduce((sum, g) => sum + g.count, 0);

  // ── action=scan ───────────────────────────────────────────────────────────
  if (action === 'scan') {
    console.log(`✅ Scan done — products:${allProducts.length} duplicateSkus:${groups.length} affectedVariants:${totalAffectedVariants} ctSyncOnly:${ctSyncOnly}`);
    return res.status(200).json({
      ctSyncOnly,
      totalProducts:        allProducts.length,
      totalVariants,
      totalDuplicateSkus:   groups.length,
      totalAffectedVariants,
      groups,
    });
  }

  // ── action=fix ────────────────────────────────────────────────────────────
  if (action === 'fix') {
    const chunk      = groups.slice(offset, offset + chunkSize);
    const nextOffset = (offset + chunkSize) < groups.length ? offset + chunkSize : null;

    let fixed   = 0;
    let skipped = 0;
    const errors: string[] = [];
    const changes: Array<{ variantId: number; sku: string; productTitle: string; action: 'cleared' }> = [];

    for (const group of chunk) {
      // Sort so lowest productId is first — that one is kept
      const sorted = [...group.variants].sort((a, b) => a.productId - b.productId);
      const [_kept, ...toClear] = sorted;

      for (const variant of toClear) {
        console.log(`  [clear-sku] variantId:${variant.variantId} sku:${group.sku} product:"${variant.productTitle}"`);
        changes.push({ variantId: variant.variantId, sku: group.sku, productTitle: variant.productTitle, action: 'cleared' });

        if (!dryRun) {
          try {
            await shopifyFetch(`/variants/${variant.variantId}.json`, {
              method: 'PUT',
              body: JSON.stringify({ variant: { id: variant.variantId, sku: '' } }),
            });
            fixed++;
          } catch (err) {
            const msg = `Variant ${variant.variantId} (SKU: ${group.sku}, "${variant.productTitle}"): ${String(err)}`;
            console.error(`  ❌ ${msg}`);
            errors.push(msg);
            continue;
          }
          await sleep(400);
        } else {
          fixed++;
        }
      }
    }

    console.log(`✅ Fix done — fixed:${fixed} skipped:${skipped} errors:${errors.length} nextOffset:${nextOffset}`);

    // Return 207 Multi-Status when some writes succeeded and some failed
    const httpStatus = !dryRun && errors.length > 0 ? 207 : 200;
    return res.status(httpStatus).json({
      dryRun,
      totalDuplicateSkus: groups.length,
      fixed,
      skipped,
      errors,
      changes,
      offset,
      chunkSize,
      nextOffset,
    });
  }

  return res.status(400).json({
    error: 'Unknown action',
    available: ['scan', 'fix'],
  });
}
