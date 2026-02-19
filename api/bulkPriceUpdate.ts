// api/bulkPriceUpdate.ts
// ============================================================
// Shopify Bulk Price Updater — Fixed Margin Model
//
// Fetches REAL dealer costs from Canada Tire API, then applies:
//   selling_price = real_ct_cost + $30 profit + shipping_buffer
//   compare_at    = MSRP (strikethrough price)
//
// Actions:
//   GET /api/bulkPriceUpdate?action=price-preview   — Show proposed changes (dry run)
//   GET /api/bulkPriceUpdate?action=price-execute    — Update Shopify + log to Sheet
//   GET /api/bulkPriceUpdate?action=price-history    — View recent price change log
// ============================================================

import crypto from 'crypto';
import type { VercelRequest, VercelResponse } from '@vercel/node';

// ─── CONFIG ───────────────────────────────────────────────────────────────────

const SHOPIFY = {
  domain: process.env.SHOPIFY_STORE_DOMAIN || '',
  token:  process.env.SHOPIFY_ADMIN_ACCESS_TOKEN || '',
  apiVersion: '2024-01',
  get baseUrl() {
    return `https://${this.domain}/admin/api/${this.apiVersion}`;
  },
};

// ─── CANADA TIRE API ─────────────────────────────────────────────────────────

const CT = {
  consumerKey:    process.env.CT_CONSUMER_KEY       || '',
  consumerSecret: process.env.CT_CONSUMER_SECRET    || '',
  tokenId:        process.env.CT_TOKEN_ID           || '',
  tokenSecret:    process.env.CT_TOKEN_SECRET       || '',
  realm:          process.env.CT_REALM              || '8031691',
  customerId:     process.env.CT_CUSTOMER_NUMBER    || '19997',
  customerToken:  process.env.CT_CUSTOMER_API_TOKEN || '',
  useSandbox:     process.env.CT_USE_SANDBOX !== 'false',
  get baseUrl() {
    return this.useSandbox
      ? 'https://8031691-sb1.restlets.api.netsuite.com/app/site/hosting/restlet.nl'
      : 'https://8031691.restlets.api.netsuite.com/app/site/hosting/restlet.nl';
  },
};

const CT_SCRIPT  = 'customscript_item_search_rl';
const CT_DEPLOY  = 'customdeploy_item_search_rl';

function pct(s: string): string {
  return encodeURIComponent(s)
    .replace(/!/g,'%21').replace(/'/g,'%27')
    .replace(/\(/g,'%28').replace(/\)/g,'%29').replace(/\*/g,'%2A');
}

function buildAuthHeader(): string {
  const ts = Math.floor(Date.now() / 1000).toString();
  const nc = crypto.randomBytes(16).toString('hex');
  const sigParams: Record<string,string> = {
    deploy: CT_DEPLOY, oauth_consumer_key: CT.consumerKey,
    oauth_nonce: nc, oauth_signature_method: 'HMAC-SHA256',
    oauth_timestamp: ts, oauth_token: CT.tokenId, oauth_version: '1.0',
    script: CT_SCRIPT,
  };
  const paramStr   = Object.keys(sigParams).sort().map(k => `${pct(k)}=${pct(sigParams[k])}`).join('&');
  const base       = ['POST', pct(CT.baseUrl), pct(paramStr)].join('&');
  const signingKey = `${pct(CT.consumerSecret)}&${pct(CT.tokenSecret)}`;
  const sig        = crypto.createHmac('sha256', signingKey).update(base).digest('base64');
  return [
    `OAuth realm="${CT.realm}"`, `oauth_consumer_key="${CT.consumerKey}"`,
    `oauth_token="${CT.tokenId}"`, `oauth_signature_method="HMAC-SHA256"`,
    `oauth_timestamp="${ts}"`, `oauth_nonce="${nc}"`, `oauth_version="1.0"`,
    `oauth_signature="${pct(sig)}"`,
  ].join(', ');
}

interface CTCostEntry { cost: number; msrp: number; performanceCategory: string; size: string; }

async function fetchCTCostMap(): Promise<Map<string, CTCostEntry>> {
  const map = new Map<string, CTCostEntry>();
  try {
    const fullUrl = `${CT.baseUrl}?script=${CT_SCRIPT}&deploy=${CT_DEPLOY}`;
    const res = await fetch(fullUrl, {
      method: 'POST',
      headers: {
        'Authorization': buildAuthHeader(),
        'Content-Type':  'application/json',
        'Accept':        'application/json',
      },
      body: JSON.stringify({
        customerId: CT.customerId, customerToken: CT.customerToken,
        filters: { width:'', rimSize:'', aspectRatio:'', size:'',
          partNumber:[], brand:'', searchKey:'',
          isWinter:'', isRunFlat:'', isTire:true, isWheel:false, page:1 },
      }),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`CT API HTTP ${res.status}: ${text.slice(0, 300)}`);
    const data: any = JSON.parse(text);
    if (!data.success) throw new Error(`CT API returned success=false: ${text.slice(0, 300)}`);
    for (const t of (data.data || [])) {
      const cost = parseFloat(t.cost) || 0;
      const msrp = parseFloat(t.msrp) || 0;
      if (cost > 0 && msrp > 0 && cost < msrp * 0.90) {
        map.set(t.partNumber.trim().toUpperCase(), { cost, msrp, performanceCategory: t.performanceCategory || '', size: t.size || '' });
      }
    }
    console.log(`📦 CT cost map loaded: ${map.size} SKUs with valid costs`);
  } catch (err: any) {
    console.error(`⚠️ CT API unavailable, falling back to Shopify stored costs: ${err.message}`);
  }
  return map;
}

const PRICING = {
  netMultiplier: 0.50,
  fixedProfit: 30,        // $30 fixed profit per tire — non-negotiable

  shippingBuffers: {
    passenger:   35,
    light_truck: 40,
    heavy_truck: 50,
  } as Record<string, number>,
};

const SHEETS_CONFIG = {
  sheetName: process.env.PRICE_MONITOR_SHEET_NAME || 'GCI Tires - Price Monitor',
  logSheetName: 'Price Updates Log',
};

// ─── SHOPIFY API HELPERS ──────────────────────────────────────────────────────

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function shopifyFetch<T>(
  endpoint: string,
  method: 'GET' | 'POST' | 'PUT' = 'GET',
  body?: unknown
): Promise<T> {
  const url = `${SHOPIFY.baseUrl}${endpoint}`;

  const res = await fetch(url, {
    method,
    headers: {
      'X-Shopify-Access-Token': SHOPIFY.token,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

  if (res.status === 429) {
    const retryAfter = parseFloat(res.headers.get('Retry-After') || '2');
    console.log(`⏳ Rate limited, waiting ${retryAfter}s...`);
    await sleep(retryAfter * 1000);
    return shopifyFetch<T>(endpoint, method, body);
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Shopify ${res.status} on ${endpoint}: ${text.slice(0, 200)}`);
  }

  if (res.status === 204 || res.headers.get('content-length') === '0') return {} as T;
  return res.json();
}

// ─── GOOGLE SHEETS — RAW FETCH (zero dependencies) ───────────────────────────
// Uses service account JWT → access token → Sheets REST API via fetch().
// No googleapis package required.

interface SheetsClient {
  readSheet: (sheetName: string) => Promise<string[][]>;
  appendRows: (sheetName: string, rows: string[][]) => Promise<void>;
}

/** Base64url encode (no padding, URL-safe) */
function b64url(input: string | Buffer): string {
  const buf = typeof input === 'string' ? Buffer.from(input) : input;
  return buf.toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

/** Create a signed JWT for Google service account auth */
function createJWT(email: string, privateKey: string, scopes: string[]): string {
  const now = Math.floor(Date.now() / 1000);

  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = b64url(JSON.stringify({
    iss: email,
    scope: scopes.join(' '),
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  }));

  const signatureInput = `${header}.${payload}`;
  const signature = crypto.createSign('RSA-SHA256').update(signatureInput).sign(privateKey, 'base64')
    .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');

  return `${signatureInput}.${signature}`;
}

/** Exchange JWT for an access token */
async function getAccessToken(email: string, privateKey: string): Promise<string> {
  const jwt = createJWT(email, privateKey, [
    'https://www.googleapis.com/auth/spreadsheets',
    'https://www.googleapis.com/auth/drive.readonly',
  ]);

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Google token exchange failed (${res.status}): ${text}`);
  }

  const data: any = await res.json();
  return data.access_token;
}

/** Generic Google API fetch with Bearer token */
async function googleFetch(url: string, token: string, options: RequestInit = {}): Promise<any> {
  const res = await fetch(url, {
    ...options,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Google API ${res.status}: ${text.slice(0, 300)}`);
  }

  if (res.status === 204) return {};
  return res.json();
}

/** Find spreadsheet ID by name via Drive API */
async function findSpreadsheetId(name: string, token: string): Promise<string | null> {
  const q = encodeURIComponent(`name = '${name}' and mimeType = 'application/vnd.google-apps.spreadsheet'`);
  const data = await googleFetch(
    `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name)&spaces=drive`,
    token
  );
  return data.files?.[0]?.id || null;
}

async function createSheetsClient(): Promise<SheetsClient | null> {
  const credsJson = process.env.GOOGLE_SHEETS_CREDENTIALS;
  if (!credsJson) {
    console.warn('⚠️ GOOGLE_SHEETS_CREDENTIALS not set — Sheet logging disabled');
    return null;
  }

  try {
    const creds = JSON.parse(credsJson);
    const token = await getAccessToken(creds.client_email, creds.private_key);

    // Find the spreadsheet by name
    const spreadsheetId = await findSpreadsheetId(SHEETS_CONFIG.sheetName, token);
    if (!spreadsheetId) {
      console.warn(`⚠️ Spreadsheet "${SHEETS_CONFIG.sheetName}" not found in Drive`);
      return null;
    }
    console.log(`📊 Found spreadsheet: ${SHEETS_CONFIG.sheetName} (${spreadsheetId})`);

    const SHEETS_BASE = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}`;

    return {
      readSheet: async (sheetName: string): Promise<string[][]> => {
        try {
          const range = encodeURIComponent(`'${sheetName}'`);
          const data = await googleFetch(`${SHEETS_BASE}/values/${range}`, token);
          return (data.values as string[][]) || [];
        } catch (err: any) {
          console.warn(`⚠️ Could not read sheet "${sheetName}": ${err.message}`);
          return [];
        }
      },

      appendRows: async (sheetName: string, rows: string[][]): Promise<void> => {
        // Ensure the sheet/tab exists
        try {
          const meta = await googleFetch(SHEETS_BASE, token);
          const existing = (meta.sheets || []).map((s: any) => s.properties?.title);

          if (!existing.includes(sheetName)) {
            // Create the tab
            await googleFetch(SHEETS_BASE + ':batchUpdate', token, {
              method: 'POST',
              body: JSON.stringify({
                requests: [{ addSheet: { properties: { title: sheetName } } }],
              }),
            });

            // Add headers
            const headerRange = encodeURIComponent(`'${sheetName}'!A1`);
            await googleFetch(
              `${SHEETS_BASE}/values/${headerRange}?valueInputOption=RAW`,
              token,
              {
                method: 'PUT',
                body: JSON.stringify({
                  values: [[
                    'Timestamp', 'SKU', 'Title', 'Size',
                    'Old Price', 'New Price', 'MSRP', 'Net Cost',
                    'Profit', 'Shipping', 'Customer Savings',
                    'Change ($)', 'Change (%)', 'Reason',
                  ]],
                }),
              }
            );
          }
        } catch (err: any) {
          console.warn(`⚠️ Sheet setup error: ${err.message}`);
        }

        // Append the data rows
        const appendRange = encodeURIComponent(`'${sheetName}'!A:N`);
        await googleFetch(
          `${SHEETS_BASE}/values/${appendRange}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
          token,
          {
            method: 'POST',
            body: JSON.stringify({ values: rows }),
          }
        );
      },
    };
  } catch (err: any) {
    console.error(`❌ Google Sheets init failed: ${err.message}`);
    return null;
  }
}

// ─── READ COMPETITOR DATA FROM GOOGLE SHEETS ──────────────────────────────────
// Reads the Summary tab and builds TWO lookup maps:
//   1. By SKU / CT part number (direct match)
//   2. By normalized brand+model+size key (fuzzy match to Shopify titles)

interface CompetitorData {
  bySku: Map<string, number>;           // "VRED-WINTRAC-195-45R16" → lowest price
  byBrandModelSize: Map<string, number>; // "vredestein-wintrac-19545r16" → lowest price
}

/** Normalize brand+model+size into a comparable key */
function normalizeTireKey(brand: string, model: string, size: string): string {
  return [brand, model, size]
    .join('-')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')  // strip everything except letters and digits
    .trim();
}

/** Extract brand+model+size key from a Shopify product title like "COOPER COBRA INSTINCT 2154517/R" */
function keyFromTitle(title: string): string {
  return (title || '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .trim();
}

async function readCompetitorPrices(
  sheetsClient: SheetsClient
): Promise<CompetitorData> {
  const data: CompetitorData = {
    bySku: new Map(),
    byBrandModelSize: new Map(),
  };

  const rows = await sheetsClient.readSheet('Summary');
  if (rows.length < 2) {
    console.warn('⚠️ Summary sheet is empty or has no data rows');
    return data;
  }

  // Find column indices from header row
  const headers = rows[0].map(h => h.toLowerCase().trim());
  const skuIdx    = headers.findIndex(h => h.includes('sku'));
  const ctPartIdx = headers.findIndex(h => h.includes('ct part'));
  const brandIdx  = headers.findIndex(h => h.includes('brand'));
  const modelIdx  = headers.findIndex(h => h.includes('model'));
  const sizeIdx   = headers.findIndex(h => h.includes('size') && !h.includes('msrp'));
  const lowestIdx = headers.findIndex(h => h.includes('lowest'));

  if (lowestIdx === -1) {
    console.warn('⚠️ Could not find Lowest Competitor column in Summary sheet');
    return data;
  }

  console.log(`📊 Sheet columns found — SKU:${skuIdx} CTPart:${ctPartIdx} Brand:${brandIdx} Model:${modelIdx} Size:${sizeIdx} Lowest:${lowestIdx}`);

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row) continue;

    const priceStr = (row[lowestIdx] || '').replace(/[$,]/g, '').trim();
    const price = parseFloat(priceStr);
    if (isNaN(price) || price <= 0) continue;

    // Map 1a: by monitor SKU (e.g. "VRED-WINTRAC-195-45R16")
    if (skuIdx !== -1 && row[skuIdx]) {
      const sku = row[skuIdx].trim().toUpperCase();
      data.bySku.set(sku, price);
    }

    // Map 1b: by CT part number (e.g. "AP19555016HWTRA02") — direct match to Shopify SKU
    if (ctPartIdx !== -1 && row[ctPartIdx]) {
      const ctPart = row[ctPartIdx].trim().toUpperCase();
      data.bySku.set(ctPart, price);
    }

    // Map 2: by brand+model+size (if columns exist)
    if (brandIdx !== -1 && modelIdx !== -1 && sizeIdx !== -1) {
      const brand = row[brandIdx] || '';
      const model = row[modelIdx] || '';
      const size  = row[sizeIdx]  || '';
      if (brand && size) {
        const key = normalizeTireKey(brand, model, size);
        data.byBrandModelSize.set(key, price);
      }
    }
  }

  console.log(`📊 Competitor prices loaded — bySku: ${data.bySku.size}, byBrandModelSize: ${data.byBrandModelSize.size}`);
  return data;
}

/** Look up competitor price for a Shopify product using all available matching methods */
function findCompetitorPrice(
  product: ShopifyProductForPricing,
  compData: CompetitorData,
): number | null {
  // Method 1: Direct SKU match (works if price monitor uses same CT part numbers)
  const bySkuPrice = compData.bySku.get(product.sku);
  if (bySkuPrice) {
    console.log(`  ✅ SKU match: ${product.sku} → $${bySkuPrice}`);
    return bySkuPrice;
  }

  // Method 2: Brand+model+size match from Shopify title
  const titleKey = keyFromTitle(product.title);
  for (const [sheetKey, price] of compData.byBrandModelSize) {
    // Check if title contains the brand+model+size key (handles extra words in title)
    if (titleKey.includes(sheetKey) || sheetKey.includes(titleKey)) {
      console.log(`  ✅ Title match: "${product.title}" ↔ key "${sheetKey}" → $${price}`);
      return price;
    }
  }

  return null;
}

// ─── GET ALL SHOPIFY PRODUCTS WITH COST DATA ──────────────────────────────────

interface ShopifyProductForPricing {
  productId: number;
  variantId: number;
  sku: string;
  title: string;
  currentPrice: number;
  compareAtPrice: number | null;
  cost: number;
  // From metafields (if available)
  tireType: string;
  floorPrice: number;
  netCost: number;
  shippingBuffer: number;
}

async function getShopifyProductsForPricing(ctCosts: Map<string, CTCostEntry>): Promise<ShopifyProductForPricing[]> {
  const products: ShopifyProductForPricing[] = [];
  let hasMore = true;
  let url = '/products.json?tag=ct-sync&limit=250';
  let page = 1;

  while (hasMore) {
    const res = await shopifyFetch<{ products: any[] }>(url);

    for (const p of res.products) {
      for (const v of p.variants || []) {
        if (!v.sku) continue;

        const sku = v.sku.trim().toUpperCase();
        const shopifyMsrp = parseFloat(v.compare_at_price) || parseFloat(v.price) || 0;

        // PRIMARY: use real CT cost from API
        const ctEntry = ctCosts.get(sku);
        let netCost: number;
        let msrp: number;

        if (ctEntry) {
          netCost = ctEntry.cost;
          msrp = ctEntry.msrp || shopifyMsrp;
        } else {
          // Fallback: estimate from MSRP
          msrp = shopifyMsrp;
          netCost = msrp * PRICING.netMultiplier;
        }

        // Determine tire type — prefer CT data, fall back to Shopify tags
        let tireType = 'passenger';
        if (ctEntry) {
          const cat = (ctEntry.performanceCategory || '').toLowerCase();
          const sz  = (ctEntry.size || '').toString();
          if (cat.includes('commercial') || cat.includes('heavy') || cat.includes('medium truck') ||
              cat.includes('steer') || cat.includes('drive') || cat.includes('trailer')) {
            tireType = 'heavy_truck';
          } else if (cat.includes('light truck') || cat.includes('suv') || cat.includes('crossover') ||
                     cat.includes('all-terrain') || cat.includes('all terrain') || cat.includes('mud') ||
                     sz.startsWith('LT')) {
            tireType = 'light_truck';
          }
        } else {
          const tags = (p.tags || '').toLowerCase();
          if (tags.includes('tire-type-heavy_truck') || tags.includes('tire-type-heavy-truck')) {
            tireType = 'heavy_truck';
          } else if (tags.includes('tire-type-light_truck') || tags.includes('tire-type-light-truck')) {
            tireType = 'light_truck';
          }
        }

        const shippingBuffer = PRICING.shippingBuffers[tireType] ?? 35;
        const floorPrice = netCost + shippingBuffer;

        products.push({
          productId: p.id,
          variantId: v.id,
          sku: v.sku.trim().toUpperCase(),
          title: p.title,
          currentPrice: parseFloat(v.price) || 0,
          compareAtPrice: v.compare_at_price ? parseFloat(v.compare_at_price) : null,
          cost: netCost,
          tireType,
          floorPrice,
          netCost,
          shippingBuffer,
        });
      }
    }

    console.log(`  Page ${page}: ${res.products.length} products`);

    if (res.products.length < 250) {
      hasMore = false;
    } else {
      const lastId = res.products[res.products.length - 1]?.id;
      url = `/products.json?limit=250&since_id=${lastId}`;
      page++;
      await sleep(500);
    }
  }

  console.log(`📦 Loaded ${products.length} Shopify variants for pricing`);
  return products;
}

// ─── CALCULATE PRICE — FIXED MARGIN MODEL ────────────────────────────────────
// Formula: selling_price = net_cost + fixed_profit + shipping_buffer
// Every tire guarantees $30 profit. Period.

interface PriceRecommendation {
  sku: string;
  title: string;
  variantId: number;
  productId: number;
  currentPrice: number;
  msrp: number;
  netCost: number;
  shippingBuffer: number;
  fixedProfit: number;
  sellingPrice: number;
  savings: number;       // MSRP - sellingPrice (what customer saves)
  savingsPct: number;
  changeAmount: number;
  changePct: number;
  reason: string;
  action: 'lower' | 'raise' | 'no-change';
}

function calculatePrice(
  product: ShopifyProductForPricing,
  manualOverride?: number
): PriceRecommendation {
  const msrp = product.compareAtPrice || product.currentPrice;
  const { netCost, shippingBuffer } = product;
  const profit = PRICING.fixedProfit;

  let sellingPrice: number;
  let reason: string;

  if (manualOverride && manualOverride > 0) {
    sellingPrice = manualOverride;
    reason = `Manual override → $${manualOverride.toFixed(2)}`;
  } else {
    // Fixed margin: net cost + $30 profit + shipping
    sellingPrice = netCost + profit + shippingBuffer;
    reason = `$${netCost.toFixed(0)} cost + $${profit} profit + $${shippingBuffer} ship`;
  }

  // Round to .99 for cleaner retail look
  sellingPrice = Math.floor(sellingPrice) + 0.99;

  // Safety: never sell below cost + shipping (even with manual override)
  const absolute_floor = netCost + shippingBuffer;
  if (sellingPrice < absolute_floor) {
    sellingPrice = Math.ceil(absolute_floor) + 0.99;
    reason += ` (raised to cover cost+ship)`;
  }

  const savings     = msrp - sellingPrice;
  const savingsPct  = msrp > 0 ? (savings / msrp) * 100 : 0;
  const changeAmount = sellingPrice - product.currentPrice;
  const changePct   = product.currentPrice > 0 ? (changeAmount / product.currentPrice) * 100 : 0;

  let action: PriceRecommendation['action'] = 'no-change';
  if (Math.abs(changeAmount) >= 0.02) {
    action = changeAmount < 0 ? 'lower' : 'raise';
  }

  return {
    sku: product.sku,
    title: product.title,
    variantId: product.variantId,
    productId: product.productId,
    currentPrice: product.currentPrice,
    msrp,
    netCost,
    shippingBuffer,
    fixedProfit: profit,
    sellingPrice: Math.round(sellingPrice * 100) / 100,
    savings:     Math.round(savings * 100) / 100,
    savingsPct:  Math.round(savingsPct * 10) / 10,
    changeAmount: Math.round(changeAmount * 100) / 100,
    changePct:   Math.round(changePct * 10) / 10,
    reason,
    action,
  };
}

// ─── UPDATE SHOPIFY VARIANT PRICE ─────────────────────────────────────────────

async function updateVariantPrice(
  variantId: number,
  price: number,
  compareAtPrice: number
): Promise<void> {
  await shopifyFetch(
    `/variants/${variantId}.json`,
    'PUT',
    {
      variant: {
        id: variantId,
        price: price.toFixed(2),
        compare_at_price: compareAtPrice.toFixed(2),
      },
    }
  );
}

// ─── LOG CHANGES TO GOOGLE SHEETS ─────────────────────────────────────────────

async function logChangesToSheet(
  sheetsClient: SheetsClient | null,
  changes: PriceRecommendation[]
): Promise<void> {
  if (!sheetsClient || changes.length === 0) return;

  const timestamp = new Date().toISOString().replace('T', ' ').substring(0, 19);

  const rows = changes.map(c => [
    timestamp,
    c.sku,
    c.title.substring(0, 50),
    '',
    `$${c.currentPrice.toFixed(2)}`,
    `$${c.sellingPrice.toFixed(2)}`,
    `$${c.msrp.toFixed(2)}`,
    `$${c.netCost.toFixed(2)}`,
    `$${c.fixedProfit.toFixed(2)}`,
    `$${c.shippingBuffer.toFixed(2)}`,
    `$${c.savings.toFixed(2)} (${c.savingsPct.toFixed(0)}% off)`,
    `${c.changeAmount >= 0 ? '+' : ''}$${c.changeAmount.toFixed(2)}`,
    `${c.changePct >= 0 ? '+' : ''}${c.changePct.toFixed(1)}%`,
    c.reason,
  ]);

  try {
    await sheetsClient.appendRows(SHEETS_CONFIG.logSheetName, rows);
    console.log(`📝 Logged ${rows.length} price changes to "${SHEETS_CONFIG.logSheetName}"`);
  } catch (err: any) {
    console.error(`❌ Failed to log to Sheet: ${err.message}`);
  }
}

// ─── MAIN PRICE UPDATE LOGIC ──────────────────────────────────────────────────

interface PriceUpdateResult {
  totalProducts: number;
  withCompetitorData: number;
  priceChanges: number;
  unchanged: number;
  updated: number;
  failed: number;
  errors: Array<{ sku: string; error: string }>;
  recommendations: PriceRecommendation[];
}

async function runPriceUpdate(
  dryRun: boolean,
  manualPrices?: Record<string, number>,
  offset: number = 0,
  chunkSize: number = 200    // ~200 updates in under 5 min at 600ms each
): Promise<PriceUpdateResult & { offset: number; chunkSize: number; done: boolean }> {
  const result: PriceUpdateResult & { offset: number; chunkSize: number; done: boolean } = {
    totalProducts: 0,
    withCompetitorData: 0,
    priceChanges: 0,
    unchanged: 0,
    updated: 0,
    failed: 0,
    errors: [],
    recommendations: [],
    offset,
    chunkSize,
    done: false,
  };

  // 1. Fetch real costs from Canada Tire API
  const ctCosts = await fetchCTCostMap();

  // 2. Get all Shopify products (enriched with CT costs)
  const shopifyProducts = await getShopifyProductsForPricing(ctCosts);
  result.totalProducts = shopifyProducts.length;

  // 2. Calculate fixed-margin price for each product
  const allRecs: PriceRecommendation[] = [];
  for (const product of shopifyProducts) {
    const manualPrice = manualPrices?.[product.sku] ?? manualPrices?.[product.sku.toLowerCase()];
    allRecs.push(calculatePrice(product, manualPrice));
  }

  // 3. Filter to only products that need a change
  const needsUpdate = allRecs.filter(r => Math.abs(r.changeAmount) >= 0.02);
  result.priceChanges = needsUpdate.length;
  result.unchanged = allRecs.length - needsUpdate.length;

  // 4. Slice the chunk for this call
  const chunk = needsUpdate.slice(offset, offset + chunkSize);
  result.done = offset + chunkSize >= needsUpdate.length;
  result.recommendations = chunk;

  console.log(`📦 Total: ${allRecs.length} | Needs update: ${needsUpdate.length} | This chunk: ${chunk.length} (offset ${offset}) | Done after this: ${result.done}`);

  // 5. Apply changes (if not dry run)
  if (!dryRun) {
    const sheetsClient = await createSheetsClient();
    console.log(`🔄 Updating ${chunk.length} prices in Shopify...`);

    for (const rec of chunk) {
      try {
        await updateVariantPrice(
          rec.variantId,
          rec.sellingPrice,
          rec.msrp
        );
        result.updated++;
        await sleep(600);
      } catch (err: any) {
        result.failed++;
        result.errors.push({ sku: rec.sku, error: err.message });
        console.error(`  ❌ ${rec.sku}: ${err.message}`);
      }
    }

    console.log(`✅ Chunk done: ${result.updated} updated, ${result.failed} failed`);

    // 6. Log changes to Google Sheets
    const updated = chunk.filter((_, i) => i < result.updated);
    await logChangesToSheet(sheetsClient, updated);
  }

  return result;
}

// ─── READ PRICE HISTORY FROM GOOGLE SHEETS ────────────────────────────────────

async function getPriceHistory(limit: number = 100): Promise<string[][]> {
  const sheetsClient = await createSheetsClient();
  if (!sheetsClient) return [];

  const rows = await sheetsClient.readSheet(SHEETS_CONFIG.logSheetName);
  if (rows.length <= 1) return rows;  // Just headers or empty

  // Return headers + last N rows
  const headers = rows[0];
  const dataRows = rows.slice(1);
  const recent = dataRows.slice(-limit);
  return [headers, ...recent];
}

// ─── VERCEL API HANDLER ───────────────────────────────────────────────────────

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'OPTIONS') return res.status(200).end();

  // Accept both GET and POST for browser convenience
  const isGet  = req.method === 'GET';
  const isPost = req.method === 'POST';
  if (!isGet && !isPost)
    return res.status(405).json({ error: 'Use GET or POST' });

  if (!SHOPIFY.domain || !SHOPIFY.token) {
    return res.status(500).json({
      error: 'Missing SHOPIFY_STORE_DOMAIN and/or SHOPIFY_ADMIN_ACCESS_TOKEN env vars.',
    });
  }

  const { action } = req.query;

  try {
    switch (action) {

      // ── Debug: show CT costs vs Shopify prices ────────────────────────
      case 'price-debug': {
        const ctCosts = await fetchCTCostMap();
        const products = await getShopifyProductsForPricing(ctCosts);

        // Show 10 sample products with full breakdown
        const sample = products.slice(0, 10).map(p => {
          const ctEntry = ctCosts.get(p.sku);
          const rec = calculatePrice(p);
          return {
            sku: p.sku,
            title: p.title,
            currentPrice: p.currentPrice,
            msrp: p.compareAtPrice,
            netCost: p.netCost,
            costSource: ctEntry ? 'CT_API_REAL' : 'FALLBACK_50PCT',
            ctApiCost: ctEntry?.cost || null,
            shippingBuffer: p.shippingBuffer,
            tireType: p.tireType,
            calculatedPrice: rec.sellingPrice,
            changeAmount: rec.changeAmount,
            reason: rec.reason,
          };
        });

        return res.status(200).json({
          success: true,
          ctCostMapSize: ctCosts.size,
          totalProducts: products.length,
          ctApiWorking: ctCosts.size > 0,
          envCheck: {
            hasConsumerKey: !!CT.consumerKey,
            hasCustomerToken: !!CT.customerToken,
            customerId: CT.customerId,
            sandbox: CT.useSandbox,
            baseUrl: CT.baseUrl,
          },
          sample,
        });
      }

      // ── Preview price changes (dry run) ───────────────────────────────
      case 'price-preview': {
        console.log('👀 Running price update preview...');
        const manualPrices = req.body?.manualPrices || undefined;
        const result = await runPriceUpdate(true, manualPrices);

        // Sort: biggest savings first
        const sorted = [...result.recommendations]
          .filter(r => r.action !== 'no-change')
          .sort((a, b) => a.changeAmount - b.changeAmount);

        return res.status(200).json({
          success: true,
          dryRun: true,
          pricingModel: `Real CT cost + $${PRICING.fixedProfit} profit + shipping`,
          summary: {
            totalProducts: result.totalProducts,
            priceChanges: result.priceChanges,
            unchanged: result.unchanged,
          },
          changes: sorted,
          allRecommendations: result.recommendations,
        });
      }

      // ── Execute price updates (chunked — use offset param for batches) ──
      case 'price-execute': {
        const offset    = parseInt(req.query.offset as string || '0', 10);
        const chunkSize = parseInt(req.query.chunk  as string || '200', 10);
        console.log(`🚀 Executing price updates — offset:${offset} chunk:${chunkSize}`);
        const manualPrices = req.body?.manualPrices || undefined;
        const result = await runPriceUpdate(false, manualPrices, offset, chunkSize);

        return res.status(200).json({
          success: true,
          dryRun: false,
          pricingModel: `Real CT cost + $${PRICING.fixedProfit} profit + shipping`,
          summary: {
            totalProducts: result.totalProducts,
            priceChanges: result.priceChanges,
            updated: result.updated,
            failed: result.failed,
            unchanged: result.unchanged,
          },
          chunk: {
            offset: result.offset,
            chunkSize: result.chunkSize,
            done: result.done,
            nextUrl: result.done ? null : `?action=price-execute&offset=${offset + chunkSize}`,
          },
          errors: result.errors,
        });
      }

      // ── View price change history ─────────────────────────────────────
      case 'price-history': {
        const limit = parseInt(req.body?.limit) || 100;
        const history = await getPriceHistory(limit);

        return res.status(200).json({
          success: true,
          rowCount: history.length,
          data: history,
        });
      }

      // ── Manual price override for specific SKUs ───────────────────────
      case 'price-override': {
        const { sku, price } = req.body || {};
        if (!sku || !price) {
          return res.status(400).json({ error: 'sku and price are required' });
        }

        console.log(`🎯 Manual price override: ${sku} → $${price}`);
        const manualPrices = { [sku]: parseFloat(price) };
        const result = await runPriceUpdate(false, manualPrices);

        const updated = result.recommendations.find(
          r => r.sku === sku.trim().toUpperCase()
        );

        return res.status(200).json({
          success: true,
          updated: updated || null,
          errors: result.errors,
        });
      }

      default:
        return res.status(400).json({
          error: 'Unknown action',
          available: [
            'price-preview',
            'price-execute',
            'price-history',
            'price-override',
          ],
        });
    }
  } catch (err: any) {
    console.error('❌ Bulk price update error:', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
}
