/**
 * Fast sync: Takes CT tires already fetched and saved to a JSON file,
 * then creates them in Shopify. No CT API call needed.
 * 
 * Step 1: Run fetch-vredestein.js to save tires to file
 * Step 2: Run this script to push them to Shopify in small batches
 */

const crypto = require('crypto');

const SHOPIFY = {
  domain:     process.env.SHOPIFY_STORE_DOMAIN || process.env.VITE_SHOPIFY_STORE_DOMAIN || '',
  adminToken: process.env.SHOPIFY_ADMIN_ACCESS_TOKEN || '',
  apiVersion: '2024-01',
};

// --- EDIT FOR EACH RUN ---
const OFFSET = 5;  // Skip first N (already synced from test-5)
const LIMIT  = 10; // How many to create this run
// -------------------------

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function parseCTSize(rawSize) {
  const s = String(rawSize || '').replace(/,/g, '').trim();
  if (/^\d{7}$/.test(s)) return `${s.slice(0,3)}/${s.slice(3,5)}R${s.slice(5)}`;
  if (/^\d{6}$/.test(s)) return `${s.slice(0,2)}/${s.slice(2,4)}R${s.slice(4)}`;
  return s;
}

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
    const retry = parseInt(res.headers.get('Retry-After') || '4', 10);
    console.log(`  Rate limited, waiting ${retry}s...`);
    await sleep(retry * 1000);
    return shopifyAdmin(endpoint, method, body);
  }
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Shopify ${method} ${endpoint}: ${res.status} ${text}`);
  }
  return res.status === 204 ? null : res.json();
}

function buildShopifyProduct(ct) {
  const size = parseCTSize(ct.size);
  const season = ct.isWinter ? 'Winter' : 'All-Season';
  const title = `${ct.brand} ${ct.model || ct.name || ''} ${size} ${season}`.replace(/\s+/g, ' ').trim();
  const rawPrice = typeof ct.msrp === 'string' ? parseFloat(ct.msrp.replace(/[^0-9.]/g, '')) : (ct.msrp || 0);
  const price = (isNaN(rawPrice) ? 0 : rawPrice).toFixed(2);

  const tags = [
    'ai-match', 'canada-tire', 'ct-sync',
    `ct-${ct.partNumber}`, ct.brand, ct.model || '',
    season, size,
  ].filter(Boolean).join(', ');

  return {
    product: {
      title,
      vendor: ct.brand,
      product_type: 'Tires',
      tags,
      status: 'active',
      body_html: `<p>${title}</p><ul><li>Part: ${ct.partNumber}</li><li>Size: ${size}</li><li>Season: ${season}</li><li>Performance: ${ct.performanceCategory || 'N/A'}</li></ul>`,
      variants: [{
        sku: ct.partNumber,
        price,
        inventory_management: null,
        requires_shipping: true,
        weight: 10,
        weight_unit: 'kg',
      }],
    },
  };
}

// ── CT OAuth + fetch (copied from working fetch-vredestein.js) ──────────────

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

function percentEncode(str) {
  return encodeURIComponent(str).replace(/[!'()*]/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

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

async function fetchCTPage(brand, page) {
  const script = 'customscript_item_search_rl';
  const deploy = 'customdeploy_item_search_rl';
  const fullUrl = `${CT.baseUrl}?script=${script}&deploy=${deploy}`;
  const auth = buildOAuthHeader(CT.baseUrl, script, deploy);

  const res = await fetch(fullUrl, {
    method: 'POST',
    headers: { 'Authorization': auth, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      customerId: CT.customerId,
      customerToken: CT.customerToken,
      filters: {
        brand, isTire: true, isWheel: false, isWinter: '',
        width: '', aspectRatio: '', rimSize: '', size: '',
        partNumber: [], searchKey: '', isRunFlat: '', page,
      },
    }),
  });

  if (!res.ok) throw new Error(`CT HTTP ${res.status}: ${await res.text()}`);
  const data = await res.json();
  if (data.success === false) throw new Error(data.error?.errorMsg || 'CT error');
  return Array.isArray(data) ? data : (data.data || []);
}

// ── MAIN ────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`=== Fast Sync: VREDESTEIN | offset=${OFFSET} limit=${LIMIT} ===\n`);
  console.log(`Shopify: ${SHOPIFY.domain}`);

  if (!SHOPIFY.adminToken) { console.error('Missing SHOPIFY_ADMIN_ACCESS_TOKEN'); return; }

  // Fetch just enough pages from CT
  console.log('\n[1] Fetching VREDESTEIN tires from CT...');
  let allTires = [];
  let page = 1;
  const neededTotal = OFFSET + LIMIT;

  // CT returns all results in a single page, so just fetch once
  console.log('  Page 1...');
  const items = await fetchCTPage('VREDESTEIN', 1);
  allTires = items;
  console.log(`  Got ${allTires.length} items`);

  // Slice the chunk we need
  const chunk = allTires.slice(OFFSET, OFFSET + LIMIT);
  console.log(`\n[2] Creating ${chunk.length} products in Shopify (offset ${OFFSET})...\n`);

  let created = 0, errors = 0;
  for (let i = 0; i < chunk.length; i++) {
    const ct = chunk[i];
    const product = buildShopifyProduct(ct);
    try {
      const result = await shopifyAdmin('/products.json', 'POST', product);
      console.log(`  [${OFFSET + i + 1}] Created: ${result.product.title} (ID: ${result.product.id})`);
      created++;
    } catch (err) {
      console.error(`  [${OFFSET + i + 1}] ERROR: ${ct.partNumber} - ${err.message.slice(0, 100)}`);
      errors++;
    }
    await sleep(600); // Stay under Shopify rate limit
  }

  console.log(`\n=== DONE ===`);
  console.log(`Created: ${created} | Errors: ${errors}`);
  console.log(`Next run: set OFFSET = ${OFFSET + LIMIT}`);
}

main().catch(e => { console.error('FATAL:', e); });
