// api/fixSkus.ts
// ============================================================
// Prefix all ct-sync product variant SKUs with "TIRE-"
//
// GET /api/fixSkus            — run prefixing
// GET /api/fixSkus?dryRun=true — preview changes without saving
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

const SYNC_TAG   = 'ct-sync';
const BATCH_SIZE = 5;
const BATCH_MS   = 300;

// ─── HELPERS ──────────────────────────────────────────────────────────────────

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

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

// ─── TYPES ────────────────────────────────────────────────────────────────────

interface ShopifyVariant {
  id: number;
  sku: string;
}

interface ShopifyProduct {
  id: number;
  title: string;
  variants: ShopifyVariant[];
}

interface VariantUpdate {
  productId: number;
  productTitle: string;
  variantId: number;
  oldSku: string;
  newSku: string;
}

// ─── FETCH ALL CT-SYNC PRODUCTS ───────────────────────────────────────────────

async function fetchAllCtSyncProducts(): Promise<ShopifyProduct[]> {
  const products: ShopifyProduct[] = [];
  let sinceId = 0;

  while (true) {
    const q = `tag=${SYNC_TAG}&limit=250&fields=id,title,variants${sinceId ? `&since_id=${sinceId}` : ''}`;
    const data: any = await shopifyFetch<any>(`/products.json?${q}`);
    const page: ShopifyProduct[] = data.products || [];
    if (page.length === 0) break;
    products.push(...page);
    if (page.length < 250) break;
    sinceId = page[page.length - 1].id;
  }

  return products;
}

// ─── MAIN HANDLER ─────────────────────────────────────────────────────────────

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const dryRun = req.query.dryRun === 'true' || req.query.dryRun === '1';

  const updated: VariantUpdate[] = [];
  const skipped: VariantUpdate[] = [];
  const errors: { variantId: number; sku: string; error: string }[] = [];

  try {
    const products = await fetchAllCtSyncProducts();
    const total = products.reduce((n, p) => n + p.variants.length, 0);

    // Collect all variants that need updating
    const toUpdate: VariantUpdate[] = [];
    for (const product of products) {
      for (const variant of product.variants) {
        if (!variant.sku || variant.sku.startsWith('TIRE-')) {
          skipped.push({
            productId: product.id,
            productTitle: product.title,
            variantId: variant.id,
            oldSku: variant.sku,
            newSku: variant.sku,
          });
        } else {
          toUpdate.push({
            productId: product.id,
            productTitle: product.title,
            variantId: variant.id,
            oldSku: variant.sku,
            newSku: `TIRE-${variant.sku}`,
          });
        }
      }
    }

    if (!dryRun) {
      // Process updates in batches
      for (let i = 0; i < toUpdate.length; i += BATCH_SIZE) {
        const batch = toUpdate.slice(i, i + BATCH_SIZE);

        await Promise.all(
          batch.map(async (item) => {
            try {
              await shopifyFetch(`/products/${item.productId}/variants/${item.variantId}.json`, {
                method: 'PUT',
                body: JSON.stringify({ variant: { id: item.variantId, sku: item.newSku } }),
              });
              updated.push(item);
            } catch (err: any) {
              errors.push({
                variantId: item.variantId,
                sku: item.oldSku,
                error: err.message || String(err),
              });
            }
          }),
        );

        if (i + BATCH_SIZE < toUpdate.length) await delay(BATCH_MS);
      }
    } else {
      // Dry run — just report what would change
      updated.push(...toUpdate);
    }

    return res.status(200).json({
      dryRun,
      total,
      updated: updated.length,
      skipped: skipped.length,
      errors: errors.length,
      updatedItems: updated,
      errorItems: errors,
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || String(err) });
  }
}
