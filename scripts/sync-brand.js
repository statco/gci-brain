/**
 * Sync a SINGLE BRAND from Canada Tire to Shopify, in chunks.
 * 
 * Environment variables:
 *   SYNC_BRAND   - Brand to sync (e.g. "VREDESTEIN"). Required.
 *   SYNC_OFFSET  - Skip this many products (default 0). Use for chunked runs.
 *   SYNC_LIMIT   - Max products to process this run (default 100).
 * 
 * Usage:
 *   SYNC_BRAND=VREDESTEIN SYNC_OFFSET=0 SYNC_LIMIT=100 node scripts/sync-brand.js
 *   SYNC_BRAND=VREDESTEIN SYNC_OFFSET=100 SYNC_LIMIT=100 node scripts/sync-brand.js
 */

const crypto = require('crypto');

// --- EDIT THESE FOR EACH RUN ---
const BRAND  = 'VREDESTEIN';
const OFFSET = 0;
const LIMIT  = 30;
// --------------------------------

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
  const s = String(rawSize || '').replace(/,/g, '').trim();
  if (/^\d{7}$/.test(s)) {
    return `${s.slice(0,3)}/${s.slice(3,5)}R${s.slice(5)}`;
  }
  if (/^\d{6}$/.test(s)) {
    return `${s.slice(0,2)}/${s.slice(2,4)}R${s.slice(4)}`;
  }
  return s;
}

// ─── OAUTH ───────────────────────────────────────────────────────────────────

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

// ─── CT FETCH ────────────────────────────────────────────────────────────────

async function fetchCTTires(brand) {
  const all = [];
  let page = 1;
  const MAX_PAGES = 2; // Limit pages to fit within sandbox timeout

  while (page <= MAX_PAGES) {
    console.log(`  Fetching page ${page} of max ${MAX_PAGES}...`);
    const { script, deploy } = SCRIPTS.tireSearch;
    const fullUrl = `${CT.baseUrl}?script=${script}&deploy=${deploy}`;
    const auth = buildOAuthHeader(CT.baseUrl, script, deploy);

    const body = {
      customerId: CT.customerId,
      customerToken: CT.customerToken,
      filters: {
        brand: brand,
        isTire: true,
        isWheel: false,
        isWinter: '',
        width: '', aspectRatio: '', rimSize: '',
        size: '', partNumber: [], searchKey: '',
        isRunFlat: '',
        page: page,
      },
    };

    const res = await fetch(fullUrl, {
      method: 'POST',
      headers: { 'Authorization': auth, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!res.ok) throw new Error(`CT API HTTP ${res.status}`);
    const data = await res.json();

    if (data.success === false) throw new Error(data.error?.errorMsg || 'CT error');

    const items = Array.isArray(data) ? data : (data.data || []);
    all.push(...items);
    console.log(`  Page ${page}: ${items.length} tires (total so far: ${all.length})`);

    if (items.length === 0) break;
    if (all.length >= OFFSET + LIMIT) break; // Have enough
    page++;
    await sleep(300);
  }

  return all;
}

// ─── SHOPIFY ADMIN ───────────────────────────────────────────────────────────

async function shopifyAdmin(endpoint, method = 'GET', body = null) {
  const url = `https://${SHOPIFY.domain}/admin/api/${SHOPIFY.apiVersion}${endpoint}`;
  const opts = {
    method,
    headers: {
      'X-Shopify-Access-Token': SHOPIFY.adminToken,
      'Content-Type': 'application/json',
    },
  };
  if (body) opts.body = JSON.stringify(body);

  const res = await fetch(url, opts);

  if (res.status === 429) {
    const retry = parseInt(res.headers.get('Retry-After') || '2', 10);
    console.log(`    Rate limited, waiting ${retry}s...`);
    await sleep(retry * 1000);
    return shopifyAdmin(endpoint, method, body);
  }

  const text = await res.text();
  if (!res.ok) throw new Error(`Shopify ${res.status}: ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : {};
}

async function getExistingSkus() {
  const skuMap = new Map();
  let sinceId = 0;

  while (true) {
    const params = new URLSearchParams({ limit: '250', fields: 'id,title,variants,tags' });
    if (sinceId) params.set('since_id', sinceId.toString());

    const data = await shopifyAdmin(`/products.json?${params.toString()}`);
    const products = data.products || [];

    for (const p of products) {
      for (const v of p.variants) {
        if (v.sku) skuMap.set(v.sku, { productId: p.id, variantId: v.id, price: v.price });
      }
      if (p.id > sinceId) sinceId = p.id;
    }

    if (products.length < 250) break;
    await sleep(500);
  }

  return skuMap;
}

function buildShopifyProduct(ct) {
  const size = parseCTSize(ct.size);
  const totalInv = (ct.inventory || []).reduce((sum, loc) => sum + (loc.quantity || 0), 0);
  const season = ct.isWinter ? 'Winter / All-Weather' : 'All-Season';

  return {
    product: {
      title: `${ct.brand} ${ct.model} ${size}`.trim(),
      body_html: `<p>${ct.brand} ${ct.model} ${size} - ${season} tire. ${ct.performanceCategory || ''}</p>`,
      vendor: ct.brand,
      product_type: 'Tires',
      tags: [
        'ai-match', 'canada-tire', 'ct-sync',
        `ct-${ct.partNumber}`, ct.brand, ct.model,
        ct.isWinter ? 'winter' : 'all-season',
        size,
      ].filter(Boolean).join(', '),
      variants: [{
        sku: ct.partNumber,
        price: ct.msrp ? String(ct.msrp) : '0.00',
        inventory_management: 'shopify',
        inventory_quantity: totalInv,
        requires_shipping: true,
        weight: 10,
        weight_unit: 'kg',
      }],
      metafields: [
        { namespace: 'ct', key: 'part_number', value: ct.partNumber || '', type: 'single_line_text_field' },
        { namespace: 'ct', key: 'size_raw', value: String(ct.size || ''), type: 'single_line_text_field' },
        { namespace: 'ct', key: 'season', value: season, type: 'single_line_text_field' },
        { namespace: 'ct', key: 'performance', value: ct.performanceCategory || '', type: 'single_line_text_field' },
        { namespace: 'ct', key: 'run_flat', value: String(ct.isRunFlat || false), type: 'single_line_text_field' },
      ],
    },
  };
}

// ─── MAIN ────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`=== Syncing ${BRAND} | offset=${OFFSET} limit=${LIMIT} ===\n`);

  // 1. Fetch from CT
  console.log(`[1] Fetching ${BRAND} tires from Canada Tire...`);
  const allTires = await fetchCTTires(BRAND);
  console.log(`  Total ${BRAND} tires in CT: ${allTires.length}\n`);

  // 2. Slice for this run
  const chunk = allTires.slice(OFFSET, OFFSET + LIMIT);
  console.log(`  This run: products ${OFFSET + 1} to ${OFFSET + chunk.length} of ${allTires.length}\n`);

  if (chunk.length === 0) {
    console.log('  Nothing to process. Done.');
    return;
  }

  // 3. Get existing Shopify SKUs
  console.log('[2] Checking existing Shopify products...');
  const existingSkus = await getExistingSkus();
  console.log(`  ${existingSkus.size} total SKUs in Shopify\n`);

  // 4. Process chunk
  let created = 0, updated = 0, skipped = 0, errors = 0;

  console.log('[3] Processing products...\n');
  for (let i = 0; i < chunk.length; i++) {
    const ct = chunk[i];
    const sku = ct.partNumber;
    const size = parseCTSize(ct.size);
    const label = `[${OFFSET + i + 1}/${allTires.length}] ${ct.brand} ${ct.model} ${size}`;

    try {
      const existing = existingSkus.get(sku);

      if (existing) {
        // Update price if changed
        const newPrice = ct.msrp ? String(ct.msrp) : '0.00';
        if (existing.price !== newPrice) {
          await shopifyAdmin(`/variants/${existing.variantId}.json`, 'PUT', {
            variant: { id: existing.variantId, price: newPrice },
          });
          console.log(`  ${label}: PRICE UPDATED $${existing.price} -> $${newPrice}`);
          updated++;
        } else {
          console.log(`  ${label}: exists, price unchanged`);
          skipped++;
        }
      } else {
        // Create new
        const payload = buildShopifyProduct(ct);
        const result = await shopifyAdmin('/products.json', 'POST', payload);
        console.log(`  ${label}: CREATED (ID: ${result.product.id})`);
        created++;
      }
    } catch (err) {
      console.error(`  ${label}: ERROR - ${err.message}`);
      errors++;
    }

    // Rate limit: pause every product
    await sleep(600);
  }

  console.log(`\n=== DONE ===`);
  console.log(`  Created:   ${created}`);
  console.log(`  Updated:   ${updated}`);
  console.log(`  Skipped:   ${skipped}`);
  console.log(`  Errors:    ${errors}`);

  if (OFFSET + LIMIT < allTires.length) {
    console.log(`\n  Next run: SYNC_OFFSET=${OFFSET + LIMIT} SYNC_LIMIT=${LIMIT}`);
  } else {
    console.log(`\n  All ${BRAND} products synced!`);
  }
}

main().catch(err => {
  console.error('FATAL:', err);
  process.exit(1);
});
