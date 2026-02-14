const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// CT config - copied from working fetch-vredestein.js
const CT = {
  consumerKey:    process.env.CT_CONSUMER_KEY,
  consumerSecret: process.env.CT_CONSUMER_SECRET,
  tokenId:        process.env.CT_TOKEN_ID,
  tokenSecret:    process.env.CT_TOKEN_SECRET,
  customerId:     process.env.CT_CUSTOMER_NUMBER || '19997',
  customerToken:  process.env.CT_CUSTOMER_API_TOKEN,
  useSandbox:     process.env.CT_USE_SANDBOX !== 'false',
  get realm()   { return this.useSandbox ? '8031691_SB1' : '8031691'; },
  get baseUrl() {
    return this.useSandbox
      ? 'https://8031691-sb1.restlets.api.netsuite.com/app/site/hosting/restlet.nl'
      : 'https://8031691.restlets.api.netsuite.com/app/site/hosting/restlet.nl';
  },
};

const SCRIPT = 'customscript_item_search_rl';
const DEPLOY = 'customdeploy_item_search_rl';

function pctEnc(s) { return encodeURIComponent(s).replace(/[!'()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase()); }

function oauthHeader(baseUrl) {
  const nonce = crypto.randomBytes(16).toString('hex');
  const ts    = Math.floor(Date.now() / 1000).toString();
  const p = { deploy: DEPLOY, oauth_consumer_key: CT.consumerKey, oauth_nonce: nonce, oauth_signature_method: 'HMAC-SHA256', oauth_timestamp: ts, oauth_token: CT.tokenId, oauth_version: '1.0', script: SCRIPT };
  const paramStr = Object.keys(p).sort().map(k => `${pctEnc(k)}=${pctEnc(p[k])}`).join('&');
  const base = ['POST', pctEnc(baseUrl), pctEnc(paramStr)].join('&');
  const key  = `${pctEnc(CT.consumerSecret)}&${pctEnc(CT.tokenSecret)}`;
  const sig  = crypto.createHmac('sha256', key).update(base).digest('base64');
  return [`OAuth realm="${CT.realm}"`, `oauth_consumer_key="${CT.consumerKey}"`, `oauth_token="${CT.tokenId}"`, `oauth_signature_method="HMAC-SHA256"`, `oauth_timestamp="${ts}"`, `oauth_nonce="${nonce}"`, `oauth_version="1.0"`, `oauth_signature="${pctEnc(sig)}"`].join(', ');
}

async function main() {
  console.log('Fetching ALL tires from CT (no brand filter)...');
  const url = `${CT.baseUrl}?script=${SCRIPT}&deploy=${DEPLOY}`;
  const auth = oauthHeader(CT.baseUrl);

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': auth },
    body: JSON.stringify({
      customerId: CT.customerId,
      customerToken: CT.customerToken,
      filters: { brand: '', isTire: true, isWheel: false, isWinter: '', width: '', aspectRatio: '', rimSize: '', size: '', partNumber: [], searchKey: '', isRunFlat: '', page: 1 },
    }),
  });

  if (!res.ok) {
    console.error(`HTTP ${res.status}: ${await res.text()}`);
    return;
  }

  const data = await res.json();
  const items = Array.isArray(data) ? data : (data.data || []);
  console.log(`Got ${items.length} tires total`);

  // Count brands
  const brands = {};
  items.forEach(t => { brands[t.brand] = (brands[t.brand] || 0) + 1; });
  console.log('\nBrands found:');
  Object.entries(brands).sort((a, b) => b[1] - a[1]).forEach(([b, c]) => console.log(`  ${b}: ${c}`));

  // Save to JSON
  const outPath = path.join(__dirname, 'ct-all-tires.json');
  fs.writeFileSync(outPath, JSON.stringify(items, null, 0));
  console.log(`\nSaved ${items.length} tires to ${outPath}`);
}

main().catch(e => console.error('FATAL:', e));
