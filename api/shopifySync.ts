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
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { classifyTire } = require('../lib/classifyTire.cjs') as typeof import('../lib/classifyTire.js');

export const config = {
  maxDuration: 300,
  api: {
    bodyParser: {
      sizeLimit: '1mb',
    },
  },
};

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

const SYNC_TAG   = 'ct-sync';
const BATCH_SIZE = 5;
const BATCH_MS   = 300;

// ─── PRICING CONFIG ───────────────────────────────────────────────────────────

const SHOPIFY_PAYMENT_FEE = 0.029;
const TARGET_NET_MARGIN   = 0.15;
const WALMART_FEE         = 0.12;

const SHIPPING_BUFFERS: Record<string, number> = {
  passenger:   40,
  light_truck: 50,
  heavy_truck: 65,
};

const VENDOR_MAP: Record<string, string> = {
  'COOPER':     'Cooper',
  'NEXEN':      'Nexen',
  'VREDESTEIN': 'Vredestein',
  'MAXTREK':    'Maxtrek',
  'MINERVA':    'Minerva',
  'OVATION':    'Ovation',
  'STARFIRE':   'Starfire',
  'KENDA':       'Kenda',
  'TRANSEAGLE':  'Transeagle',
  'PIRELLI':     'Pirelli',
  'GT RADIAL':   'GT Radial',
  'FALKEN':      'Falken',
  'KELLY':       'Kelly',
};

function calculatePrice(cost: number): number {
  let raw: number;
  if (cost < 100) {
    raw = Math.max(cost * 2.10, 150);
  } else if (cost <= 250) {
    raw = cost * 1.72;
  } else {
    raw = cost * 1.58;
  }
  const rounded = Math.round(raw);
  return (rounded - 0.01) >= raw * 0.98
    ? parseFloat((rounded - 0.01).toFixed(2))
    : parseFloat(raw.toFixed(2));
}

// ─── CT DEALER COST (no substitution) ──────────────────────────────────────
// Returns the real CT dealer cost as a number, or null when CT provides no
// cost or a non-numeric / non-positive value. Callers MUST skip + flag a null
// SKU. We never substitute MSRP and never halve — Shopify "Cost per item" is
// always the unmodified CT dealer cost.
function parseCTDealerCost(raw: unknown): number | null {
  if (raw === null || raw === undefined || String(raw).trim() === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}

// Plausible dealer-cost band as a ratio of MSRP. A valid cost must satisfy
//   msrp * COST_MSRP_FLOOR <= cost < msrp * COST_MSRP_CEIL
// Below the floor → implausibly low (clearance / bad pull); at or above the
// ceiling → looks like MSRP, not dealer cost. Out-of-band cost is skipped +
// flagged, NEVER written or substituted. Tunable via env without a code change.
const COST_MSRP_FLOOR = parseFloat(process.env.COST_MSRP_FLOOR || '') || 0.25;
const COST_MSRP_CEIL  = parseFloat(process.env.COST_MSRP_CEIL  || '') || 0.90;

type CostCheck =
  | { ok: true;  cost: number }
  | { ok: false; reason: 'no_cost' }
  | { ok: false; reason: 'out_of_band'; cost: number; min: number; max: number };

// Validate the CT dealer cost against the MSRP-ratio band.
//  - no_cost:     CT gave no / non-numeric / non-positive value → skip + flag.
//  - out_of_band: MSRP is usable and cost is outside the band → skip + flag.
//  - ok:          returns the unmodified real cost to write.
// When MSRP is missing / 0 the band can't be evaluated, so any positive cost
// passes — we write the real cost rather than mass-skip un-validatable tires.
function checkCTDealerCost(rawCost: unknown, rawMsrp: unknown): CostCheck {
  const cost = parseCTDealerCost(rawCost);
  if (cost === null) return { ok: false, reason: 'no_cost' };
  const msrp = Number(rawMsrp);
  if (Number.isFinite(msrp) && msrp > 0) {
    const min = msrp * COST_MSRP_FLOOR;
    const max = msrp * COST_MSRP_CEIL;
    if (cost < min || cost >= max) return { ok: false, reason: 'out_of_band', cost, min, max };
  }
  return { ok: true, cost };
}

const CDA_EXCLUSIVE_BRANDS = new Set(['Minerva', 'Ovation']);

function normalizeVendor(vendor: string): string {
  return VENDOR_MAP[vendor.toUpperCase()] ??
    vendor.charAt(0).toUpperCase() + vendor.slice(1).toLowerCase();
}

function classifyTireType(performanceCategory: string, size: string): string {
  const cat = (performanceCategory || '').toLowerCase();
  const s   = (size || '').toString();
  if (cat.includes('commercial') || cat.includes('heavy') ||
      cat.includes('medium truck') || cat.includes('steer') ||
      cat.includes('drive') || cat.includes('trailer')) {
    return 'heavy_truck';
  }
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

const CT_PAGE_SIZE = 50;

async function fetchAllCTTires(): Promise<CTTire[]> {
  const fullUrl  = `${CT.baseUrl}?script=${CT_SCRIPT}&deploy=${CT_DEPLOY}`;
  const allTires: CTTire[] = [];
  let   page     = 1;
  const PAGE_CAP = 100;
  while (page <= PAGE_CAP) {
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
          isWinter:'', isRunFlat:'', isTire:true, isWheel:false,
          page,
        },
      }),
    });
    if (!res.ok) throw new Error(`CT API HTTP ${res.status} on page ${page}: ${(await res.text()).slice(0,200)}`);
    const data: any = await res.json();
    if (!data.success) throw new Error(`CT API error on page ${page}: ${JSON.stringify(data.error)}`);
    const tires = data.data as CTTire[];
    if (!tires || tires.length === 0) { console.log(`📄 CT page ${page}: 0 tires — pagination complete`); break; }
    allTires.push(...tires);
    console.log(`📄 CT page ${page}: ${tires.length} tires (running total: ${allTires.length})`);
    if (tires.length < CT_PAGE_SIZE) { console.log(`📄 CT page ${page} returned ${tires.length} < ${CT_PAGE_SIZE} — last page reached`); break; }
    page++;
    await delay(300);
  }
  if (page > PAGE_CAP) console.warn(`⚠️ CT pagination safety cap hit at ${PAGE_CAP} pages — ${allTires.length} tires fetched.`);
  console.log(`✅ CT fetch complete: ${allTires.length} tires across ${page} page(s)`);
  return allTires;
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

function parseTireSize(raw: string | number): string {
  const [w='',a='',r=''] = String(raw ?? '').replace(/,/g,'/').split('/');
  return `${w}/${a}R${r}`;
}

function parseCTSizeCode(rawCode: string | number): string {
  const raw = String(rawCode ?? '');
  const match = raw.match(/^(\d{3})(\d{2})(\d{2})\/R$/);
  if (!match) return parseTireSize(raw);
  return `${match[1]}/${match[2]}R${match[3]}`;
}

function parseLoadIndexAndSpeedRating(name: string): { loadIndex: string | null; speedRating: string | null } {
  const compactMatch = name.match(/^\d{7}(?:\s+[A-Z]+)?\s+(\d{2,3})([A-Z])\b/);
  if (compactMatch) return { loadIndex: compactMatch[1], speedRating: compactMatch[2] };
  const standardMatch = name.match(/\d{3}\/\d{2}R\d{2}\s+(\d{2,3})([A-Z])\b/);
  if (standardMatch) return { loadIndex: standardMatch[1], speedRating: standardMatch[2] };
  return { loadIndex: null, speedRating: null };
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

interface ExistingProduct { productId:number; variantId:number; inventoryItemId:number; price:string; hasImages:boolean; tags:string; }

// ─── FIX 2: fetchExistingProducts ────────────────────────────────────────────
// Added secondary map entry stripping "TIRE-" prefix so CT part numbers
// (e.g. "166429021") can find old products keyed as "TIRE-166429021".
// This allows inventory + price updates to reach old products during the
// transition window while archive-tire-skus runs in batches.
// Once all TIRE- products are archived this branch is never hit.
// ─────────────────────────────────────────────────────────────────────────────
async function fetchExistingProducts(): Promise<Map<string,ExistingProduct>> {
  const map = new Map<string,ExistingProduct>();
  let sinceId = 0;
  while (true) {
    const q = `tag=${SYNC_TAG}&status=active&limit=250&fields=id,variants,images,tags${sinceId?`&since_id=${sinceId}`:''}`;
    const data: any = await shopifyFetch<any>(`/products.json?${q}`);
    const products = data.products || [];
    for (const p of products) {
      const hasImages = Array.isArray(p.images) && p.images.length > 0;
      const existingTags: string = p.tags || '';
      for (const v of p.variants) {
        if (!v.sku) continue;
        const entry: ExistingProduct = {
          productId:       p.id,
          variantId:       v.id,
          inventoryItemId: v.inventory_item_id,
          price:           v.price,
          hasImages,
          tags:            existingTags,
        };
        // Primary index: exact SKU as stored in Shopify
        map.set(v.sku, entry);
        // Legacy TIRE- prefix compatibility — can be removed once all
        // TIRE- prefixed products are retired from Shopify
        if (v.sku.startsWith('TIRE-')) {
          const strippedSku = v.sku.slice(5);
          if (!map.has(strippedSku)) {
            map.set(strippedSku, entry);
          }
        }
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
  const envId = process.env.SHOPIFY_LOCATION_ID;
  if (envId) { _locationId = parseInt(envId, 10); return _locationId; }
  const data: any = await shopifyFetch<any>('/locations.json?limit=50');
  const locations = data.locations || [];
  if (locations.length === 50) console.warn('⚠️ getLocationId: received exactly 50 locations — set SHOPIFY_LOCATION_ID env var to be explicit.');
  const primary = locations.find((l: any) => !l.legacy && l.active) || locations[0];
  _locationId = primary?.id;
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

function buildImageAlt(ct: CTTire): string {
  const normalizedBrand = normalizeVendor(ct.brand);
  const size            = parseCTSizeCode(ct.size);
  const tireType        = classifyTireType(ct.performanceCategory, ct.size);
  const category = ct.isWinter ? 'winter' : 'all-season';
  const vehicle  = tireType === 'heavy_truck'  ? 'commercial truck'
                 : tireType === 'light_truck'   ? 'light truck/SUV'
                 :                               'passenger';
  return `${normalizedBrand} ${ct.model} tire ${size} – ${category} ${vehicle} tire available with free shipping across Canada`;
}

async function attachProductImage(productId: number, ct: CTTire): Promise<boolean> {
  const lookupKey = `${ct.brand} ${ct.model}`;
  const imageUrl  = getTireImageUrl(lookupKey);
  if (!imageUrl) { console.log(`⚠️  No image in map for: "${lookupKey}"`); return false; }
  const alt = buildImageAlt(ct);
  try {
    await shopifyFetch(`/products/${productId}/images.json`, {
      method: 'POST',
      body: JSON.stringify({ image: { src: imageUrl, alt } }),
    });
    console.log(`🖼️  Image attached for: "${lookupKey}" | alt: "${alt}"`);
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
    const q = `tag=${SYNC_TAG}&limit=250&fields=id,title,handle,images${sinceId ? `&since_id=${sinceId}` : ''}`;
    const data: any = await shopifyFetch<any>(`/products.json?${q}`);
    const products = data.products || [];
    allProducts.push(...products);
    if (products.length < 250) break;
    sinceId = products[products.length - 1].id;
  }
  stats.total      = allProducts.length;
  const chunk      = allProducts.slice(offset, offset + limit);
  stats.nextOffset = offset + limit;
  stats.done       = stats.nextOffset >= allProducts.length;
  console.log(`🔍 Backfill: chunk ${offset}–${offset + chunk.length} of ${allProducts.length} products...`);
  await processBatches(chunk, async (p) => {
    if (p.images && p.images.length > 0) { stats.skipped++; return; }
    const imageUrl = getTireImageUrl(p.title);
    if (!imageUrl) { console.log(`❌ No image map match for: "${p.title}"`); stats.missing++; return; }
    try {
      await shopifyFetch(`/products/${p.id}/images.json`, {
        method: 'POST',
        body: JSON.stringify({ image: { src: imageUrl, alt: p.title } }),
      });
      console.log(`🖼️  Backfill image attached: "${p.title}"`);
      stats.attached++;
    } catch (e: any) {
      console.warn(`⚠️  Backfill image failed for ${p.id}: ${e.message}`);
      stats.errors++;
    }
  });
  return stats;
}

// ─── TITLE CASE ───────────────────────────────────────────────────────────────

function convertToken(token: string): string {
  if (/^\d+\/\d+[rR]\d+$/.test(token)) return token.replace(/[rR](\d)/, 'R$1');
  if (/^[A-Z]*[0-9]+[A-Z0-9]*$/.test(token)) return token;
  const upper = token.toUpperCase();
  if (/^(XL|XLT|SUV|ATX|4X4|4WD|AWD|AW|WS|HP|UHP|HT|LT|ST|GT|GTS|LE|SE|EV|SRX|OE|OEM|M\+S|3PMSF|OWL|BSW|VSB|STT|MTX|GTX|HL|AU|RU|RH|HI|CP)$/.test(upper)) return upper;
  return token.charAt(0).toUpperCase() + token.slice(1).toLowerCase();
}

function toTitleCase(original: string): string {
  return original.split(' ').map(word => {
    if (word.includes('-')) return word.split('-').map(convertToken).join('-');
    return convertToken(word);
  }).join(' ').replace(/\/r(\d)/gi, '/R$1');
}

function formatTireSize(title: string): string {
  return title.replace(
    /(\d{3})(\d{2})(\d{2})\/?r/gi,
    (_, width, ratio, rim) => `${width}/${ratio}R${rim}`
  );
}

// ─── TITLE NORMALIZATION ──────────────────────────────────────────────────────

function normalizeTitle(title: string): string {
  return title.toLowerCase().trim().replace(/\s+/g, ' ');
}

// ─── FIX 1: fetchExistingProductTitles ───────────────────────────────────────
// Removed &status=active — now fetches active + archived + draft products.
// Previously the sync would see an archived -1 product and incorrectly treat
// its title as available, creating a fresh duplicate on every daily run.
// Checking all statuses prevents that cycle from restarting after cleanup.
// ─────────────────────────────────────────────────────────────────────────────
async function fetchExistingProductTitles(): Promise<Set<string>> {
  const titles = new Set<string>();
  let nextUrl: string | null =
    `${SHOPIFY.baseUrl}/products.json?tag=${SYNC_TAG}&fields=id,title&limit=250`;
  while (nextUrl) {
    const res: Response = await fetch(nextUrl, {
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': SHOPIFY.token,
      },
    });
    if (res.status === 429) { await delay(2000); continue; }
    if (!res.ok) throw new Error(`Shopify ${res.status} fetching product titles`);
    const data: any = await res.json();
    for (const p of (data.products || [])) {
      titles.add(normalizeTitle(p.title));
    }
    const link: string | null = res.headers.get('link');
    const nextMatch: RegExpMatchArray | null = link ? link.match(/<([^>]+)>;\s*rel="next"/) : null;
    nextUrl = nextMatch ? nextMatch[1] : null;
  }
  console.log(`🗂️  Loaded ${titles.size} ct-sync product titles for dedup (all statuses)`);
  return titles;
}

// ─── BUILD SHOPIFY PAYLOAD ────────────────────────────────────────────────────

// Flotation / special-format titles that formatTireSize() can't derive from the
// CT size code (e.g. 33X12.50R20, 11R22.5). Keyed by variant SKU (ct.partNumber).
// When a SKU is present here, its value is used verbatim as the final product
// title instead of the formatTireSize()-derived one.
const FLOTATION_TITLE_OVERRIDES: Record<string, string> = {
  '18733NXK': 'Nexen Roadian ATX LT 33X12.50R20',
  '18761NXK': 'Nexen Roadian ATX LT 35X12.50R17',
  '18942NXK': 'Nexen Roadian MTX RM7 35X12.50R17',
  '18943NXK': 'Nexen Roadian MTX 37X12.50R17',
  'TSWH04':   'Transeagle TRA06 11R22.5',
  'TSWH15':   'Transeagle TRA06 11R24.5',
};

async function buildPayload(ct: CTTire) {
  const size    = parseCTSizeCode(ct.size);
  const season  = ct.isWinter ? 'Winter' : 'All-Season';
  const qty     = getTotalQty(ct);
  const closest = getClosestWarehouse(ct);
  const msrp    = parseFloat(ct.msrp) || 0;
  const costCheck = checkCTDealerCost(ct.cost, ct.msrp);
  if (!costCheck.ok) {
    return costCheck.reason === 'out_of_band'
      ? { skip: 'out_of_band' as const, cost: costCheck.cost, min: costCheck.min, max: costCheck.max }
      : { skip: 'no_cost' as const };
  }
  const netCost = costCheck.cost; // real CT dealer cost, stored unmodified — never MSRP, never halved
  const tireType       = classifyTireType(ct.performanceCategory, ct.size);
  const shippingBuffer = getShippingBuffer(ct.performanceCategory, ct.size);
  const sellingPrice  = calculatePrice(netCost);
  const shopifyFloor  = (netCost + shippingBuffer) / (1 - SHOPIFY_PAYMENT_FEE - TARGET_NET_MARGIN);
  const walmartFloor  = (netCost + shippingBuffer) / (1 - WALMART_FEE - TARGET_NET_MARGIN);
  const aboveMsrp     = sellingPrice > msrp + 0.01;
  const title = formatTireSize(toTitleCase(`${ct.brand} ${ct.model} ${size}`.trim()));
  // Use a hardcoded override as the final title when this SKU has one (flotation
  // / special sizes formatTireSize can't build); otherwise keep the derived title.
  const finalTitle = FLOTATION_TITLE_OVERRIDES[ct.partNumber] ?? title;
  const { season: classifiedSeason, vehicleType, brand: classifiedBrand } = classifyTire(title);
  const { loadIndex: ctLoadIndex, speedRating: ctSpeedRating } = parseLoadIndexAndSpeedRating(ct.name || '');
  const normalizedVendor = normalizeVendor(ct.brand);
  const isCdaExclusive   = CDA_EXCLUSIVE_BRANDS.has(normalizedVendor);
  const tags = [
    SYNC_TAG, 'ai-match',
    `brand-${ct.brand.toLowerCase().replace(/\s+/g,'-')}`,
    season.toLowerCase(),
    `tire-type-${tireType}`,
    size,
    ct.isRunFlat ? 'run-flat'              : null,
    isCdaExclusive ? 'canada-tire-exclusive' : null,
    isCdaExclusive ? 'road-hazard-warranty'  : null,
    aboveMsrp ? 'priced-above-msrp'         : null,
    classifiedSeason, vehicleType, classifiedBrand,
    ctLoadIndex   ? `loadindex:${ctLoadIndex}`    : null,
    ctSpeedRating ? `speedrating:${ctSpeedRating}` : null,
  ].filter((t): t is string => typeof t === 'string' && t.length > 0)
    .filter((t, i, arr) => arr.indexOf(t) === i)
    .join(', ');
  const metafields: Array<{ namespace: string; key: string; value: string; type: string }> = [
    { namespace:'canada_tire', key:'cost',                value:netCost.toFixed(2),                   type:'number_decimal' },
    // Cost-freshness stamp — read by gci-order-hub cost-integrity-audit to flag stale cost.
    { namespace:'canada_tire', key:'cost_synced_at',     value:new Date().toISOString(),             type:'date_time' },
    { namespace:'canada_tire', key:'part_number',         value:ct.partNumber,                        type:'single_line_text_field' },
    { namespace:'gci',         key:'net_cost',             value:netCost.toFixed(2),                   type:'number_decimal' },
    { namespace:'gci',         key:'shopify_floor_price',  value:shopifyFloor.toFixed(2),              type:'number_decimal' },
    { namespace:'gci',         key:'walmart_floor_price',  value:walmartFloor.toFixed(2),              type:'number_decimal' },
    { namespace:'gci',         key:'selling_price',        value:sellingPrice.toFixed(2),              type:'number_decimal' },
    { namespace:'gci',         key:'shipping_buffer',      value:shippingBuffer.toFixed(2),            type:'number_decimal' },
    { namespace:'gci',         key:'tire_type',            value:tireType,                             type:'single_line_text_field' },
    { namespace:'gci',         key:'performance_category', value:ct.performanceCategory || 'Standard', type:'single_line_text_field' },
  ];
  if (ctLoadIndex)   metafields.push({ namespace:'canada_tire', key:'load_index',   value:ctLoadIndex,   type:'single_line_text_field' });
  if (ctSpeedRating) metafields.push({ namespace:'canada_tire', key:'speed_rating', value:ctSpeedRating, type:'single_line_text_field' });
  return {
    product: {
      title: finalTitle,
      body_html: [
        `<p><strong>${ct.brand} ${ct.model}</strong> — ${size}</p>`,
        `<ul>`,
        `<li>Season: ${season}</li>`,
        ct.isRunFlat    ? `<li>Run-Flat</li>`                                        : '',
        ct.isWinter     ? `<li>❄️ 3PMSF Winter Certified</li>`                       : '',
        isCdaExclusive  ? `<li>🇧🇪 Canada Tire Exclusive Brand</li>`                 : '',
        isCdaExclusive  ? `<li>✅ Road Hazard Warranty — 1 year or 2/32nds</li>`     : '',
        isCdaExclusive  ? `<li>✅ 30-Day Customer Satisfaction Guarantee</li>`        : '',
        `<li>Stock: ${qty} units${closest ? ` (nearest: ${closest})` : ''}</li>`,
        `<li>Part #: ${ct.partNumber}</li>`,
        ctLoadIndex   ? `<li>Load Index: ${ctLoadIndex}</li>`    : '',
        ctSpeedRating ? `<li>Speed Rating: ${ctSpeedRating}</li>` : '',
        `</ul>`,
      ].filter(Boolean).join(''),
      vendor:       normalizedVendor,
      product_type: 'Tire',
      tags,
      variants: [{
        sku:                  ct.partNumber,
        price:                sellingPrice.toFixed(2),
        compare_at_price:     aboveMsrp ? null : msrp.toFixed(2),
        cost:                 netCost.toFixed(2),
        inventory_management: 'shopify',
        inventory_policy:     'deny',
        requires_shipping:    true,
        taxable:              true,
        weight:               25,
        weight_unit:          'lb',
        option1:              size,
      }],
      options: [{ name: 'Size' }],
      metafields,
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
  skippedNoStock:number; skippedDuplicate:number; skippedDuplicateTitles:string[];
  errorList:string[]; duration:string; timestamp:string;
  skippedNoCost?:number; noCostSkus?:string[];
  skippedOutOfBand?:number; outOfBandSkus?:string[];
  totalCT?:number; inStock?:number; createPoolSize?:number;
  offset?:number; chunkSize?:number; done?:boolean;
}

async function runSync(mode: 'full'|'daily', offset: number = 0, chunkSize: number = 50, updateOffset: number = 0, updateChunkSize: number = 200): Promise<SyncStats & { updateDone?: boolean; nextUpdateOffset?: number }> {
  const t0 = Date.now();
  const stats: SyncStats & { updateDone?: boolean; nextUpdateOffset?: number } = {
    created:0, updated:0, skipped:0, errors:0,
    skippedNoStock:0, skippedDuplicate:0, skippedDuplicateTitles:[],
    skippedNoCost:0, noCostSkus:[],
    skippedOutOfBand:0, outOfBandSkus:[],
    errorList:[], duration:'', timestamp:new Date().toISOString(),
  };

  console.log(`🚀 ${mode} sync — offset:${offset} chunkSize:${chunkSize}`);
  const [ctTires, existingMap, existingTitles] = await Promise.all([
    fetchAllCTTires(),
    fetchExistingProducts(),
    fetchExistingProductTitles(),
  ]);
  console.log(`📦 CT:${ctTires.length} Shopify:${existingMap.size}`);

  const inStockTires = ctTires.filter(p => getTotalQty(p) > 0);
  stats.totalCT        = ctTires.length;
  stats.inStock        = inStockTires.length;
  stats.skippedNoStock = ctTires.length - inStockTires.length;
  stats.offset         = offset;
  stats.chunkSize      = chunkSize;
  console.log(`📊 In stock: ${inStockTires.length}/${ctTires.length} (${stats.skippedNoStock} filtered out)`);

  const createPool = inStockTires.filter(p => !existingMap.has(p.partNumber));
  stats.createPoolSize = createPool.length;
  const createChunk = createPool.slice(offset, offset + chunkSize);

  const toUpdate = ctTires.filter(p => existingMap.has(p.partNumber));
  const updateChunk = toUpdate.slice(updateOffset, updateOffset + updateChunkSize);
  stats.updateDone = updateOffset + updateChunkSize >= toUpdate.length;
  stats.nextUpdateOffset = stats.updateDone ? 0 : updateOffset + updateChunkSize;
  stats.done = (offset + chunkSize >= createPool.length) && stats.updateDone;

  console.log(`🆕 New to create: ${createChunk.length} (of ${createPool.length} total new)`);
  console.log(`🔄 Existing to update: ${updateChunk.length} of ${toUpdate.length} (offset ${updateOffset})`);

  // ─── FIX 3: Create new products ──────────────────────────────────────────
  // - Guard moved BEFORE the Shopify API call (saves a wasted HTTP round-trip)
  // - Now catches duplicates across ALL statuses (active + archived + draft)
  //   because fetchExistingProductTitles no longer filters by status=active
  // - Handle collision retry uses a short 5-digit timestamp suffix instead of
  //   the full SKU slug — keeps handles short and prevents Shopify from ever
  //   auto-appending its own -1 on a second collision
  // ─────────────────────────────────────────────────────────────────────────
  await processBatches(createChunk, async (ct) => {
    const built = await buildPayload(ct);
    if ('skip' in built) {
      if (built.skip === 'out_of_band') {
        stats.skippedOutOfBand = (stats.skippedOutOfBand ?? 0) + 1;
        (stats.outOfBandSkus ??= []).push(`${ct.partNumber} (cost $${built.cost} outside $${built.min.toFixed(2)}-$${built.max.toFixed(2)})`);
        console.log(`⏭️  Out-of-band CT cost — skipped + flagged: ${ct.partNumber} ($${built.cost} vs $${built.min.toFixed(2)}-$${built.max.toFixed(2)})`);
      } else {
        stats.skippedNoCost = (stats.skippedNoCost ?? 0) + 1;
        (stats.noCostSkus ??= []).push(ct.partNumber);
        console.log(`⏭️  No/invalid CT cost — skipped + flagged: ${ct.partNumber}`);
      }
      return;
    }
    const payload = built;
    const normTitle = normalizeTitle(payload.product.title);

    // Guard before API call — catches active + archived + draft duplicates
    if (existingTitles.has(normTitle)) {
      stats.skippedDuplicate++;
      stats.skippedDuplicateTitles.push(normTitle);
      console.log(`⏭️  Duplicate title skipped (all statuses): "${normTitle}"`);
      return;
    }

    try {
      let data: any;
      try {
        data = await shopifyFetch<any>('/products.json', {
          method: 'POST',
          body:   JSON.stringify(payload),
        });
      } catch (e: any) {
        if (!e.message?.toLowerCase().includes('handle has already been taken')) throw e;
        // Use a short timestamp suffix — keeps handles readable and unique,
        // avoids Shopify auto-appending its own -1 on a second collision
        const slugBase    = payload.product.title
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-|-$/g, '');
        const tsSuffix    = String(Date.now()).slice(-5);
        const retryHandle = `${slugBase}-${tsSuffix}`;
        console.warn(
          `⚠️  Handle collision on "${payload.product.title}" — ` +
          `retrying with handle: ${retryHandle}. ` +
          `Check for stale archived product with same handle.`
        );
        data = await shopifyFetch<any>('/products.json', {
          method: 'POST',
          body:   JSON.stringify({ product: { ...payload.product, handle: retryHandle } }),
        });
      }
      const productId = data.product?.id;
      const invId     = data.product?.variants?.[0]?.inventory_item_id;
      if (invId)     await setInventory(invId, getTotalQty(ct));
      if (productId) await attachProductImage(productId, ct);
      existingTitles.add(normTitle);
      stats.created++;
    } catch (e: any) {
      stats.errors++;
      stats.errorList.push(`CREATE ${ct.partNumber}: ${e.message}`);
    }
  });

  // Update existing products (price, inventory, cost) — chunked
  await processBatches(updateChunk, async (ct) => {
    const ex = existingMap.get(ct.partNumber)!;
    const msrp     = parseFloat(ct.msrp) || 0;
    const costCheck = checkCTDealerCost(ct.cost, ct.msrp);
    if (!costCheck.ok) {
      if (costCheck.reason === 'out_of_band') {
        stats.skippedOutOfBand = (stats.skippedOutOfBand ?? 0) + 1;
        (stats.outOfBandSkus ??= []).push(`${ct.partNumber} (cost $${costCheck.cost} outside $${costCheck.min.toFixed(2)}-$${costCheck.max.toFixed(2)})`);
        console.log(`⏭️  Out-of-band CT cost — skipped + flagged: ${ct.partNumber} ($${costCheck.cost} vs $${costCheck.min.toFixed(2)}-$${costCheck.max.toFixed(2)})`);
      } else {
        stats.skippedNoCost = (stats.skippedNoCost ?? 0) + 1;
        (stats.noCostSkus ??= []).push(ct.partNumber);
        console.log(`⏭️  No/invalid CT cost — skipped + flagged: ${ct.partNumber}`);
      }
      return;
    }
    const netCost  = costCheck.cost; // real CT dealer cost, stored unmodified
    const newSellingPrice = calculatePrice(netCost);
    const newPrice        = newSellingPrice.toFixed(2);
    const priceChanged    = newPrice !== ex.price;
    const { loadIndex: upLI, speedRating: upSR } = parseLoadIndexAndSpeedRating(ct.name || '');
    const existingTagStr = ex.tags || '';
    let updatedTags = existingTagStr;
    if (upLI && !existingTagStr.includes('loadindex:'))   updatedTags = [updatedTags, `loadindex:${upLI}`].filter(Boolean).join(', ');
    if (upSR && !existingTagStr.includes('speedrating:')) updatedTags = [updatedTags, `speedrating:${upSR}`].filter(Boolean).join(', ');
    const tagsChanged = updatedTags !== existingTagStr;
    if (!priceChanged && mode === 'daily') {
      try {
        await shopifyFetch(`/variants/${ex.variantId}.json`, {
          method: 'PUT',
          body: JSON.stringify({
            variant: { id: ex.variantId, cost: netCost.toFixed(2), inventory_management: 'shopify', inventory_policy: 'deny' },
          }),
        });
        // Refresh canada_tire.cost with the same strict-parsed real cost
        // (overwrites any MSRP-poisoned cache). Always runs; tags folded in
        // when changed. Not swallowed — a failure must surface so Cost per item
        // and canada_tire.cost never diverge.
        await shopifyFetch(`/products/${ex.productId}.json`, {
          method: 'PUT',
          body: JSON.stringify({ product: { id: ex.productId, ...(tagsChanged ? { tags: updatedTags } : {}), metafields: [{ namespace: 'canada_tire', key: 'cost', value: netCost.toFixed(2), type: 'number_decimal' }] } }),
        });
        await setInventory(ex.inventoryItemId, getTotalQty(ct));
        if (!ex.hasImages) await attachProductImage(ex.productId, ct);
        stats.updated++;
      } catch (e: any) { stats.errors++; stats.errorList.push(`COST ${ct.partNumber}: ${e.message}`); }
      return;
    }
    try {
      await shopifyFetch(`/variants/${ex.variantId}.json`, {
        method: 'PUT',
        body: JSON.stringify({
          variant: {
            id: ex.variantId,
            ...(priceChanged ? {
              price:            newPrice,
              compare_at_price: newSellingPrice > msrp + 0.01 ? null : msrp.toFixed(2),
            } : {}),
            cost:                 netCost.toFixed(2),
            inventory_management: 'shopify',
            inventory_policy:     'deny',
          },
        }),
      });
      // Refresh canada_tire.cost with the same strict-parsed real cost
      // (overwrites any MSRP-poisoned cache). Always runs; tags folded in when
      // changed. Not swallowed — a failure must surface so Cost per item and
      // canada_tire.cost never diverge.
      await shopifyFetch(`/products/${ex.productId}.json`, {
        method: 'PUT',
        body: JSON.stringify({ product: { id: ex.productId, ...(tagsChanged ? { tags: updatedTags } : {}), metafields: [{ namespace: 'canada_tire', key: 'cost', value: netCost.toFixed(2), type: 'number_decimal' }] } }),
      });
      await setInventory(ex.inventoryItemId, getTotalQty(ct));
      if (!ex.hasImages) await attachProductImage(ex.productId, ct);
      stats.updated++;
    } catch (e: any) { stats.errors++; stats.errorList.push(`UPDATE ${ct.partNumber}: ${e.message}`); }
  });

  stats.duration = `${((Date.now()-t0)/1000).toFixed(1)}s`;
  console.log(`✅ Chunk done in ${stats.duration} — created:${stats.created} updated:${stats.updated} skipped:${stats.skipped} skippedNoStock:${stats.skippedNoStock} skippedDuplicate:${stats.skippedDuplicate} skippedNoCost:${stats.skippedNoCost} skippedOutOfBand:${stats.skippedOutOfBand} errors:${stats.errors} done:${stats.done}`);
  if (stats.skippedDuplicateTitles.length > 0) {
    console.log(`⏭️  Skipped duplicate titles (${stats.skippedDuplicateTitles.length}): ${stats.skippedDuplicateTitles.join(', ')}`);
  }
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

      case 'debug-ct-pages': {
        const maxPages = parseInt(req.query.maxPages as string || '20', 10);
        const fullUrl  = `${CT.baseUrl}?script=${CT_SCRIPT}&deploy=${CT_DEPLOY}`;
        const brandCounts:  Record<string, number> = {};
        const pageSizes:    number[]               = [];
        let   totalTires  = 0;
        let   page        = 1;
        let   stoppedEarly = false;
        while (page <= maxPages) {
          const ctRes = await fetch(fullUrl, {
            method: 'POST',
            headers: { 'Authorization': buildAuthHeader(), 'Content-Type': 'application/json', 'Accept': 'application/json' },
            body: JSON.stringify({
              customerId: CT.customerId, customerToken: CT.customerToken,
              filters: { width:'', rimSize:'', aspectRatio:'', size:'', partNumber:[], brand:'', searchKey:'', isWinter:'', isRunFlat:'', isTire:true, isWheel:false, page },
            }),
          });
          if (!ctRes.ok) return res.status(502).json({ success:false, mode:'debug-ct-pages', error:`CT API HTTP ${ctRes.status} on page ${page}`, pagesCompleted:page-1, totalTiresSoFar:totalTires, brandCounts, pageSizes });
          const data: any = await ctRes.json();
          if (!data.success) return res.status(502).json({ success:false, mode:'debug-ct-pages', error:`CT API error on page ${page}: ${JSON.stringify(data.error)}`, pagesCompleted:page-1, totalTiresSoFar:totalTires, brandCounts, pageSizes });
          const tires = (data.data || []) as CTTire[];
          if (tires.length === 0) { console.log(`📄 debug-ct-pages: page ${page} empty — done`); break; }
          pageSizes.push(tires.length);
          totalTires += tires.length;
          for (const t of tires) { brandCounts[t.brand] = (brandCounts[t.brand] || 0) + 1; }
          console.log(`📄 debug-ct-pages: page ${page} → ${tires.length} tires`);
          if (tires.length < CT_PAGE_SIZE) break;
          if (page === maxPages) { stoppedEarly = true; }
          page++;
          await delay(300);
        }
        const unmappedBrands = Object.keys(brandCounts).filter(b => !VENDOR_MAP[b.toUpperCase()]).sort();
        const sortedBrands = Object.entries(brandCounts).sort(([,a],[,b]) => b-a).reduce<Record<string,number>>((acc,[k,v]) => { acc[k]=v; return acc; }, {});
        return res.status(200).json({
          success:true, mode:'debug-ct-pages',
          summary:{ totalPages:pageSizes.length, totalTires, stoppedEarlyAtPage:stoppedEarly?maxPages:null, pageSizes, note:stoppedEarly?`Stopped at maxPages=${maxPages}. Re-run with ?maxPages=50 if you expect more pages.`:'All pages fetched — this is the complete CT catalog.' },
          brands:{ total:Object.keys(brandCounts).length, sortedByCount:sortedBrands, unmappedBrands:unmappedBrands.length>0?{ count:unmappedBrands.length, brands:unmappedBrands, action:'Add these to VENDOR_MAP in shopifySync.ts' }:{ count:0, message:'✅ All brands are already in VENDOR_MAP' } },
        });
      }

      case 'status': {
        const existing = await fetchExistingProducts();
        return res.status(200).json({ success:true, shopifyProductCount:existing.size, domain:SHOPIFY.domain, ctEnvironment:CT.useSandbox?'SANDBOX':'PRODUCTION', nextCron:'3:00 AM ET daily', pricingConfig:{ shippingBuffers:SHIPPING_BUFFERS, costBand:{ msrpFloor:COST_MSRP_FLOOR, msrpCeil:COST_MSRP_CEIL, note:'CT cost must satisfy msrp*floor <= cost < msrp*ceil, else skipped+flagged' }, note:'Use /api/bulkPriceUpdate?action=price-preview to see competitive pricing' } });
      }

      case 'cost-analysis': {
        const ctTires = await fetchAllCTTires();
        const inStock = ctTires.filter(p => getTotalQty(p) > 0);
        const sorted = [...inStock].sort((a,b) => parseFloat(a.msrp)-parseFloat(b.msrp));
        const sampleSize = 30;
        const step = Math.max(1, Math.floor(sorted.length/sampleSize));
        const sample = sorted.filter((_,i) => i%step===0).slice(0,sampleSize);
        const analysis = sample.map(t => {
          const msrp=parseFloat(t.msrp)||0, realCost=parseFloat(t.cost)||0, estimated50=msrp*0.50;
          const costPct=msrp>0?((realCost/msrp)*100):0;
          const tireType=classifyTireType(t.performanceCategory,t.size);
          const ship=SHIPPING_BUFFERS[tireType]||35;
          return { sku:t.partNumber, brand:t.brand, model:t.model, size:parseTireSize(t.size), tireType, msrp:`$${msrp.toFixed(2)}`, realCost:`$${realCost.toFixed(2)}`, estimated50pct:`$${estimated50.toFixed(2)}`, costAsPctOfMSRP:`${costPct.toFixed(1)}%`, difference:`$${(estimated50-realCost).toFixed(2)}`, sellingWithRealCost:`$${(realCost+30+ship).toFixed(2)}`, sellingWithEstimate:`$${(estimated50+30+ship).toFixed(2)}`, customerSavesMore:`$${(estimated50+30+ship-(realCost+30+ship)).toFixed(2)}` };
        });
        const allCosts = inStock.map(t => { const msrp=parseFloat(t.msrp)||1, cost=parseFloat(t.cost)||0; return (cost/msrp)*100; }).filter(p=>p>0&&p<100);
        const avgPct = allCosts.reduce((s,v)=>s+v,0)/allCosts.length;
        return res.status(200).json({ success:true, mode:'cost-analysis', totalInStock:inStock.length, costSummary:{ avgCostAsPctOfMSRP:`${avgPct.toFixed(1)}%`, minCostPct:`${Math.min(...allCosts).toFixed(1)}%`, maxCostPct:`${Math.max(...allCosts).toFixed(1)}%`, note:'If avg is well below 50%, you can lower prices by using real CT cost instead of MSRP×0.50' }, sample:analysis });
      }

      case 'full-import': {
        const offset    = parseInt((req.body as any)?.offset    || req.query.offset    as string || '0', 10);
        const chunkSize = parseInt((req.body as any)?.chunkSize || req.query.chunkSize as string || '10', 10);
        const stats = await runSync('full', offset, chunkSize, 0, 0);
        const done = offset + chunkSize >= (stats.createPoolSize ?? 0);
        return res.status(200).json({ success:true, mode:'full-import', ...stats, done });
      }

      case 'update-only': {
        const updateOffset  = parseInt(req.query.updateOffset as string || '0', 10);
        const updateChunkSz = parseInt(req.query.updateChunk  as string || '200', 10);
        const stats = await runSync('full', Number.MAX_SAFE_INTEGER, 0, updateOffset, updateChunkSz);
        return res.status(200).json({ success:true, mode:'update-only', ...stats });
      }

      case 'retry-create': {
        const rawSkus = (req.query.skus as string || '').split(',').map(s => s.trim()).filter(Boolean);
        if (rawSkus.length === 0) return res.status(400).json({ error: 'Query param ?skus= is required (comma-separated SKUs)' });
        if (rawSkus.length > 50) return res.status(400).json({ error: 'Max 50 SKUs per call' });
        const t0 = Date.now();
        const fullUrl = `${CT.baseUrl}?script=${CT_SCRIPT}&deploy=${CT_DEPLOY}`;
        const ctRes = await fetch(fullUrl, {
          method: 'POST',
          headers: { 'Authorization':buildAuthHeader(), 'Content-Type':'application/json', 'Accept':'application/json' },
          body: JSON.stringify({ customerId:CT.customerId, customerToken:CT.customerToken, filters:{ width:'', rimSize:'', aspectRatio:'', size:'', partNumber:rawSkus, brand:'', searchKey:'', isWinter:'', isRunFlat:'', isTire:true, isWheel:false, page:1 } }),
        });
        if (!ctRes.ok) throw new Error(`CT API HTTP ${ctRes.status}: ${(await ctRes.text()).slice(0,200)}`);
        const ctData: any = await ctRes.json();
        if (!ctData.success) throw new Error(`CT API error: ${JSON.stringify(ctData.error)}`);
        const rcTires = (ctData.data || []) as CTTire[];
        const [rcExisting, rcTitles] = await Promise.all([fetchExistingProducts(), fetchExistingProductTitles()]);
        let rcCreated=0, rcSkipped=0, rcErrors=0;
        const rcErrorList: string[]=[], notFoundInCT: string[]=[], alreadyInShopify: string[]=[], noCostSkus: string[]=[], outOfBandSkus: string[]=[];
        for (const sku of rawSkus) {
          const ct = rcTires.find(t => t.partNumber===sku);
          if (!ct) { notFoundInCT.push(sku); continue; }
          if (rcExisting.has(sku)) { alreadyInShopify.push(sku); rcSkipped++; continue; }
          const built=await buildPayload(ct);
          if ('skip' in built) {
            if (built.skip === 'out_of_band') { outOfBandSkus.push(`${sku} (cost $${built.cost} outside $${built.min.toFixed(2)}-$${built.max.toFixed(2)})`); console.log(`⏭️  retry-create: out-of-band CT cost — skipped + flagged: ${sku}`); }
            else { noCostSkus.push(sku); console.log(`⏭️  retry-create: no/invalid CT cost — skipped + flagged: ${sku}`); }
            continue;
          }
          const payload=built;
          const normTitle=normalizeTitle(payload.product.title);
          if (rcTitles.has(normTitle)) { console.log(`⏭️  retry-create: duplicate title skipped: "${normTitle}"`); rcSkipped++; rcErrorList.push(`SKIP ${sku}: duplicate title "${normTitle}"`); continue; }
          try {
            let data: any;
            try { data=await shopifyFetch<any>('/products.json',{method:'POST',body:JSON.stringify(payload)}); }
            catch (e: any) {
              if (!e.message?.toLowerCase().includes('handle has already been taken')) throw e;
              const slugBase=payload.product.title.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
              const tsSuffix=String(Date.now()).slice(-5);
              const retryHandle=`${slugBase}-${tsSuffix}`;
              console.log(`🔁 retry-create: handle collision on "${payload.product.title}" — retrying with handle: ${retryHandle}`);
              data=await shopifyFetch<any>('/products.json',{method:'POST',body:JSON.stringify({product:{...payload.product,handle:retryHandle}})});
            }
            const productId=data.product?.id, invId=data.product?.variants?.[0]?.inventory_item_id;
            if (invId) await setInventory(invId,getTotalQty(ct));
            if (productId) await attachProductImage(productId,ct);
            rcTitles.add(normTitle); rcCreated++;
            console.log(`✅ retry-create: created ${sku} — "${payload.product.title}"`);
          } catch (e: any) { rcErrors++; rcErrorList.push(`CREATE ${sku}: ${e.message}`); console.error(`❌ retry-create: failed ${sku}: ${e.message}`); }
        }
        return res.status(200).json({ success:true, mode:'retry-create', skusRequested:rawSkus.length, ctFound:rcTires.length, created:rcCreated, skipped:rcSkipped, errors:rcErrors, ...(notFoundInCT.length>0?{notFoundInCT}:{}), ...(alreadyInShopify.length>0?{alreadyInShopify}:{}), ...(noCostSkus.length>0?{noCostSkus}:{}), ...(outOfBandSkus.length>0?{outOfBandSkus}:{}), ...(rcErrorList.length>0?{errorList:rcErrorList}:{}), duration:`${((Date.now()-t0)/1000).toFixed(1)}s` });
      }

      case 'list-skus': {
        const existingMap = await fetchExistingProducts();
        const skus = [...existingMap.keys()];
        return res.status(200).json({ success:true, mode:'list-skus', total:skus.length, skus });
      }

      case 'update-chunk': {
        const body=req.body as any;
        const skus: string[]=Array.isArray(body?.skus)?body.skus:[];
        if (skus.length===0) return res.status(400).json({ error:'POST body must include skus: string[]' });
        if (skus.length>50)  return res.status(400).json({ error:'Max 50 SKUs per chunk' });
        // Optional manual dealer-cost overrides (stopgap until the CT/NetSuite
        // RESTlet exposes a real vendor cost field — it currently returns MSRP
        // in `cost`). Shape: { "MB5027": 226.00, ... }. An override is STILL
        // band-checked against CT's MSRP before writing, so a bad number can't
        // slip through; only the cost source changes, not the safety gate.
        const rawOverrides=(body?.costOverrides && typeof body.costOverrides==='object') ? body.costOverrides as Record<string,unknown> : {};
        const costOverrides=new Map<string,number>();
        const badOverrides: string[]=[];
        for (const [k,v] of Object.entries(rawOverrides)) {
          const n=parseCTDealerCost(v);
          if (n===null) { badOverrides.push(`${k} (non-numeric/non-positive: ${JSON.stringify(v)})`); continue; }
          costOverrides.set(k, n);
        }
        const t0=Date.now();
        const fullUrl=`${CT.baseUrl}?script=${CT_SCRIPT}&deploy=${CT_DEPLOY}`;
        const ctRes=await fetch(fullUrl,{ method:'POST', headers:{ 'Authorization':buildAuthHeader(),'Content-Type':'application/json','Accept':'application/json' }, body:JSON.stringify({ customerId:CT.customerId, customerToken:CT.customerToken, filters:{ width:'',rimSize:'',aspectRatio:'',size:'',partNumber:skus,brand:'',searchKey:'',isWinter:'',isRunFlat:'',isTire:true,isWheel:false,page:1 } }) });
        if (!ctRes.ok) throw new Error(`CT API HTTP ${ctRes.status}: ${(await ctRes.text()).slice(0,200)}`);
        const ctData: any=await ctRes.json();
        if (!ctData.success) throw new Error(`CT API error: ${JSON.stringify(ctData.error)}`);
        const ctTires=(ctData.data||[]) as CTTire[];
        const existingMap=await fetchExistingProducts();
        let ucUpdated=0,ucErrors=0,ucOverridden=0;
        const ucErrorList: string[]=[], notFoundInCT: string[]=[], ucNoCost: string[]=[], ucOutOfBand: string[]=[];
        for (const sku of skus) {
          const ct=ctTires.find(t=>t.partNumber===sku);
          if (!ct) { notFoundInCT.push(sku); continue; }
          const ex=existingMap.get(sku);
          if (!ex) continue;
          const msrp=parseFloat(ct.msrp)||0;
          // Source cost from the manual override when provided, else CT. Either
          // way it is band-checked against CT's MSRP before writing.
          const override=costOverrides.get(sku);
          const costSource=override!==undefined ? 'override' : 'ct';
          const costCheck=checkCTDealerCost(override!==undefined ? override : ct.cost, ct.msrp);
          if (!costCheck.ok) {
            if (costCheck.reason==='out_of_band') { ucOutOfBand.push(`${sku} (${costSource} cost $${costCheck.cost} outside $${costCheck.min.toFixed(2)}-$${costCheck.max.toFixed(2)})`); console.log(`⏭️  update-chunk: out-of-band ${costSource} cost — skipped + flagged: ${sku}`); }
            else { ucNoCost.push(sku); console.log(`⏭️  update-chunk: no/invalid ${costSource} cost — skipped + flagged: ${sku}`); }
            continue;
          }
          const netCost=costCheck.cost; // real dealer cost (override or CT), stored unmodified
          if (costSource==='override') { ucOverridden++; console.log(`✏️  update-chunk: ${sku} using override cost $${netCost} (CT returned $${ct.cost})`); }
          const newSellingPrice=calculatePrice(netCost), newPrice=newSellingPrice.toFixed(2);
          const priceChanged=newPrice!==ex.price;
          const {loadIndex:upLI,speedRating:upSR}=parseLoadIndexAndSpeedRating(ct.name||'');
          const existingTagStr=ex.tags||''; let updatedTags=existingTagStr;
          if (upLI&&!existingTagStr.includes('loadindex:'))   updatedTags=[updatedTags,`loadindex:${upLI}`].filter(Boolean).join(', ');
          if (upSR&&!existingTagStr.includes('speedrating:')) updatedTags=[updatedTags,`speedrating:${upSR}`].filter(Boolean).join(', ');
          const tagsChanged=updatedTags!==existingTagStr;
          try {
            await shopifyFetch(`/variants/${ex.variantId}.json`,{ method:'PUT', body:JSON.stringify({ variant:{ id:ex.variantId, ...(priceChanged?{ price:newPrice, compare_at_price:newSellingPrice>msrp+0.01?null:msrp.toFixed(2) }:{}), cost:netCost.toFixed(2), inventory_management:'shopify', inventory_policy:'deny' } }) });
            // Refresh canada_tire.cost with the same strict-parsed real cost (overwrites MSRP-poisoned cache). Always runs; not swallowed so the two fields never diverge.
            await shopifyFetch(`/products/${ex.productId}.json`,{ method:'PUT', body:JSON.stringify({ product:{ id:ex.productId, ...(tagsChanged?{ tags:updatedTags }:{}), metafields:[{ namespace:'canada_tire', key:'cost', value:netCost.toFixed(2), type:'number_decimal' }] } }) });
            await setInventory(ex.inventoryItemId,getTotalQty(ct));
            if (!ex.hasImages) await attachProductImage(ex.productId,ct);
            ucUpdated++;
          } catch (e: any) { ucErrors++; ucErrorList.push(`UPDATE ${sku}: ${e.message}`); }
        }
        return res.status(200).json({ success:true, mode:'update-chunk', skusRequested:skus.length, ctFound:ctTires.length, ...(notFoundInCT.length>0?{notFoundInCT}:{}), updated:ucUpdated, overridden:ucOverridden, errors:ucErrors, ...(badOverrides.length>0?{badOverrides}:{}), ...(ucNoCost.length>0?{noCostSkus:ucNoCost}:{}), ...(ucOutOfBand.length>0?{outOfBandSkus:ucOutOfBand}:{}), ...(ucErrorList.length>0?{errorList:ucErrorList}:{}), duration:`${((Date.now()-t0)/1000).toFixed(1)}s` });
      }

      case 'missing-images': {
        const checkAll=req.query.all==='true';
        let sinceId=0;
        const noImageTitles=new Set<string>(), withImageTitles=new Set<string>();
        const noImageProducts: Array<{id:number;title:string}>=[];
        let totalScanned=0;
        while (true) {
          const tagFilter=checkAll?'':`tag=${SYNC_TAG}&`;
          const q=`${tagFilter}limit=250&fields=id,title,images,tags${sinceId?`&since_id=${sinceId}`:''}`;
          const data: any=await shopifyFetch<any>(`/products.json?${q}`);
          const products=data.products||[];
          totalScanned+=products.length;
          for (const p of products) {
            const tokens=p.title.trim().split(' '), modelKey=tokens.slice(0,-1).join(' ').toUpperCase();
            if (!p.images||p.images.length===0) { noImageTitles.add(modelKey); noImageProducts.push({id:p.id,title:p.title}); }
            else { withImageTitles.add(modelKey); }
          }
          if (products.length<250) break;
          sinceId=products[products.length-1].id;
        }
        const trulyMissing=[...noImageTitles].filter(t=>!withImageTitles.has(t)).sort();
        const missingDetails=noImageProducts.filter(p=>{ const mk=p.title.trim().split(' ').slice(0,-1).join(' ').toUpperCase(); return trulyMissing.includes(mk); }).map(p=>p.title);
        return res.status(200).json({ success:true, mode:'missing-images', scope:checkAll?'ALL products':'ct-sync only', totalScanned, missingCount:trulyMissing.length, missing:trulyMissing, ...(checkAll?{missingProducts:missingDetails}:{}) });
      }

      case 'debug-images': {
        const q=`tag=${SYNC_TAG}&limit=5&fields=id,title,images`;
        const data: any=await shopifyFetch<any>(`/products.json?${q}`);
        const sample=(data.products||[]).map((p: any)=>({ id:p.id, title:p.title, imageCount:p.images?.length||0, firstImageSrc:p.images?.[0]?.src||null }));
        return res.status(200).json({ success:true, mode:'debug-images', sample });
      }

      case 'backfill-images': {
        const bfOffset=parseInt((req.body as any)?.offset??req.query.offset??'0',10);
        const bfLimit =parseInt((req.body as any)?.limit ??req.query.limit ??'100',10);
        const bfStats =await runImageBackfill(bfOffset,bfLimit);
        return res.status(200).json({ success:true, mode:'backfill-images', ...bfStats });
      }

      case 'attach-image': {
        const search=(req.query.search as string||'').trim(), imageUrl=(req.query.imageUrl as string||'').trim();
        if (!search||!imageUrl) return res.status(400).json({ error:'Required params: search (title match) and imageUrl' });
        let sinceId=0;
        const matched: Array<{id:number;title:string;hadImage:boolean}>=[];
        let attached=0, skipped=0, errors=0;
        while (true) {
          const q=`tag=${SYNC_TAG}&limit=250&fields=id,title,images${sinceId?`&since_id=${sinceId}`:''}`;
          const data: any=await shopifyFetch<any>(`/products.json?${q}`);
          const products=data.products||[];
          for (const p of products) {
            if (p.title.toUpperCase().includes(search.toUpperCase())) {
              const hasImage=p.images&&p.images.length>0;
              matched.push({id:p.id,title:p.title,hadImage:hasImage});
              if (!hasImage) { try { await shopifyFetch(`/products/${p.id}/images.json`,{method:'POST',body:JSON.stringify({image:{src:imageUrl,alt:p.title}})}); attached++; await delay(500); } catch(e: any){ errors++; } }
              else { skipped++; }
            }
          }
          if (products.length<250) break;
          sinceId=products[products.length-1].id;
        }
        return res.status(200).json({ success:true, mode:'attach-image', search, imageUrl, totalMatched:matched.length, attached, skippedHadImage:skipped, errors, products:matched.map(m=>`${m.title} ${m.hadImage?'(had image)':'✅ attached'}`) });
      }

      case 'fix-all-images': {
        const dryRun=(req.query.dryRun??'true')!=='false';
        let sinceId=0;
        const noImageProducts: Array<{id:number;title:string;modelKey:string}>=[];
        const withImageModels=new Set<string>();
        while (true) {
          const q=`tag=${SYNC_TAG}&limit=250&fields=id,title,images${sinceId?`&since_id=${sinceId}`:''}`;
          const data: any=await shopifyFetch<any>(`/products.json?${q}`);
          const products=data.products||[];
          for (const p of products) {
            const tokens=p.title.trim().split(' '), modelKey=tokens.slice(0,-1).join(' ').toUpperCase();
            if (!p.images||p.images.length===0) noImageProducts.push({id:p.id,title:p.title,modelKey});
            else withImageModels.add(modelKey);
          }
          if (products.length<250) break;
          sinceId=products[products.length-1].id;
        }
        const trulyMissing=noImageProducts.filter(p=>!withImageModels.has(p.modelKey));
        const modelGroups=new Map<string,typeof trulyMissing>();
        for (const p of trulyMissing) { if (!modelGroups.has(p.modelKey)) modelGroups.set(p.modelKey,[]); modelGroups.get(p.modelKey)!.push(p); }
        if (dryRun) {
          const plan=[...modelGroups.entries()].map(([model,products])=>{ const imageUrl=getTireImageUrl(products[0].title); return { model, imageUrl:imageUrl||'⚠️ NO SOURCE — use attach-image manually', productCount:products.length, hasSource:!!imageUrl }; });
          return res.status(200).json({ success:true, mode:'fix-all-images', dryRun:true, totalMissing:trulyMissing.length, uniqueModels:modelGroups.size, withSource:plan.filter(p=>p.hasSource).length, withoutSource:plan.filter(p=>!p.hasSource).length, plan });
        }
        let attached=0,errors=0,skippedNoSource=0;
        const results: Array<{title:string;status:string;url?:string;error?:string}>=[];
        for (const p of trulyMissing) {
          const imageUrl=getTireImageUrl(p.title);
          if (!imageUrl) { skippedNoSource++; results.push({title:p.title,status:'⏭️ no source URL'}); continue; }
          try { await shopifyFetch(`/products/${p.id}/images.json`,{method:'POST',body:JSON.stringify({image:{src:imageUrl,alt:p.title}})}); attached++; results.push({title:p.title,status:'✅ attached',url:imageUrl}); await delay(500); }
          catch (e: any) { errors++; results.push({title:p.title,status:'❌ failed',url:imageUrl,error:e.message?.slice(0,150)}); }
        }
        return res.status(200).json({ success:true, mode:'fix-all-images', dryRun:false, totalMissing:trulyMissing.length, attached, errors, skippedNoSource, results });
      }

      case 'find-orphans': {
        const ctTires=await fetchAllCTTires();
        const ctPartNumbers=new Set(ctTires.map((t: any)=>t.partNumber));
        const orphans: Array<{id:number;title:string;handle:string;sku:string;tags:string}>=[];
        let foUrl: string|null=`${SHOPIFY.baseUrl}/products.json?tag=${SYNC_TAG}&status=active&limit=250&fields=id,title,handle,variants,tags`;
        while (foUrl) {
          const r: Response=await fetch(foUrl,{ headers:{'Content-Type':'application/json','X-Shopify-Access-Token':SHOPIFY.token} });
          if (!r.ok) throw new Error(`Shopify ${r.status}`);
          const data: any=await r.json();
          for (const p of (data.products||[])) { const sku=p.variants?.[0]?.sku||''; if (sku&&!ctPartNumbers.has(sku)) orphans.push({id:p.id,title:p.title,handle:p.handle||'',sku,tags:p.tags||''}); }
          const lnk: string|null=r.headers.get('link'), lm=lnk?lnk.match(/<([^>]+)>;\s*rel="next"/):null;
          foUrl=lm?lm[1]:null;
        }
        const soldOut=orphans.filter(p=>p.tags.includes('sold-out')), trulyOrphaned=orphans.filter(p=>!p.tags.includes('sold-out'));
        return res.status(200).json({ success:true, mode:'find-orphans', ctProducts:ctPartNumbers.size, totalOrphans:orphans.length, soldOutOrphans:soldOut.length, trulyOrphaned:trulyOrphaned.length, sample:trulyOrphaned.slice(0,20).map(p=>({id:p.id,title:p.title,sku:p.sku})) });
      }

      case 'archive-orphans': {
        const dryRun2=(req.query.dryRun??'true')!=='false', aoLimit=parseInt(req.query.limit as string||'100',10);
        const ctTires2=await fetchAllCTTires(), ctPNs=new Set(ctTires2.map((t: any)=>t.partNumber));
        const aoOrphans: Array<{id:number;title:string;handle:string;sku:string}>=[];
        let aoUrl: string|null=`${SHOPIFY.baseUrl}/products.json?tag=${SYNC_TAG}&status=active&limit=250&fields=id,title,handle,variants,tags`;
        while (aoUrl) {
          const r: Response=await fetch(aoUrl,{headers:{'Content-Type':'application/json','X-Shopify-Access-Token':SHOPIFY.token}});
          if (!r.ok) throw new Error(`Shopify ${r.status}`);
          const data: any=await r.json();
          for (const p of (data.products||[])) { const sku=p.variants?.[0]?.sku||''; if (sku&&!ctPNs.has(sku)) aoOrphans.push({id:p.id,title:p.title,handle:p.handle||'',sku}); }
          const lnk: string|null=r.headers.get('link'), lm=lnk?lnk.match(/<([^>]+)>;\s*rel="next"/):null;
          aoUrl=lm?lm[1]:null;
        }
        const aoChunk=aoOrphans.slice(0,aoLimit);
        if (dryRun2) return res.status(200).json({ success:true, mode:'archive-orphans', dryRun:true, totalOrphans:aoOrphans.length, willArchive:aoChunk.length, sample:aoChunk.slice(0,10).map(p=>({title:p.title,sku:p.sku})) });
        let aoArchived=0,aoRedirected=0,aoErrors=0;
        for (const p of aoChunk) {
          try {
            if (p.handle) { await shopifyFetch('/redirects.json',{method:'POST',body:JSON.stringify({redirect:{path:`/products/${p.handle}`,target:'/collections/all'}})}).catch(()=>{}); aoRedirected++; }
            await shopifyFetch(`/products/${p.id}.json`,{method:'PUT',body:JSON.stringify({product:{id:p.id,status:'archived'}})}); aoArchived++;
            await delay(300);
          } catch (e: any) { console.error('[archive-orphans] Failed',p.id,e.message); aoErrors++; }
        }
        return res.status(200).json({ success:true, mode:'archive-orphans', dryRun:false, totalOrphans:aoOrphans.length, archived:aoArchived, redirected:aoRedirected, errors:aoErrors, remaining:aoOrphans.length-aoChunk.length });
      }

      case 'archive-tire-skus': {
        const atsDryRun=(req.query.dryRun??'true')!=='false', atsLimit=Math.max(1,parseInt(req.query.limit as string||'100',10));
        const tireSKUProducts: Array<{id:number;title:string;handle:string;sku:string}>=[];
        let atsUrl: string|null=`${SHOPIFY.baseUrl}/products.json?status=active&limit=250&fields=id,title,handle,variants`;
        while (atsUrl) {
          const r: Response=await fetch(atsUrl,{headers:{'Content-Type':'application/json','X-Shopify-Access-Token':SHOPIFY.token}});
          if (!r.ok) throw new Error(`Shopify ${r.status} while paginating for archive-tire-skus`);
          const data: any=await r.json();
          for (const p of (data.products||[])) { const sku=p.variants?.[0]?.sku||''; if (sku.startsWith('TIRE-')) tireSKUProducts.push({id:p.id,title:p.title,handle:p.handle||'',sku}); }
          const lnk: string|null=r.headers.get('link'), lm=lnk?lnk.match(/<([^>]+)>;\s*rel="next"/):null;
          atsUrl=lm?lm[1]:null;
        }
        const atsChunk=tireSKUProducts.slice(0,atsLimit);
        if (atsDryRun) return res.status(200).json({ success:true, mode:'archive-tire-skus', dryRun:true, totalFound:tireSKUProducts.length, willArchive:atsChunk.length, sample:atsChunk.slice(0,10).map(p=>({id:p.id,title:p.title,sku:p.sku,handle:p.handle})) });
        let atsArchived=0,atsRedirected=0,atsErrors=0;
        for (const p of atsChunk) {
          try {
            if (p.handle) { await shopifyFetch('/redirects.json',{method:'POST',body:JSON.stringify({redirect:{path:`/products/${p.handle}`,target:'/collections/all'}})}).catch(()=>{}); atsRedirected++; }
            await shopifyFetch(`/products/${p.id}.json`,{method:'PUT',body:JSON.stringify({product:{id:p.id,status:'archived'}})}); atsArchived++;
            console.log(`🗑️  archive-tire-skus: archived ${p.sku} — "${p.title}"`);
            await delay(300);
          } catch (e: any) { console.error(`[archive-tire-skus] Failed ${p.id} (${p.sku}): ${e.message}`); atsErrors++; }
        }
        return res.status(200).json({ success:true, mode:'archive-tire-skus', dryRun:false, totalFound:tireSKUProducts.length, archived:atsArchived, redirected:atsRedirected, errors:atsErrors, remaining:tireSKUProducts.length-atsChunk.length });
      }

      case 'dedup': {
        const dryRun=!(req.body as any)?.confirm&&req.query.confirm!=='true';
        const allById=new Map<number,{id:number;title:string;handle:string;imageCount:number}>();
        let nextUrl: string|null=`${SHOPIFY.baseUrl}/products.json?tag=${SYNC_TAG}&limit=250&fields=id,title,images`;
        let safetyLimit=100;
        while (nextUrl&&safetyLimit-->0) {
          const r: Response=await fetch(nextUrl,{headers:{'Content-Type':'application/json','X-Shopify-Access-Token':SHOPIFY.token}});
          if (!r.ok) throw new Error(`Shopify ${r.status} paginating products`);
          const data: any=await r.json();
          for (const p of (data.products||[])) allById.set(p.id,{id:p.id,title:p.title,handle:p.handle||'',imageCount:p.images?.length||0});
          const link: string|null=r.headers.get('link'), nextMatch=link?link.match(/<([^>]+)>;\s*rel="next"/):null;
          nextUrl=nextMatch?nextMatch[1]:null;
        }
        const byTitle=new Map<string,Array<{id:number;title:string;handle:string;imageCount:number}>>();
        for (const p of allById.values()) { const key=p.title.trim().toUpperCase(); if (!byTitle.has(key)) byTitle.set(key,[]); byTitle.get(key)!.push(p); }
        const duplicateGroups: Array<{title:string;keep:number;delete:number[]}>=[];
        for (const [title,group] of byTitle.entries()) {
          const seen=new Map<number,{id:number;title:string;handle:string;imageCount:number}>();
          for (const p of group) seen.set(p.id,p);
          const unique=[...seen.values()];
          if (unique.length<2) continue;
          unique.sort((a,b)=>b.imageCount-a.imageCount||b.id-a.id);
          const keepId=unique[0].id, deleteIds=[...new Set(unique.slice(1).map(p=>p.id))].filter(id=>id!==keepId);
          if (deleteIds.length===0) continue;
          duplicateGroups.push({title,keep:keepId,delete:deleteIds});
        }
        const toDelete=duplicateGroups.flatMap(g=>g.delete);
        if (!dryRun) {
          let deleted=0,failed=0,redirected=0;
          for (const g of duplicateGroups) {
            const keepProduct=allById.get(g.keep), keepHandle=keepProduct?.handle||'';
            for (const id of g.delete) {
              try {
                const delProduct=allById.get(id), delHandle=delProduct?.handle||'';
                if (delHandle&&keepHandle) { await shopifyFetch('/redirects.json',{method:'POST',body:JSON.stringify({redirect:{path:`/products/${delHandle}`,target:`/products/${keepHandle}`}})}).catch(()=>{}); redirected++; }
                await shopifyFetch(`/products/${id}.json`,{method:'DELETE'}); deleted++;
              } catch (err) { console.error(`[dedup] Failed to delete product ${id}:`,err); failed++; }
              await delay(300);
            }
          }
          return res.status(200).json({ success:true, mode:'dedup', dryRun:false, duplicateGroups:duplicateGroups.length, deleted, redirected, failed, detail:duplicateGroups });
        }
        return res.status(200).json({ success:true, mode:'dedup', dryRun:true, duplicateGroups:duplicateGroups.length, wouldDelete:toDelete.length, detail:duplicateGroups });
      }

      case 'check-tags': {
        const search=(req.query.search as string||'Procontrol').trim();
        let found: Array<{id:number;title:string;tags:string}>=[];
        let nextUrl: string|null=`${SHOPIFY.baseUrl}/products.json?status=active&limit=250&fields=id,title,tags`;
        while (nextUrl) {
          const r: Response=await fetch(nextUrl,{headers:{'Content-Type':'application/json','X-Shopify-Access-Token':SHOPIFY.token}});
          if (r.status===429) { await delay(2000); continue; }
          if (!r.ok) break;
          const data: any=await r.json();
          for (const p of (data.products||[])) { if (p.title.toLowerCase().includes(search.toLowerCase())) { found.push({id:p.id,title:p.title,tags:p.tags}); if (found.length>=3) break; } }
          if (found.length>=3) break;
          const link: string|null=r.headers.get('link'), m=link?link.match(/<([^>]+)>;\s*rel="next"/):null;
          nextUrl=m?m[1]:null;
        }
        return res.status(200).json({ success:true, mode:'check-tags', search, found });
      }

      case 'debug-ct-names': {
        const ctSample=await fetchAllCTTires();
        const sample=ctSample.slice(0,10).map(ct=>{ const {loadIndex,speedRating}=parseLoadIndexAndSpeedRating(ct.name||''); return {name:ct.name,brand:ct.brand,model:ct.model,size:ct.size,parsedLoadIndex:loadIndex,parsedSpeedRating:speedRating}; });
        return res.status(200).json({ success:true, mode:'debug-ct-names', sample });
      }

      case 'repair-tags': {
        const dryRun=(req.query.dryRun??'true')!=='false';
        const repairOffset=parseInt(req.query.offset as string||'0',10), repairLimit=parseInt(req.query.limit as string||'100',10);
        let nextUrl: string|null=`${SHOPIFY.baseUrl}/products.json?status=active&limit=250&fields=id,title,tags,product_type`;
        const orphaned: Array<{id:number;title:string;tags:string}>=[];
        while (nextUrl) {
          const r: Response=await fetch(nextUrl,{headers:{'Content-Type':'application/json','X-Shopify-Access-Token':SHOPIFY.token}});
          if (r.status===429) { await delay(2000); continue; }
          if (!r.ok) throw new Error(`Shopify ${r.status}`);
          const data: any=await r.json();
          for (const p of (data.products||[])) {
            const tagArr: string[]=(p.tags||'').split(',').map((t: string)=>t.trim()).filter(Boolean);
            const nonLiSr=tagArr.filter((t: string)=>!t.startsWith('loadindex:')&&!t.startsWith('speedrating:'));
            if (nonLiSr.length===0&&tagArr.length>0) orphaned.push({id:p.id,title:p.title,tags:p.tags});
          }
          const link: string|null=r.headers.get('link'), nextMatch=link?link.match(/<([^>]+)>;\s*rel="next"/):null;
          nextUrl=nextMatch?nextMatch[1]:null;
        }
        const chunk=orphaned.slice(repairOffset,repairOffset+repairLimit);
        const nextOffset=repairOffset+repairLimit, done=nextOffset>=orphaned.length;
        if (dryRun) return res.status(200).json({ success:true, mode:'repair-tags', dryRun:true, totalOrphaned:orphaned.length, showing:chunk.length, orphaned:chunk.map(p=>({id:p.id,title:p.title,currentTags:p.tags})) });
        let repaired=0,errors=0;
        for (const p of chunk) {
          try {
            const parts=p.title.trim().split(' '), size=parts[parts.length-1]||'', brand=parts[0]||'';
            const brandTag=`brand-${brand.toLowerCase().replace(/\s+/g,'-')}`;
            const existingTags=p.tags||'';
            const isWinter=p.title.toLowerCase().includes('winter')||p.title.toLowerCase().includes('snow')||p.title.toLowerCase().includes('blizzak')||p.title.toLowerCase().includes('ice');
            const seasonTag=isWinter?'winter':'all-season';
            const liTag=existingTags.split(',').map((t: string)=>t.trim()).find((t: string)=>t.startsWith('loadindex:'))||'';
            const srTag=existingTags.split(',').map((t: string)=>t.trim()).find((t: string)=>t.startsWith('speedrating:'))||'';
            const restoredTags=[SYNC_TAG,'ai-match',brandTag,seasonTag,size,liTag,srTag].filter(Boolean).join(', ');
            await shopifyFetch(`/products/${p.id}.json`,{method:'PUT',body:JSON.stringify({product:{id:p.id,tags:restoredTags}})}); repaired++;
            await delay(250);
          } catch (e: any) { console.error(`[repair-tags] Failed ${p.id} "${p.title}":`,e.message); errors++; }
        }
        return res.status(200).json({ success:true, mode:'repair-tags', dryRun:false, totalOrphaned:orphaned.length, repaired, errors, nextOffset:done?null:nextOffset, done });
      }

      case 'backfill-ai-match': {
        const bfDryRun=req.query.dryRun!=='false'&&req.query.dryRun==='true';
        const bfOffset=parseInt(req.query.offset as string||'0',10), bfLimit=parseInt(req.query.limit as string||'250',10);
        const missing: Array<{id:number;title:string;tags:string}>=[];
        let nextUrl: string|null=`${SHOPIFY.baseUrl}/products.json?tag=${SYNC_TAG}&status=active&limit=250&fields=id,title,tags`;
        while (nextUrl) {
          const r: Response=await fetch(nextUrl,{headers:{'Content-Type':'application/json','X-Shopify-Access-Token':SHOPIFY.token}});
          if (r.status===429) { await delay(2000); continue; }
          if (!r.ok) throw new Error(`Shopify ${r.status}`);
          const d: any=await r.json();
          for (const p of (d.products||[])) { const existingTags: string[]=(p.tags||'').split(',').map((t: string)=>t.trim()).filter(Boolean); if (!existingTags.includes('ai-match')) missing.push({id:p.id,title:p.title,tags:p.tags}); }
          const lnk=r.headers.get('link'), lm=lnk?lnk.match(/<([^>]+)>;\s*rel="next"/):null;
          nextUrl=lm?lm[1]:null;
        }
        const chunk=missing.slice(bfOffset,bfOffset+bfLimit), bfDone=bfOffset+bfLimit>=missing.length;
        console.log(`[backfill-ai-match] ${missing.length} products missing ai-match, processing ${chunk.length} (offset=${bfOffset})`);
        let patched=0,bfErrors=0;
        if (!bfDryRun) {
          for (const p of chunk) {
            try { const existingTags=(p.tags||'').split(',').map((t: string)=>t.trim()).filter(Boolean); const newTags=[...existingTags,'ai-match'].join(', '); await shopifyFetch(`/products/${p.id}.json`,{method:'PUT',body:JSON.stringify({product:{id:p.id,tags:newTags}})}); patched++; await delay(250); }
            catch (e: any) { console.error(`[backfill-ai-match] Failed ${p.id} "${p.title}":`,e.message); bfErrors++; }
          }
        }
        return res.status(200).json({ success:true, mode:'backfill-ai-match', dryRun:bfDryRun, totalMissing:missing.length, chunkSize:chunk.length, patched:bfDryRun?0:patched, errors:bfDryRun?0:bfErrors, nextOffset:bfDone?null:bfOffset+bfLimit, done:bfDone, ...(bfDryRun?{sample:chunk.slice(0,10).map(p=>({id:p.id,title:p.title}))}:{}) });
      }

      case 'list-products': {
        const sinceId=parseInt(req.query.sinceId as string||'0',10);
        const lpQuery=`tag=${SYNC_TAG}&status=active&limit=250&fields=id,title,tags,variants${sinceId?`&since_id=${sinceId}`:''}`;
        const lpData: any=await shopifyFetch<any>(`/products.json?${lpQuery}`);
        const lpProducts=(lpData.products||[]).map((p: any)=>({id:p.id,title:p.title,tags:p.tags||'',sku:p.variants?.[0]?.sku||''}));
        const nextSinceId=lpProducts.length===250?lpProducts[lpProducts.length-1].id:null;
        return res.status(200).json({ success:true, mode:'list-products', products:lpProducts, nextSinceId });
      }

      case 'list-no-image-products': {
        const nipSinceId=parseInt(req.query.sinceId as string||'0',10);
        const nipQ=`tag=${SYNC_TAG}&status=active&limit=250&fields=id,title,vendor,images${nipSinceId?`&since_id=${nipSinceId}`:''}`;
        const nipData: any=await shopifyFetch<any>(`/products.json?${nipQ}`);
        const nipAll=nipData.products||[];
        const nipProducts=nipAll.filter((p: any)=>!p.images||p.images.length===0).map((p: any)=>({id:p.id,title:p.title,vendor:p.vendor||''}));
        const nipNextSinceId=nipAll.length===250?nipAll[nipAll.length-1].id:null;
        return res.status(200).json({ success:true, mode:'list-no-image-products', products:nipProducts, nextSinceId:nipNextSinceId, pageTotal:nipAll.length });
      }

      case 'attach-image-by-id': {
        const aibProductId=parseInt(req.query.productId as string||'0',10), aibImageUrl=(req.query.imageUrl as string||'').trim(), aibAlt=(req.query.alt as string||'').trim();
        if (!aibProductId||!aibImageUrl) return res.status(400).json({ error:'Required params: productId and imageUrl' });
        await shopifyFetch(`/products/${aibProductId}/images.json`,{method:'POST',body:JSON.stringify({image:{src:aibImageUrl,...(aibAlt?{alt:aibAlt}:{})}})});
        return res.status(200).json({ success:true, mode:'attach-image-by-id', productId:aibProductId, imageUrl:aibImageUrl });
      }

      case 'list-products-seo': {
        const lpsSinceId=parseInt(req.query.sinceId as string||'0',10);
        const lpsQ=`tag=${SYNC_TAG}&status=active&limit=250&fields=id,title,vendor,tags,body_html${lpsSinceId?`&since_id=${lpsSinceId}`:''}`;
        const lpsData: any=await shopifyFetch<any>(`/products.json?${lpsQ}`);
        const lpsProducts=(lpsData.products||[]).map((p: any)=>({id:p.id,title:p.title,vendor:p.vendor||'',tags:p.tags||'',body_html:p.body_html||''}));
        const lpsNextSinceId=lpsProducts.length===250?lpsProducts[lpsProducts.length-1].id:null;
        return res.status(200).json({ success:true, mode:'list-products-seo', products:lpsProducts, nextSinceId:lpsNextSinceId });
      }

      case 'update-description': {
        const udBody=req.body as {productId?:number;body_html?:string};
        const udProductId=Number(udBody?.productId), udBodyHtml=(udBody?.body_html||'').trim();
        if (!udProductId||!udBodyHtml) return res.status(400).json({ error:'Required body fields: productId (number) and body_html (string)' });
        await shopifyFetch(`/products/${udProductId}.json`,{method:'PUT',body:JSON.stringify({product:{id:udProductId,body_html:udBodyHtml}})});
        return res.status(200).json({ success:true, mode:'update-description', productId:udProductId });
      }

      case 'list-all-products': {
        const lapSinceId=parseInt(req.query.sinceId as string||'0',10);
        const lapQ=`status=active&limit=250&fields=id,title,handle,variants${lapSinceId?`&since_id=${lapSinceId}`:''}`;
        const lapData: any=await shopifyFetch<any>(`/products.json?${lapQ}`);
        const lapProducts=(lapData.products||[]).map((p: any)=>({id:p.id,title:p.title,handle:p.handle||'',sku:p.variants?.[0]?.sku||''}));
        const lapNextSinceId=lapProducts.length===250?lapProducts[lapProducts.length-1].id:null;
        return res.status(200).json({ success:true, mode:'list-all-products', products:lapProducts, nextSinceId:lapNextSinceId });
      }

      case 'archive-single': {
        const asId=parseInt(req.query.id as string||'0',10), asHandle=(req.query.handle as string||'').trim();
        if (!asId) return res.status(400).json({ error:'?id= is required' });
        let asRedirected=false;
        if (asHandle) { await shopifyFetch('/redirects.json',{method:'POST',body:JSON.stringify({redirect:{path:`/products/${asHandle}`,target:'/collections/all'}})}).catch(()=>{}); asRedirected=true; }
        await shopifyFetch(`/products/${asId}.json`,{method:'PUT',body:JSON.stringify({product:{id:asId,status:'archived'}})});
        return res.status(200).json({ success:true, mode:'archive-single', productId:asId, redirected:asRedirected });
      }

      case 'audit-tire-skus': {
        const tireSkuProducts: Array<{id:number;title:string;sku:string}>=[];
        const realSkuByTitle=new Map<string,{id:number;title:string;sku:string}>();
        let auditUrl: string|null=`${SHOPIFY.baseUrl}/products.json?tag=${SYNC_TAG}&status=active&limit=250&fields=id,title,variants`;
        while (auditUrl) {
          const r: Response=await fetch(auditUrl,{headers:{'Content-Type':'application/json','X-Shopify-Access-Token':SHOPIFY.token}});
          if (r.status===429) { await delay(2000); continue; }
          if (!r.ok) throw new Error(`Shopify ${r.status} fetching ct-sync products`);
          const data: any=await r.json();
          for (const p of (data.products||[])) { const sku: string=p.variants?.[0]?.sku||''; const entry={id:p.id,title:p.title,sku}; if (sku.startsWith('TIRE-')) tireSkuProducts.push(entry); else if (sku) realSkuByTitle.set(normalizeTitle(p.title),entry); }
          const lnk: string|null=r.headers.get('link'), lm=lnk?lnk.match(/<([^>]+)>;\s*rel="next"/):null;
          auditUrl=lm?lm[1]:null;
        }
        const hasRealMatch: Array<{id:number;title:string;tireSku:string;realSku:string;realId:number}>=[];
        const trulyStale: Array<{id:number;title:string;sku:string}>=[];
        for (const p of tireSkuProducts) { const match=realSkuByTitle.get(normalizeTitle(p.title)); if (match) hasRealMatch.push({id:p.id,title:p.title,tireSku:p.sku,realSku:match.sku,realId:match.id}); else trulyStale.push(p); }
        return res.status(200).json({ success:true, mode:'audit-tire-skus', summary:{ totalTireSkuProducts:tireSkuProducts.length, realCtSkuProducts:realSkuByTitle.size, hasRealMatch:hasRealMatch.length, trulyStale:trulyStale.length, note:'hasRealMatch products are safe to delete (real CT product exists). trulyStale have no CT counterpart — investigate before deleting.' }, samples:{ hasRealMatch:hasRealMatch.slice(0,10).map(p=>({tireProduct:{id:p.id,title:p.title,sku:p.tireSku},realProduct:{id:p.realId,sku:p.realSku}})), trulyStale:trulyStale.slice(0,10).map(p=>({id:p.id,title:p.title,sku:p.sku})) } });
      }

      case 'debug-translations': {
        // Inspect what translation keys and locales T&A actually stores for a product.
        // Usage: POST /api/shopifySync?action=debug-translations&search=cooper+procontrol
        const searchTerm = (req.query.search as string || 'Cooper Procontrol').trim();
        const graphqlUrl = `https://${SHOPIFY.domain}/admin/api/${SHOPIFY.apiVersion}/graphql.json`;

        async function gqlDebug(query: string, variables: Record<string,any> = {}): Promise<any> {
          const r = await fetch(graphqlUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': SHOPIFY.token },
            body: JSON.stringify({ query, variables }),
          });
          if (!r.ok) throw new Error(`GraphQL HTTP ${r.status}: ${(await r.text()).slice(0,200)}`);
          return r.json();
        }

        // Find one matching product
        const findResult: any = await gqlDebug(`
          query($q: String!) {
            products(first: 1, query: $q) {
              edges { node { id title handle } }
            }
          }
        `, { q: searchTerm });

        const product = findResult?.data?.products?.edges?.[0]?.node;
        if (!product) return res.status(404).json({ error: `No product found matching: ${searchTerm}` });

        // Check all locales
        const locales = ['fr', 'fr-CA', 'fr_CA', 'fr-ca'];
        const results: Record<string, any> = {};

        for (const locale of locales) {
          const transResult: any = await gqlDebug(`
            query($id: ID!, $locale: String!) {
              translatableResource(resourceId: $id) {
                translations(locale: $locale) { key value locale outdated }
              }
            }
          `, { id: product.id, locale });
          results[locale] = transResult?.data?.translatableResource?.translations || [];
        }

        // Also check translatableContent to see all available keys
        const contentResult: any = await gqlDebug(`
          query($id: ID!) {
            translatableResource(resourceId: $id) {
              translatableContent { key value digest locale }
            }
          }
        `, { id: product.id });

        return res.status(200).json({
          success: true,
          mode: 'debug-translations',
          product: { id: product.id, title: product.title, handle: product.handle },
          translationsByLocale: results,
          translatableContent: contentResult?.data?.translatableResource?.translatableContent || [],
        });
      }

      case 'clear-french-handles': {
        // Clears all French URL handle translations from Translate & Adapt.
        // When French handles are blank, Shopify automatically uses the English
        // handle with the /fr-ca/ prefix — no collision, no -1 suffix.
        //
        // Uses the Shopify Translations API (GraphQL) to delete the handle
        // translation resource for every product.
        //
        // Query params:
        //   dryRun=true  (default) — counts affected products, no writes
        //   dryRun=false           — clears handles in batches of 10
        //   offset=0               — pagination offset
        //   limit=100              — products to process per call
        //
        // Run repeatedly with increasing offset until done=true.
        // Usage:
        //   POST /api/shopifySync?action=clear-french-handles            ← dry run
        //   POST /api/shopifySync?action=clear-french-handles&dryRun=false&offset=0&limit=100

        const cfhDryRun = (req.query.dryRun ?? 'true') !== 'false';
        const cfhOffset = parseInt(req.query.offset as string || '0', 10);
        const cfhLimit  = parseInt(req.query.limit  as string || '100', 10);

        const graphqlUrl = `https://${SHOPIFY.domain}/admin/api/${SHOPIFY.apiVersion}/graphql.json`;

        // Helper: run a GraphQL query
        async function gql(query: string, variables: Record<string,any> = {}): Promise<any> {
          const r = await fetch(graphqlUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': SHOPIFY.token },
            body: JSON.stringify({ query, variables }),
          });
          if (r.status === 429) { await delay(2000); return gql(query, variables); }
          if (!r.ok) throw new Error(`GraphQL HTTP ${r.status}: ${(await r.text()).slice(0,200)}`);
          return r.json();
        }

        // Step 1: paginate all products to get their GIDs
        const allProductGids: Array<{ gid: string; title: string }> = [];
        let cfhCursor: string | null = null;

        while (true) {
          const result: any = await gql(`
            query($cursor: String) {
              products(first: 250, after: $cursor, query: "tag:ct-sync") {
                edges {
                  cursor
                  node { id title }
                }
                pageInfo { hasNextPage }
              }
            }
          `, { cursor: cfhCursor });

          const edges = result?.data?.products?.edges || [];
          for (const e of edges) {
            allProductGids.push({ gid: e.node.id, title: e.node.title });
          }
          if (!result?.data?.products?.pageInfo?.hasNextPage) break;
          cfhCursor = edges[edges.length - 1]?.cursor || null;
          await delay(200);
        }

        const chunk = allProductGids.slice(cfhOffset, cfhOffset + cfhLimit);
        const nextOffset = cfhOffset + cfhLimit;
        const cfhDone = nextOffset >= allProductGids.length;

        console.log(`[clear-french-handles] Total products: ${allProductGids.length}, chunk: ${chunk.length} (offset=${cfhOffset})`);

        if (cfhDryRun) {
          return res.status(200).json({
            success: true,
            mode: 'clear-french-handles',
            dryRun: true,
            totalProducts: allProductGids.length,
            chunkSize: chunk.length,
            offset: cfhOffset,
            nextOffset: cfhDone ? null : nextOffset,
            done: cfhDone,
            sample: chunk.slice(0, 10).map(p => p.title),
            note: 'Run with dryRun=false to clear French handles',
          });
        }

        // Step 2: for each product, delete the French handle translation
        let cleared = 0, skipped = 0, cfhErrors = 0;
        const cfhErrorList: string[] = [];

        for (const product of chunk) {
          try {
            // First check if a French handle translation exists
            const transResult: any = await gql(`
              query($id: ID!, $locale: String!) {
                translatableResource(resourceId: $id) {
                  translations(locale: $locale) {
                    key
                    value
                  }
                }
              }
            `, { id: product.gid, locale: 'fr' });

            const translations: Array<{ key: string; value: string }> =
              transResult?.data?.translatableResource?.translations || [];

            const handleTranslation = translations.find(t => t.key === 'handle');

            if (!handleTranslation) {
              skipped++;
              continue; // no French handle set — nothing to clear
            }

            // Delete the French handle translation by setting it to empty string
            // Shopify treats empty/missing translation as "use default language"
            const removeResult: any = await gql(`
              mutation($id: ID!, $translations: [TranslationInput!]!) {
                translationsRemove(resourceId: $id, translationKeys: ["handle"], locales: ["fr"]) {
                  userErrors { field message }
                  translations { key value }
                }
              }
            `, { id: product.gid, translations: [] });

            const userErrors = removeResult?.data?.translationsRemove?.userErrors || [];
            if (userErrors.length > 0) {
              cfhErrors++;
              cfhErrorList.push(`${product.title}: ${userErrors.map((e: any) => e.message).join(', ')}`);
            } else {
              cleared++;
              console.log(`✅ Cleared French handle for: "${product.title}"`);
            }

            await delay(150); // respect API rate limits

          } catch (e: any) {
            cfhErrors++;
            cfhErrorList.push(`${product.title}: ${e.message}`);
            console.error(`[clear-french-handles] Failed "${product.title}":`, e.message);
          }
        }

        return res.status(200).json({
          success: true,
          mode: 'clear-french-handles',
          dryRun: false,
          totalProducts: allProductGids.length,
          chunkProcessed: chunk.length,
          cleared,
          skipped,
          errors: cfhErrors,
          ...(cfhErrorList.length > 0 ? { errorList: cfhErrorList.slice(0, 20) } : {}),
          offset: cfhOffset,
          nextOffset: cfhDone ? null : nextOffset,
          done: cfhDone,
          nextCommand: cfhDone
            ? '✅ All French handles cleared'
            : `Run with offset=${nextOffset} to continue`,
        });
      }

      case 'daily-sync':
      default: {
        const updateOffset    = parseInt(req.query.updateOffset as string || '0', 10);
        const updateChunkSize = parseInt(req.query.updateChunk  as string || '50', 10);
        const t0 = Date.now();

        // Fetch existing Shopify SKUs and slice a chunk — avoids a full CT fetch
        const existingMap = await fetchExistingProducts();
        const allSkus = [...existingMap.keys()].filter(s => !s.startsWith('TIRE-'));
        const chunk   = allSkus.slice(updateOffset, updateOffset + updateChunkSize);
        const done    = updateOffset + updateChunkSize >= allSkus.length;
        const nextOffset = done ? 0 : updateOffset + updateChunkSize;

        if (chunk.length === 0) {
          return res.status(200).json({ success:true, mode:'daily-sync', done:true, totalSkus:allSkus.length, message:'All SKUs processed' });
        }

        // Fetch only this chunk from CT API using partNumber filter
        const fullUrl = `${CT.baseUrl}?script=${CT_SCRIPT}&deploy=${CT_DEPLOY}`;
        const ctRes = await fetch(fullUrl, {
          method: 'POST',
          headers: { 'Authorization': buildAuthHeader(), 'Content-Type': 'application/json', 'Accept': 'application/json' },
          body: JSON.stringify({
            customerId: CT.customerId, customerToken: CT.customerToken,
            filters: { width:'', rimSize:'', aspectRatio:'', size:'', partNumber: chunk, brand:'', searchKey:'', isWinter:'', isRunFlat:'', isTire:true, isWheel:false, page:1 },
          }),
        });
        if (!ctRes.ok) throw new Error(`CT API HTTP ${ctRes.status}: ${(await ctRes.text()).slice(0,200)}`);
        const ctData: any = await ctRes.json();
        if (!ctData.success) throw new Error(`CT API error: ${JSON.stringify(ctData.error)}`);
        const ctTires = (ctData.data || []) as CTTire[];

        let updated=0, errors=0;
        const errorList: string[] = [];
        const noCostSkus: string[] = [];
        const outOfBandSkus: string[] = [];
        for (const sku of chunk) {
          const ct = ctTires.find(t => t.partNumber === sku);
          if (!ct) continue;
          const ex = existingMap.get(sku);
          if (!ex) continue;
          const costCheck = checkCTDealerCost(ct.cost, ct.msrp);
          if (!costCheck.ok) {
            if (costCheck.reason === 'out_of_band') { outOfBandSkus.push(`${sku} (cost $${costCheck.cost} outside $${costCheck.min.toFixed(2)}-$${costCheck.max.toFixed(2)})`); console.log(`⏭️  daily-sync: out-of-band CT cost — skipped + flagged: ${sku}`); }
            else { noCostSkus.push(sku); console.log(`⏭️  daily-sync: no/invalid CT cost — skipped + flagged: ${sku}`); }
            continue;
          }
          const netCost = costCheck.cost; // real CT dealer cost, stored unmodified
          const newSellingPrice = calculatePrice(netCost);
          const newPrice = newSellingPrice.toFixed(2);
          const priceChanged = newPrice !== ex.price;
          const { loadIndex: upLI, speedRating: upSR } = parseLoadIndexAndSpeedRating(ct.name || '');
          const existingTagStr = ex.tags || '';
          let updatedTags = existingTagStr;
          if (upLI && !existingTagStr.includes('loadindex:'))   updatedTags = [updatedTags, `loadindex:${upLI}`].filter(Boolean).join(', ');
          if (upSR && !existingTagStr.includes('speedrating:')) updatedTags = [updatedTags, `speedrating:${upSR}`].filter(Boolean).join(', ');
          const tagsChanged = updatedTags !== existingTagStr;
          try {
            await shopifyFetch(`/variants/${ex.variantId}.json`, {
              method: 'PUT',
              body: JSON.stringify({ variant: { id: ex.variantId, ...(priceChanged ? { price: newPrice } : {}), cost: netCost.toFixed(2), inventory_management: 'shopify', inventory_policy: 'deny' } }),
            });
            // Refresh canada_tire.cost with the same strict-parsed real cost
            // (overwrites any MSRP-poisoned cache). Always runs; tags folded in
            // when changed. Not swallowed — Cost per item and canada_tire.cost
            // must never diverge.
            await shopifyFetch(`/products/${ex.productId}.json`, {
              method: 'PUT',
              body: JSON.stringify({ product: { id: ex.productId, ...(tagsChanged ? { tags: updatedTags } : {}), metafields: [{ namespace: 'canada_tire', key: 'cost', value: netCost.toFixed(2), type: 'number_decimal' }] } }),
            });
            // Stamp cost freshness (upsert by owner+namespace+key) — read by
            // gci-order-hub cost-integrity-audit to flag stale cost. Non-fatal.
            await shopifyFetch(`/products/${ex.productId}/metafields.json`, {
              method: 'POST',
              body: JSON.stringify({ metafield: { namespace: 'canada_tire', key: 'cost_synced_at', value: new Date().toISOString(), type: 'date_time' } }),
            }).catch(() => {});
            await setInventory(ex.inventoryItemId, getTotalQty(ct));
            if (!ex.hasImages) await attachProductImage(ex.productId, ct);
            updated++;
          } catch (e: any) {
            errors++;
            errorList.push(`UPDATE ${sku}: ${e.message}`);
          }
        }

        return res.status(200).json({
          success: true, mode: 'daily-sync',
          totalSkus: allSkus.length, chunkOffset: updateOffset, chunkSize: chunk.length,
          updated, errors,
          skippedNoCost: noCostSkus.length,
          skippedOutOfBand: outOfBandSkus.length,
          ...(noCostSkus.length ? { noCostSkus } : {}),
          ...(outOfBandSkus.length ? { outOfBandSkus } : {}),
          ...(errorList.length ? { errorList } : {}),
          done,
          nextUrl: done ? null : `?action=daily-sync&updateOffset=${nextOffset}&updateChunk=${updateChunkSize}`,
          duration: `${((Date.now()-t0)/1000).toFixed(1)}s`,
        });
      }
    }
  } catch (e: any) {
    console.error('❌ shopifySync error:', e);
    return res.status(500).json({ success:false, error:e.message });
  }
}
