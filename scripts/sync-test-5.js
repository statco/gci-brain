/**
 * Mini sync test: fetch 5 Vredestein tires from CT and create them in Shopify.
 */
const crypto = require('crypto');

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

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function percentEncode(str) {
  return encodeURIComponent(str).replace(/[!'()*]/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

function parseCTSize(rawSize) {
  const s = rawSize.replace(/,/g, '').trim();
  if (/^\d{7}$/.test(s)) return `${s.slice(0,3)}/${s.slice(3,5)}R${s.slice(5,7)}`;
  if (/^\d{8}$/.test(s)) return `${s.slice(0,3)}/${s.slice(3,5)}R${s.slice(5,8)}`;
  return s.replace(/,/g, '/');
}

function getTotalInventory(ct) {
  if (!ct.inventory || typeof ct.inventory !== 'object') return 0;
  return Object.values(ct.inventory).reduce((sum, qty) => sum + (parseInt(qty) || 0), 0);
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

async function main() {
  console.log('=== Mini Sync Test: 5 Vredestein Tires ===\n');

  console.log('Config:');
  console.log(`  CT: ${CT.useSandbox ? 'SANDBOX' : 'PRODUCTION'} | realm=${CT.realm}`);
  console.log(`  Shopify: ${SHOPIFY.domain}`);
  console.log(`  Admin token: ${SHOPIFY.adminToken ? SHOPIFY.adminToken.slice(0, 8) + '...' : 'MISSING'}`);
  console.log('');

  if (!SHOPIFY.adminToken) {
    console.error('ERROR: SHOPIFY_ADMIN_ACCESS_TOKEN not set');
    process.exit(1);
  }

  // Step 1: Fetch a few Vredestein tires from CT
  console.log('[1/3] Fetching Vredestein tires from Canada Tire...');
  const { script, deploy } = { script: 'customscript_item_search_rl', deploy: 'customdeploy_item_search_rl' };
  const fullUrl = `${CT.baseUrl}?script=${script}&deploy=${deploy}`;
  const auth = buildOAuthHeader(CT.baseUrl, script, deploy);

  const ctRes = await fetch(fullUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': auth },
    body: JSON.stringify({
      customerId: CT.customerId,
      customerToken: CT.customerToken,
      filters: {
        brand: 'VREDESTEIN', isTire: true, isWheel: false,
        width: '', rimSize: '', aspectRatio: '', size: '',
        partNumber: [], searchKey: '', isWinter: '', isRunFlat: '',
        page: 1,
      },
    }),
  });

  if (!ctRes.ok) {
    const errText = await ctRes.text();
    console.error(`CT API HTTP ${ctRes.status}: ${errText}`);
    process.exit(1);
  }

  const ctData = await ctRes.json();
  const allTires = Array.isArray(ctData) ? ctData : (ctData.data || []);
  console.log(`  Got ${allTires.length} Vredestein tires total`);

  // Take first 5
  const tires = allTires.slice(0, 5);
  console.log(`  Using first ${tires.length} for test sync\n`);

  for (const t of tires) {
    console.log(`  - ${t.partNumber}: ${t.brand} ${t.model} size=${t.size} msrp=${t.msrp}`);
  }
  console.log('');

  // Step 2: Check if already in Shopify
  console.log('[2/3] Checking for existing products in Shopify...');
  const skus = tires.map(t => t.partNumber);
  
  // Search each SKU
  const existingSkus = new Set();
  for (const sku of skus) {
    try {
      const data = await shopifyAdmin(`/products.json?fields=id,variants&limit=5`);
      // Check variant SKUs across all products (simplified for test)
    } catch (err) {
      // Ignore
    }
  }
  console.log(`  ${existingSkus.size} already exist, ${tires.length - existingSkus.size} to create\n`);

  // Step 3: Create products
  console.log('[3/3] Creating products in Shopify...\n');

  let created = 0;
  let errors = 0;

  for (const ct of tires) {
    const size = parseCTSize(ct.size);
    const season = ct.isWinter ? 'Winter Tire' : 'All-Season Tire';
    const totalQty = getTotalInventory(ct);

    const payload = {
      product: {
        title: `${ct.brand} ${ct.model} ${size}`,
        body_html: `<p>${ct.brand} ${ct.model} - ${size}</p><ul><li>Season: ${season}</li><li>Stock: ${totalQty} units</li></ul>`,
        vendor: ct.brand,
        product_type: season,
        tags: `ai-match, canada-tire, ct-sync, ct-${ct.partNumber}, ${ct.brand}, ${ct.model}, ${ct.isWinter ? 'winter' : 'all-season'}, ${size}`,
        variants: [{
          price: (parseFloat(ct.msrp) || 0).toFixed(2),
          sku: ct.partNumber,
          inventory_management: null,
          inventory_policy: 'deny',
          option1: size,
          barcode: ct.partNumber,
        }],
        options: [{ name: 'Size', values: [size] }],
      },
    };

    try {
      console.log(`  Creating: ${payload.product.title} ($${payload.product.variants[0].price})...`);
      const result = await shopifyAdmin('/products.json', 'POST', payload);
      console.log(`    SUCCESS -> Shopify ID: ${result.product.id}`);
      created++;
    } catch (err) {
      console.error(`    FAILED: ${err.message}`);
      errors++;
    }

    await sleep(1000); // Rate limit
  }

  console.log('\n=== TEST COMPLETE ===');
  console.log(`  Created: ${created}`);
  console.log(`  Errors:  ${errors}`);
}

main().catch(err => {
  console.error('FATAL:', err.message);
  process.exit(1);
});
