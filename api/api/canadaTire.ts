// api/canadaTire.ts
// ============================================================
// Canada Tire Supplier — NetSuite RESTlet API
// Full implementation: Tire Search, Wheel Search,
// Submit Order, Update Order, Ship-To Addresses
// OAuth 1.0 HMAC-SHA256
// ============================================================

import crypto from 'crypto';
import type { VercelRequest, VercelResponse } from '@vercel/node';

// ─── ENVIRONMENT CONFIG ───────────────────────────────────────────────────────
const CONFIG = {
  consumerKey:    process.env.CT_CONSUMER_KEY        || '',
  consumerSecret: process.env.CT_CONSUMER_SECRET     || '',
  tokenId:        process.env.CT_TOKEN_ID            || '',
  tokenSecret:    process.env.CT_TOKEN_SECRET        || '',
  customerId:     process.env.CT_CUSTOMER_NUMBER     || '19997',
  customerToken:  process.env.CT_CUSTOMER_API_TOKEN  || '',
  useSandbox:     process.env.CT_USE_SANDBOX !== 'false',

  get realm()   { return this.useSandbox ? '8031691_SB1' : '8031691'; },
  get baseUrl() {
    // NOTE: path is /restlet.nl (not /restlets/)
    return this.useSandbox
      ? 'https://8031691-sb1.restlets.api.netsuite.com/app/site/hosting/restlet.nl'
      : 'https://8031691.restlets.api.netsuite.com/app/site/hosting/restlet.nl';
  },
};

// ─── SCRIPT REGISTRY ─────────────────────────────────────────────────────────
// All script + deploy names confirmed from API documentation.
const SCRIPTS = {
  tireSearch:      { script: 'customscript_item_search_rl',          deploy: 'customdeploy_item_search_rl' },          // ✅ Confirmed
  wheelSearch:     { script: 'customscript_cda_wheel_search_rl',     deploy: 'customdeploycda_wheel_search_rl' },       // ✅ Confirmed
  submitOrder:     { script: 'customscript_create_sales_order_rl',   deploy: 'customdeploy_create_sales_order_rl' },    // ✅ Confirmed
  updateOrderAddr: { script: 'customscript_update_order_addr_rl',    deploy: 'customdeploy_update_order_addr_rl' },     // ✅ Confirmed
  shipToAddresses: { script: 'customscript_get_cust_addr_rl',        deploy: 'customdeploy_get_cust_addr_rl' },         // ✅ Confirmed
} as const;

type ScriptKey = keyof typeof SCRIPTS;

// ─── TYPESCRIPT INTERFACES ────────────────────────────────────────────────────

export interface CTInventoryLocation {
  location: string;
  quantity: number;
}

// Tire product
export interface CTTireProduct {
  partNumber:          string;
  name:                string;
  performanceCategory: string;
  brand:               string;
  model:               string;
  size:                string;
  isWinter:            boolean;
  isRunFlat:           boolean;
  isTire:              boolean;
  isWheel:             boolean;
  cost:                string;   // supplier cost — server-side only!
  msrp:                string;   // customer-facing price
  inventory:           CTInventoryLocation[];
}

// Wheel product (extends tire with wheel-specific fields)
export interface CTWheelProduct {
  partNumber:          string;
  name:                string;
  performanceCategory: string;
  brand:               string;
  model:               string;
  size:                string;
  isWinter:            boolean;
  isRunFlat:           boolean;
  isWheel:             boolean;
  bolt_pattern:        string;   // e.g. "5-100"
  centreBore:          string;   // e.g. "56.1"
  offSet:              string;   // e.g. "48"
  rimDiameter:         number;
  width:               number;
  cost:                string;
  msrp:                string;
  inventory:           CTInventoryLocation[];
}

// Ship-to address
export interface CTShipToAddress {
  addrId:    number;
  attention: string;
  addressee: string;
  addr1:     string;
  addr2:     string;
  city:      string;
  province:  string;
  postalCode: string;
  country:   string;
}

// Shipping input for orders
export interface CTShipping {
  addrId?:    number;
  addr1?:     string;
  addr2?:     string;
  attention?: string;
  addressee?: string;
  city?:      string;
  province?:  string;  // UPPERCASE: QC, ON, BC …
  postalCode?: string;
  country?:   string;  // UPPERCASE: CA, US
}

// Order item
export interface CTOrderItem {
  partNumber: string;
  quantity:   number;
}

// Order details for submit
export interface CTOrderDetails {
  poNumber:  string;
  location:  string;           // MANDATORY
  email?:    string;
  phone?:    string;
  shipping:  CTShipping;
  items:     CTOrderItem[];
}

// API generic response wrapper
interface CTApiResponse<T = unknown> {
  data:    T;
  success: boolean;
  error: {
    code:     number | string;
    errorMsg: string;
  };
}

// Filters for tire search
export interface CTTireFilters {
  width?:       number;
  rimSize?:     number;
  aspectRatio?: number;
  size?:        string;
  partNumber?:  string[];
  brand?:       string;
  searchKey?:   string;
  isWinter?:    boolean | '';
  isRunFlat?:   boolean | '';
  isTire?:      boolean | '';
  isWheel?:     boolean | '';
  page?:        number;
}

// Filters for wheel search
export interface CTWheelFilters {
  bolt_pattern?: string;   // e.g. "5-100"
  offSet?:       string;   // e.g. "48"
  centreBore?:   string;   // e.g. "57.1"
  rimDiameter?:  number;
  width?:        number;
  size?:         string;
  aspectRatio?:  number;
  brand?:        string;
  partNumber?:   string[];
  isWinter?:     boolean | '';
  isRunFlat?:    boolean | '';
  searchKey?:    string;
  page?:         number;
}

// ─── OAUTH 1.0 HMAC-SHA256 ────────────────────────────────────────────────────

function nonce():     string { return crypto.randomBytes(16).toString('hex'); }
function timestamp(): string { return Math.floor(Date.now() / 1000).toString(); }

function pct(s: string): string {
  return encodeURIComponent(s)
    .replace(/!/g, '%21').replace(/'/g, '%27')
    .replace(/\(/g, '%28').replace(/\)/g, '%29').replace(/\*/g, '%2A');
}

/**
 * Builds the OAuth 1.0 Authorization header.
 *
 * NetSuite signature params in alphabetical order:
 *   deploy, oauth_consumer_key, oauth_nonce, oauth_signature_method,
 *   oauth_timestamp, oauth_token, oauth_version, script
 *
 * @param baseUrl  - URL WITHOUT query string (used as base for signing)
 * @param script   - script name string (e.g. "customscript_cda_tire_search_rl")
 * @param deploy   - deploy name string  (e.g. "customdeploy_cda_tire_search_rl")
 */
function buildAuthHeader(baseUrl: string, script: string, deploy: string): string {
  const ts = timestamp();
  const nc = nonce();

  // All params that go into the signature (alphabetical order)
  const sigParams: Record<string, string> = {
    deploy,
    oauth_consumer_key:     CONFIG.consumerKey,
    oauth_nonce:            nc,
    oauth_signature_method: 'HMAC-SHA256',
    oauth_timestamp:        ts,
    oauth_token:            CONFIG.tokenId,
    oauth_version:          '1.0',
    script,
  };

  const paramStr = Object.keys(sigParams)
    .sort()
    .map(k => `${pct(k)}=${pct(sigParams[k])}`)
    .join('&');

  const base      = ['POST', pct(baseUrl), pct(paramStr)].join('&');
  const signingKey = `${pct(CONFIG.consumerSecret)}&${pct(CONFIG.tokenSecret)}`;
  const signature  = crypto.createHmac('sha256', signingKey).update(base).digest('base64');

  return [
    `OAuth realm="${CONFIG.realm}"`,
    `oauth_consumer_key="${CONFIG.consumerKey}"`,
    `oauth_token="${CONFIG.tokenId}"`,
    `oauth_signature_method="HMAC-SHA256"`,
    `oauth_timestamp="${ts}"`,
    `oauth_nonce="${nc}"`,
    `oauth_version="1.0"`,
    `oauth_signature="${pct(signature)}"`,
  ].join(', ');
}

// ─── CORE POST HELPER ─────────────────────────────────────────────────────────
//
// Error handling per API docs:
//   HTTP 401 → OAuth signing rejected (bad keys, wrong realm, clock skew)
//   HTTP 200 → OAuth accepted. Check data.success for business-level result.
//
// Business error codes in data.error.code:
//   401 → OAuth OK but customerId / customerToken mismatch
//   400 → Wrong data type or missing mandatory field
//   500 → Server-side processing error

async function ctPost<T>(key: ScriptKey, body: Record<string, unknown>): Promise<T> {
  const { script, deploy } = SCRIPTS[key];
  const baseUrl = CONFIG.baseUrl;
  const fullUrl = `${baseUrl}?script=${script}&deploy=${deploy}`;
  const auth    = buildAuthHeader(baseUrl, script, deploy);

  console.log(`🔗 CT POST [${key}] ${CONFIG.useSandbox ? "(SANDBOX)" : "(PRODUCTION)"}`);

  let res: Response;
  try {
    res = await fetch(fullUrl, {
      method: "POST",
      headers: {
        "Authorization": auth,
        "Content-Type":  "application/json",
        "Accept":        "application/json",
      },
      body: JSON.stringify(body),
    });
  } catch (networkErr: any) {
    throw new Error(`Network error reaching Canada Tire API: ${networkErr.message}`);
  }

  // HTTP 401 = OAuth signature rejected by NetSuite
  if (res.status === 401) {
    const txt = await res.text().catch(() => "");
    console.error("❌ OAuth 1.0 rejected (HTTP 401):", txt);
    throw new Error(
      "OAuth 1.0 authentication failed (HTTP 401). " +
      "Check CT_CONSUMER_KEY, CT_CONSUMER_SECRET, CT_TOKEN_ID, CT_TOKEN_SECRET and Realm."
    );
  }

  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`Canada Tire API HTTP ${res.status}: ${txt}`);
  }

  // HTTP 200: OAuth accepted. Now check business-level result.
  const data: CTApiResponse<T> = await res.json();

  if (!data.success) {
    const code = Number(data.error?.code);
    const msg  = data.error?.errorMsg || "Unknown error";

    switch (code) {
      case 401:
        console.error("❌ CT error 401: customerId/customerToken mismatch");
        throw new Error(
          "Canada Tire API error 401: customerId and customerToken do not match. " +
          "Verify CT_CUSTOMER_NUMBER and CT_CUSTOMER_API_TOKEN in Vercel env vars."
        );
      case 400:
        console.error("❌ CT error 400 (bad request):", msg);
        throw new Error(`Canada Tire API error 400 (bad request): ${msg}`);
      case 500:
        console.error("❌ CT error 500 (server error):", msg);
        throw new Error(`Canada Tire API error 500 (server error): ${msg}. Contact supplier if this persists.`);
      default:
        console.error(`❌ CT error ${code}:`, msg);
        throw new Error(`Canada Tire API error ${code}: ${msg}`);
    }
  }

  console.log(`✅ CT [${key}] success`);
  return data.data;
}

// ─── 1. TIRE SEARCH ──────────────────────────────────────────────────────────

export async function searchTires(filters: CTTireFilters = {}): Promise<CTTireProduct[]> {
  console.log('🔍 Searching tires...', filters);
  return ctPost<CTTireProduct[]>('tireSearch', {
    customerId:    CONFIG.customerId,
    customerToken: CONFIG.customerToken,
    filters: {
      width:       filters.width       ?? '',
      rimSize:     filters.rimSize     ?? '',
      aspectRatio: filters.aspectRatio ?? '',
      size:        filters.size        ?? '',
      partNumber:  filters.partNumber  ?? [],
      brand:       filters.brand       ?? '',
      searchKey:   filters.searchKey   ?? '',
      isWinter:    filters.isWinter    ?? '',
      isRunFlat:   filters.isRunFlat   ?? '',
      isTire:      filters.isTire      ?? '',
      isWheel:     filters.isWheel     ?? '',
      page:        filters.page        ?? 1,
    },
  });
}

// Convenience wrappers
export const searchTiresOnly       = (f: CTTireFilters = {}) => searchTires({ ...f, isTire: true,  isWheel: false });
export const searchWinterTires     = (f: CTTireFilters = {}) => searchTires({ ...f, isTire: true,  isWinter: true });
export const searchTiresBySize     = (w: number, ar: number, rim: number) =>
  searchTires({ width: w, aspectRatio: ar, rimSize: rim, isTire: true });
export const searchTiresByBrand    = (brand: string) =>
  searchTires({ brand: brand.toUpperCase(), isTire: true });
export const searchTiresByPartNums = (partNumbers: string[]) =>
  searchTires({ partNumber: partNumbers });

// ─── 2. WHEEL SEARCH ─────────────────────────────────────────────────────────

export async function searchWheels(filters: CTWheelFilters = {}): Promise<CTWheelProduct[]> {
  console.log('🔍 Searching wheels...', filters);
  return ctPost<CTWheelProduct[]>('wheelSearch', {
    customerId:    CONFIG.customerId,
    customerToken: CONFIG.customerToken,
    filters: {
      bolt_pattern: filters.bolt_pattern ?? '',
      offSet:       filters.offSet       ?? '',
      centreBore:   filters.centreBore   ?? '',
      rimDiameter:  filters.rimDiameter  ?? '',
      width:        filters.width        ?? '',
      size:         filters.size         ?? '',
      aspectRatio:  filters.aspectRatio  ?? '',
      brand:        filters.brand        ?? '',
      partNumber:   filters.partNumber   ?? [],
      isWinter:     filters.isWinter     ?? '',
      isRunFlat:    filters.isRunFlat    ?? '',
      searchKey:    filters.searchKey    ?? '',
      page:         filters.page         ?? '',
    },
  });
}

// ─── 3. USER SHIP-TO ADDRESSES ───────────────────────────────────────────────

export async function getShipToAddresses(): Promise<CTShipToAddress[]> {
  console.log('📫 Fetching ship-to addresses...');
  return ctPost<CTShipToAddress[]>('shipToAddresses', {
    customerId:    CONFIG.customerId,
    customerToken: CONFIG.customerToken,
  });
}

// ─── 4. SUBMIT ORDER ─────────────────────────────────────────────────────────

export interface CTOrderResponse {
  id:           string;
  orderNumber:  string;
  orderTotal:   string;
  salesTax:     string;
  tireTax:      string;
  shippingCost: string;
  items: {
    partNumber: string;
    quantity:   number;
    itemTotal:  string;
  }[];
}

export async function submitOrder(orderDetails: CTOrderDetails): Promise<CTOrderResponse> {
  console.log('🛒 Submitting order:', orderDetails.poNumber);

  // Validate address before sending
  if (!orderDetails.shipping.addrId) {
    const addrErrors = validateShipping(orderDetails.shipping);
    if (addrErrors.length > 0) throw new Error(`Address validation failed: ${addrErrors.join(', ')}`);
  }

  return ctPost<CTOrderResponse>('submitOrder', {
    customerId:    CONFIG.customerId,
    customerToken: CONFIG.customerToken,
    orderDetails: {
      poNumber:  orderDetails.poNumber,
      location:  orderDetails.location,
      email:     orderDetails.email  || '',
      phone:     orderDetails.phone  || '',
      shipping:  orderDetails.shipping,
      items:     orderDetails.items,
    },
  });
}

// ─── 5. UPDATE ORDER ADDRESS ─────────────────────────────────────────────────

export async function updateOrderAddress(
  soId: number,
  shipping: CTShipping
): Promise<{ soId: number }> {
  console.log('📦 Updating order address for soId:', soId);

  if (!shipping.addrId) {
    const errors = validateShipping(shipping);
    if (errors.length > 0) throw new Error(`Address validation failed: ${errors.join(', ')}`);
  }

  return ctPost<{ soId: number }>('updateOrderAddr', {
    customerId:    CONFIG.customerId,
    customerToken: CONFIG.customerToken,
    orderDetails: { soId, shipping },
  });
}

// ─── INVENTORY HELPERS ────────────────────────────────────────────────────────

export const getTotalInventory = (p: CTTireProduct | CTWheelProduct) =>
  p.inventory.reduce((sum, l) => sum + l.quantity, 0);

export const isInStock = (p: CTTireProduct | CTWheelProduct) =>
  getTotalInventory(p) > 0;

/**
 * Best warehouse for Rouyn-Noranda customers
 * Priority: Sherbrooke → Levis → Valleyfield → any with stock
 */
export function getClosestWarehouse(
  p: CTTireProduct | CTWheelProduct
): CTInventoryLocation | null {
  const preferred = ['Sherbrooke', 'Levis', 'Valleyfield'];
  for (const name of preferred) {
    const loc = p.inventory.find(l => l.location === name && l.quantity > 0);
    if (loc) return loc;
  }
  return p.inventory.find(l => l.quantity > 0) || null;
}

// ─── TRANSFORMER — CT → AI Match TireProduct format ──────────────────────────

export function transformToAIMatchProduct(ct: CTTireProduct) {
  // Normalize size: "2,355,019" → "235/50/19"
  const size = ct.size.toString().replace(/,/g, '/');

  const features: string[] = [];
  if (ct.isWinter)            features.push('Winter certified (3PMSF)');
  if (ct.isRunFlat)           features.push('Run-flat technology');
  if (ct.performanceCategory) features.push(`${ct.performanceCategory} performance`);

  return {
    // Standard AI Match fields
    id:              ct.partNumber,
    title:           ct.name,
    brand:           ct.brand,
    model:           ct.model,
    size,
    season:          ct.isWinter ? 'Winter' : 'All-Season',
    pricePerUnit:    parseFloat(ct.msrp) || 0,
    rating:          4.5,
    reviews:         0,
    imageUrl:        '',     // populated by Shopify / CDN
    description:     `${ct.brand} ${ct.model} – ${size}`,
    features,
    inStock:         isInStock(ct),
    warranty:        '6-year limited',
    speedRating:     'H',
    loadIndex:       '94',
    shopifyVariantId: '',
    shopifyHandle:    '',
    // CT-specific fields
    ctPartNumber:    ct.partNumber,
    isRunFlat:       ct.isRunFlat,
    isWinter:        ct.isWinter,
    performanceCategory: ct.performanceCategory,
    stockQty:        getTotalInventory(ct),
    closestWarehouse: getClosestWarehouse(ct),
    inventory:       ct.inventory,
    // ⚠️ PRIVATE — never expose cost to frontend
    _cost:           parseFloat(ct.cost) || 0,
  };
}

// ─── ADDRESS VALIDATION ───────────────────────────────────────────────────────

const PROVINCES = ['AB','BC','MB','NB','NL','NS','NT','NU','ON','PE','QC','SK','YT',
                   'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL',
                   'IN','IA','KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT',
                   'NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI',
                   'SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY'];
const COUNTRIES = ['CA', 'US'];

export function validateShipping(s: CTShipping): string[] {
  const errors: string[] = [];
  if (!s.addr1)      errors.push('addr1 is required');
  if (!s.postalCode) errors.push('postalCode is required');
  if (!s.province || !PROVINCES.includes(s.province))
    errors.push(`province must be an uppercase code (e.g. QC, ON). Got: "${s.province}"`);
  if (!s.country || !COUNTRIES.includes(s.country))
    errors.push(`country must be CA or US. Got: "${s.country}"`);
  return errors;
}

// ─── PO NUMBER GENERATOR ──────────────────────────────────────────────────────
// Creates a unique PO number for each GCI order

export function generatePONumber(): string {
  const ts   = Date.now().toString(36).toUpperCase();
  const rand = Math.random().toString(36).substring(2, 6).toUpperCase();
  return `GCI-${ts}-${rand}`;
}

// ─── VERCEL API HANDLER  /api/canadianTire?action=xxx ────────────────────────

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')
    return res.status(405).json({ error: 'Use POST' });

  const { action } = req.query;

  try {
    switch (action) {

      // ── Connection test ──────────────────────────────────────────────────
      case 'test': {
        const tires = await searchTiresOnly({ page: 1 });
        return res.status(200).json({
          success: true,
          message: '✅ Canada Tire API connected!',
          environment: CONFIG.useSandbox ? 'SANDBOX' : 'PRODUCTION',
          tireSampleCount: tires.length,
          sample: tires[0]
            ? { partNumber: tires[0].partNumber, name: tires[0].name, msrp: tires[0].msrp }
            : null,
        });
      }

      // ── Search tires ──────────────────────────────────────────────────────
      case 'tires': {
        const tires = await searchTiresOnly(req.body?.filters);
        return res.status(200).json({ success: true, count: tires.length, data: tires });
      }

      // ── Search tires by size ──────────────────────────────────────────────
      case 'tires-by-size': {
        const { width, aspectRatio, rimSize } = req.body || {};
        if (!width || !aspectRatio || !rimSize)
          return res.status(400).json({ error: 'width, aspectRatio, rimSize required' });
        const tires = await searchTiresBySize(width, aspectRatio, rimSize);
        return res.status(200).json({ success: true, count: tires.length, data: tires });
      }

      // ── Search winter tires ───────────────────────────────────────────────
      case 'winter-tires': {
        const tires = await searchWinterTires(req.body?.filters);
        return res.status(200).json({ success: true, count: tires.length, data: tires });
      }

      // ── Search wheels ─────────────────────────────────────────────────────
      case 'wheels': {
        const wheels = await searchWheels(req.body?.filters);
        return res.status(200).json({ success: true, count: wheels.length, data: wheels });
      }

      // ── Products in AI Match format ───────────────────────────────────────
      case 'ai-match-products': {
        const tires = await searchTiresOnly(req.body?.filters);
        const data  = tires.map(transformToAIMatchProduct).map(p => {
          const { _cost, ...safe } = p;  // strip supplier cost before sending to frontend
          return safe;
        });
        return res.status(200).json({ success: true, count: data.length, data });
      }

      // ── Get saved ship-to addresses ───────────────────────────────────────
      case 'addresses': {
        const addresses = await getShipToAddresses();
        return res.status(200).json({ success: true, data: addresses });
      }

      // ── Submit an order ───────────────────────────────────────────────────
      case 'submit-order': {
        const { orderDetails } = req.body || {};
        if (!orderDetails)
          return res.status(400).json({ error: 'orderDetails is required' });
        if (!orderDetails.location)
          return res.status(400).json({ error: 'orderDetails.location is required' });
        if (!orderDetails.items?.length)
          return res.status(400).json({ error: 'orderDetails.items cannot be empty' });

        // Auto-generate PO number if not provided
        if (!orderDetails.poNumber) {
          orderDetails.poNumber = generatePONumber();
        }

        const order = await submitOrder(orderDetails);
        return res.status(200).json({ success: true, data: order });
      }

      // ── Update order shipping address ─────────────────────────────────────
      case 'update-order-address': {
        const { soId, shipping } = req.body || {};
        if (!soId)     return res.status(400).json({ error: 'soId is required' });
        if (!shipping) return res.status(400).json({ error: 'shipping is required' });

        const result = await updateOrderAddress(soId, shipping);
        return res.status(200).json({ success: true, data: result });
      }

      default:
        return res.status(400).json({
          error: 'Unknown action',
          available: [
            'test',
            'tires',
            'tires-by-size',
            'winter-tires',
            'wheels',
            'ai-match-products',
            'addresses',
            'submit-order',
            'update-order-address',
          ],
        });
    }
  } catch (err: any) {
    console.error('❌ Canada Tire API error:', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
}
