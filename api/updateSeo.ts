console.log('updateSeo module loaded');
// api/updateSeo.ts
// ============================================================
// Shopify SEO Updater — bulk-set SEO title, meta description,
// and image alt tags for all products using existing title + tags.
//
// GET /api/updateSeo                          — first chunk (chunkSize=10)
// GET /api/updateSeo?dry=true                 — preview (no saves)
// GET /api/updateSeo?offset=10&chunkSize=10   — next batch
// GET /api/updateSeo?productId=123456789      — single product
// ============================================================

import type { VercelRequest, VercelResponse } from '@vercel/node';

export const config = { maxDuration: 300 };

// ─── SHOPIFY CONFIG ───────────────────────────────────────────────────────────

const SHOPIFY = {
  domain:     process.env.SHOPIFY_STORE_DOMAIN       || '',
  token:      process.env.SHOPIFY_ADMIN_ACCESS_TOKEN || '',
  apiVersion: '2024-01',
  get baseUrl() { return `https://${this.domain}/admin/api/${this.apiVersion}`; },
};

// ─── SEASON / VEHICLE LABEL MAPS (French) ────────────────────────────────────

const SEASON_LABELS: Record<string, string> = {
  'winter':      'hiver',
  'all-season':  'quatre saisons',
  'all-weather': 'toutes saisons',
  'all-terrain': 'tout-terrain',
  'summer':      'été',
};

const VEHICLE_LABELS: Record<string, string> = {
  'passenger':   'voiture',
  'suv':         'VUS',
  'light-truck': 'camion léger',
};

const SEASON_TAGS  = Object.keys(SEASON_LABELS);
const VEHICLE_TAGS = Object.keys(VEHICLE_LABELS);

const NON_TIRE_TITLES = ['installation', 'service', 'balancing', 'mounting'];

// ─── TEMPLATE FUNCTIONS ───────────────────────────────────────────────────────

function seoTitle(productTitle: string): string {
  return `${productTitle} | Pneus GCI`;
}

function metaDescription(productTitle: string, season: string, vehicle: string): string {
  const s = SEASON_LABELS[season]  || 'toutes saisons';
  const v = VEHICLE_LABELS[vehicle] || 'voiture';
  return `Achetez le ${productTitle} chez GCI Tires. Pneu ${s} pour ${v}. Livraison rapide au Québec. Prix compétitifs.`;
}

function imageAlt(productTitle: string, season: string, vehicle: string): string {
  const s = SEASON_LABELS[season]  || '';
  const v = VEHICLE_LABELS[vehicle] || '';
  return `${productTitle} - pneu ${s} ${v}`.trim();
}

// ─── TAG DETECTION ────────────────────────────────────────────────────────────

function detectFromTags(tags: string): { season: string; vehicle: string } {
  const tagList = tags.split(',').map(t => t.trim().toLowerCase());
  const season  = tagList.find(t => SEASON_TAGS.includes(t))  || '';
  const vehicle = tagList.find(t => VEHICLE_TAGS.includes(t)) || '';
  return { season, vehicle };
}

// ─── HELPERS ──────────────────────────────────────────────────────────────────

function delay(ms: number) { return new Promise(r => setTimeout(r, ms)); }

async function shopifyFetchRaw(url: string, options: RequestInit = {}): Promise<Response> {
  if (options.method === 'POST' || options.method === 'PUT') {
    console.log('Writing metafield to Shopify:', url, JSON.stringify(options.body));
  }
  const res = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': SHOPIFY.token,
      ...(options.headers || {}),
    },
  });
  let _responseBody: unknown = null;
  try { _responseBody = await res.clone().json(); } catch { /* 204 / empty body */ }
  console.log('Shopify response:', res.status, JSON.stringify(_responseBody));
  if (res.status === 429) { await delay(2000); return shopifyFetchRaw(url, options); }
  if (!res.ok) throw new Error(`Shopify ${res.status} on ${url}: ${(await res.text()).slice(0, 200)}`);
  return res;
}

async function shopifyFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await shopifyFetchRaw(`${SHOPIFY.baseUrl}${path}`, options);
  if (res.status === 204 || res.headers.get('content-length') === '0') return {} as T;
  return res.json() as Promise<T>;
}

// ─── TYPES ────────────────────────────────────────────────────────────────────

interface ShopifyImage {
  id: number;
  alt: string | null;
}

interface ShopifyProduct {
  id:     number;
  title:  string;
  tags:   string;
  images: ShopifyImage[];
}

interface ShopifyMetafield {
  id:        number;
  namespace: string;
  key:       string;
  value:     string;
}

interface ChangeRecord {
  id:                number;
  title:             string;
  seoTitle:          string;
  metaDescription:   string;
  imageAltsUpdated:  number;
}

// ─── FETCH ALL PRODUCTS ───────────────────────────────────────────────────────

async function fetchAllProducts(): Promise<ShopifyProduct[]> {
  const all: ShopifyProduct[] = [];
  let url: string = `${SHOPIFY.baseUrl}/products.json?limit=250&fields=id,title,tags,images`;
  let page = 0;

  while (url) {
    page++;
    const response = await shopifyFetchRaw(url);
    const data: any = await response.json();
    const products: ShopifyProduct[] = data.products || [];
    all.push(...products);
    console.log(`  [updateSeo] page ${page}: fetched ${products.length} products (running total: ${all.length})`);

    const link = response.headers.get('Link') || '';
    const next = link.match(/<([^>]+)>;\s*rel="next"/);
    url = next ? next[1] : '';
  }

  console.log(`  [updateSeo] done — ${page} page(s), ${all.length} total products`);
  return all;
}

// ─── METAFIELD HELPERS ────────────────────────────────────────────────────────

async function getProductMetafields(productId: number): Promise<ShopifyMetafield[]> {
  const data: any = await shopifyFetch(`/products/${productId}/metafields.json?namespace=global`);
  return (data.metafields || []) as ShopifyMetafield[];
}

async function upsertMetafield(
  productId: number,
  existing: ShopifyMetafield | undefined,
  key: string,
  value: string,
): Promise<void> {
  if (existing) {
    await shopifyFetch(`/metafields/${existing.id}.json`, {
      method: 'PUT',
      body: JSON.stringify({ metafield: { id: existing.id, value } }),
    });
  } else {
    await shopifyFetch(`/products/${productId}/metafields.json`, {
      method: 'POST',
      body: JSON.stringify({
        metafield: {
          namespace: 'global',
          key,
          value,
          type: 'single_line_text_field',
        },
      }),
    });
  }
}

// ─── PROCESS A SINGLE PRODUCT ─────────────────────────────────────────────────

async function processProduct(
  product: ShopifyProduct,
  dryRun: boolean,
): Promise<{ change: ChangeRecord; error: string | null }> {
  const { season, vehicle } = detectFromTags(product.tags);

  const newSeoTitle = seoTitle(product.title);
  const newMetaDesc = metaDescription(product.title, season, vehicle);
  const newAlt      = imageAlt(product.title, season, vehicle);

  let imageAltsUpdated = 0;

  if (!dryRun) {
    // ── Metafields ────────────────────────────────────────────────────────────
    let metafields: ShopifyMetafield[];
    try {
      metafields = await getProductMetafields(product.id);
    } catch (err) {
      return {
        change: { id: product.id, title: product.title, seoTitle: newSeoTitle, metaDescription: newMetaDesc, imageAltsUpdated: 0 },
        error: `Product ${product.id}: failed to fetch metafields — ${String(err)}`,
      };
    }

    const existingTitle = metafields.find(m => m.key === 'title_tag');
    const existingDesc  = metafields.find(m => m.key === 'description_tag');

    try {
      await upsertMetafield(product.id, existingTitle, 'title_tag', newSeoTitle);
    } catch (err) {
      return {
        change: { id: product.id, title: product.title, seoTitle: newSeoTitle, metaDescription: newMetaDesc, imageAltsUpdated: 0 },
        error: `Product ${product.id}: failed to upsert title_tag — ${String(err)}`,
      };
    }

    try {
      await upsertMetafield(product.id, existingDesc, 'description_tag', newMetaDesc);
    } catch (err) {
      return {
        change: { id: product.id, title: product.title, seoTitle: newSeoTitle, metaDescription: newMetaDesc, imageAltsUpdated: 0 },
        error: `Product ${product.id}: failed to upsert description_tag — ${String(err)}`,
      };
    }

    // ── Image alt tags ────────────────────────────────────────────────────────
    for (const image of product.images) {
      try {
        await shopifyFetch(`/products/${product.id}/images/${image.id}.json`, {
          method: 'PUT',
          body: JSON.stringify({ image: { id: image.id, alt: newAlt } }),
        });
        imageAltsUpdated++;
      } catch (err) {
        // Non-fatal: log but continue with remaining images
        console.error(`  ⚠️  Product ${product.id} image ${image.id}: failed to set alt — ${String(err)}`);
      }
    }
  } else {
    // In dry-run mode, count images that would be updated
    imageAltsUpdated = product.images.length;
  }

  return {
    change: { id: product.id, title: product.title, seoTitle: newSeoTitle, metaDescription: newMetaDesc, imageAltsUpdated },
    error: null,
  };
}

// ─── HANDLER ──────────────────────────────────────────────────────────────────

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Content-Type', 'application/json');

  const dryRun    = req.query.dry       === 'true';
  console.log('dry mode:', dryRun);
  const productId = req.query.productId ? String(req.query.productId) : null;
  const offset    = req.query.offset    ? parseInt(req.query.offset    as string, 10) : 0;
  const chunkSize = req.query.chunkSize ? parseInt(req.query.chunkSize as string, 10) : 10;

  if (!SHOPIFY.domain || !SHOPIFY.token) {
    return res.status(500).json({ error: 'Missing SHOPIFY_STORE_DOMAIN or SHOPIFY_ADMIN_ACCESS_TOKEN' });
  }

  // ── Single-product mode ────────────────────────────────────────────────────
  if (productId) {
    console.log(`🔍 updateSeo — single product mode productId=${productId} dry=${dryRun}`);

    let product: ShopifyProduct;
    try {
      const data: any = await shopifyFetch<any>(`/products/${productId}.json?fields=id,title,tags,images`);
      product = data.product as ShopifyProduct;
      if (!product) throw new Error('Product not found');
    } catch (err) {
      return res.status(404).json({ error: `Failed to fetch product ${productId}: ${String(err)}` });
    }

    const titleLower = product.title.toLowerCase();
    if (NON_TIRE_TITLES.some(kw => titleLower.includes(kw))) {
      return res.status(200).json({
        dryRun,
        total: 1,
        updated: 0,
        skipped: 1,
        errors: [],
        changes: [],
        offset: 0,
        chunkSize,
        nextOffset: null,
      });
    }

    const { change, error } = await processProduct(product, dryRun);

    return res.status(200).json({
      dryRun,
      total: 1,
      updated: error ? 0 : 1,
      skipped: 0,
      errors: error ? [error] : [],
      changes: error ? [] : [change],
      offset: 0,
      chunkSize,
      nextOffset: null,
    });
  }

  // ── Batch mode ─────────────────────────────────────────────────────────────
  console.log(`🔍 updateSeo — dry=${dryRun} offset=${offset} chunkSize=${chunkSize}`);

  let allProducts: ShopifyProduct[];
  try {
    allProducts = await fetchAllProducts();
  } catch (err) {
    return res.status(500).json({ error: `Failed to fetch products: ${String(err)}` });
  }

  const chunk = allProducts.slice(offset, offset + chunkSize);
  const nextOffset = (offset + chunkSize) < allProducts.length ? offset + chunkSize : null;

  let updated = 0;
  let skipped = 0;
  const errors:  string[]       = [];
  const changes: ChangeRecord[] = [];

  for (const product of chunk) {
    const titleLower = product.title.toLowerCase();
    if (NON_TIRE_TITLES.some(kw => titleLower.includes(kw))) {
      skipped++;
      continue;
    }

    console.log(`  Processing "${product.title}" (id=${product.id})`);

    const { change, error } = await processProduct(product, dryRun);

    if (error) {
      console.error(`  ❌ ${error}`);
      errors.push(error);
    } else {
      changes.push(change);
      updated++;
    }
  }

  console.log(`✅ Done — offset:${offset} scanned:${chunk.length} updated:${updated} skipped:${skipped} errors:${errors.length} nextOffset:${nextOffset}`);

  return res.status(200).json({
    dryRun,
    total: allProducts.length,
    updated,
    skipped,
    errors,
    changes,
    offset,
    chunkSize,
    nextOffset,
  });
}
