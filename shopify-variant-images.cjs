#!/usr/bin/env node
/**
 * shopify-variant-images.js
 *
 * Assigns each product's featured image to its first variant's image field
 * via the Shopify Admin GraphQL API.
 *
 * Usage:
 *   node shopify-variant-images.js              # live run (all products)
 *   node shopify-variant-images.js --dry-run    # preview only, no writes
 *   node shopify-variant-images.js --limit 20   # process at most N products
 *
 * Required env vars:
 *   SHOPIFY_STORE_URL       e.g. my-store.myshopify.com
 *   SHOPIFY_ACCESS_TOKEN    shpat_...
 */

'use strict';

const https = require('https');

// ── Config ──────────────────────────────────────────────────────────────────

const STORE_URL    = (process.env.SHOPIFY_STORE_URL    || '').replace(/^https?:\/\//, '').replace(/\/$/, '');
const ACCESS_TOKEN = process.env.SHOPIFY_ACCESS_TOKEN  || '';

if (!STORE_URL || !ACCESS_TOKEN) {
  console.error('❌  Missing env vars: SHOPIFY_STORE_URL and SHOPIFY_ACCESS_TOKEN are required.');
  process.exit(1);
}

const args    = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const limitArg = args.indexOf('--limit');
const LIMIT   = limitArg !== -1 ? parseInt(args[limitArg + 1], 10) : Infinity;

const PAGE_SIZE = 50; // products per GraphQL page (Shopify max)
const RATE_DELAY_MS = 200; // ms between mutation calls to stay under rate limits

// ── Helpers ──────────────────────────────────────────────────────────────────

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function gqlRequest(query, variables = {}) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ query, variables });
    const opts = {
      hostname: STORE_URL,
      path:     '/admin/api/2024-01/graphql.json',
      method:   'POST',
      headers: {
        'Content-Type':           'application/json',
        'X-Shopify-Access-Token': ACCESS_TOKEN,
        'Content-Length':         Buffer.byteLength(body),
      },
    };

    const req = https.request(opts, res => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode === 429) {
          // Retry-After header or 2s default
          const wait = (parseInt(res.headers['retry-after'] || '2', 10) * 1000);
          setTimeout(() => gqlRequest(query, variables).then(resolve).catch(reject), wait);
          return;
        }
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(new Error(`JSON parse error: ${data.slice(0, 200)}`));
        }
      });
    });

    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// ── GraphQL queries / mutations ───────────────────────────────────────────────

const PRODUCTS_QUERY = `
  query fetchProducts($first: Int!, $after: String) {
    products(first: $first, after: $after) {
      pageInfo { hasNextPage endCursor }
      edges {
        node {
          id
          title
          featuredImage { id url }
          variants(first: 1) {
            edges {
              node {
                id
                image { id url }
              }
            }
          }
        }
      }
    }
  }
`;

const ATTACH_MUTATION = `
  mutation productVariantAppendMedia($productId: ID!, $variantMedia: [ProductVariantAppendMediaInput!]!) {
    productVariantAppendMedia(productId: $productId, variantMedia: $variantMedia) {
      product { id }
      productVariants {
        id
        image { id url }
      }
      userErrors { field message }
    }
  }
`;

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n🛍  Shopify Variant Image Assign`);
  console.log(`   Store:   ${STORE_URL}`);
  console.log(`   Mode:    ${DRY_RUN ? '🔍 DRY RUN (no writes)' : '⚡ LIVE'}`);
  if (LIMIT !== Infinity) console.log(`   Limit:   ${LIMIT} products`);
  console.log('');

  const stats = { processed: 0, updated: 0, alreadySet: 0, skipped: 0, errors: 0 };

  let cursor       = null;
  let hasNextPage  = true;
  let done         = false;

  while (hasNextPage && !done) {
    const toFetch = LIMIT === Infinity ? PAGE_SIZE : Math.min(PAGE_SIZE, LIMIT - stats.processed);
    if (toFetch <= 0) break;

    const resp = await gqlRequest(PRODUCTS_QUERY, { first: toFetch, after: cursor });

    if (resp.errors) {
      console.error('❌  GraphQL errors:', JSON.stringify(resp.errors, null, 2));
      process.exit(1);
    }

    const { edges, pageInfo } = resp.data.products;
    hasNextPage = pageInfo.hasNextPage;
    cursor      = pageInfo.endCursor;

    for (const { node: product } of edges) {
      if (stats.processed >= LIMIT) { done = true; break; }

      stats.processed++;

      const featuredImage = product.featuredImage;
      const variant       = product.variants.edges[0]?.node;

      // No featured image or no variants → skip
      if (!featuredImage) {
        console.log(`  ⊘  [${stats.processed}] ${product.title} — no featured image, skipping`);
        stats.skipped++;
        continue;
      }

      if (!variant) {
        console.log(`  ⊘  [${stats.processed}] ${product.title} — no variants, skipping`);
        stats.skipped++;
        continue;
      }

      // Already has the right image set
      if (variant.image?.id === featuredImage.id) {
        console.log(`  ✓  [${stats.processed}] ${product.title} — already set`);
        stats.alreadySet++;
        continue;
      }

      if (DRY_RUN) {
        console.log(`  →  [${stats.processed}] ${product.title}`);
        console.log(`       would assign: ${featuredImage.url}`);
        console.log(`       to variant:   ${variant.id}`);
        stats.updated++;
        continue;
      }

      // Live: attach the featured image to the first variant
      try {
        const mutResp = await gqlRequest(ATTACH_MUTATION, {
          productId:    product.id,
          variantMedia: [{ variantId: variant.id, mediaIds: [featuredImage.id] }],
        });

        const userErrors = mutResp.data?.productVariantAppendMedia?.userErrors || [];
        if (userErrors.length > 0) {
          console.error(`  ✗  [${stats.processed}] ${product.title} — ${userErrors.map(e => e.message).join('; ')}`);
          stats.errors++;
        } else {
          console.log(`  ✓  [${stats.processed}] ${product.title} — image assigned`);
          stats.updated++;
        }

        await delay(RATE_DELAY_MS);
      } catch (err) {
        console.error(`  ✗  [${stats.processed}] ${product.title} — ${err.message}`);
        stats.errors++;
      }
    }
  }

  console.log('\n──────────────────────────────────────────');
  console.log(`📊  Final stats`);
  console.log(`    Processed:   ${stats.processed}`);
  console.log(`    ${DRY_RUN ? 'Would update:' : 'Updated:     '} ${stats.updated}`);
  console.log(`    Already set: ${stats.alreadySet}`);
  console.log(`    Skipped:     ${stats.skipped}`);
  console.log(`    Errors:      ${stats.errors}`);
  console.log('──────────────────────────────────────────\n');
}

main().catch(err => {
  console.error('❌  Fatal:', err.message);
  process.exit(1);
});
