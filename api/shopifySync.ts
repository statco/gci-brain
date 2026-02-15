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

interface ExistingProduct { productId:number; variantId:number; inventoryItemId:number; price:string; }

async function fetchExistingProducts(): Promise<Map<string,ExistingProduct>> {
  const map = new Map<string,ExistingProduct>();
  let sinceId = 0;
  while (true) {
    const q = `tag=${SYNC_TAG}&limit=250&fields=id,variants${sinceId?`&since_id=${sinceId}`:''}`;
    const data: any = await shopifyFetch<any>(`/products.json?${q}`);
    const products = data.products || [];
    for (const p of products) {
      for (const v of p.variants) {
        if (v.sku) map.set(v.sku, { productId:p.id, variantId:v.id, inventoryItemId:v.inventory_item_id, price:v.price });
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

/**
 * Attach a tire image to a Shopify product via the Admin REST API.
 * Uses the static IMAGE_MAP — zero extra network calls for the lookup itself.
 * Only called for newly created products (updates skip to avoid duplicates).
 */
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

/**
 * Backfill: attach images to existing products that have none.
 * Run once manually via POST ?action=backfill-images
 */
async function runImageBackfill(offset = 0, limit = 100): Promise<{ attached: number; skipped: number; missing: number; errors: number; total: number; nextOffset: number; done: boolean }> {
  const stats = { attached: 0, skipped: 0, missing: 0, errors: 0, total: 0, nextOffset: 0, done: false };

  // Fetch all CT-synced products with their current images
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
    // Skip if already has an image
    if (p.images && p.images.length > 0) {
      stats.skipped++;
      return;
    }

    // title format: "Brand Model Size" — strip trailing size to get brand+model
    const titleParts = p.title.trim().split(' ');
    // Try full title first, then drop last token (size) iteratively
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

function buildPayload(ct: CTTire) {
  const size    = parseTireSize(ct.size);
  const season  = ct.isWinter ? 'Winter' : 'All-Season';
  const qty     = getTotalQty(ct);
  const closest = getClosestWarehouse(ct);
  const tags    = [SYNC_TAG, `brand-${ct.brand.toLowerCase().replace(/\s+/g,'-')}`, season.toLowerCase(), ct.isRunFlat?'run-flat':null].filter(Boolean).join(', ');

  return {
    product: {
      title:        `${ct.brand} ${ct.model} ${size}`.trim(),
      body_html:    `<p><strong>${ct.brand} ${ct.model}</strong> — ${size}</p><ul><li>Season: ${season}</li>${ct.isRunFlat?'<li>Run-Flat</li>':''}${ct.isWinter?'<li>3PMSF Winter</li>':''}<li>Stock: ${qty} units${closest?` (nearest: ${closest})`:''}</li><li>Part #: ${ct.partNumber}</li></ul>`,
      vendor:       ct.brand,
      product_type: 'Tire',
      tags,
      variants: [{
        sku: ct.partNumber,
        price: (parseFloat(ct.msrp)||0).toFixed(2),
        inventory_management: 'shopify',
        inventory_policy: 'deny',
        requires_shipping: true, taxable: true,
        weight: 25, weight_unit: 'lb',
        option1: size,
      }],
      options: [{ name: 'Size' }],
      metafields: [
        { namespace:'canada_tire', key:'cost',        value:(parseFloat(ct.cost)||0).toFixed(2), type:'number_decimal' },
        { namespace:'canada_tire', key:'part_number', value:ct.partNumber, type:'single_line_text_field' },
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

interface SyncStats { created:number; updated:number; skipped:number; errors:number; errorList:string[]; duration:string; timestamp:string; totalCT?:number; offset?:number; chunkSize?:number; done?:boolean; }

async function runSync(mode: 'full'|'daily', offset: number = 0, chunkSize: number = 50): Promise<SyncStats> {
  const t0 = Date.now();
  const stats: SyncStats = { created:0, updated:0, skipped:0, errors:0, errorList:[], duration:'', timestamp:new Date().toISOString() };

  console.log(`🚀 ${mode} sync — offset:${offset} chunkSize:${chunkSize}`);
  const [ctTires, existingMap] = await Promise.all([fetchAllCTTires(), fetchExistingProducts()]);
  console.log(`📦 CT:${ctTires.length} Shopify:${existingMap.size}`);

  stats.totalCT  = ctTires.length;
  stats.offset   = offset;
  stats.chunkSize = chunkSize;

  // Slice the chunk for this call
  const chunk = ctTires.slice(offset, offset + chunkSize);
  stats.done  = offset + chunkSize >= ctTires.length;

  const toCreate = chunk.filter(p => !existingMap.has(p.partNumber));
  const toUpdate = chunk.filter(p =>  existingMap.has(p.partNumber));

  // Create new products
  await processBatches(toCreate, async (ct) => {
    try {
      const data: any = await shopifyFetch<any>('/products.json', { method:'POST', body:JSON.stringify(buildPayload(ct)) });
      const productId = data.product?.id;
      const invId     = data.product?.variants?.[0]?.inventory_item_id;
      if (invId)     await setInventory(invId, getTotalQty(ct));
      if (productId) await attachProductImage(productId, ct);  // 🖼️ attach from static map
      stats.created++;
    } catch (e: any) { stats.errors++; stats.errorList.push(`CREATE ${ct.partNumber}: ${e.message}`); }
  });

  // Update existing products
  await processBatches(toUpdate, async (ct) => {
    const ex = existingMap.get(ct.partNumber)!;
    const newPrice = (parseFloat(ct.msrp)||0).toFixed(2);
    const priceChanged = newPrice !== ex.price;

    if (!priceChanged && mode === 'daily') {
      await setInventory(ex.inventoryItemId, getTotalQty(ct));
      stats.skipped++;
      return;
    }

    try {
      if (priceChanged) {
        await shopifyFetch(`/variants/${ex.variantId}.json`, { method:'PUT', body:JSON.stringify({ variant:{ id:ex.variantId, price:newPrice } }) });
      }
      await setInventory(ex.inventoryItemId, getTotalQty(ct));
      stats.updated++;
    } catch (e: any) { stats.errors++; stats.errorList.push(`UPDATE ${ct.partNumber}: ${e.message}`); }
  });

  stats.duration = `${((Date.now()-t0)/1000).toFixed(1)}s`;
  console.log(`✅ Chunk done in ${stats.duration} — created:${stats.created} updated:${stats.updated} skipped:${stats.skipped} errors:${stats.errors} done:${stats.done}`);
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
        return res.status(200).json({ success:true, shopifyProductCount:existing.size, domain:SHOPIFY.domain, ctEnvironment:CT.useSandbox?'SANDBOX':'PRODUCTION', nextCron:'3:00 AM ET daily' });
      }
      case 'full-import': {
        const offset    = parseInt((req.body as any)?.offset    || '0', 10);
        const chunkSize = parseInt((req.body as any)?.chunkSize || '50', 10);
        const stats = await runSync('full', offset, chunkSize);
        return res.status(200).json({ success:true, mode:'full-import', ...stats });
      }
      case 'missing-images': {
        // Returns all unique titles that have NO image — to identify map gaps
        let sinceId = 0;
        const noImageTitles = new Set<string>();
        const withImageTitles = new Set<string>();

        while (true) {
          const q = `tag=${SYNC_TAG}&limit=250&fields=id,title,images${sinceId ? `&since_id=${sinceId}` : ''}`;
          const data: any = await shopifyFetch<any>(`/products.json?${q}`);
          const products = data.products || [];
          for (const p of products) {
            // Strip size suffix from title (last token e.g. "235/65R18" or "2356518/R")
            const tokens = p.title.trim().split(' ');
            const modelKey = tokens.slice(0, -1).join(' ').toUpperCase();
            if (!p.images || p.images.length === 0) {
              noImageTitles.add(modelKey);
            } else {
              withImageTitles.add(modelKey);
            }
          }
          if (products.length < 250) break;
          sinceId = products[products.length - 1].id;
        }

        // Only report models that NEVER have an image (not just some variants missing)
        const trulyMissing = [...noImageTitles].filter(t => !withImageTitles.has(t)).sort();
        return res.status(200).json({
          success: true, mode: 'missing-images',
          missingCount: trulyMissing.length,
          missing: trulyMissing,
        });
      }
      case 'debug-images': {
        // Returns first 5 products with their image state for diagnosis
        let sinceId = 0;
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
      case 'dedup': {
        // Finds duplicate ct-sync products (same title) and deletes all but the best copy.
        // "Best" = most images; tiebreak = lowest product ID (oldest).
        // Default is DRY RUN — pass { confirm: true } in body to actually delete.
        const dryRun = !(req.body as any)?.confirm;
        let sinceId = 0;
        const byTitle = new Map<string, Array<{ id: number; title: string; imageCount: number }>>();

        // Page through all ct-sync products
        while (true) {
          const q = `tag=${SYNC_TAG}&limit=250&fields=id,title,images${sinceId ? `&since_id=${sinceId}` : ''}`;
          const data: any = await shopifyFetch<any>(`/products.json?${q}`);
          const products = data.products || [];
          for (const p of products) {
            const key = p.title.trim().toUpperCase();
            if (!byTitle.has(key)) byTitle.set(key, []);
            byTitle.get(key)!.push({ id: p.id, title: p.title, imageCount: p.images?.length || 0 });
          }
          if (products.length < 250) break;
          sinceId = products[products.length - 1].id;
        }

        // Identify duplicates
        const duplicateGroups: Array<{ title: string; keep: number; delete: number[] }> = [];
        for (const [title, group] of byTitle.entries()) {
          // Deduplicate by product ID first (since_id pagination can yield same product twice)
          const seen = new Map<number, { id: number; title: string; imageCount: number }>();
          for (const p of group) seen.set(p.id, p);
          const unique = [...seen.values()];
          if (unique.length < 2) continue;
          // Sort: most images first, then lowest ID (oldest) as tiebreak
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
            await new Promise(r => setTimeout(r, 250)); // rate-limit: 4 req/s
          }
          return res.status(200).json({
            success: true, mode: 'dedup', dryRun: false,
            duplicateGroups: duplicateGroups.length,
            deleted, failed,
            detail: duplicateGroups,
          });
        }

        // Dry run — just report what would be deleted
        return res.status(200).json({
          success: true, mode: 'dedup', dryRun: true,
          duplicateGroups: duplicateGroups.length,
          wouldDelete: toDelete.length,
          detail: duplicateGroups,
        });
      }
      case 'daily-sync':
      default: {
        const stats = await runSync('daily', 0, 9999);
        return res.status(200).json({ success:true, mode:'daily-sync', ...stats });
      }
    }
  } catch (e: any) {
    console.error('❌ shopifySync error:', e);
    return res.status(500).json({ success:false, error:e.message });
  }
}
