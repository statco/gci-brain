// api/shopifySync.ts
// ============================================================
// Canada Tire → Shopify Product Sync
// Imports: addTireImages (static image map, same api/ folder)
//
// POST ?action=full-import   — create / update all CT products
// POST ?action=daily-sync    — only update changed price / inventory
// POST ?action=status        — show Shopify connection + product count
// GET  /api/shopifySync      — Vercel cron trigger (daily 3am ET)
// ============================================================

import crypto from 'crypto';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getTireImageUrl } from './addTireImages.js';

export const config = { maxDuration: 300 };

// ─── CANADA TIRE CONFIG ───────────────────────────────────────────────────────

const CT = {
  consumerKey:    process.env.CT_CONSUMER_KEY       || '',
  consumerSecret: process.env.CT_CONSUMER_SECRET    || '',
  tokenId:        process.env.CT_TOKEN_ID           || '',
  tokenSecret:    process.env.CT_TOKEN_SECRET       || '',
  customerId:     process.env.CT_CUSTOMER_NUMBER    || '19997',
  customerToken:  process.env.CT_CUSTOMER_API_TOKEN || '',
  useSandbox:     process.env.CT_USE_SANDBOX !== 'false',
  get realm()   { return this.useSandbox ? '8031691_SB1' : '8031691'; },
  get baseUrl() {
    return this.useSandbox
      ? 'https://8031691-sb1.restlets.api.netsuite.com/app/site/hosting/restlet.nl'
      : 'https://8031691.restlets.api.netsuite.com/app/site/hosting/restlet.nl';
  },
};

const CT_SCRIPT  = 'customscript_item_search_rl';
const CT_DEPLOY  = 'customdeploy_item_search_rl';

// ─── SHOPIFY CONFIG ───────────────────────────────────────────────────────────

const SHOPIFY = {
  domain:     process.env.SHOPIFY_STORE_DOMAIN       || '',
  token:      process.env.SHOPIFY_ADMIN_ACCESS_TOKEN || '',
  apiVersion: '2024-01',
  get baseUrl() { return `https://${this.domain}/admin/api/${this.apiVersion}`; },
};

const CT_VENDOR  = 'Canada Tire';
const SYNC_TAG   = 'ct-sync';
const BATCH_SIZE = 5;
const BATCH_MS   = 300;

// ─── PRICING CONFIG ───────────────────────────────────────────────────────────
// Net cost = MSRP × NET_MULTIPLIER
// Shipping buffer varies by tire type (from performanceCategory)
// Floor price = net cost + shipping buffer (minimum viable selling price)

const NET_MULTIPLIER = 0.50;

const SHIPPING_BUFFERS: Record<string, number> = {
  passenger:   35,
  light_truck: 40,
  heavy_truck: 50,
};

/**
 * Classify tire type from Canada Tire performanceCategory field.
 * Used to determine shipping buffer for floor price calculation.
 */
function classifyTireType(performanceCategory: string, size: string): string {
  const cat = (performanceCategory || '').toLowerCase();
  const s   = (size || '').toString();

  // Heavy truck
  if (cat.includes('commercial') || cat.includes('heavy') ||
      cat.includes('medium truck') || cat.includes('steer') ||
      cat.includes('drive') || cat.includes('trailer')) {
    return 'heavy_truck';
  }

  // Light truck / SUV
  if (cat.includes('light truck') || cat.includes('suv') ||
      cat.includes('crossover') || cat.includes('all-terrain') ||
      cat.includes('all terrain') || cat.includes('mud') ||
      s.startsWith('LT')) {
    return 'light_truck';
  }

  return 'passenger';
}

function getShippingBuffer(cat: string, size: string): number {
  return SHIPPING_BUFFERS[classifyTireType(cat, size)] ?? 35;
}

// ─── CT OAUTH ─────────────────────────────────────────────────────────────────

function pct(s: string): string {
  return encodeURIComponent(s)
    .replace(/!/g,'%21').replace(/'/g,'%27')
    .replace(/\(/g,'%28').replace(/\)/g,'%29').replace(/\*/g,'%2A');
}

function buildAuthHeader(): string {
  const ts = Math.floor(Date.now() / 1000).toString();
  const nc = crypto.randomBytes(16).toString('hex');

  const sigParams: Record<string,string> = {
    deploy:                 CT_DEPLOY,
    oauth_consumer_key:     CT.consumerKey,
    oauth_nonce:            nc,
    oauth_signature_method: 'HMAC-SHA256',
    oauth_timestamp:        ts,
    oauth_token:            CT.tokenId,
    oauth_version:          '1.0',
    script:                 CT_SCRIPT,
  };

  const paramStr   = Object.keys(sigParams).sort().map(k => `${pct(k)}=${pct(sigParams[k])}`).join('&');
  const base       = ['POST', pct(CT.baseUrl), pct(paramStr)].join('&');
  const signingKey = `${pct(CT.consumerSecret)}&${pct(CT.tokenSecret)}`;
  const sig        = crypto.createHmac('sha256', signingKey).update(base).digest('base64');

  return [
    `OAuth realm="${CT.realm}"`,
    `oauth_consumer_key="${CT.consumerKey}"`,
    `oauth_token="${CT.tokenId}"`,
    `oauth_signature_method="HMAC-SHA256"`,
    `oauth_timestamp="${ts}"`,
    `oauth_nonce="${nc}"`,
    `oauth_version="1.0"`,
    `oauth_signature="${pct(sig)}"`,
  ].join(', ');
}

// ─── CT TYPES ────────────────────────────────────────────────────────────────

interface CTInventory { location: string; quantity: number; }
interface CTTire {
  partNumber: string; name: string; brand: string; model: string;
  size: string; performanceCategory: string;
  isWinter: boolean; isRunFlat: boolean;
  cost: string; msrp: string;
  inventory: CTInventory[];
}

// ─── FETCH ALL CT TIRES ───────────────────────────────────────────────────────

async function fetchAllCTTires(): Promise<CTTire[]> {
  const fullUrl = `${CT.baseUrl}?script=${CT_SCRIPT}&deploy=${CT_DEPLOY}`;
  const res = await fetch(fullUrl, {
    method: 'POST',
    headers: {
      'Authorization': buildAuthHeader(),
      'Content-Type':  'application/json',
      'Accept':        'application/json',
    },
    body: JSON.stringify({
      customerId:    CT.customerId,
      customerToken: CT.customerToken,
      filters: {
        width:'', rimSize:'', aspectRatio:'', size:'',
        partNumber:[], brand:'', searchKey:'',
        isWinter:'', isRunFlat:'', isTire:true, isWheel:false, page:1,
      },
    }),
  });

  if (!res.ok) throw new Error(`CT API HTTP ${res.status}: ${(await res.text()).slice(0,200)}`);
  const data: any = await res.json();
  if (!data.success) throw new Error(`CT API error: ${JSON.stringify(data.error)}`);
  return data.data as CTTire[];
}

function getTotalQty(p: CTTire): number {
  return p.inventory.reduce((s, l) => s + l.quantity, 0);
}

function getClosestWarehouse(p: CTTire): string {
  const preferred = ['Sherbrooke', 'Levis', 'Valleyfield'];
  for (const name of preferred) {
    if (p.inventory.find(l => l.location === name && l.quantity > 0)) return name;
  }
  return p.inventory.find(l => l.quantity > 0)?.location || '';
}

function parseTireSize(raw: string): string {
  const [w='',a='',r=''] = raw.toString().replace(/,/g,'/').split('/');
  return `${w}/${a}R${r}`;
}

// Handles compact 8-digit CT codes like "2256016/R" → "225/60R16"
function formatTireSize(rawCode: string): string {
  const match = rawCode.match(/^(\d{3})(\d{2})(\d{2})\/R$/);
  if (!match) return parseTireSize(rawCode);
  return `${match[1]}/${match[2]}R${match[3]}`;
}

// ─── SHOPIFY HELPERS ──────────────────────────────────────────────────────────

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
  if (!res.ok) throw new Error(`Shopify ${res.status} on ${path}: ${(await res.text()).slice(0,200)}`);
  if (res.status === 204 || res.headers.get('content-length') === '0') return {} as T;
  return res.json() as Promise<T>;
}

interface ExistingProduct { productId:number; variantId:number; inventoryItemId:number; price:string; hasImages:boolean; }

async function fetchExistingProducts(): Promise<Map<string,ExistingProduct>> {
  const map = new Map<string,ExistingProduct>();
  let sinceId = 0;
  while (true) {
    const q = `tag=${SYNC_TAG}&limit=250&fields=id,variants,images${sinceId?`&since_id=${sinceId}`:''}`;
    const data: any = await shopifyFetch<any>(`/products.json?${q}`);
    const products = data.products || [];
    for (const p of products) {
      const hasImages = Array.isArray(p.images) && p.images.length > 0;
      for (const v of p.variants) {
        if (v.sku) map.set(v.sku, { productId:p.id, variantId:v.id, inventoryItemId:v.inventory_item_id, price:v.price, hasImages });
      }
    }
    if (products.length < 250) break;
    sinceId = products[products.length-1].id;
  }
  return map;
}

let _locationId: number | null = null;
async function getLocationId(): Promise<number> {
  if (_locationId) return _locationId;
  const data: any = await shopifyFetch<any>('/locations.json?limit=1');
  _locationId = data.locations?.[0]?.id;
  if (!_locationId) throw new Error('No Shopify location found');
  return _locationId;
}

async function setInventory(inventoryItemId: number, qty: number): Promise<void> {
  try {
    const locationId = await getLocationId();
    await shopifyFetch('/inventory_levels/set.json', {
      method: 'POST',
      body: JSON.stringify({ location_id:locationId, inventory_item_id:inventoryItemId, available:Math.max(0,qty) }),
    });
  } catch (e) { console.warn(`⚠️ Inventory update failed for ${inventoryItemId}:`, e); }
}

// ─── IMAGE ATTACHMENT ─────────────────────────────────────────────────────────

async function attachProductImage(productId: number, ct: CTTire): Promise<boolean> {
  const lookupKey = `${ct.brand} ${ct.model}`;
  const imageUrl  = getTireImageUrl(lookupKey);

  if (!imageUrl) {
    console.log(`⚠️  No image in map for: "${lookupKey}"`);
    return false;
  }

  try {
    await shopifyFetch(`/products/${productId}/images.json`, {
      method: 'POST',
      body: JSON.stringify({ image: { src: imageUrl, alt: lookupKey } }),
    });
    console.log(`🖼️  Image attached for: "${lookupKey}"`);
    return true;
  } catch (e: any) {
    console.warn(`⚠️  Image attach failed for ${productId} ("${lookupKey}"): ${e.message}`);
    return false;
  }
}

async function runImageBackfill(offset = 0, limit = 100): Promise<{ attached: number; skipped: number; missing: number; errors: number; total: number; nextOffset: number; done: boolean }> {
  const stats = { attached: 0, skipped: 0, missing: 0, errors: 0, total: 0, nextOffset: 0, done: false };

  let sinceId = 0;
  const allProducts: Array<{ id: number; title: string; images: any[] }> = [];

  while (true) {
    const q = `tag=${SYNC_TAG}&limit=250&fields=id,title,images${sinceId ? `&since_id=${sinceId}` : ''}`;
    const data: any = await shopifyFetch<any>(`/products.json?${q}`);
    const products = data.products || [];
    allProducts.push(...products);
    if (products.length < 250) break;
    sinceId = products[products.length - 1].id;
  }

  stats.total     = allProducts.length;
  const chunk     = allProducts.slice(offset, offset + limit);
  stats.nextOffset = offset + limit;
  stats.done      = stats.nextOffset >= allProducts.length;

  console.log(`🔍 Backfill: chunk ${offset}–${offset + chunk.length} of ${allProducts.length} products...`);

  await processBatches(chunk, async (p) => {
    if (p.images && p.images.length > 0) {
      stats.skipped++;
      return;
    }

    const titleParts = p.title.trim().split(' ');
    let imageUrl: string | undefined;
    let matchedKey = '';
    for (let drop = 0; drop < 3; drop++) {
      const key = titleParts.slice(0, titleParts.length - drop).join(' ');
      imageUrl = getTireImageUrl(key);
      if (imageUrl) { matchedKey = key; break; }
    }

    if (!imageUrl) {
      console.log(`❌ No image map match for: "${p.title}"`);
      stats.missing++;
      return;
    }

    try {
      await shopifyFetch(`/products/${p.id}/images.json`, {
        method: 'POST',
        body: JSON.stringify({ image: { src: imageUrl, alt: matchedKey } }),
      });
      console.log(`🖼️  Backfill image attached: "${matchedKey}"`);
      stats.attached++;
    } catch (e: any) {
      console.warn(`⚠️  Backfill image failed for ${p.id}: ${e.message}`);
      stats.errors++;
    }
  });

  return stats;
}

// ─── TITLE CASE ───────────────────────────────────────────────────────────────
// Mirrors the logic in api/fixTitles.ts — keep both in sync if updating.

function convertToken(token: string): string {
  if (/^[A-Z]*[0-9]+[A-Z0-9]*$/.test(token)) return token;
  if (/^(XL|XLT|SUV|ATX|4X4|4WD|AWD|AW|WS|HP|UHP|HT|LT|ST|GT|GTS|LE|SE|EV|SRX|OE|OEM|M\+S|3PMSF|OWL|BSW|VSB)$/.test(token)) return token;
  return token.charAt(0).toUpperCase() + token.slice(1).toLowerCase();
}

function toTitleCase(original: string): string {
  return original.split(' ').map(word => {
    if (word.includes('-')) return word.split('-').map(convertToken).join('-');
    return convertToken(word);
  }).join(' ').replace(/\/r\b/g, '/R');
}

// ─── BUILD SHOPIFY PAYLOAD ────────────────────────────────────────────────────
// Uses REAL CT dealer cost (ct.cost field) instead of MSRP estimate.
// Safety check: if cost looks wrong (>90% of MSRP or zero), fall back to estimate.

function buildPayload(ct: CTTire) {
  const size    = formatTireSize(ct.size);
  const season  = ct.isWinter ? 'Winter' : 'All-Season';
  const qty     = getTotalQty(ct);
  const closest = getClosestWarehouse(ct);
  const msrp    = parseFloat(ct.msrp) || 0;
  const rawCost = parseFloat(ct.cost) || 0;

  // Use real cost, but fall back to estimate if data looks bad
  const costLooksValid = rawCost > 0 && rawCost < msrp * 0.90;
  const netCost = costLooksValid ? rawCost : msrp * NET_MULTIPLIER;

  const tireType       = classifyTireType(ct.performanceCategory, ct.size);
  const shippingBuffer = getShippingBuffer(ct.performanceCategory, ct.size);
  const floorPrice     = netCost + shippingBuffer;

  const tags = [
    SYNC_TAG,
    `brand-${ct.brand.toLowerCase().replace(/\s+/g,'-')}`,
    season.toLowerCase(),
    `tire-type-${tireType}`,
    size,
    ct.isRunFlat ? 'run-flat' : null,
  ].filter(Boolean).join(', ');

  return {
    product: {
      title:        toTitleCase(`${ct.brand} ${ct.model} ${size}`.trim()),
      body_html:    `<p><strong>${ct.brand} ${ct.model}</strong> — ${size}</p><ul><li>Season: ${season}</li>${ct.isRunFlat?'<li>Run-Flat</li>':''}${ct.isWinter?'<li>3PMSF Winter</li>':''}<li>Stock: ${qty} units${closest?` (nearest: ${closest})`:''}</li><li>Part #: ${ct.partNumber}</li></ul>`,
      vendor:       ct.brand,
      product_type: 'Tire',
      tags,
      variants: [{
        sku:                  ct.partNumber,
        price:                msrp.toFixed(2),                // Selling price (bulk updater adjusts later)
        compare_at_price:     msrp.toFixed(2),                // MSRP strikethrough
        cost:                 netCost.toFixed(2),              // Net cost = MSRP × 0.50
        inventory_management: 'shopify',
        inventory_policy:     'deny',
        requires_shipping:    true,
        taxable:              true,
        weight:               25,
        weight_unit:          'lb',
        option1:              size,
      }],
      options: [{ name: 'Size' }],
      metafields: [
        { namespace:'canada_tire', key:'cost',             value:(parseFloat(ct.cost)||0).toFixed(2), type:'number_decimal' },
        { namespace:'canada_tire', key:'part_number',      value:ct.partNumber,                       type:'single_line_text_field' },
        { namespace:'gci',         key:'net_cost',          value:netCost.toFixed(2),                  type:'number_decimal' },
        { namespace:'gci',         key:'floor_price',       value:floorPrice.toFixed(2),               type:'number_decimal' },
        { namespace:'gci',         key:'shipping_buffer',   value:shippingBuffer.toFixed(2),           type:'number_decimal' },
        { namespace:'gci',         key:'tire_type',         value:tireType,                            type:'single_line_text_field' },
        { namespace:'gci',         key:'performance_category', value:ct.performanceCategory || 'Standard', type:'single_line_text_field' },
      ],
    },
  };
}

// ─── BATCH HELPER ─────────────────────────────────────────────────────────────

async function processBatches<T>(items: T[], fn: (item: T) => Promise<void>): Promise<void> {
  for (let i = 0; i < items.length; i += BATCH_SIZE) {
    await Promise.all(items.slice(i, i+BATCH_SIZE).map(fn));
    if (i+BATCH_SIZE < items.length) await delay(BATCH_MS);
  }
}

// ─── MAIN SYNC ────────────────────────────────────────────────────────────────

interface SyncStats {
  created:number; updated:number; skipped:number; errors:number;
  skippedNoStock:number;                // NEW: count of zero-stock products filtered out
  errorList:string[]; duration:string; timestamp:string;
  totalCT?:number; inStock?:number;     // NEW: total vs in-stock counts
  offset?:number; chunkSize?:number; done?:boolean;
}

async function runSync(mode: 'full'|'daily', offset: number = 0, chunkSize: number = 50, updateOffset: number = 0, updateChunkSize: number = 200): Promise<SyncStats & { updateDone?: boolean; nextUpdateOffset?: number }> {
  const t0 = Date.now();
  const stats: SyncStats & { updateDone?: boolean; nextUpdateOffset?: number } = {
    created:0, updated:0, skipped:0, errors:0,
    skippedNoStock:0,
    errorList:[], duration:'', timestamp:new Date().toISOString(),
  };

  console.log(`🚀 ${mode} sync — offset:${offset} chunkSize:${chunkSize}`);
  const [ctTires, existingMap] = await Promise.all([fetchAllCTTires(), fetchExistingProducts()]);
  console.log(`📦 CT:${ctTires.length} Shopify:${existingMap.size}`);

  // ── NEW: Filter out zero-stock products for creation ──
  // Products already in Shopify still get inventory updates (could go to 0)
  // but NEW products are only created if they have positive stock.
  const inStockTires = ctTires.filter(p => getTotalQty(p) > 0);
  stats.totalCT       = ctTires.length;
  stats.inStock       = inStockTires.length;
  stats.skippedNoStock = ctTires.length - inStockTires.length;
  stats.offset         = offset;
  stats.chunkSize      = chunkSize;

  console.log(`📊 In stock: ${inStockTires.length}/${ctTires.length} (${stats.skippedNoStock} filtered out)`);

  // For CREATE: only use in-stock tires, sliced by chunk
  const createPool = inStockTires.filter(p => !existingMap.has(p.partNumber));
  const createChunk = createPool.slice(offset, offset + chunkSize);

  // For UPDATE: chunk existing products (price + inventory + cost), including zero-stock
  const toUpdate = ctTires.filter(p => existingMap.has(p.partNumber));
  const updateChunk = toUpdate.slice(updateOffset, updateOffset + updateChunkSize);
  stats.updateDone = updateOffset + updateChunkSize >= toUpdate.length;
  stats.nextUpdateOffset = stats.updateDone ? 0 : updateOffset + updateChunkSize;

  stats.done = (offset + chunkSize >= createPool.length) && stats.updateDone;

  console.log(`🆕 New to create: ${createChunk.length} (of ${createPool.length} total new)`);
  console.log(`🔄 Existing to update: ${updateChunk.length} of ${toUpdate.length} (offset ${updateOffset})`);

  // Create new products (only positive stock)
  await processBatches(createChunk, async (ct) => {
    try {
      const data: any = await shopifyFetch<any>('/products.json', { method:'POST', body:JSON.stringify(buildPayload(ct)) });
      const productId = data.product?.id;
      const invId     = data.product?.variants?.[0]?.inventory_item_id;
      if (invId)     await setInventory(invId, getTotalQty(ct));
      if (productId) await attachProductImage(productId, ct);
      stats.created++;
    } catch (e: any) { stats.errors++; stats.errorList.push(`CREATE ${ct.partNumber}: ${e.message}`); }
  });

  // Update existing products (price, inventory, cost) — chunked
  await processBatches(updateChunk, async (ct) => {
    const ex = existingMap.get(ct.partNumber)!;
    const msrp     = parseFloat(ct.msrp) || 0;
    const rawCost  = parseFloat(ct.cost) || 0;
    const costOk   = rawCost > 0 && rawCost < msrp * 0.90;
    const netCost  = costOk ? rawCost : msrp * NET_MULTIPLIER;
    const newPrice = msrp.toFixed(2);
    const priceChanged = newPrice !== ex.price;

    if (!priceChanged && mode === 'daily') {
      // Price unchanged — still write real cost + update inventory + backfill image
      try {
        await shopifyFetch(`/variants/${ex.variantId}.json`, {
          method: 'PUT',
          body: JSON.stringify({
            variant: { id: ex.variantId, cost: netCost.toFixed(2) },
          }),
        });
        await setInventory(ex.inventoryItemId, getTotalQty(ct));
        if (!ex.hasImages) await attachProductImage(ex.productId, ct);
        stats.updated++;
      } catch (e: any) { stats.errors++; stats.errorList.push(`COST ${ct.partNumber}: ${e.message}`); }
      return;
    }

    try {
      // Always update variant: cost (real CT cost) + price if changed
      await shopifyFetch(`/variants/${ex.variantId}.json`, {
        method: 'PUT',
        body: JSON.stringify({
          variant: {
            id:               ex.variantId,
            ...(priceChanged ? { price: newPrice, compare_at_price: newPrice } : {}),
            cost:             netCost.toFixed(2),      // Always write real CT cost
          },
        }),
      });
      await setInventory(ex.inventoryItemId, getTotalQty(ct));
      if (!ex.hasImages) await attachProductImage(ex.productId, ct);
      stats.updated++;
    } catch (e: any) { stats.errors++; stats.errorList.push(`UPDATE ${ct.partNumber}: ${e.message}`); }
  });

  stats.duration = `${((Date.now()-t0)/1000).toFixed(1)}s`;
  console.log(`✅ Chunk done in ${stats.duration} — created:${stats.created} updated:${stats.updated} skipped:${stats.skipped} skippedNoStock:${stats.skippedNoStock} errors:${stats.errors} done:${stats.done}`);
  return stats;
}

// ─── VERCEL HANDLER ───────────────────────────────────────────────────────────

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const isCron   = req.method === 'GET';
  const isManual = req.method === 'POST';
  if (!isCron && !isManual) return res.status(405).json({ error: 'Use GET (cron) or POST (manual)' });

  const secret = process.env.CRON_SECRET || '';
  if (isManual && secret) {
    const provided = (req.headers.authorization || '').replace('Bearer ', '');
    if (provided !== secret) return res.status(401).json({ error: 'Unauthorized' });
  }

  if (!SHOPIFY.domain || !SHOPIFY.token) {
    return res.status(500).json({
      error: 'Missing Shopify config',
      missing: [!SHOPIFY.domain?'SHOPIFY_STORE_DOMAIN':null, !SHOPIFY.token?'SHOPIFY_ADMIN_ACCESS_TOKEN':null].filter(Boolean),
    });
  }

  const action = (req.query.action as string) || (req.body as any)?.action || (isCron ? 'daily-sync' : 'status');

  try {
    switch (action) {
      case 'status': {
        const existing = await fetchExistingProducts();
        return res.status(200).json({
          success:true,
          shopifyProductCount: existing.size,
          domain:              SHOPIFY.domain,
          ctEnvironment:       CT.useSandbox ? 'SANDBOX' : 'PRODUCTION',
          nextCron:            '3:00 AM ET daily',
          pricingConfig: {
            netMultiplier:  NET_MULTIPLIER,
            shippingBuffers: SHIPPING_BUFFERS,
            note: 'Use /api/bulkPriceUpdate?action=price-preview to see competitive pricing',
          },
        });
      }
      case 'cost-analysis': {
        // Pull real CT costs and compare to MSRP — helps calibrate pricing formula
        const ctTires = await fetchAllCTTires();
        const inStock = ctTires.filter(p => getTotalQty(p) > 0);

        // Sample across price ranges
        const sorted = [...inStock].sort((a, b) => parseFloat(a.msrp) - parseFloat(b.msrp));
        const sampleSize = 30;
        const step = Math.max(1, Math.floor(sorted.length / sampleSize));
        const sample = sorted.filter((_, i) => i % step === 0).slice(0, sampleSize);

        const analysis = sample.map(t => {
          const msrp = parseFloat(t.msrp) || 0;
          const realCost = parseFloat(t.cost) || 0;
          const estimated50 = msrp * 0.50;
          const costPct = msrp > 0 ? ((realCost / msrp) * 100) : 0;
          const tireType = classifyTireType(t.performanceCategory, t.size);
          const ship = SHIPPING_BUFFERS[tireType] || 35;
          const sellingReal = realCost + 30 + ship;
          const sellingEst  = estimated50 + 30 + ship;

          return {
            sku: t.partNumber,
            brand: t.brand,
            model: t.model,
            size: parseTireSize(t.size),
            tireType,
            msrp: `$${msrp.toFixed(2)}`,
            realCost: `$${realCost.toFixed(2)}`,
            estimated50pct: `$${estimated50.toFixed(2)}`,
            costAsPctOfMSRP: `${costPct.toFixed(1)}%`,
            difference: `$${(estimated50 - realCost).toFixed(2)}`,
            sellingWithRealCost: `$${sellingReal.toFixed(2)}`,
            sellingWithEstimate: `$${sellingEst.toFixed(2)}`,
            customerSavesMore: `$${(sellingEst - sellingReal).toFixed(2)}`,
          };
        });

        // Summary stats
        const allCosts = inStock.map(t => {
          const msrp = parseFloat(t.msrp) || 1;
          const cost = parseFloat(t.cost) || 0;
          return (cost / msrp) * 100;
        }).filter(p => p > 0 && p < 100);

        const avgPct = allCosts.reduce((s, v) => s + v, 0) / allCosts.length;
        const minPct = Math.min(...allCosts);
        const maxPct = Math.max(...allCosts);

        return res.status(200).json({
          success: true,
          mode: 'cost-analysis',
          totalInStock: inStock.length,
          costSummary: {
            avgCostAsPctOfMSRP: `${avgPct.toFixed(1)}%`,
            minCostPct: `${minPct.toFixed(1)}%`,
            maxCostPct: `${maxPct.toFixed(1)}%`,
            note: 'If avg is well below 50%, you can lower prices by using real CT cost instead of MSRP×0.50',
          },
          sample: analysis,
        });
      }
      case 'full-import': {
        const offset         = parseInt((req.body as any)?.offset    || req.query.offset    as string || '0', 10);
        const chunkSize      = parseInt((req.body as any)?.chunkSize || req.query.chunkSize as string || '50', 10);
        const updateOffset   = parseInt(req.query.updateOffset as string || '0', 10);
        const updateChunkSz  = parseInt(req.query.updateChunk  as string || '200', 10);
        const stats = await runSync('full', offset, chunkSize, updateOffset, updateChunkSz);
        return res.status(200).json({ success:true, mode:'full-import', ...stats });
      }
      case 'missing-images': {
        const checkAll = req.query.all === 'true';
        let sinceId = 0;
        const noImageTitles = new Set<string>();
        const withImageTitles = new Set<string>();
        const noImageProducts: Array<{ id: number; title: string }> = [];
        let totalScanned = 0;

        while (true) {
          const tagFilter = checkAll ? '' : `tag=${SYNC_TAG}&`;
          const q = `${tagFilter}limit=250&fields=id,title,images,tags${sinceId ? `&since_id=${sinceId}` : ''}`;
          const data: any = await shopifyFetch<any>(`/products.json?${q}`);
          const products = data.products || [];
          totalScanned += products.length;
          for (const p of products) {
            const tokens = p.title.trim().split(' ');
            const modelKey = tokens.slice(0, -1).join(' ').toUpperCase();
            if (!p.images || p.images.length === 0) {
              noImageTitles.add(modelKey);
              noImageProducts.push({ id: p.id, title: p.title });
            } else {
              withImageTitles.add(modelKey);
            }
          }
          if (products.length < 250) break;
          sinceId = products[products.length - 1].id;
        }

        const trulyMissing = [...noImageTitles].filter(t => !withImageTitles.has(t)).sort();
        const missingDetails = noImageProducts
          .filter(p => {
            const mk = p.title.trim().split(' ').slice(0, -1).join(' ').toUpperCase();
            return trulyMissing.includes(mk);
          })
          .map(p => p.title);

        return res.status(200).json({
          success: true, mode: 'missing-images',
          scope: checkAll ? 'ALL products' : 'ct-sync only',
          totalScanned,
          missingCount: trulyMissing.length,
          missing: trulyMissing,
          ...(checkAll ? { missingProducts: missingDetails } : {}),
        });
      }
      case 'debug-images': {
        const q = `tag=${SYNC_TAG}&limit=5&fields=id,title,images`;
        const data: any = await shopifyFetch<any>(`/products.json?${q}`);
        const sample = (data.products || []).map((p: any) => ({
          id: p.id,
          title: p.title,
          imageCount: p.images?.length || 0,
          firstImageSrc: p.images?.[0]?.src || null,
        }));
        return res.status(200).json({ success: true, mode: 'debug-images', sample });
      }
      case 'backfill-images': {
        const bfOffset = parseInt((req.body as any)?.offset ?? req.query.offset ?? '0', 10);
        const bfLimit  = parseInt((req.body as any)?.limit  ?? req.query.limit  ?? '100', 10);
        const bfStats  = await runImageBackfill(bfOffset, bfLimit);
        return res.status(200).json({ success:true, mode:'backfill-images', ...bfStats });
      }
      case 'attach-image': {
        // Attach an image to all products matching a title search
        // Usage: ?action=attach-image&search=COOPER+PROCONTROL&imageUrl=https://...
        const search   = (req.query.search as string || '').trim();
        const imageUrl = (req.query.imageUrl as string || '').trim();

        if (!search || !imageUrl) {
          return res.status(400).json({ error: 'Required params: search (title match) and imageUrl' });
        }

        let sinceId = 0;
        const matched: Array<{ id: number; title: string; hadImage: boolean }> = [];
        let attached = 0;
        let skipped = 0;
        let errors = 0;

        // Find all matching products
        while (true) {
          const q = `tag=${SYNC_TAG}&limit=250&fields=id,title,images${sinceId ? `&since_id=${sinceId}` : ''}`;
          const data: any = await shopifyFetch<any>(`/products.json?${q}`);
          const products = data.products || [];

          for (const p of products) {
            if (p.title.toUpperCase().includes(search.toUpperCase())) {
              const hasImage = p.images && p.images.length > 0;
              matched.push({ id: p.id, title: p.title, hadImage: hasImage });

              if (!hasImage) {
                try {
                  await shopifyFetch(`/products/${p.id}/images.json`, {
                    method: 'POST',
                    body: JSON.stringify({ image: { src: imageUrl, alt: p.title } }),
                  });
                  attached++;
                  await delay(500);
                } catch (e: any) {
                  errors++;
                  console.error(`❌ Image attach failed for ${p.title}: ${e.message}`);
                }
              } else {
                skipped++;
              }
            }
          }

          if (products.length < 250) break;
          sinceId = products[products.length - 1].id;
        }

        return res.status(200).json({
          success: true,
          mode: 'attach-image',
          search,
          imageUrl,
          totalMatched: matched.length,
          attached,
          skippedHadImage: skipped,
          errors,
          products: matched.map(m => `${m.title} ${m.hadImage ? '(had image)' : '✅ attached'}`),
        });
      }
      case 'fix-all-images': {
        // Batch fix: find all products with missing images, use curated image map
        const dryRun = (req.query.dryRun ?? 'true') !== 'false';

        // 1. Find all products missing images
        let sinceId = 0;
        const noImageProducts: Array<{ id: number; title: string; modelKey: string }> = [];
        const withImageModels = new Set<string>();

        while (true) {
          const q = `tag=${SYNC_TAG}&limit=250&fields=id,title,images${sinceId ? `&since_id=${sinceId}` : ''}`;
          const data: any = await shopifyFetch<any>(`/products.json?${q}`);
          const products = data.products || [];
          for (const p of products) {
            const tokens = p.title.trim().split(' ');
            const modelKey = tokens.slice(0, -1).join(' ').toUpperCase();
            if (!p.images || p.images.length === 0) {
              noImageProducts.push({ id: p.id, title: p.title, modelKey });
            } else {
              withImageModels.add(modelKey);
            }
          }
          if (products.length < 250) break;
          sinceId = products[products.length - 1].id;
        }

        const trulyMissing = noImageProducts.filter(p => !withImageModels.has(p.modelKey));

        // 2. Group by model and match to IMAGE_MAP
        const modelGroups = new Map<string, typeof trulyMissing>();
        for (const p of trulyMissing) {
          if (!modelGroups.has(p.modelKey)) modelGroups.set(p.modelKey, []);
          modelGroups.get(p.modelKey)!.push(p);
        }

        if (dryRun) {
          const plan = [...modelGroups.entries()].map(([model, products]) => {
            const imageUrl = getTireImageUrl(products[0].title);
            return {
              model,
              imageUrl: imageUrl || '⚠️ NO SOURCE — use attach-image manually',
              productCount: products.length,
              hasSource: !!imageUrl,
            };
          });
          return res.status(200).json({
            success: true, mode: 'fix-all-images', dryRun: true,
            totalMissing: trulyMissing.length,
            uniqueModels: modelGroups.size,
            withSource: plan.filter(p => p.hasSource).length,
            withoutSource: plan.filter(p => !p.hasSource).length,
            plan,
          });
        }

        // 3. Execute
        let attached = 0;
        let errors = 0;
        let skippedNoSource = 0;
        const results: Array<{ title: string; status: string; url?: string; error?: string }> = [];

        for (const p of trulyMissing) {
          const imageUrl = getTireImageUrl(p.title);
          if (!imageUrl) {
            skippedNoSource++;
            results.push({ title: p.title, status: '⏭️ no source URL' });
            continue;
          }
          try {
            await shopifyFetch(`/products/${p.id}/images.json`, {
              method: 'POST',
              body: JSON.stringify({ image: { src: imageUrl, alt: p.title } }),
            });
            attached++;
            results.push({ title: p.title, status: '✅ attached', url: imageUrl });
            await delay(500);
          } catch (e: any) {
            errors++;
            results.push({ title: p.title, status: '❌ failed', url: imageUrl, error: e.message?.slice(0, 150) });
          }
        }

        return res.status(200).json({
          success: true, mode: 'fix-all-images', dryRun: false,
          totalMissing: trulyMissing.length,
          attached, errors, skippedNoSource,
          results,
        });
      }
      case 'dedup': {
        const dryRun = !(req.body as any)?.confirm;
        const allById = new Map<number, { id: number; title: string; imageCount: number }>();
        let nextUrl: string | null =
          `${SHOPIFY.baseUrl}/products.json?tag=${SYNC_TAG}&limit=250&fields=id,title,images`;
        let safetyLimit = 20;
        while (nextUrl && safetyLimit-- > 0) {
          const res = await fetch(nextUrl, {
            headers: {
              'Content-Type': 'application/json',
              'X-Shopify-Access-Token': SHOPIFY.token,
            },
          });
          if (!res.ok) throw new Error(`Shopify ${res.status} paginating products`);
          const data: any = await res.json();
          for (const p of (data.products || [])) {
            allById.set(p.id, { id: p.id, title: p.title, imageCount: p.images?.length || 0 });
          }
          const link = res.headers.get('link') || '';
          const nextMatch = link.match(/<([^>]+)>;\s*rel="next"/);
          nextUrl = nextMatch ? nextMatch[1] : null;
        }

        const byTitle = new Map<string, Array<{ id: number; title: string; imageCount: number }>>();
        for (const p of allById.values()) {
          const key = p.title.trim().toUpperCase();
          if (!byTitle.has(key)) byTitle.set(key, []);
          byTitle.get(key)!.push(p);
        }

        const duplicateGroups: Array<{ title: string; keep: number; delete: number[] }> = [];
        for (const [title, group] of byTitle.entries()) {
          const seen = new Map<number, { id: number; title: string; imageCount: number }>();
          for (const p of group) seen.set(p.id, p);
          const unique = [...seen.values()];
          if (unique.length < 2) continue;
          unique.sort((a, b) => b.imageCount - a.imageCount || a.id - b.id);
          const keepId = unique[0].id;
          const deleteIds = [...new Set(unique.slice(1).map(p => p.id))].filter(id => id !== keepId);
          if (deleteIds.length === 0) continue;
          duplicateGroups.push({ title, keep: keepId, delete: deleteIds });
        }

        const toDelete = duplicateGroups.flatMap(g => g.delete);

        if (!dryRun) {
          let deleted = 0, failed = 0;
          for (const id of toDelete) {
            try {
              await shopifyFetch(`/products/${id}.json`, { method: 'DELETE' });
              deleted++;
            } catch (err) {
              console.error(`[dedup] Failed to delete product ${id}:`, err);
              failed++;
            }
            await new Promise(r => setTimeout(r, 250));
          }
          return res.status(200).json({
            success: true, mode: 'dedup', dryRun: false,
            duplicateGroups: duplicateGroups.length,
            deleted, failed,
            detail: duplicateGroups,
          });
        }

        return res.status(200).json({
          success: true, mode: 'dedup', dryRun: true,
          duplicateGroups: duplicateGroups.length,
          wouldDelete: toDelete.length,
          detail: duplicateGroups,
        });
      }
      case 'daily-sync':
      default: {
        const updateOffset    = parseInt(req.query.updateOffset as string || '0', 10);
        const updateChunkSize = parseInt(req.query.updateChunk  as string || '200', 10);
        const stats = await runSync('daily', 0, 9999, updateOffset, updateChunkSize);
        return res.status(200).json({
          success: true,
          mode: 'daily-sync',
          ...stats,
          nextUrl: stats.updateDone ? null : `?action=daily-sync&updateOffset=${stats.nextUpdateOffset}`,
        });
      }
    }
  } catch (e: any) {
    console.error('❌ shopifySync error:', e);
    return res.status(500).json({ success:false, error:e.message });
  }
}
