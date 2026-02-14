// Quick test: verify Shopify Admin API connection

async function main() {
  const domain = process.env.SHOPIFY_STORE_DOMAIN || process.env.VITE_SHOPIFY_STORE_DOMAIN || '';
  const token  = process.env.SHOPIFY_ADMIN_ACCESS_TOKEN || '';

  console.log('Shopify Admin API Test');
  console.log('Domain:', domain ? domain : 'MISSING');
  console.log('Token:',  token ? `${token.slice(0, 8)}...${token.slice(-4)}` : 'MISSING');

  if (!domain || !token) {
    console.error('Missing SHOPIFY_STORE_DOMAIN or SHOPIFY_ADMIN_ACCESS_TOKEN');
    return;
  }

  // Test 1: Get shop info
  console.log('\n--- Test 1: Get shop info ---');
  try {
    const res = await fetch(`https://${domain}/admin/api/2024-01/shop.json`, {
      headers: { 'X-Shopify-Access-Token': token, 'Content-Type': 'application/json' },
    });
    console.log('HTTP Status:', res.status);
    if (res.ok) {
      const data = await res.json();
      console.log('Shop name:', data.shop?.name);
      console.log('Shop email:', data.shop?.email);
    } else {
      console.log('Response:', await res.text());
    }
  } catch (err) {
    console.error('Error:', err.message);
  }

  // Test 2: Count existing products
  console.log('\n--- Test 2: Count products ---');
  try {
    const res = await fetch(`https://${domain}/admin/api/2024-01/products/count.json`, {
      headers: { 'X-Shopify-Access-Token': token, 'Content-Type': 'application/json' },
    });
    console.log('HTTP Status:', res.status);
    if (res.ok) {
      const data = await res.json();
      console.log('Total products:', data.count);
    } else {
      console.log('Response:', await res.text());
    }
  } catch (err) {
    console.error('Error:', err.message);
  }

  // Test 3: Check for existing canada-tire tagged products
  console.log('\n--- Test 3: Existing canada-tire products ---');
  try {
    const res = await fetch(`https://${domain}/admin/api/2024-01/products.json?limit=5&fields=id,title,tags`, {
      headers: { 'X-Shopify-Access-Token': token, 'Content-Type': 'application/json' },
    });
    console.log('HTTP Status:', res.status);
    if (res.ok) {
      const data = await res.json();
      console.log('First 5 products:');
      for (const p of data.products || []) {
        console.log(`  - ${p.title} [tags: ${p.tags || 'none'}]`);
      }
    } else {
      console.log('Response:', await res.text());
    }
  } catch (err) {
    console.error('Error:', err.message);
  }
}

main();
