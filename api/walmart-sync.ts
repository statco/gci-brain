// api/walmart-sync.ts
// ============================================================
// Walmart Marketplace Sync — Price & Inventory Push
//
// Runs after cdatire.ca → Shopify sync and pushes updated
// price and quantity to Walmart Marketplace for all TIRE- SKUs.
//
// Triggered by:
//   GET  /api/walmart-sync          — Vercel cron (0 9 * * *, same as shopifySync)
//   POST /api/walmart-sync          — Manual trigger
//
// Safety switch:
//   If cdatire stock quantity < 4, Walmart quantity is set to 0
//   to prevent overselling when supply is tight.
//
// Required env vars:
//   SHOPIFY_STORE_DOMAIN         — existing var
//   SHOPIFY_ADMIN_ACCESS_TOKEN   — existing var
//   WALMART_CLIENT_ID            — new
//   WALMART_CLIENT_SECRET        — new
//   WALMART_BASE_URL             — optional (default https://marketplace.walmartapis.com)
// ============================================================

import type { VercelRequest, VercelResponse }             from '@vercel/node';
import {
  pushPrices,
  pushInventory,
  chunkArray,
  WalmartPriceItem,
  WalmartInventoryItem,
} from './lib/walmart-client.js';

export const config = { maxDuration: 300 };

// ─── CONFIG ───────────────────────────────────────────────────────────────────

const SHOPIFY = {
  domain:     process.env.SHOPIFY_STORE_DOMAIN       || '',
  token:      process.env.SHOPIFY_ADMIN_ACCESS_TOKEN || '',
  apiVersion: '2024-01',
  get baseUrl() { return `https://${this.domain}/admin/api/${this.apiVersion}`; },
};

const TIRE_PREFIX      = 'TIRE-';
const SYNC_TAG         = 'ct-sync';
const LOW_STOCK_CUTOFF = 4;    // qty < 4 → Walmart qty = 0
const BATCH_DELAY_MS   = 300;  // delay between Shopify pages to respect rate limits
const WALMART_CHUNK    = 1000; // Walmart feed API limit per call

// ─── SHOPIFY HELPERS ──────────────────────────────────────────────────────────

function delay(ms: number) { return new Promise(r => setTimeout(r, ms)); }

async function shopifyFetch<T>(path: string): Promise<T> {
  const res = await fetch(`${SHOPIFY.baseUrl}${path}`, {
    headers: {
      'Content-Type':           'application/json',
      'X-Shopify-Access-Token': SHOPIFY.token,
    },
  });
  if (res.status === 429) { await delay(2000); return shopifyFetch<T>(path); }
  if (!res.ok) throw new Error(`Shopify ${res.status} on ${path}: ${(await res.text()).slice(0, 200)}`);
  return res.json() as Promise<T>;
}

// ─── TYPES ────────────────────────────────────────────────────────────────────

interface ShopifyVariant {
  id:                 number;
  sku:                string;
  price:              string;
  inventory_quantity: number;
}

interface ShopifyProduct {
  id:       number;
  title:    string;
  variants: ShopifyVariant[];
}

interface SyncItem {
  sku:          string;
  price:        number;
  shopifyQty:   number;
  walmartQty:   number;  // after safety-switch applied
}

// ─── FETCH ALL TIRE PRODUCTS FROM SHOPIFY ─────────────────────────────────────

async function fetchAllTireVariants(): Promise<SyncItem[]> {
  const items: SyncItem[] = [];
  let sinceId = 0;

  while (true) {
    const q = `tag=${SYNC_TAG}&limit=250&fields=id,variants${sinceId ? `&since_id=${sinceId}` : ''}`;
    const data: any = await shopifyFetch<any>(`/products.json?${q}`);
    const products: ShopifyProduct[] = data.products || [];

    for (const p of products) {
      for (const v of p.variants) {
        const sku = (v.sku || '').toUpperCase();
        if (!sku.startsWith(TIRE_PREFIX)) continue;

        const shopifyQty = Math.max(0, v.inventory_quantity || 0);
        const walmartQty = shopifyQty < LOW_STOCK_CUTOFF ? 0 : shopifyQty;

        items.push({
          sku,
          price:      parseFloat(v.price) || 0,
          shopifyQty,
          walmartQty,
        });
      }
    }

    if (products.length < 250) break;
    sinceId = products[products.length - 1].id;
    await delay(BATCH_DELAY_MS);
  }

  return items;
}

// ─── MAIN HANDLER ─────────────────────────────────────────────────────────────

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const isDry = req.query.dry === 'true';
  const start = Date.now();

  console.log(`🛒 Walmart sync starting${isDry ? ' [DRY RUN]' : ''}...`);

  // Validate config
  if (!SHOPIFY.domain || !SHOPIFY.token) {
    return res.status(500).json({ error: 'Shopify credentials not configured' });
  }

  // ── Fetch Shopify data ──────────────────────────────────────────────────────

  let items: SyncItem[];
  try {
    items = await fetchAllTireVariants();
    console.log(`📦 Fetched ${items.length} TIRE- variants from Shopify`);
  } catch (err: any) {
    console.error('❌ Failed to fetch Shopify variants:', err);
    return res.status(500).json({ error: 'Shopify fetch failed', details: err.message });
  }

  if (items.length === 0) {
    return res.status(200).json({ ok: true, message: 'No TIRE- variants found', synced: 0 });
  }

  // Safety-switch stats
  const safetyZeroed = items.filter(i => i.shopifyQty > 0 && i.walmartQty === 0).length;
  console.log(`🛡️  Safety switch: zeroed ${safetyZeroed} items with qty < ${LOW_STOCK_CUTOFF}`);

  if (isDry) {
    const sample = items.slice(0, 5).map(i => ({
      sku:        i.sku,
      price:      i.price,
      shopifyQty: i.shopifyQty,
      walmartQty: i.walmartQty,
      zeroed:     i.walmartQty === 0 && i.shopifyQty > 0,
    }));
    return res.status(200).json({
      dryRun:       true,
      total:        items.length,
      safetyZeroed,
      sampleOutput: sample,
    });
  }

  // ── Push to Walmart ─────────────────────────────────────────────────────────

  const priceItems: WalmartPriceItem[]     = items.map(i => ({ sku: i.sku, price: i.price }));
  const inventoryItems: WalmartInventoryItem[] = items.map(i => ({ sku: i.sku, quantity: i.walmartQty }));

  const priceFeedIds:    string[] = [];
  const inventoryFeedIds:string[] = [];
  const errors:          string[] = [];

  // Push prices in chunks of 1000
  for (const chunk of chunkArray(priceItems, WALMART_CHUNK)) {
    try {
      const feedId = await pushPrices(chunk);
      priceFeedIds.push(feedId);
    } catch (err: any) {
      console.error('❌ Walmart price push failed:', err.message);
      errors.push(`price: ${err.message}`);
    }
    await delay(500); // brief pause between Walmart API calls
  }

  // Push inventory in chunks of 1000
  for (const chunk of chunkArray(inventoryItems, WALMART_CHUNK)) {
    try {
      const feedId = await pushInventory(chunk);
      inventoryFeedIds.push(feedId);
    } catch (err: any) {
      console.error('❌ Walmart inventory push failed:', err.message);
      errors.push(`inventory: ${err.message}`);
    }
    await delay(500);
  }

  const durationMs = Date.now() - start;
  console.log(`✅ Walmart sync complete in ${durationMs}ms. Price feeds: ${priceFeedIds.length}, Inventory feeds: ${inventoryFeedIds.length}`);

  return res.status(errors.length > 0 ? 207 : 200).json({
    ok:             errors.length === 0,
    totalVariants:  items.length,
    safetyZeroed,
    priceFeedIds,
    inventoryFeedIds,
    durationMs,
    ...(errors.length ? { errors } : {}),
  });
}
