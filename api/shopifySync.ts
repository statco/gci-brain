// api/shopifySync.ts
// ============================================================
// Canada Tire → Shopify Product Sync
//
// Two modes:
//   POST ?action=full-import   — create / update all 1,000 CT products
//   POST ?action=daily-sync    — only update changed price / inventory
//   POST ?action=status        — show last sync stats from metafields
//
// Vercel Cron (runs daily at 3:00 AM ET):
//   GET  /api/shopifySync      — triggered by vercel.json cron config
//
// Auth: Vercel passes CRON_SECRET automatically as Bearer token.
//       Manual calls need: Authorization: Bearer <CRON_SECRET>
// ============================================================

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { searchTiresOnly, searchWheels, transformToAIMatchProduct } from './canadaTire';

// ─── Extend default Vercel 60s timeout to 300s (Vercel Pro required) ─────────
export const config = { maxDuration: 300 };

// ─── CONFIG ───────────────────────────────────────────────────────────────────
const SHOPIFY = {
  domain:      process.env.SHOPIFY_STORE_DOMAIN       || '',   // e.g. gci-tires.myshopify.com
  token:       process.env.SHOPIFY_ADMIN_ACCESS_TOKEN || '',
  apiVersion:  '2024-01',
  get baseUrl() { return `https://${this.domain}/admin/api/${this.apiVersion}`; },
};

const SYNC_TAG    = 'ct-sync';          // tag applied to every CT product in Shopify
const CT_VENDOR   = 'Canada Tire';      // Shopify vendor field
const BATCH_SIZE  = 5;                  // concurrent Shopify requests
const BATCH_DELAY = 250;               // ms between batches (stays under 2 req/s limit)

// ─── TYPES ────────────────────────────────────────────────────────────────────

interface ShopifyVariant {
  id:         number;
  sku:        string;
  price:      string;
  product_id: number;
  inventory_item_id: number;
}

interface ShopifyProduct {
  id:       number;
  title:    string;
  vendor:   string;
  tags:     string;
  variants: ShopifyVariant[];
}

interface SyncStats {
  created:   number;
  updated:   number;
  skipped:   number;
  errors:    number;
  errorList: string[];
  duration:  string;
  timestamp: string;
}

// ─── SHOPIFY REST HELPER ──────────────────────────────────────────────────────

async function shopifyFetch<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const url = `${SHOPIFY.baseUrl}${path}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      'Content-Type':              'application/json',
      'X-Shopify-Access-Token':    SHOPIFY.token,
      ...options.headers,
    },
  });

  if (res.status === 429) {
    // Rate limited — wait 2 seconds and retry once
    await delay(2000);
    return shopifyFetch<T>(path, options);
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Shopify API ${res.status} on ${path}: ${body.slice(0, 200)}`);
  }

  return res.json() as Promise<T>;
}

function delay(ms: number) {
  return new Promise(r => setTimeout(r, ms));
}

// ─── FETCH ALL EXISTING CT PRODUCTS FROM SHOPIFY ─────────────────────────────
// Returns a Map<sku → { productId, variantId, inventoryItemId, price, title }>

async function fetchExistingShopifyProducts(): Promise<Map<string, {
  productId:       number;
  variantId:       number;
  inventoryItemId: number;
  price:           string;
  title:           string;
}>> {
  const skuMap = new Map<string, {
    productId: number; variantId: number;
    inventoryItemId: number; price: string; title: string;
  }>();

  let url = `/products.json?vendor=${encodeURIComponent(CT_VENDOR)}&limit=250&fields=id,title,vendor,variants`;

  while (url) {
    const data: any = await shopifyFetch<any>(url);
    const products: ShopifyProduct[] = data.products || [];

    for (const p of products) {
      for (const v of p.variants) {
        if (v.sku) {
          skuMap.set(v.sku, {
            productId:       p.id,
            variantId:       v.id,
            inventoryItemId: v.inventory_item_id,
            price:           v.price,
            title:           p.title,
          });
        }
      }
    }

    // Cursor-based pagination via Link header
    url = '';  // reset — Shopify returns next page info in response
    if (products.length === 250 && data.products.length === 250) {
      // Check if there's a page_info cursor in headers — handled via Link header
      // For simplicity use offset-based with since_id
      const lastId = products[products.length - 1]?.id;
      if (lastId) {
        url = `/products.json?vendor=${encodeURIComponent(CT_VENDOR)}&limit=250&fields=id,title,vendor,variants&since_id=${lastId}`;
      }
    }
  }

  console.log(`📦 Found ${skuMap.size} existing CT products in Shopify`);
  return skuMap;
}

// ─── PARSE TIRE SIZE FROM CT FORMAT ──────────────────────────────────────────
// CT: "235,50,19" or "235/50/19" → "235/50R19"

function parseTireSize(raw: string): { display: string; width: string; aspect: string; rim: string } {
  const parts = raw.toString().replace(/,/g, '/').split('/');
  const [width = '', aspect = '', rim = ''] = parts;
  return {
    display: `${width}/${aspect}R${rim}`,
    width,
    aspect,
    rim,
  };
}

// ─── BUILD SHOPIFY PRODUCT PAYLOAD ───────────────────────────────────────────

function buildShopifyProductPayload(ct: ReturnType<typeof transformToAIMatchProduct>) {
  const size = parseTireSize(ct.size);
  const season = ct.isWinter ? 'Winter' : 'All-Season';
  const productType = 'Tire';

  const tags = [
    SYNC_TAG,
    `brand-${ct.brand.toLowerCase().replace(/\s+/g, '-')}`,
    `size-${size.width}-${size.aspect}-${size.rim}`,
    `rim-${size.rim}`,
    `width-${size.width}`,
    season.toLowerCase(),
    ct.isRunFlat ? 'run-flat' : null,
  ].filter(Boolean).join(', ');

  const title = `${ct.brand} ${ct.model} ${size.display}`.trim();

  const body_html = `
    <p><strong>${ct.brand} ${ct.model}</strong> — ${size.display}</p>
    <ul>
      <li>Season: ${season}</li>
      ${ct.isRunFlat     ? '<li>Run-Flat Technology</li>' : ''}
      ${ct.isWinter      ? '<li>3PMSF Winter Certified</li>' : ''}
      ${ct.performanceCategory ? `<li>Performance: ${ct.performanceCategory}</li>` : ''}
      <li>Part #: ${ct.ctPartNumber}</li>
    </ul>
  `.trim();

  return {
    product: {
      title,
      body_html,
      vendor:       ct.brand,               // brand as Shopify vendor for filtering
      product_type: productType,
      tags,
      variants: [
        {
          sku:                  ct.ctPartNumber,
          price:                ct.pricePerUnit.toFixed(2),
          inventory_management: 'shopify',
          inventory_policy:     'deny',
          requires_shipping:    true,
          taxable:              true,
          weight:               25,          // avg tire weight in lbs
          weight_unit:          'lb',
          option1:              size.display,
        },
      ],
      options: [{ name: 'Size' }],
      // Store CT cost as a private metafield
      metafields: [
        {
          namespace: 'canada_tire',
          key:       'cost',
          value:     ct._cost.toFixed(2),
          type:      'number_decimal',
        },
        {
          namespace: 'canada_tire',
          key:       'part_number',
          value:     ct.ctPartNumber,
          type:      'single_line_text_field',
        },
      ],
    },
  };
}

// ─── CREATE A NEW SHOPIFY PRODUCT ─────────────────────────────────────────────

async function createShopifyProduct(
  ct: ReturnType<typeof transformToAIMatchProduct>
): Promise<void> {
  const payload = buildShopifyProductPayload(ct);
  const data: any = await shopifyFetch<any>('/products.json', {
    method: 'POST',
    body:   JSON.stringify(payload),
  });

  // Set inventory level after creation
  const variantId     = data.product?.variants?.[0]?.id;
  const inventoryItem = data.product?.variants?.[0]?.inventory_item_id;
  if (inventoryItem && ct.stockQty > 0) {
    await setInventoryLevel(inventoryItem, ct.stockQty);
  }
}

// ─── UPDATE AN EXISTING SHOPIFY PRODUCT ──────────────────────────────────────

async function updateShopifyProduct(
  productId:       number,
  variantId:       number,
  inventoryItemId: number,
  ct:              ReturnType<typeof transformToAIMatchProduct>,
  currentPrice:    string,
  forceUpdate:     boolean = false
): Promise<'updated' | 'skipped'> {
  const newPrice = ct.pricePerUnit.toFixed(2);
  const priceChanged = newPrice !== currentPrice;

  // Only update if something actually changed (or forced)
  if (!priceChanged && !forceUpdate) {
    return 'skipped';
  }

  if (priceChanged) {
    await shopifyFetch(`/variants/${variantId}.json`, {
      method: 'PUT',
      body:   JSON.stringify({ variant: { id: variantId, price: newPrice } }),
    });
  }

  // Always update inventory during daily sync
  if (ct.stockQty >= 0) {
    await setInventoryLevel(inventoryItemId, ct.stockQty);
  }

  return 'updated';
}

// ─── SET INVENTORY LEVEL ──────────────────────────────────────────────────────
// Uses Shopify's primary location

let _primaryLocationId: number | null = null;

async function getPrimaryLocationId(): Promise<number> {
  if (_primaryLocationId) return _primaryLocationId;
  const data: any = await shopifyFetch<any>('/locations.json?limit=1');
  _primaryLocationId = data.locations?.[0]?.id;
  if (!_primaryLocationId) throw new Error('No Shopify location found');
  return _primaryLocationId;
}

async function setInventoryLevel(inventoryItemId: number, qty: number): Promise<void> {
  try {
    const locationId = await getPrimaryLocationId();
    await shopifyFetch('/inventory_levels/set.json', {
      method: 'POST',
      body:   JSON.stringify({
        location_id:        locationId,
        inventory_item_id:  inventoryItemId,
        available:          Math.max(0, qty),
      }),
    });
  } catch (e) {
    // Non-fatal — product exists, inventory update failed
    console.warn(`⚠️ Inventory update failed for item ${inventoryItemId}:`, e);
  }
}

// ─── BATCH PROCESSOR ─────────────────────────────────────────────────────────
// Runs items in batches of BATCH_SIZE with BATCH_DELAY between batches

async function processBatches<T, R>(
  items:     T[],
  processor: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = [];

  for (let i = 0; i < items.length; i += BATCH_SIZE) {
    const batch = items.slice(i, i + BATCH_SIZE);
    const batchResults = await Promise.all(batch.map(processor));
    results.push(...batchResults);
    if (i + BATCH_SIZE < items.length) {
      await delay(BATCH_DELAY);
    }
  }

  return results;
}

// ─── MAIN SYNC ORCHESTRATOR ───────────────────────────────────────────────────

async function runSync(mode: 'full' | 'daily'): Promise<SyncStats> {
  const startTime = Date.now();
  const stats: SyncStats = {
    created: 0, updated: 0, skipped: 0, errors: 0,
    errorList: [], duration: '', timestamp: new Date().toISOString(),
  };

  console.log(`🚀 Starting ${mode} sync — ${new Date().toISOString()}`);

  // 1. Fetch all CT products
  console.log('📥 Fetching Canada Tire products...');
  const ctRaw = await searchTiresOnly({ page: 1 });
  const ctProducts = ctRaw.map(transformToAIMatchProduct);
  console.log(`✅ Got ${ctProducts.length} CT products`);

  // 2. Fetch all existing Shopify products keyed by SKU
  console.log('📥 Fetching existing Shopify products...');
  const existingBySku = await fetchExistingShopifyProducts();

  // 3. Separate into creates vs updates
  const toCreate = ctProducts.filter(p => !existingBySku.has(p.ctPartNumber));
  const toUpdate = ctProducts.filter(p =>  existingBySku.has(p.ctPartNumber));

  console.log(`📊 To create: ${toCreate.length} | To update: ${toUpdate.length}`);

  // 4. Create new products
  if (toCreate.length > 0) {
    console.log(`➕ Creating ${toCreate.length} new products...`);
    await processBatches(toCreate, async (ct) => {
      try {
        await createShopifyProduct(ct);
        stats.created++;
        if (stats.created % 50 === 0) console.log(`  ✅ Created ${stats.created}/${toCreate.length}`);
      } catch (e: any) {
        stats.errors++;
        stats.errorList.push(`CREATE ${ct.ctPartNumber}: ${e.message}`);
        console.error(`  ❌ Create failed for ${ct.ctPartNumber}:`, e.message);
      }
    });
  }

  // 5. Update existing products
  if (toUpdate.length > 0) {
    console.log(`🔄 Checking ${toUpdate.length} existing products for changes...`);
    const forceUpdate = mode === 'full';  // full-import updates all; daily only updates changed

    await processBatches(toUpdate, async (ct) => {
      const existing = existingBySku.get(ct.ctPartNumber)!;
      try {
        const result = await updateShopifyProduct(
          existing.productId,
          existing.variantId,
          existing.inventoryItemId,
          ct,
          existing.price,
          forceUpdate,
        );
        if (result === 'updated') stats.updated++;
        else stats.skipped++;
      } catch (e: any) {
        stats.errors++;
        stats.errorList.push(`UPDATE ${ct.ctPartNumber}: ${e.message}`);
        console.error(`  ❌ Update failed for ${ct.ctPartNumber}:`, e.message);
      }
    });
  }

  stats.duration = `${((Date.now() - startTime) / 1000).toFixed(1)}s`;
  console.log(`\n✅ Sync complete in ${stats.duration}`);
  console.log(`   Created: ${stats.created} | Updated: ${stats.updated} | Skipped: ${stats.skipped} | Errors: ${stats.errors}`);

  return stats;
}

// ─── VERCEL HANDLER ───────────────────────────────────────────────────────────

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // ── Auth check ──────────────────────────────────────────────────────────────
  const secret    = process.env.CRON_SECRET || '';
  const authHeader = req.headers.authorization || '';
  const isCronCall = req.method === 'GET';              // Vercel cron uses GET
  const isManual   = req.method === 'POST';

  if (!isManual && !isCronCall) {
    return res.status(405).json({ error: 'Use GET (cron) or POST (manual)' });
  }

  // Protect manual POST calls with CRON_SECRET
  if (isManual && secret) {
    const provided = authHeader.replace('Bearer ', '');
    if (provided !== secret) {
      return res.status(401).json({ error: 'Unauthorized — provide CRON_SECRET as Bearer token' });
    }
  }

  // Verify Shopify config
  if (!SHOPIFY.domain || !SHOPIFY.token) {
    return res.status(500).json({
      error: 'Missing Shopify config',
      missing: [
        !SHOPIFY.domain ? 'SHOPIFY_STORE_DOMAIN' : null,
        !SHOPIFY.token  ? 'SHOPIFY_ADMIN_ACCESS_TOKEN' : null,
      ].filter(Boolean),
    });
  }

  const action = (req.query.action as string) || (isCronCall ? 'daily-sync' : 'status');

  try {
    switch (action) {

      // ── Status check (no sync) ───────────────────────────────────────────────
      case 'status': {
        const existing = await fetchExistingShopifyProducts();
        return res.status(200).json({
          success:            true,
          shopifyProductCount: existing.size,
          domain:             SHOPIFY.domain,
          nextCronRun:        '3:00 AM ET daily',
          actions:            ['full-import', 'daily-sync', 'status'],
        });
      }

      // ── Full import (create + force-update all products) ────────────────────
      case 'full-import': {
        const stats = await runSync('full');
        return res.status(200).json({ success: true, mode: 'full-import', ...stats });
      }

      // ── Daily sync (create new + update changed only) ────────────────────────
      case 'daily-sync':
      default: {
        const stats = await runSync('daily');
        return res.status(200).json({ success: true, mode: 'daily-sync', ...stats });
      }
    }
  } catch (e: any) {
    console.error('❌ Sync error:', e);
    return res.status(500).json({ success: false, error: e.message });
  }
}
