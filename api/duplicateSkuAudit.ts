// api/duplicateSkuAudit.ts
// ============================================================
// Duplicate SKU Audit — find and optionally clear duplicate TIRE- SKUs
//
// GET /api/duplicateSkuAudit?action=scan                           — all products
// GET /api/duplicateSkuAudit?action=scan&ctSyncOnly=true           — ct-sync tagged products only
// GET /api/duplicateSkuAudit?action=fix                           — clear duplicate SKUs (live write)
// GET /api/duplicateSkuAudit?action=fix&dry=true                  — fix dry run (no writes)
// GET /api/duplicateSkuAudit?action=fix&offset=0&chunkSize=20     — chunked execution
// GET /api/duplicateSkuAudit?action=remove-tag                    — remove ct-sync from duplicate products (live write)
// GET /api/duplicateSkuAudit?action=remove-tag&dry=true           — remove-tag dry run (no writes)
// GET /api/duplicateSkuAudit?action=remove-tag&ctSyncOnly=true    — scope fetch to ct-sync products
// GET /api/duplicateSkuAudit?action=remove-tag&offset=0&chunkSize=20   — chunked execution
// GET /api/duplicateSkuAudit?action=archive-duplicate             — archive higher-productId duplicate products (live write)
// GET /api/duplicateSkuAudit?action=archive-duplicate&dry=true    — archive-duplicate dry run (no writes)
// GET /api/duplicateSkuAudit?action=archive-duplicate&ctSyncOnly=true  — scope fetch to ct-sync products
// GET /api/duplicateSkuAudit?action=archive-duplicate&offset=0&chunkSize=20  — chunked execution
// GET /api/duplicateSkuAudit?action=archive-null-sku              — archive ct-sync products where ALL variants have blank/null SKU (live write)
// GET /api/duplicateSkuAudit?action=archive-null-sku&dry=true     — archive-null-sku dry run (no writes)
// GET /api/duplicateSkuAudit?action=archive-null-sku&offset=0&chunkSize=20  — chunked execution
// GET /api/duplicateSkuAudit?action=debug-tags&productId=N        — inspect raw tag data for one product
//
// Only considers SKUs that start with 'TIRE-'.
// For each duplicate SKU group, the variant on the product with the lowest
// numeric productId is kept; all others have their SKU cleared to "".
// ============================================================

import type { VercelRequest, VercelResponse } from '@vercel/node';

export const config = { maxDuration: 300 };

// ─── CONFIG ───────────────────────────────────────────────────────────────────

const SHOPIFY = {
  domain:     process.env.SHOPIFY_STORE_DOMAIN       || '',
  token:      process.env.SHOPIFY_ADMIN_ACCESS_TOKEN || '',
  apiVersion: '2024-01',
  get baseUrl() { return `https://${this.domain}/admin/api/${this.apiVersion}`; },
};

// ─── HELPERS ──────────────────────────────────────────────────────────────────

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

async function shopifyFetchRaw(url: string, options: RequestInit = {}): Promise<Response> {
  const res = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': SHOPIFY.token,
      ...(options.headers || {}),
    },
  });
  if (res.status === 429) { await sleep(2000); return shopifyFetchRaw(url, options); }
  if (!res.ok) throw new Error(`Shopify ${res.status} on ${url}: ${(await res.text()).slice(0, 1000)}`);
  return res;
}

async function shopifyFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await shopifyFetchRaw(`${SHOPIFY.baseUrl}${path}`, options);
  if (res.status === 204 || res.headers.get('content-length') === '0') return {} as T;
  return res.json() as Promise<T>;
}

// ─── TYPES ────────────────────────────────────────────────────────────────────

interface ShopifyVariant {
  id: number;
  sku: string;
  price: string;
}

interface ShopifyProduct {
  id: number;
  title: string;
  status: string;
  variants: ShopifyVariant[];
}

interface VariantEntry {
  productId: number;
  productTitle: string;
  variantId: number;
  price: string;
  status: string;
}

interface DuplicateGroup {
  sku: string;
  count: number;
  variants: VariantEntry[];
}

// ─── FETCH ALL PRODUCTS ───────────────────────────────────────────────────────

async function fetchAllProducts(ctSyncOnly: boolean): Promise<ShopifyProduct[]> {
  const all: ShopifyProduct[] = [];
  const tagParam = ctSyncOnly ? '&tag=ct-sync' : '';
  let url: string = `${SHOPIFY.baseUrl}/products.json?limit=250${tagParam}&fields=id,title,status,variants`;
  let page = 0;

  while (url) {
    page++;
    const response = await shopifyFetchRaw(url);
    const data: any = await response.json();
    const products: ShopifyProduct[] = data.products || [];
    all.push(...products);
    console.log(`  [duplicateSkuAudit] page ${page}: fetched ${products.length} products (running total: ${all.length})`);

    const link = response.headers.get('Link') || '';
    const next = link.match(/<([^>]+)>;\s*rel="next"/);
    url = next ? next[1] : '';
  }

  console.log(`  [duplicateSkuAudit] done — ${page} page(s), ${all.length} total products`);
  return all;
}

// ─── BUILD DUPLICATE GROUPS ───────────────────────────────────────────────────

function buildDuplicateGroups(products: ShopifyProduct[]): {
  groups: DuplicateGroup[];
  totalVariants: number;
} {
  const skuMap = new Map<string, VariantEntry[]>();
  let totalVariants = 0;

  for (const product of products) {
    for (const variant of product.variants || []) {
      totalVariants++;
      const sku = (variant.sku || '').trim().toUpperCase();
      if (!sku.startsWith('TIRE-')) continue;

      const entry: VariantEntry = {
        productId:    product.id,
        productTitle: product.title,
        variantId:    variant.id,
        price:        variant.price,
        status:       product.status,
      };

      const existing = skuMap.get(sku);
      if (existing) { existing.push(entry); } else { skuMap.set(sku, [entry]); }
    }
  }

  const groups: DuplicateGroup[] = [];
  for (const [sku, variants] of skuMap.entries()) {
    if (variants.length < 2) continue;

    // Only flag as duplicate if the SKU spans more than one product
    const distinctProducts = new Set(variants.map(v => v.productId));
    if (distinctProducts.size < 2) continue;

    groups.push({ sku, count: variants.length, variants });
  }

  // Sort: count desc, then sku asc for stable output
  groups.sort((a, b) => b.count - a.count || a.sku.localeCompare(b.sku));

  return { groups, totalVariants };
}

// ─── HANDLER ──────────────────────────────────────────────────────────────────

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Content-Type', 'application/json');

  if (!SHOPIFY.domain || !SHOPIFY.token) {
    return res.status(500).json({ error: 'Missing SHOPIFY_STORE_DOMAIN or SHOPIFY_ADMIN_ACCESS_TOKEN' });
  }

  const action = (req.query.action as string) || 'scan';

  // Log entry point with raw action value in quotes so routing failures are immediately visible
  console.log(`🔍 duplicateSkuAudit — action="${action}" query:${JSON.stringify(req.query)}`);

  // ── action=debug-tags ────────────────────────────────────────────────────
  // First in the routing chain — needs only a single product fetch, not the full scan.
  if (action === 'debug-tags') {
    const productIdParam = req.query.productId as string;
    if (!productIdParam) {
      return res.status(400).json({ error: 'productId query param is required for action=debug-tags' });
    }
    const productId = parseInt(productIdParam, 10);
    if (isNaN(productId)) {
      return res.status(400).json({ error: `Invalid productId: ${productIdParam}` });
    }

    let data: any;
    try {
      data = await shopifyFetch(`/products/${productId}.json?fields=id,tags`);
    } catch (err) {
      return res.status(500).json({ error: `Shopify fetch failed: ${String(err)}` });
    }

    const rawTags = data?.product?.tags;
    const tagType = typeof rawTags;

    // Parse the same way remove-tag does so discrepancies are obvious
    const parsed: string[] = tagType === 'string'
      ? (rawTags as string).split(',').map((t: string) => t.trim()).filter(Boolean)
      : Array.isArray(rawTags) ? rawTags : [];

    const containsCtSync = parsed.some(t => t.toLowerCase() === 'ct-sync');

    console.log(`  [debug-tags] productId:${productId} type:${tagType} rawTags:${JSON.stringify(rawTags)} containsCtSync:${containsCtSync}`);

    return res.status(200).json({
      productId,
      rawTags,
      type: tagType,
      parsed,
      containsCtSync,
    });
  }

  // All remaining actions need the full product list
  const dryRun     = req.query.dry        === 'true';
  const ctSyncOnly = req.query.ctSyncOnly === 'true';
  const chunkSize  = req.query.chunkSize ? parseInt(req.query.chunkSize as string, 10) : 20;
  const offset     = req.query.offset    ? parseInt(req.query.offset    as string, 10) : 0;

  let allProducts: ShopifyProduct[];
  try {
    allProducts = await fetchAllProducts(ctSyncOnly);
  } catch (err) {
    return res.status(500).json({ error: `Failed to fetch products: ${String(err)}` });
  }

  const { groups, totalVariants } = buildDuplicateGroups(allProducts);
  const totalAffectedVariants = groups.reduce((sum, g) => sum + g.count, 0);

  // ── action=scan ───────────────────────────────────────────────────────────
  if (action === 'scan') {
    console.log(`✅ Scan done — products:${allProducts.length} duplicateSkus:${groups.length} affectedVariants:${totalAffectedVariants} ctSyncOnly:${ctSyncOnly}`);
    return res.status(200).json({
      ctSyncOnly,
      totalProducts:        allProducts.length,
      totalVariants,
      totalDuplicateSkus:   groups.length,
      totalAffectedVariants,
      groups,
    });
  }

  // ── action=fix ────────────────────────────────────────────────────────────
  if (action === 'fix') {
    const chunk      = groups.slice(offset, offset + chunkSize);
    const nextOffset = (offset + chunkSize) < groups.length ? offset + chunkSize : null;

    let fixed   = 0;
    let skipped = 0;
    const errors: string[] = [];
    const changes: Array<{ variantId: number; sku: string; productTitle: string; action: 'cleared' }> = [];

    for (const group of chunk) {
      // Sort so lowest productId is first — that one is kept
      const sorted = [...group.variants].sort((a, b) => a.productId - b.productId);
      const [_kept, ...toClear] = sorted;

      for (const variant of toClear) {
        console.log(`  [clear-sku] variantId:${variant.variantId} sku:${group.sku} product:"${variant.productTitle}"`);
        changes.push({ variantId: variant.variantId, sku: group.sku, productTitle: variant.productTitle, action: 'cleared' });

        if (!dryRun) {
          try {
            await shopifyFetch(`/variants/${variant.variantId}.json`, {
              method: 'PUT',
              body: JSON.stringify({ variant: { id: variant.variantId, sku: '' } }),
            });
            fixed++;
          } catch (err) {
            const msg = `Variant ${variant.variantId} (SKU: ${group.sku}, "${variant.productTitle}"): ${String(err)}`;
            console.error(`  ❌ ${msg}`);
            errors.push(msg);
            continue;
          }
          await sleep(400);
        } else {
          fixed++;
        }
      }
    }

    console.log(`✅ Fix done — fixed:${fixed} skipped:${skipped} errors:${errors.length} nextOffset:${nextOffset}`);

    // Return 207 Multi-Status when some writes succeeded and some failed
    const httpStatus = !dryRun && errors.length > 0 ? 207 : 200;
    return res.status(httpStatus).json({
      dryRun,
      totalDuplicateSkus: groups.length,
      fixed,
      skipped,
      errors,
      changes,
      offset,
      chunkSize,
      nextOffset,
    });
  }

  // ── action=remove-tag ─────────────────────────────────────────────────────
  if (action === 'remove-tag') {
    // Collect the unique set of higher-productId products to de-tag (one per duplicate group).
    // A single product may appear as the duplicate in multiple groups; deduplicate by productId
    // so we only fetch+write it once.
    const toDetagMap = new Map<number, string>(); // productId → productTitle
    for (const group of groups) {
      const sorted = [...group.variants].sort((a, b) => a.productId - b.productId);
      // Every entry after the first (lowest id) is considered a duplicate import
      for (const variant of sorted.slice(1)) {
        if (!toDetagMap.has(variant.productId)) {
          toDetagMap.set(variant.productId, variant.productTitle);
        }
      }
    }

    const allToDetag = Array.from(toDetagMap.entries()); // [ [productId, title], ... ]
    const chunk      = allToDetag.slice(offset, offset + chunkSize);
    const nextOffset = (offset + chunkSize) < allToDetag.length ? offset + chunkSize : null;

    let fixed       = 0;
    let skipped     = 0;
    let debugLogged = 0;
    const errors: string[] = [];
    const changes: Array<{ productId: number; productTitle: string; removedTag: string; newTags: string }> = [];

    for (const [productId, productTitle] of chunk) {
      console.log(`  [remove-tag] productId:${productId} product:"${productTitle}"`);

      if (!dryRun) {
        // Fetch current tags for this product
        let currentTags: string;
        try {
          const data: any = await shopifyFetch(`/products/${productId}.json?fields=id,tags`);
          const rawTags = data.product?.tags;

          // Log exact format for first 3 products to diagnose skip issues
          if (debugLogged < 3) {
            console.log(`  [debug-tags] productId:${productId} type:${typeof rawTags} rawTags:${JSON.stringify(rawTags)}`);
            debugLogged++;
          }

          // Shopify REST always returns tags as a comma-separated string, but guard for arrays
          if (Array.isArray(rawTags)) {
            currentTags = rawTags.join(', ');
          } else {
            currentTags = (rawTags as string) ?? '';
          }
        } catch (err) {
          const msg = `Product ${productId} ("${productTitle}") fetch tags: ${String(err)}`;
          console.error(`  ❌ ${msg}`);
          errors.push(msg);
          continue;
        }

        // Strip 'ct-sync' (case-insensitive, trim surrounding commas/spaces)
        const tagList     = currentTags.split(',').map(t => t.trim()).filter(Boolean);
        const updatedList = tagList.filter(t => t.toLowerCase() !== 'ct-sync');

        if (updatedList.length === tagList.length) {
          // ct-sync was not present in this product's tags
          console.log(`  [skip no tag] productId:${productId} tags:${JSON.stringify(tagList)}`);
          skipped++;
          continue;
        }

        const updatedTags = updatedList.join(', ');

        try {
          await shopifyFetch(`/products/${productId}.json`, {
            method: 'PUT',
            body: JSON.stringify({ product: { id: productId, tags: updatedTags } }),
          });
          changes.push({ productId, productTitle, removedTag: 'ct-sync', newTags: updatedTags });
          fixed++;
        } catch (err) {
          const msg = `Product ${productId} ("${productTitle}") update tags: ${String(err)}`;
          console.error(`  ❌ ${msg}`);
          errors.push(msg);
          continue;
        }

        await sleep(500);
      } else {
        changes.push({ productId, productTitle, removedTag: 'ct-sync', newTags: '(dry run)' });
        fixed++;
      }
    }

    console.log(`✅ remove-tag done — fixed:${fixed} skipped:${skipped} errors:${errors.length} nextOffset:${nextOffset}`);

    const httpStatus = !dryRun && errors.length > 0 ? 207 : 200;
    return res.status(httpStatus).json({
      dryRun,
      totalDuplicateProducts: allToDetag.length,
      fixed,
      skipped,
      errors,
      changes,
      offset,
      chunkSize,
      nextOffset,
    });
  }

  // ── action=archive-duplicate ───────────────────────────────────────────────
  if (action === 'archive-duplicate') {
    // Collect unique higher-productId products to archive.
    // VariantEntry already carries `status` from the initial product fetch,
    // so no extra GET is needed to check for already-archived products.
    const toArchiveMap = new Map<number, { title: string; status: string }>();
    for (const group of groups) {
      const sorted = [...group.variants].sort((a, b) => a.productId - b.productId);
      for (const variant of sorted.slice(1)) {
        if (!toArchiveMap.has(variant.productId)) {
          toArchiveMap.set(variant.productId, { title: variant.productTitle, status: variant.status });
        }
      }
    }

    const allToArchive = Array.from(toArchiveMap.entries()); // [ [productId, { title, status }], ... ]
    const chunk        = allToArchive.slice(offset, offset + chunkSize);
    const nextOffset   = (offset + chunkSize) < allToArchive.length ? offset + chunkSize : null;

    let fixed   = 0;
    let skipped = 0;
    const errors: string[] = [];
    const changes: Array<{ productId: number; productTitle: string; action: 'archived' }> = [];

    for (const [productId, { title: productTitle, status }] of chunk) {
      if (status === 'archived') {
        console.log(`  [skip already-archived] productId:${productId} product:"${productTitle}"`);
        skipped++;
        continue;
      }

      console.log(`  [archive-duplicate] productId:${productId} product:"${productTitle}" currentStatus:${status}`);

      if (!dryRun) {
        try {
          await shopifyFetch(`/products/${productId}.json`, {
            method: 'PUT',
            body: JSON.stringify({ product: { id: productId, status: 'archived' } }),
          });
          changes.push({ productId, productTitle, action: 'archived' });
          fixed++;
        } catch (err) {
          const msg = `Product ${productId} ("${productTitle}"): ${String(err)}`;
          console.error(`  ❌ ${msg}`);
          errors.push(msg);
          continue;
        }
        await sleep(500);
      } else {
        changes.push({ productId, productTitle, action: 'archived' });
        fixed++;
      }
    }

    console.log(`✅ archive-duplicate done — fixed:${fixed} skipped:${skipped} errors:${errors.length} nextOffset:${nextOffset}`);

    const httpStatus = !dryRun && errors.length > 0 ? 207 : 200;
    return res.status(httpStatus).json({
      dryRun,
      totalDuplicateProducts: allToArchive.length,
      fixed,
      skipped,
      errors,
      changes,
      offset,
      chunkSize,
      nextOffset,
    });
  }

  // ── action=archive-null-sku ───────────────────────────────────────────────
  if (action === 'archive-null-sku') {
    // Products where every variant has a blank or null SKU are never picked up
    // by archive-duplicate (which only scans TIRE- SKUs), so they must be
    // handled separately. These products cannot be synced to any channel.
    const nullSkuProducts = allProducts.filter(p =>
      p.variants.length > 0 &&
      p.variants.every(v => !(v.sku || '').trim())
    );

    const chunk      = nullSkuProducts.slice(offset, offset + chunkSize);
    const nextOffset = (offset + chunkSize) < nullSkuProducts.length ? offset + chunkSize : null;

    let fixed   = 0;
    let skipped = 0;
    const errors: string[] = [];
    const changes: Array<{ productId: number; productTitle: string; action: 'archived' }> = [];

    for (const product of chunk) {
      if (product.status === 'archived') {
        console.log(`  [skip already-archived] productId:${product.id} product:"${product.title}"`);
        skipped++;
        continue;
      }

      console.log(`  [archive-null-sku] productId:${product.id} product:"${product.title}" currentStatus:${product.status}`);

      if (!dryRun) {
        try {
          await shopifyFetch(`/products/${product.id}.json`, {
            method: 'PUT',
            body: JSON.stringify({ product: { id: product.id, status: 'archived' } }),
          });
          changes.push({ productId: product.id, productTitle: product.title, action: 'archived' });
          fixed++;
        } catch (err) {
          const msg = `Product ${product.id} ("${product.title}"): ${String(err)}`;
          console.error(`  ❌ ${msg}`);
          errors.push(msg);
          continue;
        }
        await sleep(500);
      } else {
        changes.push({ productId: product.id, productTitle: product.title, action: 'archived' });
        fixed++;
      }
    }

    console.log(`✅ archive-null-sku done — total:${nullSkuProducts.length} fixed:${fixed} skipped:${skipped} errors:${errors.length} nextOffset:${nextOffset}`);

    const httpStatus = !dryRun && errors.length > 0 ? 207 : 200;
    return res.status(httpStatus).json({
      dryRun,
      totalNullSkuProducts: nullSkuProducts.length,
      fixed,
      skipped,
      errors,
      changes,
      offset,
      chunkSize,
      nextOffset,
    });
  }

  return res.status(400).json({
    error: 'Unknown action',
    available: ['scan', 'fix', 'remove-tag', 'archive-duplicate', 'archive-null-sku', 'debug-tags'],
  });
}
