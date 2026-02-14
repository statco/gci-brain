/**
 * Sync ALL Canada Tire products to Shopify.
 * 
 * This script:
 * 1. Fetches all tire products from Canada Tire NetSuite API (all brands)
 * 2. Checks which already exist in Shopify (by SKU)
 * 3. Creates new products / updates existing prices
 * 
 * Required env vars:
 *   CT_CONSUMER_KEY, CT_CONSUMER_SECRET, CT_TOKEN_ID, CT_TOKEN_SECRET,
 *   CT_CUSTOMER_NUMBER, CT_CUSTOMER_API_TOKEN, CT_USE_SANDBOX,
 *   SHOPIFY_ADMIN_ACCESS_TOKEN, SHOPIFY_STORE_DOMAIN (or VITE_SHOPIFY_STORE_DOMAIN)
 */

const crypto = require('crypto');

// ─── CONFIG ──────────────────────────────────────────────────────────────────

const CT = {
  consumerKey:    process.env.CT_CONSUMER_KEY    || '',
  consumerSecret: process.env.CT_CONSUMER_SECRET || '',
  tokenId:        process.env.CT_TOKEN_ID        || '',
  tokenSecret:    process.env.CT_TOKEN_SECRET    || '',
  customerId:     process.env.CT_CUSTOMER_NUMBER || '19997',
  customerToken:  process.env.CT_CUSTOMER_API_TOKEN || '',
  useSandbox:     process.env.CT_USE_SANDBOX !== 'false',
  get realm()   { return this.useSandbox ? '8031691_SB1' : '8031691'; },
  get baseUrl() {
    return this.useSandbox
      ? 'https://8031691-sb1.restlets.api.netsuite.com/app/site/hosting/restlet.nl'
      : 'https://8031691.restlets.api.netsuite.com/app/site/hosting/restlet.nl';
  },
};

const SHOPIFY = {
  domain:     process.env.SHOPIFY_STORE_DOMAIN || process.env.VITE_SHOPIFY_STORE_DOMAIN || '',
  adminToken: process.env.SHOPIFY_ADMIN_ACCESS_TOKEN || '',
  apiVersion: '2024-01',
};

const SCRIPTS = {
  tireSearch: { script: 'customscript_item_search_rl', deploy: 'customdeploy_item_search_rl' },
};

// ─── UTILITIES ───────────────────────────────────────────────────────────────

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function percentEncode(str) {
  return encodeURIComponent(str).replace(/[!'()*]/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

function parseCTSize(rawSize) {
  const s = rawSize.replace(/,/g, '').trim();
  if (/^\d{7}$/.test(s)) return `${s.slice(0,3)}/${s.slice(3,5)}R${s.slice(5,7)}`;
  if (/^\d{8}$/.test(s)) return `${s.slice(0,3)}/${s.slice(3,5)}R${s.slice(5,8)}`;
  if (/^\d{6}$/.test(s)) return `${s.slice(0,3)}/R${s.slice(4,6)}`;
  return s.replace(/,/g, '/');
}

function getTotalInventory(ct) {
  if (!ct.inventory || typeof ct.inventory !== 'object') return 0;
  return Object.values(ct.inventory).reduce((sum, qty) => sum + (parseInt(qty) || 0), 0);
}

// ─── CANADA TIRE OAUTH ──────────────────────────────────────────────────────

function buildOAuthHeader(baseUrl, script, deploy) {
  const nonce     = crypto.randomBytes(16).toString('hex');
  const timestamp = Math.floor(Date.now() / 1000).toString();

  const sigParams = {
    deploy,
    oauth_consumer_key:     CT.consumerKey,
    oauth_nonce:            nonce,
    oauth_signature_method: 'HMAC-SHA256',
    oauth_timestamp:        timestamp,
    oauth_token:            CT.tokenId,
    oauth_version:          '1.0',
    script,
  };

  const paramStr = Object.keys(sigParams).sort()
    .map(k => `${percentEncode(k)}=${percentEncode(sigParams[k])}`)
    .join('&');

  const baseString = ['POST', percentEncode(baseUrl), percentEncode(paramStr)].join('&');
  const signingKey = `${percentEncode(CT.consumerSecret)}&${percentEncode(CT.tokenSecret)}`;
  const signature  = crypto.createHmac('sha256', signingKey).update(baseString).digest('base64');

  return [
    `OAuth realm="${CT.realm}"`,
    `oauth_consumer_key="${CT.consumerKey}"`,
    `oauth_token="${CT.tokenId}"`,
    `oauth_signature_method="HMAC-SHA256"`,
    `oauth_timestamp="${timestamp}"`,
    `oauth_nonce="${nonce}"`,
    `oauth_version="1.0"`,
    `oauth_signature="${percentEncode(signature)}"`,
  ].join(', ');
}

async function ctPost(body) {
  const { script, deploy } = SCRIPTS.tireSearch;
  const fullUrl = `${CT.baseUrl}?script=${script}&deploy=${deploy}`;
  const auth = buildOAuthHeader(CT.baseUrl, script, deploy);

  const res = await fetch(fullUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': auth },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`CT API HTTP ${res.status}: ${text}`);
  }

  const json = await res.json();
  if (json.success === false) throw new Error(`CT API error: ${JSON.stringify(json)}`);
  return json;
}

// ─── SHOPIFY ADMIN API ──────────────────────────────────────────────────────

async function shopifyAdmin(path, method = 'GET', body = null) {
  const url = `https://${SHOPIFY.domain}/admin/api/${SHOPIFY.apiVersion}${path}`;

  const res = await fetch(url, {
    method,
    headers: {
      'X-Shopify-Access-Token': SHOPIFY.adminToken,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  // Rate limit
  if (res.status === 429) {
    const retryAfter = parseFloat(res.headers.get('Retry-After') || '2');
    console.log(`  Rate limited, waiting ${retryAfter}s...`);
    await sleep(retryAfter * 1000);
    return shopifyAdmin(path, method, body);
  }

  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`Shopify ${method} ${path} -> HTTP ${res.status}: ${txt}`);
  }

  if (res.status === 204) return {};
  return res.json();
}

// ─── FETCH ALL CT PRODUCTS ──────────────────────────────────────────────────

async function fetchAllCTProducts() {
  const all = [];
  let page = 1;

  while (page <= 100) {
    console.log(`  CT page ${page}...`);

    const result = await ctPost({
      customerId:    CT.customerId,
      customerToken: CT.customerToken,
      filters: {
        brand: '', isTire: true, isWheel: false,
        width: '', rimSize: '', aspectRatio: '', size: '',
        partNumber: [], searchKey: '', isWinter: '', isRunFlat: '',
        page,
      },
    });

    const tires = Array.isArray(result) ? result : (result.data || []);
    console.log(`    -> ${tires.length} tires`);

    if (tires.length === 0) break;
    all.push(...tires);

    if (tires.length < 100) break;
    page++;
    await sleep(1000);
  }

  return all;
}

// ─── FETCH EXISTING SHOPIFY PRODUCTS ────────────────────────────────────────

async function getExistingShopifyProducts() {
  const skuMap = new Map();
  let sinceId = 0;

  while (true) {
    const params = new URLSearchParams({
      limit: '250',
      fields: 'id,title,variants,tags',
    });
    if (sinceId) params.set('since_id', sinceId.toString());

    const data = await shopifyAdmin(`/products.json?${params.toString()}`);
    const products = data.products || [];

    for (const p of products) {
      if (p.tags && p.tags.includes('canada-tire')) {
        for (const v of p.variants) {
          if (v.sku) skuMap.set(v.sku, { productId: p.id, variantId: v.id, price: v.price, title: p.title });
        }
      }
      if (p.id > sinceId) sinceId = p.id;
    }

    if (products.length < 250) break;
    await sleep(500);
  }

  return skuMap;
}

// ─── BUILD SHOPIFY PRODUCT ──────────────────────────────────────────────────

function buildShopifyProduct(ct) {
  const size    = parseCTSize(ct.size);
  const season  = ct.isWinter ? 'Winter Tire' : 'All-Season Tire';
  const totalQty = getTotalInventory(ct);

  const features = [];
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
    'ai-match', 'canada-tire',
    `ct-${ct.partNumber}`, ct.brand, ct.model,
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
      variants: [{
        price: (parseFloat(ct.msrp) || 0).toFixed(2),
        sku: ct.partNumber,
        inventory_management: null,
        inventory_policy: 'deny',
        option1: size,
        barcode: ct.partNumber,
      }],
      options: [{ name: 'Size', values: [size] }],
      metafields: [
        { namespace: 'canada_tire', key: 'part_number', value: ct.partNumber, type: 'single_line_text_field' },
        { namespace: 'canada_tire', key: 'brand', value: ct.brand, type: 'single_line_text_field' },
        { namespace: 'canada_tire', key: 'model', value: ct.model, type: 'single_line_text_field' },
        { namespace: 'canada_tire', key: 'season', value: ct.isWinter ? 'winter' : 'all-season', type: 'single_line_text_field' },
        { namespace: 'canada_tire', key: 'source', value: 'canada_tire', type: 'single_line_text_field' },
      ],
    },
  };
}

// ─── MAIN SYNC ──────────────────────────────────────────────────────────────

async function main() {
  console.log('=== Canada Tire -> Shopify Full Sync ===\n');

  // Validate config
  if (!CT.consumerKey || !CT.tokenId || !CT.customerToken) {
    console.error('ERROR: Missing CT environment variables');
    process.exit(1);
  }
  if (!SHOPIFY.domain || !SHOPIFY.adminToken) {
    console.error('ERROR: Missing Shopify environment variables (SHOPIFY_STORE_DOMAIN, SHOPIFY_ADMIN_ACCESS_TOKEN)');
    process.exit(1);
  }

  console.log(`CT Environment: ${CT.useSandbox ? 'SANDBOX' : 'PRODUCTION'}`);
  console.log(`Shopify Store:  ${SHOPIFY.domain}`);
  console.log('');

  // Step 1: Test Shopify connection
  console.log('[1/4] Testing Shopify Admin API connection...');
  try {
    const shop = await shopifyAdmin('/shop.json');
    console.log(`  Connected to: ${shop.shop?.name || SHOPIFY.domain}\n`);
  } catch (err) {
    console.error(`  FAILED to connect to Shopify: ${err.message}`);
    console.error('  Check SHOPIFY_ADMIN_ACCESS_TOKEN and SHOPIFY_STORE_DOMAIN');
    process.exit(1);
  }

  // Step 2: Fetch all CT products
  console.log('[2/4] Fetching ALL products from Canada Tire...');
  const ctProducts = await fetchAllCTProducts();
  console.log(`  Total CT products: ${ctProducts.length}\n`);

  if (ctProducts.length === 0) {
    console.log('No products found. Exiting.');
    return;
  }

  // Summarize brands found
  const brandCounts = {};
  for (const ct of ctProducts) {
    brandCounts[ct.brand] = (brandCounts[ct.brand] || 0) + 1;
  }
  console.log('  Brands found:');
  for (const [brand, count] of Object.entries(brandCounts).sort((a, b) => b[1] - a[1])) {
    console.log(`    ${brand}: ${count} products`);
  }
  console.log('');

  // Step 3: Get existing Shopify products
  console.log('[3/4] Fetching existing Canada Tire products from Shopify...');
  const existingMap = await getExistingShopifyProducts();
  console.log(`  Found ${existingMap.size} existing CT products in Shopify\n`);

  // Step 4: Sync
  console.log('[4/4] Syncing products...\n');

  let created = 0, updated = 0, unchanged = 0, errors = 0;
  const BATCH = 4;

  for (let i = 0; i < ctProducts.length; i += BATCH) {
    const batch = ctProducts.slice(i, i + BATCH);
    const batchNum = Math.floor(i / BATCH) + 1;
    const totalBatches = Math.ceil(ctProducts.length / BATCH);

    process.stdout.write(`  Batch ${batchNum}/${totalBatches} (${i + 1}-${Math.min(i + BATCH, ctProducts.length)} of ${ctProducts.length})...`);

    const promises = batch.map(async (ct) => {
      try {
        const existing = existingMap.get(ct.partNumber);

        if (existing) {
          // Update price if changed
          const newPrice = (parseFloat(ct.msrp) || 0).toFixed(2);
          if (existing.price !== newPrice) {
            await shopifyAdmin(`/variants/${existing.variantId}.json`, 'PUT', {
              variant: { id: existing.variantId, price: newPrice },
            });
            return 'updated';
          }
          return 'unchanged';
        } else {
          // Create new product
          const payload = buildShopifyProduct(ct);
          await shopifyAdmin('/products.json', 'POST', payload);
          return 'created';
        }
      } catch (err) {
        console.error(`\n    Error for ${ct.partNumber}: ${err.message}`);
        return 'error';
      }
    });

    const results = await Promise.all(promises);
    for (const r of results) {
      if (r === 'created') created++;
      else if (r === 'updated') updated++;
      else if (r === 'unchanged') unchanged++;
      else errors++;
    }

    console.log(` done (C:${created} U:${updated} S:${unchanged} E:${errors})`);

    // Rate limit pause between batches
    if (i + BATCH < ctProducts.length) {
      await sleep(2500);
    }
  }

  console.log('\n=== SYNC COMPLETE ===');
  console.log(`  Created:   ${created}`);
  console.log(`  Updated:   ${updated}`);
  console.log(`  Unchanged: ${unchanged}`);
  console.log(`  Errors:    ${errors}`);
  console.log(`  Total CT:  ${ctProducts.length}`);
}

main().catch(err => {
  console.error('FATAL:', err.message);
  process.exit(1);
});
