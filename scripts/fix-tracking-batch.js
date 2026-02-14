const SHOPIFY_DOMAIN = process.env.SHOPIFY_STORE_DOMAIN || process.env.VITE_SHOPIFY_STORE_DOMAIN;
const SHOPIFY_TOKEN  = process.env.SHOPIFY_ADMIN_ACCESS_TOKEN;

// --- EDIT FOR EACH RUN ---
const BATCH_SIZE = 20;       // products per run
const SINCE_ID   = 0;        // set to last processed ID from previous run output
// -------------------------

async function shopifyGet(path) {
  const res = await fetch(`https://${SHOPIFY_DOMAIN}/admin/api/2024-01${path}`, {
    headers: { 'X-Shopify-Access-Token': SHOPIFY_TOKEN, 'Content-Type': 'application/json' },
  });
  if (!res.ok) throw new Error(`Shopify GET ${path}: ${res.status} ${await res.text()}`);
  return res.json();
}

async function shopifyPut(path, body) {
  const res = await fetch(`https://${SHOPIFY_DOMAIN}/admin/api/2024-01${path}`, {
    method: 'PUT',
    headers: { 'X-Shopify-Access-Token': SHOPIFY_TOKEN, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Shopify PUT ${path}: ${res.status} ${await res.text()}`);
  return res.json();
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  console.log(`Store: ${SHOPIFY_DOMAIN}`);
  console.log(`Fetching products (since_id=${SINCE_ID}, limit=${BATCH_SIZE})...\n`);

  // Fetch a batch of Vredestein products
  const params = new URLSearchParams({
    limit: String(BATCH_SIZE),
    vendor: 'VREDESTEIN',
    fields: 'id,title,variants',
  });
  if (SINCE_ID) params.set('since_id', String(SINCE_ID));

  const data = await shopifyGet(`/products.json?${params.toString()}`);
  const products = data.products || [];
  console.log(`Found ${products.length} products in this batch\n`);

  if (products.length === 0) {
    console.log('No more products to process. Done!');
    return;
  }

  let fixed = 0, skipped = 0, lastId = 0;

  for (const product of products) {
    lastId = product.id;
    for (const variant of product.variants) {
      if (variant.inventory_management === 'shopify') {
        skipped++;
        continue;
      }

      // Enable inventory tracking on this variant
      console.log(`Enabling tracking: ${product.title} (variant ${variant.id})...`);
      try {
        await shopifyPut(`/variants/${variant.id}.json`, {
          variant: {
            id: variant.id,
            inventory_management: 'shopify',
          },
        });
        fixed++;
        console.log(`  OK`);
      } catch (err) {
        console.error(`  FAILED: ${err.message}`);
      }
      await sleep(500); // rate limit
    }
  }

  console.log(`\n--- BATCH COMPLETE ---`);
  console.log(`Fixed: ${fixed}, Already tracked: ${skipped}`);
  console.log(`Last product ID: ${lastId}`);
  if (products.length === BATCH_SIZE) {
    console.log(`\nMore products remain. Set SINCE_ID = ${lastId} and run again.`);
  } else {
    console.log(`\nAll Vredestein products processed!`);
  }
}

main().catch(err => console.error('FATAL:', err.message));
