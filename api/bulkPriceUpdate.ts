// api/bulkPriceUpdate.ts
// ============================================================
// Shopify Bulk Price Updater
//
// Reads competitor pricing data, calculates optimal prices using
// the floor price formula, updates Shopify, and logs every change
// to Google Sheets.
//
// Pricing formula:
//   net_cost      = MSRP × 0.50
//   floor_price   = net_cost + shipping_buffer ($35 / $40 / $50)
//   suggested     = lowest_competitor - $2 (never below floor)
//   compare_at    = MSRP (strikethrough price)
//
// Actions:
//   POST /api/bulkPriceUpdate?action=price-preview   — Show proposed changes (dry run)
//   POST /api/bulkPriceUpdate?action=price-execute    — Update Shopify + log to Sheet
//   POST /api/bulkPriceUpdate?action=price-history    — View recent price change log
//
// Env vars required:
//   SHOPIFY_STORE                — e.g. "gcitires.myshopify.com"
//   SHOPIFY_ACCESS_TOKEN         — Admin API token (write_products)
//   GOOGLE_SHEETS_CREDENTIALS    — Service account JSON (same as price monitor)
//   PRICE_MONITOR_SHEET_NAME     — Default: "GCI Tires - Price Monitor"
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

const PRICING = {
  netMultiplier: 0.50,
  undercutAmount: 2.00,  // Undercut lowest competitor by this amount
  minMargin: 5.00,       // Minimum profit margin above floor price

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
                    'Timestamp', 'SKU', 'Brand', 'Size',
                    'Old Price', 'New Price', 'MSRP', 'Net Cost',
                    'Floor Price', 'Lowest Competitor', 'Margin ($)',
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
// Reads the Summary tab from the price monitor spreadsheet

interface CompetitorPriceData {
  sku: string;
  lowestCompetitorPrice: number | null;
}

async function readCompetitorPrices(
  sheetsClient: SheetsClient
): Promise<Map<string, number>> {
  const competitorMap = new Map<string, number>();

  const rows = await sheetsClient.readSheet('Summary');
  if (rows.length < 2) {
    console.warn('⚠️ Summary sheet is empty or has no data rows');
    return competitorMap;
  }

  // Find column indices from header row
  const headers = rows[0].map(h => h.toLowerCase().trim());
  const skuIdx = headers.findIndex(h => h.includes('sku'));
  const lowestIdx = headers.findIndex(h => h.includes('lowest'));

  if (skuIdx === -1 || lowestIdx === -1) {
    console.warn('⚠️ Could not find SKU or Lowest Competitor columns in Summary sheet');
    return competitorMap;
  }

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row || !row[skuIdx]) continue;

    const sku = row[skuIdx].trim().toUpperCase();
    const priceStr = (row[lowestIdx] || '').replace(/[$,]/g, '').trim();
    const price = parseFloat(priceStr);

    if (sku && !isNaN(price) && price > 0) {
      competitorMap.set(sku, price);
    }
  }

  console.log(`📊 Read ${competitorMap.size} competitor prices from Summary sheet`);
  return competitorMap;
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

async function getShopifyProductsForPricing(): Promise<ShopifyProductForPricing[]> {
  const products: ShopifyProductForPricing[] = [];
  let hasMore = true;
  let url = '/products.json?tag=ct-sync&limit=250';
  let page = 1;

  while (hasMore) {
    const res = await shopifyFetch<{ products: any[] }>(url);

    for (const p of res.products) {
      for (const v of p.variants || []) {
        if (!v.sku) continue;

        const msrp = parseFloat(v.compare_at_price) || parseFloat(v.price) || 0;
        const cost = parseFloat(v.cost) || msrp * PRICING.netMultiplier;
        const netCost = cost > 0 ? cost : msrp * PRICING.netMultiplier;

        // Determine tire type from tags (shopifySync adds tire-type-{type} tag)
        let tireType = 'passenger';
        const tags = (p.tags || '').toLowerCase();
        if (tags.includes('tire-type-heavy_truck') || tags.includes('tire-type-heavy-truck')) {
          tireType = 'heavy_truck';
        } else if (tags.includes('tire-type-light_truck') || tags.includes('tire-type-light-truck')) {
          tireType = 'light_truck';
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

// ─── CALCULATE OPTIMAL PRICE ──────────────────────────────────────────────────

interface PriceRecommendation {
  sku: string;
  title: string;
  variantId: number;
  productId: number;
  currentPrice: number;
  msrp: number;
  netCost: number;
  shippingBuffer: number;
  floorPrice: number;
  lowestCompetitor: number | null;
  suggestedPrice: number;
  margin: number;
  changeAmount: number;
  changePct: number;
  reason: string;
  action: 'lower' | 'raise' | 'no-change' | 'no-competitor-data';
}

function calculatePrice(
  product: ShopifyProductForPricing,
  competitorPrice: number | null,
  manualOverride?: number
): PriceRecommendation {
  const msrp = product.compareAtPrice || product.currentPrice;
  const { netCost, shippingBuffer, floorPrice } = product;

  let suggestedPrice: number;
  let reason: string;
  let action: PriceRecommendation['action'];

  if (manualOverride && manualOverride > 0) {
    // Manual override: use specified price but enforce floor
    suggestedPrice = Math.max(manualOverride, floorPrice);
    reason = manualOverride >= floorPrice
      ? `Manual override to $${manualOverride.toFixed(2)}`
      : `Manual override $${manualOverride.toFixed(2)} raised to floor $${floorPrice.toFixed(2)}`;
    action = suggestedPrice !== product.currentPrice ? 'lower' : 'no-change';

  } else if (competitorPrice && competitorPrice > 0) {
    // Competitive pricing: undercut by $2, but never below floor
    const idealPrice = competitorPrice - PRICING.undercutAmount;

    if (idealPrice >= floorPrice + PRICING.minMargin) {
      // Plenty of room: undercut and enjoy margin
      suggestedPrice = Math.round(idealPrice * 100) / 100;
      reason = `Undercut competitor ($${competitorPrice.toFixed(2)}) by $${PRICING.undercutAmount}`;
      action = suggestedPrice < product.currentPrice ? 'lower' : suggestedPrice > product.currentPrice ? 'raise' : 'no-change';

    } else if (idealPrice >= floorPrice) {
      // Tight but doable: price at ideal, thin margin
      suggestedPrice = Math.round(idealPrice * 100) / 100;
      reason = `Tight margin: competitor at $${competitorPrice.toFixed(2)}, floor at $${floorPrice.toFixed(2)}`;
      action = suggestedPrice < product.currentPrice ? 'lower' : suggestedPrice > product.currentPrice ? 'raise' : 'no-change';

    } else {
      // Below floor: can't compete on price alone
      suggestedPrice = floorPrice;
      reason = `❌ Can't undercut: competitor $${competitorPrice.toFixed(2)} below floor $${floorPrice.toFixed(2)}`;
      action = suggestedPrice < product.currentPrice ? 'lower' : suggestedPrice > product.currentPrice ? 'raise' : 'no-change';
    }

  } else {
    // No competitor data: keep current price or set to MSRP
    suggestedPrice = product.currentPrice > 0 ? product.currentPrice : msrp;
    reason = 'No competitor data — price unchanged';
    action = 'no-competitor-data';
  }

  const margin = suggestedPrice - netCost - shippingBuffer;
  const changeAmount = suggestedPrice - product.currentPrice;
  const changePct = product.currentPrice > 0
    ? ((changeAmount / product.currentPrice) * 100)
    : 0;

  return {
    sku: product.sku,
    title: product.title,
    variantId: product.variantId,
    productId: product.productId,
    currentPrice: product.currentPrice,
    msrp,
    netCost,
    shippingBuffer,
    floorPrice,
    lowestCompetitor: competitorPrice,
    suggestedPrice: Math.round(suggestedPrice * 100) / 100,
    margin: Math.round(margin * 100) / 100,
    changeAmount: Math.round(changeAmount * 100) / 100,
    changePct: Math.round(changePct * 10) / 10,
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
    '', // Size (could extract from title)
    `$${c.currentPrice.toFixed(2)}`,
    `$${c.suggestedPrice.toFixed(2)}`,
    `$${c.msrp.toFixed(2)}`,
    `$${c.netCost.toFixed(2)}`,
    `$${c.floorPrice.toFixed(2)}`,
    c.lowestCompetitor ? `$${c.lowestCompetitor.toFixed(2)}` : 'N/A',
    `$${c.margin.toFixed(2)}`,
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
  manualPrices?: Record<string, number>  // SKU → price overrides
): Promise<PriceUpdateResult> {
  const result: PriceUpdateResult = {
    totalProducts: 0,
    withCompetitorData: 0,
    priceChanges: 0,
    unchanged: 0,
    updated: 0,
    failed: 0,
    errors: [],
    recommendations: [],
  };

  // 1. Get all Shopify products
  const shopifyProducts = await getShopifyProductsForPricing();
  result.totalProducts = shopifyProducts.length;

  // 2. Get competitor prices from Google Sheets
  const sheetsClient = await createSheetsClient();
  let competitorPrices = new Map<string, number>();

  if (sheetsClient) {
    competitorPrices = await readCompetitorPrices(sheetsClient);
  }

  // 3. Merge manual price overrides
  if (manualPrices) {
    for (const [sku, price] of Object.entries(manualPrices)) {
      competitorPrices.set(sku.trim().toUpperCase(), price);
    }
  }

  // 4. Calculate recommendations for each product
  for (const product of shopifyProducts) {
    const compPrice = competitorPrices.get(product.sku) ?? null;
    const manualPrice = manualPrices?.[product.sku] ?? manualPrices?.[product.sku.toLowerCase()];

    if (compPrice) result.withCompetitorData++;

    const rec = calculatePrice(product, compPrice, manualPrice);
    result.recommendations.push(rec);

    if (Math.abs(rec.changeAmount) < 0.01) {
      result.unchanged++;
    } else {
      result.priceChanges++;
    }
  }

  // 5. Apply changes (if not dry run)
  if (!dryRun) {
    const toUpdate = result.recommendations.filter(r => Math.abs(r.changeAmount) >= 0.01);
    console.log(`🔄 Updating ${toUpdate.length} prices in Shopify...`);

    for (const rec of toUpdate) {
      try {
        await updateVariantPrice(
          rec.variantId,
          rec.suggestedPrice,
          rec.msrp  // compare_at_price = MSRP (strikethrough)
        );
        result.updated++;
        console.log(`  ✅ ${rec.sku}: $${rec.currentPrice} → $${rec.suggestedPrice} (${rec.reason})`);
        await sleep(600);  // Rate limit
      } catch (err: any) {
        result.failed++;
        result.errors.push({ sku: rec.sku, error: err.message });
        console.error(`  ❌ ${rec.sku}: ${err.message}`);
      }
    }

    // 6. Log all changes to Google Sheets
    await logChangesToSheet(sheetsClient, toUpdate);
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

      // ── Preview price changes (dry run) ───────────────────────────────
      case 'price-preview': {
        console.log('👀 Running price update preview...');
        const manualPrices = req.body?.manualPrices || undefined;
        const result = await runPriceUpdate(true, manualPrices);

        // Sort: biggest savings first
        const sorted = [...result.recommendations]
          .filter(r => r.action !== 'no-change' && r.action !== 'no-competitor-data')
          .sort((a, b) => a.changeAmount - b.changeAmount);

        return res.status(200).json({
          success: true,
          dryRun: true,
          summary: {
            totalProducts: result.totalProducts,
            withCompetitorData: result.withCompetitorData,
            priceChanges: result.priceChanges,
            unchanged: result.unchanged,
          },
          changes: sorted,
          allRecommendations: result.recommendations,
        });
      }

      // ── Execute price updates ─────────────────────────────────────────
      case 'price-execute': {
        console.log('🚀 Executing price updates...');
        const manualPrices = req.body?.manualPrices || undefined;
        const result = await runPriceUpdate(false, manualPrices);

        return res.status(200).json({
          success: true,
          dryRun: false,
          summary: {
            totalProducts: result.totalProducts,
            withCompetitorData: result.withCompetitorData,
            priceChanges: result.priceChanges,
            updated: result.updated,
            failed: result.failed,
            unchanged: result.unchanged,
          },
          errors: result.errors,
          recommendations: result.recommendations,
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
