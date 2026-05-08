/**
 * scripts/backfill-missing-images.ts
 *
 * One-time (and re-runnable) script that:
 *   1. Fetches all Active Shopify products that have no image
 *   2. Resolves an image URL from the CDN chain (Tire Rack → SimpleTire → Les Schwab)
 *   3. Uploads the resolved image URL to Shopify via the REST Admin API
 *
 * Run:
 *   npx ts-node -r tsconfig-paths/register scripts/backfill-missing-images.ts
 *
 * Env vars required (same as the rest of gci-brain):
 *   SHOPIFY_STORE_DOMAIN   — e.g. gcitires.myshopify.com
 *   SHOPIFY_ADMIN_TOKEN    — Admin API access token
 *
 * Dry-run mode (no writes to Shopify):
 *   DRY_RUN=true npx ts-node ... scripts/backfill-missing-images.ts
 */

import { resolveProductImagesBatch } from "../lib/image-cdn";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const SHOPIFY_DOMAIN = process.env.SHOPIFY_STORE_DOMAIN!;
const SHOPIFY_TOKEN = process.env.SHOPIFY_ADMIN_TOKEN!;
const DRY_RUN = process.env.DRY_RUN === "true";
const API_VERSION = "2025-01"; // keep in sync with rest of gci-brain

const BASE_URL = `https://${SHOPIFY_DOMAIN}/admin/api/${API_VERSION}`;

const headers = {
  "X-Shopify-Access-Token": SHOPIFY_TOKEN,
  "Content-Type": "application/json",
};

// ---------------------------------------------------------------------------
// Shopify helpers
// ---------------------------------------------------------------------------

interface ShopifyProduct {
  id: number;
  title: string;
  status: string;
  images: { id: number; src: string }[];
  metafields?: { namespace: string; key: string; value: string }[];
}

/** Paginate through all Active products, yielding each page. */
async function* fetchActiveProducts(): AsyncGenerator<ShopifyProduct[]> {
  let url: string | null =
    `${BASE_URL}/products.json?status=active&fields=id,title,status,images&limit=250`;

  while (url) {
    const res = await fetch(url, { headers });
    if (!res.ok) throw new Error(`Shopify error ${res.status}: ${await res.text()}`);
    const data = (await res.json()) as { products: ShopifyProduct[] };
    yield data.products;

    // Follow Link header for next page
    const link = res.headers.get("link") ?? "";
    const next = link.match(/<([^>]+)>;\s*rel="next"/)?.[1] ?? null;
    url = next;
  }
}

/**
 * Upload an image to a Shopify product by URL.
 * Shopify fetches the image from the URL and stores it on its own CDN.
 */
async function uploadImageToShopify(
  productId: number,
  imageUrl: string
): Promise<boolean> {
  const res = await fetch(`${BASE_URL}/products/${productId}/images.json`, {
    method: "POST",
    headers,
    body: JSON.stringify({ image: { src: imageUrl, position: 1 } }),
  });
  return res.ok;
}

// ---------------------------------------------------------------------------
// Brand/model extractor
// ---------------------------------------------------------------------------

/**
 * Extracts brand and model from a product title.
 * Title format: "{Brand} {Model} {Size}"  e.g. "Vredestein Pinza HT 225/65R17"
 *
 * The size always starts with digits matching \d{2,3}/\d{2,3}.
 * Everything before it is "Brand Model".
 * The first token is the brand; the rest is the model.
 */
function extractBrandModel(
  title: string
): { brand: string; model: string } | null {
  const match = title.match(/^(.+?)\s+\d{2,4}[\/R\-].+$/i);
  if (!match) return null;

  const brandModel = match[1].trim().split(/\s+/);
  if (brandModel.length < 2) return null;

  const brand = brandModel[0];
  const model = brandModel.slice(1).join(" ");
  return { brand, model };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log(`\n=== GCI Tires Image Backfill ===`);
  console.log(`Mode: ${DRY_RUN ? "DRY RUN (no writes)" : "LIVE"}`);
  console.log(`Store: ${SHOPIFY_DOMAIN}\n`);

  // 1. Collect all products missing images
  const missing: { id: number; title: string; brand: string; model: string }[] = [];
  let scanned = 0;

  for await (const page of fetchActiveProducts()) {
    for (const product of page) {
      scanned++;
      if (product.images.length === 0) {
        const parsed = extractBrandModel(product.title);
        if (parsed) {
          missing.push({ id: product.id, title: product.title, ...parsed });
        } else {
          console.warn(`  [SKIP] Could not parse brand/model: "${product.title}"`);
        }
      }
    }
  }

  console.log(`Scanned ${scanned} active products.`);
  console.log(`Found ${missing.length} products with no image.\n`);

  if (missing.length === 0) {
    console.log("✅ Nothing to do.");
    return;
  }

  // 2. Deduplicate brand+model pairs for CDN resolution (avoids probing same CDN N times)
  const uniquePairs = [
    ...new Map(missing.map((p) => [`${p.brand}::${p.model}`, p])).values(),
  ].map((p) => ({ brand: p.brand, model: p.model }));

  console.log(`Resolving images for ${uniquePairs.length} unique brand/model pairs…`);
  const imageMap = await resolveProductImagesBatch(uniquePairs, 5);

  let resolved = 0;
  let notFound = 0;
  let uploaded = 0;
  let failed = 0;

  // 3. Upload images to Shopify
  for (const product of missing) {
    const key = `${product.brand}::${product.model}`;
    const imageUrl = imageMap.get(key) ?? null;

    if (!imageUrl) {
      console.warn(`  [NOT FOUND] ${product.title} (id: ${product.id})`);
      notFound++;
      continue;
    }

    resolved++;
    console.log(`  [FOUND] ${product.title}`);
    console.log(`          → ${imageUrl}`);

    if (DRY_RUN) continue;

    const ok = await uploadImageToShopify(product.id, imageUrl);
    if (ok) {
      console.log(`          ✅ Uploaded`);
      uploaded++;
    } else {
      console.error(`          ❌ Upload failed`);
      failed++;
    }

    // Polite rate limiting — Shopify Admin REST: 2 req/s bucket
    await new Promise((r) => setTimeout(r, 500));
  }

  // 4. Summary
  console.log(`\n=== Summary ===`);
  console.log(`Scanned:      ${scanned}`);
  console.log(`Missing imgs: ${missing.length}`);
  console.log(`CDN resolved: ${resolved}`);
  console.log(`Not found:    ${notFound}`);
  if (!DRY_RUN) {
    console.log(`Uploaded:     ${uploaded}`);
    console.log(`Failed:       ${failed}`);
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
