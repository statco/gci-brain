const crypto = require('crypto');

// ─── Shopify Config ──────────────────────────────────────────────────────────
const SHOPIFY_DOMAIN = process.env.SHOPIFY_STORE_DOMAIN || process.env.VITE_SHOPIFY_STORE_DOMAIN;
const SHOPIFY_ADMIN  = process.env.SHOPIFY_ADMIN_ACCESS_TOKEN;

// ─── Canada Tire Config ──────────────────────────────────────────────────────
const CT = {
  consumerKey:    (process.env.CT_CONSUMER_KEY    || '').trim(),
  consumerSecret: (process.env.CT_CONSUMER_SECRET || '').trim(),
  tokenId:        (process.env.CT_TOKEN_ID        || '').trim(),
  tokenSecret:    (process.env.CT_TOKEN_SECRET    || '').trim(),
  customerId:     (process.env.CT_CUSTOMER_NUMBER  || '').trim(),
  customerToken:  (process.env.CT_CUSTOMER_API_TOKEN || '').trim(),
  useSandbox:     process.env.CT_USE_SANDBOX !== 'false',
  get realm()   { return this.useSandbox ? '8031691_SB1' : '8031691'; },
  get baseUrl() {
    return this.useSandbox
      ? 'https://8031691-sb1.restlets.api.netsuite.com/app/site/hosting/restlet.nl'
      : 'https://8031691.restlets.api.netsuite.com/app/site/hosting/restlet.nl';
  },
};

const SCRIPTS = {
  tireSearch: { script: 'customscript_item_search_rl', deploy: 'customdeploy_item_search_rl' },
};

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const pctEnc = (s) => encodeURIComponent(s).replace(/[!'()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase());

// ─── OAuth ──────────────────────────────────────────────────────────────────
function buildOAuthHeader(baseUrl, script, deploy) {
  const nonce     = crypto.randomBytes(16).toString('hex');
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const sigParams = {
    deploy,
    oauth_consumer_key: CT.consumerKey, oauth_nonce: nonce,
    oauth_signature_method: 'HMAC-SHA256', oauth_timestamp: timestamp,
    oauth_token: CT.tokenId, oauth_version: '1.0', script,
  };
  const paramStr   = Object.keys(sigParams).sort().map(k => `${pctEnc(k)}=${pctEnc(sigParams[k])}`).join('&');
  const baseString = ['POST', pctEnc(baseUrl), pctEnc(paramStr)].join('&');
  const sigKey     = `${pctEnc(CT.consumerSecret)}&${pctEnc(CT.tokenSecret)}`;
  const signature  = crypto.createHmac('sha256', sigKey).update(baseString).digest('base64');
  return [
    `OAuth realm="${CT.realm}"`, `oauth_consumer_key="${CT.consumerKey}"`,
    `oauth_token="${CT.tokenId}"`, `oauth_signature_method="HMAC-SHA256"`,
    `oauth_timestamp="${timestamp}"`, `oauth_nonce="${nonce}"`,
    `oauth_version="1.0"`, `oauth_signature="${pctEnc(signature)}"`,
  ].join(', ');
}

// ─── Shopify Admin API ──────────────────────────────────────────────────────
async function shopifyAdmin(endpoint, method = 'GET', body = null) {
  const url = `https://${SHOPIFY_DOMAIN}/admin/api/2024-01${endpoint}`;
  const opts = {
    method,
    headers: { 'X-Shopify-Access-Token': SHOPIFY_ADMIN, 'Content-Type': 'application/json' },
  };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(url, opts);
  if (res.status === 429) {
    const retry = parseInt(res.headers.get('Retry-After') || '2', 10);
    console.log(`  Rate limited, waiting ${retry}s...`);
    await sleep(retry * 1000);
    return shopifyAdmin(endpoint, method, body);
  }
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Shopify ${method} ${endpoint}: ${res.status} - ${text}`);
  }
  return res.json();
}

// ─── Fetch CT inventory for a brand ─────────────────────────────────────────
async function fetchCTInventory(brand) {
  const { script, deploy } = SCRIPTS.tireSearch;
  const fullUrl = `${CT.baseUrl}?script=${script}&deploy=${deploy}`;
  const auth    = buildOAuthHeader(CT.baseUrl, script, deploy);

  const body = {
    customerId: CT.customerId,
    customerToken: CT.customerToken,
    filters: {
      brand, isTire: true, isWheel: false, isWinter: '',
      width: '', aspectRatio: '', rimSize: '', size: '',
      partNumber: [], searchKey: '', isRunFlat: '', page: 1,
    },
  };

  const res = await fetch(fullUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: auth },
    body: JSON.stringify(body),
  });

  if (!res.ok) throw new Error(`CT API: ${res.status}`);
  const data = await res.json();
  const items = Array.isArray(data) ? data : (data.data || []);

  // Build lookup: partNumber -> totalInventory
  const invMap = {};
  for (const item of items) {
    const totalInv = (item.inventory || []).reduce((sum, loc) => sum + (loc.quantity || 0), 0);
    invMap[item.partNumber] = totalInv;
  }
  return invMap;
}

// ─── Fetch untracked Shopify products ───────────────────────────────────────
async function getUntrackedProducts(brand) {
  const untracked = [];
  let sinceId = 0;

  while (true) {
    const params = new URLSearchParams({ limit: '250', fields: 'id,title,variants,tags' });
    if (sinceId) params.set('since_id', sinceId.toString());

    const data = await shopifyAdmin(`/products.json?${params.toString()}`);
    const products = data.products || [];

    for (const p of products) {
      const tags = (p.tags || '').toUpperCase();
      if (tags.includes(brand.toUpperCase()) || tags.includes('CT-SYNC')) {
        for (const v of p.variants) {
          if (v.inventory_management === null || v.inventory_management === '') {
            untracked.push({
              productId: p.id,
              variantId: v.id,
              sku: v.sku,
              title: p.title,
              inventoryItemId: v.inventory_item_id,
            });
          }
        }
      }
      if (p.id > sinceId) sinceId = p.id;
    }

    if (products.length < 250) break;
    await sleep(500);
  }

  return untracked;
}

// ─── MAIN ───────────────────────────────────────────────────────────────────
async function main() {
  console.log('=== FIX INVENTORY TRACKING ===\n');
  console.log(`Shopify: ${SHOPIFY_DOMAIN}`);
  console.log(`CT Env:  ${CT.useSandbox ? 'SANDBOX' : 'PRODUCTION'}\n`);

  // Step 1: Find all untracked CT products in Shopify
  console.log('Step 1: Finding untracked products in Shopify...');
  const untracked = await getUntrackedProducts('VREDESTEIN');
  console.log(`  Found ${untracked.length} untracked variants\n`);

  if (untracked.length === 0) {
    console.log('All products already tracked. Done!');
    return;
  }

  // Step 2: Get CT inventory data
  console.log('Step 2: Fetching Canada Tire inventory...');
  const invMap = await fetchCTInventory('VREDESTEIN');
  console.log(`  Got inventory for ${Object.keys(invMap).length} CT products\n`);

  // Step 3: Update each untracked variant
  // Process max 40 to stay within sandbox timeout
  const batch = untracked.slice(0, 40);
  console.log(`Step 3: Updating ${batch.length} variants (of ${untracked.length} total)...\n`);

  let fixed = 0, errors = 0;

  for (const item of batch) {
    const inv = invMap[item.sku] || 0;
    try {
      // Update variant to enable inventory tracking
      await shopifyAdmin(`/variants/${item.variantId}.json`, 'PUT', {
        variant: {
          id: item.variantId,
          inventory_management: 'shopify',
        },
      });

      // Set inventory level via inventory_levels/set
      // First get the location ID from the inventory item
      const invItemData = await shopifyAdmin(`/inventory_items/${item.inventoryItemId}.json`);
      
      // Get the shop's locations
      if (fixed === 0) {
        // Cache location ID on first iteration
        const locData = await shopifyAdmin('/locations.json');
        global._locationId = locData.locations[0]?.id;
      }

      if (global._locationId) {
        await shopifyAdmin('/inventory_levels/set.json', 'POST', {
          location_id: global._locationId,
          inventory_item_id: item.inventoryItemId,
          available: inv,
        });
      }

      fixed++;
      console.log(`  [${fixed}/${batch.length}] ${item.title} -> ${inv} units`);
      await sleep(800); // Rate limit
    } catch (err) {
      errors++;
      console.error(`  ERROR: ${item.title}: ${err.message}`);
      await sleep(500);
    }
  }

  console.log(`\n=== DONE ===`);
  console.log(`Fixed: ${fixed} | Errors: ${errors} | Remaining: ${untracked.length - batch.length}`);
  if (untracked.length > batch.length) {
    console.log(`\nRun again to fix the next ${untracked.length - batch.length} products.`);
  }
}

main().catch(err => { console.error('FATAL:', err); process.exit(1); });
