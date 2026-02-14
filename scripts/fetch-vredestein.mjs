/**
 * Fetch all Vredestein branded tires from Canada Tire API.
 * Uses the same OAuth 1.0 HMAC-SHA256 signing as api/canadaTire.ts.
 */

import crypto from 'crypto';

// ── Config from environment ──────────────────────────────────────────────────
const CONFIG = {
  consumerKey:    process.env.CT_CONSUMER_KEY    || '',
  consumerSecret: process.env.CT_CONSUMER_SECRET || '',
  tokenId:        process.env.CT_TOKEN_ID        || '',
  tokenSecret:    process.env.CT_TOKEN_SECRET    || '',
  customerId:     process.env.CT_CUSTOMER_NUMBER || '19997',
  customerToken:  process.env.CT_CUSTOMER_API_TOKEN || '',
  useSandbox:     (process.env.CT_USE_SANDBOX ?? 'true') === 'true',
  get realm()   { return this.useSandbox ? '8031691_SB1' : '8031691'; },
  get baseUrl() { return `https://${this.realm}.restlets.api.netsuite.com/app/site/hosting/restlet.nl`; },
};

const SCRIPTS = {
  tireSearch: { script: 'customscript_gci_tire_search', deploy: 'customdeploy_gci_tire_search' },
};

// ── OAuth 1.0 HMAC-SHA256 ────────────────────────────────────────────────────
function percentEncode(str) {
  return encodeURIComponent(str).replace(/[!'()*]/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

function buildOAuthHeader(url, method = 'POST') {
  const nonce     = crypto.randomBytes(16).toString('hex');
  const timestamp = Math.floor(Date.now() / 1000).toString();

  const params = {
    oauth_consumer_key:     CONFIG.consumerKey,
    oauth_nonce:            nonce,
    oauth_signature_method: 'HMAC-SHA256',
    oauth_timestamp:        timestamp,
    oauth_token:            CONFIG.tokenId,
    oauth_version:          '1.0',
  };

  const baseString = [
    method.toUpperCase(),
    percentEncode(url),
    percentEncode(
      Object.keys(params).sort()
        .map(k => `${percentEncode(k)}=${percentEncode(params[k])}`)
        .join('&')
    ),
  ].join('&');

  const signingKey = `${percentEncode(CONFIG.consumerSecret)}&${percentEncode(CONFIG.tokenSecret)}`;
  const signature  = crypto.createHmac('sha256', signingKey).update(baseString).digest('base64');

  return `OAuth realm="${CONFIG.realm}", ` +
    Object.keys({ ...params, oauth_signature: signature }).sort()
      .map(k => `${percentEncode(k)}="${percentEncode(k === 'oauth_signature' ? signature : params[k])}"`)
      .join(', ');
}

// ── POST helper ──────────────────────────────────────────────────────────────
async function ctPost(scriptKey, body) {
  const { script, deploy } = SCRIPTS[scriptKey];
  const url = `${CONFIG.baseUrl}?script=${script}&deploy=${deploy}`;
  const auth = buildOAuthHeader(url);

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': auth,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`HTTP ${response.status}: ${text}`);
  }

  const json = await response.json();
  if (json.success === false) {
    throw new Error(`API error: ${JSON.stringify(json)}`);
  }
  return json;
}

// ── Fetch Vredestein tires across multiple pages ─────────────────────────────
async function fetchAllVredestein() {
  console.log('=== Fetching Vredestein Tires from Canada Tire ===\n');
  console.log(`Environment: ${CONFIG.useSandbox ? 'SANDBOX' : 'PRODUCTION'}`);
  console.log(`Realm: ${CONFIG.realm}`);
  console.log(`Customer ID: ${CONFIG.customerId}\n`);

  // Check credentials
  if (!CONFIG.consumerKey || !CONFIG.tokenId || !CONFIG.customerToken) {
    console.error('ERROR: Missing CT environment variables. Make sure these are set:');
    console.error('  CT_CONSUMER_KEY, CT_CONSUMER_SECRET, CT_TOKEN_ID, CT_TOKEN_SECRET, CT_CUSTOMER_API_TOKEN');
    process.exit(1);
  }

  let allTires = [];
  let page = 1;
  let hasMore = true;

  while (hasMore) {
    console.log(`Fetching page ${page}...`);

    const result = await ctPost('tireSearch', {
      customerId:    CONFIG.customerId,
      customerToken: CONFIG.customerToken,
      filters: {
        brand:       'VREDESTEIN',
        isTire:      true,
        isWheel:     false,
        width:       '',
        rimSize:     '',
        aspectRatio: '',
        size:        '',
        partNumber:  [],
        searchKey:   '',
        isWinter:    '',
        isRunFlat:   '',
        page:        page,
      },
    });

    const tires = Array.isArray(result) ? result : (result.data || []);
    console.log(`  -> Page ${page}: ${tires.length} tires returned`);

    if (tires.length === 0) {
      hasMore = false;
    } else {
      allTires = allTires.concat(tires);
      page++;
    }

    // Safety limit
    if (page > 50) {
      console.log('  Reached page limit (50), stopping.');
      hasMore = false;
    }
  }

  console.log(`\n========================================`);
  console.log(`Total Vredestein tires found: ${allTires.length}`);
  console.log(`========================================\n`);

  if (allTires.length === 0) {
    console.log('No Vredestein tires found. Possible reasons:');
    console.log('  1. The brand name might differ in CT system (try "Vredestein" vs "VREDESTEIN")');
    console.log('  2. Vredestein may not be available for customer account ' + CONFIG.customerId);
    console.log('  3. The sandbox environment may have limited data');
    console.log('\nTrying with searchKey instead of brand filter...\n');

    // Retry with searchKey
    const retryResult = await ctPost('tireSearch', {
      customerId:    CONFIG.customerId,
      customerToken: CONFIG.customerToken,
      filters: {
        brand:       '',
        isTire:      true,
        isWheel:     false,
        width:       '',
        rimSize:     '',
        aspectRatio: '',
        size:        '',
        partNumber:  [],
        searchKey:   'VREDESTEIN',
        isWinter:    '',
        isRunFlat:   '',
        page:        1,
      },
    });

    const retryTires = Array.isArray(retryResult) ? retryResult : (retryResult.data || []);
    console.log(`searchKey="VREDESTEIN" returned: ${retryTires.length} tires\n`);

    if (retryTires.length > 0) {
      allTires = retryTires;
      console.log('Found tires via searchKey! The brand field value in CT may differ from "VREDESTEIN".');
      console.log(`Actual brand value: "${retryTires[0].brand}"\n`);
    } else {
      console.log('Still no results. Vredestein may not be in this CT account/environment.');
      return;
    }
  }

  // Print summary
  allTires.forEach((tire, i) => {
    console.log(`[${i + 1}] ${tire.name || tire.partNumber}`);
    console.log(`    Part#:   ${tire.partNumber}`);
    console.log(`    Brand:   ${tire.brand}`);
    console.log(`    Size:    ${tire.size || `${tire.width}/${tire.aspectRatio}R${tire.rimSize}`}`);
    console.log(`    MSRP:    $${tire.msrp}`);
    console.log(`    Season:  Winter=${tire.isWinter}, RunFlat=${tire.isRunFlat}`);
    console.log(`    Stock:   ${JSON.stringify(tire.inventory || 'N/A')}`);
    console.log('');
  });

  // Print raw JSON of first tire for field inspection
  console.log('--- Raw JSON (first tire) ---');
  console.log(JSON.stringify(allTires[0], null, 2));
}

fetchAllVredestein().catch(err => {
  console.error('FATAL ERROR:', err.message);
  process.exit(1);
});
