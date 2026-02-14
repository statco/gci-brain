// api/syncProducts.ts
// ============================================================
// Canada Tire -> Shopify Product Sync
// Full import + daily price/inventory update
// Uses Shopify Admin REST API (2024-01) + CT API from canadaTire.ts
// ============================================================

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { searchTires, transformToAIMatchProduct, getTotalInventory, isInStock } from './canadaTire';
import type { CTTireProduct } from './canadaTire';

// ─── SHOPIFY ADMIN CONFIG ─────────────────────────────────────────────────────

const SHOPIFY_DOMAIN = process.env.SHOPIFY_STORE_DOMAIN || process.env.VITE_SHOPIFY_STORE_DOMAIN || '';
const SHOPIFY_ADMIN_TOKEN = process.env.SHOPIFY_ADMIN_ACCESS_TOKEN || '';
const API_VERSION = '2024-01';

function shopifyAdminUrl(path: string): string {
  return `https://${SHOPIFY_DOMAIN}/admin/api/${API_VERSION}${path}`;
}

async function shopifyAdmin<T = unknown>(
  path: string,
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' = 'GET',
  body?: Record<string, unknown>
): Promise<T> {
  const url = shopifyAdminUrl(path);
  const res = await fetch(url, {
    method,
    headers: {
      'X-Shopify-Access-Token': SHOPIFY_ADMIN_TOKEN,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  // Handle Shopify rate limits (429)
  if (res.status === 429) {
    const retryAfter = parseFloat(res.headers.get('Retry-After') || '2');
    console.log(`Rate limited, retrying after ${retryAfter}s...`);
    await sleep(retryAfter * 1000);
    return shopifyAdmin<T>(path, method, body);
  }

  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`Shopify Admin API ${method} ${path} -> HTTP ${res.status}: ${txt}`);
  }

  // DELETE returns no body
  if (res.status === 204) return {} as T;

  return res.json() as Promise<T>;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ─── SIZE PARSER ──────────────────────────────────────────────────────────────
// CT size is numeric like "2355518" meaning 235/55R18
// We parse it into human-readable format

function parseCTSize(rawSize: string): string {
  const s = rawSize.replace(/,/g, '').trim();
  // Common tire size: 7 digits like 2355518 -> 235/55R18
  if (/^\d{7}$/.test(s)) {
    const width = s.slice(0, 3);
    const aspect = s.slice(3, 5);
    const rim = s.slice(5, 7);
    return `${width}/${aspect}R${rim}`;
  }
  // 8 digits like 23555R18 -> 235/55R18
  if (/^\d{8}$/.test(s)) {
    const width = s.slice(0, 3);
    const aspect = s.slice(3, 5);
    const rim = s.slice(5, 8);
    return `${width}/${aspect}R${rim}`;
  }
  // 6 digits like 185015 -> 185/R15 (no aspect ratio)
  if (/^\d{6}$/.test(s)) {
    const width = s.slice(0, 3);
    const rim = s.slice(4, 6);
    return `${width}/R${rim}`;
  }
  // Already formatted or unrecognized: return as-is with slashes
  return s.replace(/,/g, '/');
}

// ─── CT PRODUCT -> SHOPIFY PRODUCT MAPPING ────────────────────────────────────

interface ShopifyProductPayload {
  product: {
    title: string;
    body_html: string;
    vendor: string;
    product_type: string;
    tags: string;
    variants: {
      price: string;
      sku: string;
      inventory_management: string | null;
      inventory_policy: string;
      option1: string;
      barcode: string;
    }[];
    options: { name: string; values: string[] }[];
    metafields: {
      namespace: string;
      key: string;
      value: string;
      type: string;
    }[];
  };
}

function buildShopifyProduct(ct: CTTireProduct): ShopifyProductPayload {
  const size = parseCTSize(ct.size);
  const season = ct.isWinter ? 'Winter Tire' : 'All-Season Tire';
  const totalQty = getTotalInventory(ct);

  const features: string[] = [];
  if (ct.isWinter) features.push('Winter certified (3PMSF)');
  if (ct.isRunFlat) features.push('Run-flat technology');
  if (ct.performanceCategory) features.push(`${ct.performanceCategory} performance`);

  const bodyHtml = `
    <p>${ct.brand} ${ct.model} - ${size}</p>
    <ul>
      ${features.map(f => `<li>${f}</li>`).join('\n      ')}
      <li>Season: ${season}</li>
      <li>In stock: ${totalQty} units</li>
    </ul>
  `.trim();

  const tags = [
    'ai-match',
    'canada-tire',
    `ct-${ct.partNumber}`,
    ct.brand,
    ct.model,
    season.toLowerCase().replace(/\s+/g, '-'),
    ct.performanceCategory || '',
    ct.isRunFlat ? 'run-flat' : '',
    ct.isWinter ? 'winter' : 'all-season',
    size,
  ].filter(Boolean).join(', ');

  return {
    product: {
      title: `${ct.brand} ${ct.model} ${size}`,
      body_html: bodyHtml,
      vendor: ct.brand,
      product_type: season,
      tags,
      variants: [
        {
          price: (parseFloat(ct.msrp) || 0).toFixed(2),
          sku: ct.partNumber,
          inventory_management: null, // Don't track through Shopify inventory system
          inventory_policy: totalQty > 0 ? 'deny' : 'deny',
          option1: size,
          barcode: ct.partNumber,
        },
      ],
      options: [{ name: 'Size', values: [size] }],
      metafields: [
        { namespace: 'canada_tire', key: 'part_number', value: ct.partNumber, type: 'single_line_text_field' },
        { namespace: 'canada_tire', key: 'brand', value: ct.brand, type: 'single_line_text_field' },
        { namespace: 'canada_tire', key: 'model', value: ct.model, type: 'single_line_text_field' },
        { namespace: 'canada_tire', key: 'season', value: ct.isWinter ? 'winter' : 'all-season', type: 'single_line_text_field' },
        { namespace: 'canada_tire', key: 'is_run_flat', value: ct.isRunFlat ? 'true' : 'false', type: 'single_line_text_field' },
        { namespace: 'canada_tire', key: 'performance_category', value: ct.performanceCategory || '', type: 'single_line_text_field' },
        { namespace: 'canada_tire', key: 'total_inventory', value: totalQty.toString(), type: 'number_integer' },
        { namespace: 'canada_tire', key: 'raw_size', value: ct.size, type: 'single_line_text_field' },
        { namespace: 'canada_tire', key: 'source', value: 'canada_tire', type: 'single_line_text_field' },
      ],
    },
  };
}

// ─── FETCH EXISTING SHOPIFY PRODUCTS BY SKU ───────────────────────────────────

interface ShopifyProduct {
  id: number;
  title: string;
  variants: { id: number; sku: string; price: string }[];
  tags: string;
}

async function getExistingProductsBySku(): Promise<Map<string, ShopifyProduct>> {
  const map = new Map<string, ShopifyProduct>();
  let pageInfo: string | null = null;

  // Paginate through ALL Shopify products tagged with 'canada-tire'
  // This avoids fetching products from other sources
  while (true) {
    const params = new URLSearchParams({
      limit: '250',
      fields: 'id,title,variants,tags',
    });

    if (pageInfo) {
      params.set('page_info', pageInfo);
    }

    const url = `/products.json?${params.toString()}`;
    const data = await shopifyAdmin<{ products: ShopifyProduct[] }>(url);

    for (const product of data.products) {
      // Only index products that came from Canada Tire
      if (product.tags && product.tags.includes('canada-tire')) {
        for (const variant of product.variants) {
          if (variant.sku) {
            map.set(variant.sku, product);
          }
        }
      }
    }

    // Check for pagination -- Shopify uses Link header, but REST also supports page_info
    // For simplicity, break if fewer than 250 products returned
    if (data.products.length < 250) break;

    // Note: In a production app you'd parse the Link header for page_info
    // For now, this handles the common case
    pageInfo = null;
    break;
  }

  console.log(`Found ${map.size} existing Canada Tire products in Shopify`);
  return map;
}

// ─── BATCH HELPERS ────────────────────────────────────────────────────────────
// Shopify Admin has a rate limit of ~2 requests/second for REST API

const BATCH_SIZE = 5;
const BATCH_DELAY_MS = 2500; // 2.5 seconds between batches (~2 req/s)

async function processBatch<T, R>(
  items: T[],
  processor: (item: T, index: number) => Promise<R>,
  label: string
): Promise<{ results: R[]; errors: { item: T; error: string }[] }> {
  const results: R[] = [];
  const errors: { item: T; error: string }[] = [];

  for (let i = 0; i < items.length; i += BATCH_SIZE) {
    const batch = items.slice(i, i + BATCH_SIZE);
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(items.length / BATCH_SIZE);

    console.log(`[${label}] Batch ${batchNum}/${totalBatches} (${batch.length} items)`);

    const batchResults = await Promise.allSettled(
      batch.map((item, idx) => processor(item, i + idx))
    );

    for (let j = 0; j < batchResults.length; j++) {
      const result = batchResults[j];
      if (result.status === 'fulfilled') {
        results.push(result.value);
      } else {
        const ct = batch[j] as any;
        const sku = ct?.partNumber || ct?.sku || 'unknown';
        console.error(`  Error for SKU ${sku}: ${result.reason?.message || result.reason}`);
        errors.push({ item: batch[j], error: result.reason?.message || String(result.reason) });
      }
    }

    // Respect rate limit between batches
    if (i + BATCH_SIZE < items.length) {
      await sleep(BATCH_DELAY_MS);
    }
  }

  return { results, errors };
}

// ─── FETCH ALL CT PRODUCTS (all pages) ────────────────────────────────────────

async function fetchAllCTProducts(brand?: string): Promise<CTTireProduct[]> {
  const allProducts: CTTireProduct[] = [];
  let page = 1;
  const MAX_PAGES = 100; // Safety limit

  while (page <= MAX_PAGES) {
    console.log(`Fetching CT products page ${page}${brand ? ` (brand: ${brand})` : ''}...`);

    const filters: Record<string, unknown> = {
      isTire: true,
      page,
    };
    if (brand) filters.brand = brand.toUpperCase();

    const products = await searchTires(filters as any);

    if (!products || products.length === 0) {
      console.log(`No more products on page ${page}. Done.`);
      break;
    }

    allProducts.push(...products);
    console.log(`  Got ${products.length} products (total: ${allProducts.length})`);

    // If less than expected page size, we've reached the end
    if (products.length < 100) break;

    page++;
    await sleep(1000); // Be gentle with the CT API
  }

  return allProducts;
}

// ─── FULL SYNC: Import ALL CT products to Shopify ─────────────────────────────

async function fullSync(brand?: string) {
  console.log(`Starting FULL SYNC${brand ? ` for brand: ${brand}` : ' for ALL brands'}...`);

  // 1. Fetch all products from Canada Tire
  const ctProducts = await fetchAllCTProducts(brand);
  console.log(`Fetched ${ctProducts.length} total CT products`);

  if (ctProducts.length === 0) {
    return { action: 'full-sync', created: 0, updated: 0, errors: 0, message: 'No products found in Canada Tire' };
  }

  // 2. Get existing Shopify products to know which to create vs update
  const existingMap = await getExistingProductsBySku();

  // 3. Split into create vs update
  const toCreate: CTTireProduct[] = [];
  const toUpdate: { ct: CTTireProduct; shopifyProduct: ShopifyProduct }[] = [];

  for (const ct of ctProducts) {
    const existing = existingMap.get(ct.partNumber);
    if (existing) {
      toUpdate.push({ ct, shopifyProduct: existing });
    } else {
      toCreate.push(ct);
    }
  }

  console.log(`To create: ${toCreate.length}, To update: ${toUpdate.length}`);

  // 4. Create new products
  const createResult = await processBatch(
    toCreate,
    async (ct) => {
      const payload = buildShopifyProduct(ct);
      const result = await shopifyAdmin<{ product: ShopifyProduct }>(
        '/products.json',
        'POST',
        payload
      );
      return { sku: ct.partNumber, shopifyId: result.product.id, action: 'created' as const };
    },
    'CREATE'
  );

  // 5. Update existing products (price + tags + inventory info)
  const updateResult = await processBatch(
    toUpdate,
    async ({ ct, shopifyProduct }) => {
      const size = parseCTSize(ct.size);
      const season = ct.isWinter ? 'Winter Tire' : 'All-Season Tire';
      const totalQty = getTotalInventory(ct);

      const tags = [
        'ai-match',
        'canada-tire',
        `ct-${ct.partNumber}`,
        ct.brand,
        ct.model,
        season.toLowerCase().replace(/\s+/g, '-'),
        ct.performanceCategory || '',
        ct.isRunFlat ? 'run-flat' : '',
        ct.isWinter ? 'winter' : 'all-season',
        size,
      ].filter(Boolean).join(', ');

      // Update product tags + type
      await shopifyAdmin(
        `/products/${shopifyProduct.id}.json`,
        'PUT',
        {
          product: {
            id: shopifyProduct.id,
            tags,
            product_type: season,
          },
        }
      );

      // Update variant price
      if (shopifyProduct.variants[0]) {
        const newPrice = (parseFloat(ct.msrp) || 0).toFixed(2);
        if (shopifyProduct.variants[0].price !== newPrice) {
          await shopifyAdmin(
            `/variants/${shopifyProduct.variants[0].id}.json`,
            'PUT',
            {
              variant: {
                id: shopifyProduct.variants[0].id,
                price: newPrice,
              },
            }
          );
        }
      }

      return { sku: ct.partNumber, shopifyId: shopifyProduct.id, action: 'updated' as const };
    },
    'UPDATE'
  );

  const summary = {
    action: 'full-sync',
    brand: brand || 'ALL',
    totalCTProducts: ctProducts.length,
    created: createResult.results.length,
    createErrors: createResult.errors.length,
    updated: updateResult.results.length,
    updateErrors: updateResult.errors.length,
    errors: [
      ...createResult.errors.map(e => ({ sku: (e.item as any).partNumber, error: e.error, action: 'create' })),
      ...updateResult.errors.map(e => ({ sku: (e.item as any).ct?.partNumber, error: e.error, action: 'update' })),
    ],
  };

  console.log(`FULL SYNC COMPLETE:`, JSON.stringify(summary, null, 2));
  return summary;
}

// ─── PRICE SYNC: Update prices + inventory for existing products only ─────────

async function priceSync() {
  console.log('Starting PRICE SYNC (daily)...');

  // 1. Fetch all CT products
  const ctProducts = await fetchAllCTProducts();
  console.log(`Fetched ${ctProducts.length} CT products for price sync`);

  // 2. Get existing Shopify products
  const existingMap = await getExistingProductsBySku();

  // 3. Find products that exist in both
  const toSync: { ct: CTTireProduct; shopifyProduct: ShopifyProduct }[] = [];
  let newProducts = 0;

  for (const ct of ctProducts) {
    const existing = existingMap.get(ct.partNumber);
    if (existing) {
      toSync.push({ ct, shopifyProduct: existing });
    } else {
      newProducts++;
    }
  }

  console.log(`Found ${toSync.length} products to update prices, ${newProducts} new products (use full-sync to import)`);

  // 4. Update prices
  const result = await processBatch(
    toSync,
    async ({ ct, shopifyProduct }) => {
      const newPrice = (parseFloat(ct.msrp) || 0).toFixed(2);
      const currentPrice = shopifyProduct.variants[0]?.price;

      if (currentPrice === newPrice) {
        return { sku: ct.partNumber, action: 'unchanged' as const };
      }

      // Update variant price
      if (shopifyProduct.variants[0]) {
        await shopifyAdmin(
          `/variants/${shopifyProduct.variants[0].id}.json`,
          'PUT',
          {
            variant: {
              id: shopifyProduct.variants[0].id,
              price: newPrice,
            },
          }
        );
      }

      // Update inventory metafield via product tags (quick approach)
      const totalQty = getTotalInventory(ct);
      const currentTags = shopifyProduct.tags || '';
      const inStockTag = isInStock(ct) ? 'in-stock' : 'out-of-stock';

      // Update tags to reflect stock status
      let newTags = currentTags
        .replace(/,?\s*in-stock/g, '')
        .replace(/,?\s*out-of-stock/g, '');
      newTags = `${newTags}, ${inStockTag}`.replace(/^,\s*/, '');

      await shopifyAdmin(
        `/products/${shopifyProduct.id}.json`,
        'PUT',
        {
          product: {
            id: shopifyProduct.id,
            tags: newTags,
          },
        }
      );

      return {
        sku: ct.partNumber,
        action: 'price-updated' as const,
        oldPrice: currentPrice,
        newPrice,
        inStock: isInStock(ct),
        inventory: totalQty,
      };
    },
    'PRICE-SYNC'
  );

  const priceChanges = result.results.filter(r => r.action === 'price-updated');

  const summary = {
    action: 'price-sync',
    totalChecked: toSync.length,
    priceUpdated: priceChanges.length,
    unchanged: result.results.filter(r => r.action === 'unchanged').length,
    errors: result.errors.length,
    newProductsNotImported: newProducts,
    priceChanges: priceChanges.slice(0, 50), // Show first 50 changes
  };

  console.log(`PRICE SYNC COMPLETE:`, JSON.stringify(summary, null, 2));
  return summary;
}

// ─── VERCEL API HANDLER  /api/syncProducts?action=xxx ────────────────────────

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // Auth: Vercel cron jobs send CRON_SECRET, manual calls need a header
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = req.headers.authorization;
  const isCron = cronSecret && authHeader === `Bearer ${cronSecret}`;
  const action = (req.query.action as string) || '';

  // For cron-triggered actions, verify the secret
  if (action === 'price-sync' && cronSecret && !isCron) {
    // Allow manual calls without CRON_SECRET if env var not set (dev mode)
    // But if CRON_SECRET exists, require it
    if (!authHeader) {
      return res.status(401).json({ error: 'Authorization required for price-sync' });
    }
  }

  // Validate Shopify config
  if (!SHOPIFY_DOMAIN || !SHOPIFY_ADMIN_TOKEN) {
    return res.status(500).json({
      error: 'Missing Shopify Admin config',
      details: {
        hasDomain: !!SHOPIFY_DOMAIN,
        hasAdminToken: !!SHOPIFY_ADMIN_TOKEN,
      },
    });
  }

  try {
    switch (action) {
      case 'full-sync': {
        const brand = (req.query.brand as string) || (req.body?.brand as string) || undefined;
        const result = await fullSync(brand);
        return res.status(200).json(result);
      }

      case 'sync-brand': {
        const brand = (req.query.brand as string) || (req.body?.brand as string);
        if (!brand) return res.status(400).json({ error: 'brand parameter is required' });
        const result = await fullSync(brand);
        return res.status(200).json(result);
      }

      case 'price-sync': {
        const result = await priceSync();
        return res.status(200).json(result);
      }

      case 'status': {
        // Quick check: how many CT products are in Shopify?
        const existingMap = await getExistingProductsBySku();
        return res.status(200).json({
          action: 'status',
          shopifyProductsWithCTTag: existingMap.size,
          shopifyDomain: SHOPIFY_DOMAIN,
          hasAdminToken: !!SHOPIFY_ADMIN_TOKEN,
        });
      }

      case 'test': {
        // Test connection to both APIs
        const ctTest = await searchTires({ brand: 'VREDESTEIN', page: 1 });
        return res.status(200).json({
          action: 'test',
          ctConnection: 'OK',
          ctSampleCount: ctTest.length,
          shopifyDomain: SHOPIFY_DOMAIN,
          hasAdminToken: !!SHOPIFY_ADMIN_TOKEN,
          message: 'Both APIs reachable',
        });
      }

      default:
        return res.status(400).json({
          error: `Unknown action: "${action}"`,
          validActions: ['full-sync', 'sync-brand', 'price-sync', 'status', 'test'],
          examples: [
            'POST /api/syncProducts?action=test',
            'POST /api/syncProducts?action=full-sync',
            'POST /api/syncProducts?action=full-sync&brand=VREDESTEIN',
            'POST /api/syncProducts?action=sync-brand&brand=MICHELIN',
            'POST /api/syncProducts?action=price-sync',
            'GET  /api/syncProducts?action=status',
          ],
        });
    }
  } catch (error: any) {
    console.error('Sync error:', error);
    return res.status(500).json({
      error: error.message || 'Internal sync error',
      action,
    });
  }
}
