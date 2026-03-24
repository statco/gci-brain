// api/fixSkus.ts
// ============================================================
// Fix variant SKU prefixes for ct-sync and nuproz-innovation products
//
// GET /api/fixSkus?action=fix-tires        — prefix ct-sync SKUs with "TIRE-"
// GET /api/fixSkus?action=fix-nuproz       — prefix nuproz-innovation SKUs with "NUPROZ-"
// GET /api/fixSkus?action=revert-nuproz    — fix nuproz products wrongly prefixed "TIRE-"
// (no action param defaults to fix-tires)
// Add ?dryRun=true to any action to preview without saving
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

const TAG_CT_SYNC  = 'ct-sync';
const TAG_NUPROZ   = 'nuproz-innovation';
const BATCH_SIZE   = 5;
const BATCH_MS     = 300;

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

// ─── FETCH PRODUCTS BY TAG ────────────────────────────────────────────────────

async function fetchProductsByTag(tag: string): Promise<ShopifyProduct[]> {
  const products: ShopifyProduct[] = [];
  let sinceId = 0;

  while (true) {
    const q = `tag=${tag}&limit=250&fields=id,title,variants${sinceId ? `&since_id=${sinceId}` : ''}`;
    const data: any = await shopifyFetch<any>(`/products.json?${q}`);
    const page: ShopifyProduct[] = data.products || [];
    if (page.length === 0) break;
    products.push(...page);
    if (page.length < 250) break;
    sinceId = page[page.length - 1].id;
  }

  return products;
}

// ─── PLAN HELPERS ─────────────────────────────────────────────────────────────

/** Collect variants that need a prefix applied (skip if already prefixed). */
function planPrefix(
  products: ShopifyProduct[],
  prefix: string,
): { toUpdate: VariantUpdate[]; skipped: VariantUpdate[] } {
  const toUpdate: VariantUpdate[] = [];
  const skipped: VariantUpdate[] = [];

  for (const product of products) {
    for (const variant of product.variants) {
      const base: Omit<VariantUpdate, 'newSku'> = {
        productId: product.id,
        productTitle: product.title,
        variantId: variant.id,
        oldSku: variant.sku,
      };
      if (!variant.sku || variant.sku.startsWith(prefix)) {
        skipped.push({ ...base, newSku: variant.sku });
      } else {
        toUpdate.push({ ...base, newSku: `${prefix}${variant.sku}` });
      }
    }
  }

  return { toUpdate, skipped };
}

/**
 * Collect nuproz variants that were wrongly prefixed with "TIRE-".
 * Strips "TIRE-" and replaces with "NUPROZ-".
 */
function planRevertNuproz(
  products: ShopifyProduct[],
): { toUpdate: VariantUpdate[]; skipped: VariantUpdate[] } {
  const toUpdate: VariantUpdate[] = [];
  const skipped: VariantUpdate[] = [];

  for (const product of products) {
    for (const variant of product.variants) {
      const base: Omit<VariantUpdate, 'newSku'> = {
        productId: product.id,
        productTitle: product.title,
        variantId: variant.id,
        oldSku: variant.sku,
      };
      if (variant.sku && variant.sku.startsWith('TIRE-')) {
        const bare = variant.sku.slice('TIRE-'.length);
        toUpdate.push({ ...base, newSku: `NUPROZ-${bare}` });
      } else {
        skipped.push({ ...base, newSku: variant.sku });
      }
    }
  }

  return { toUpdate, skipped };
}

// ─── APPLY UPDATES ────────────────────────────────────────────────────────────

async function applyUpdates(
  toUpdate: VariantUpdate[],
  dryRun: boolean,
): Promise<{ updated: VariantUpdate[]; errors: { variantId: number; sku: string; error: string }[] }> {
  const updated: VariantUpdate[] = [];
  const errors: { variantId: number; sku: string; error: string }[] = [];

  if (dryRun) {
    return { updated: [...toUpdate], errors };
  }

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
          errors.push({ variantId: item.variantId, sku: item.oldSku, error: err.message || String(err) });
        }
      }),
    );

    if (i + BATCH_SIZE < toUpdate.length) await delay(BATCH_MS);
  }

  return { updated, errors };
}

// ─── MAIN HANDLER ─────────────────────────────────────────────────────────────

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const dryRun = req.query.dryRun === 'true' || req.query.dryRun === '1';
  const action = (req.query.action as string) || 'fix-tires';

  const validActions = ['fix-tires', 'fix-nuproz', 'revert-nuproz'];
  if (!validActions.includes(action)) {
    return res.status(400).json({ error: `Unknown action "${action}". Valid: ${validActions.join(', ')}` });
  }

  try {
    let products: ShopifyProduct[];
    let toUpdate: VariantUpdate[];
    let skipped: VariantUpdate[];

    if (action === 'fix-tires') {
      products = await fetchProductsByTag(TAG_CT_SYNC);
      ({ toUpdate, skipped } = planPrefix(products, 'TIRE-'));
    } else if (action === 'fix-nuproz') {
      products = await fetchProductsByTag(TAG_NUPROZ);
      ({ toUpdate, skipped } = planPrefix(products, 'NUPROZ-'));
    } else {
      // revert-nuproz: fetch nuproz products and fix any TIRE- wrongly applied
      products = await fetchProductsByTag(TAG_NUPROZ);
      ({ toUpdate, skipped } = planRevertNuproz(products));
    }

    const total = products.reduce((n, p) => n + p.variants.length, 0);
    const { updated, errors } = await applyUpdates(toUpdate, dryRun);

    return res.status(200).json({
      action,
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
