// api/backfillImages.ts
// ============================================================
// Multi-source product image backfill
//
// Finds every Shopify product with no attached image and tries
// brand-specific CDNs before falling back to SimpleTire.
//
// Sources (tried in order for each product):
//   A — Nexen CDN       (nexentire.com)
//   B — Cooper CDN      (coopertire.com / coopertyres.com)
//   C — Vredestein CDN  (vredestein.com)
//   D — SimpleTire CDN  (cdn.simpletire.com)  — universal fallback
//
// MODES
//   GET /api/backfillImages                 — chunk 0 (50 products)
//   GET /api/backfillImages?cursor=50       — next chunk
//   GET /api/backfillImages?preview=true    — dry run, no writes
//   GET /api/backfillImages?brand=Nexen     — filter to one brand
//
// RESPONSE
//   { total, attached, skipped, failed, errors, nextCursor, preview }
//   preview — first 20 matches { id, title, source, url }
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

// ─── HELPERS ──────────────────────────────────────────────────────────────────

function delay(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

async function shopifyFetchRaw(url: string, options: RequestInit = {}): Promise<Response> {
  let wait = 2000;
  while (true) {
    const res = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': SHOPIFY.token,
        ...(options.headers ?? {}),
      },
    });
    if (res.status === 429) { await delay(wait); wait = Math.min(wait * 2, 16000); continue; }
    if (!res.ok) throw new Error(`Shopify ${res.status} — ${url}: ${(await res.text()).slice(0, 200)}`);
    return res;
  }
}

async function shopifyFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await shopifyFetchRaw(`${SHOPIFY.baseUrl}${path}`, options);
  if (res.status === 204 || res.headers.get('content-length') === '0') return {} as T;
  return res.json() as Promise<T>;
}

// ─── SLUG EXTRACTION ─────────────────────────────────────────────────────────
//
//   "Nexen Winguard Sport 2 215/55R17"       → brand="Nexen"   model="winguard-sport-2"
//   "Cooper Discoverer Snow Claw 275/65R20 LT" → brand="Cooper" model="discoverer-snow-claw"
//
const TIRE_SIZE_RE  = /\s+\d{3}\/\d{2}[A-Z]\d{2}.*$/i;   // " 215/45R17 XL" and beyond
const COMPACT_RE    = /\s+\d{7}\/r.*$/i;                  // " 2154517/r" compact codes
const TRAILING_JUNK = /[\s\-]+$/;

function extractBrandAndSlug(title: string): { brand: string; modelSlug: string } {
  // Strip tire size (formatted or compact) then convert model name to kebab-case
  const withoutSize = title
    .replace(TIRE_SIZE_RE, '')
    .replace(COMPACT_RE, '')
    .replace(TRAILING_JUNK, '');

  const words     = withoutSize.trim().split(/\s+/);
  const brand     = words[0] ?? '';
  const modelSlug = words
    .slice(1)
    .join('-')
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');

  return { brand, modelSlug };
}

// ─── SOURCE A — NEXEN CDN ────────────────────────────────────────────────────

function nexenCandidates(modelSlug: string): string[] {
  return [
    `https://www.nexentire.com/upload/product/${modelSlug}_main.jpg`,
    `https://www.nexentire.com/upload/product/${modelSlug}.jpg`,
    `https://www.nexentire.com/image/product/${modelSlug}/main.jpg`,
  ];
}

// ─── SOURCE B — COOPER CDN ───────────────────────────────────────────────────

function cooperCandidates(modelSlug: string): string[] {
  return [
    `https://coopertire.com/content/dam/coopertire/products/${modelSlug}/product-image.png`,
    `https://www.coopertire.com/content/dam/coopertire/tires/${modelSlug}.jpg`,
    `https://coopertyres.com/content/dam/coopertyres/products/${modelSlug}/main.jpg`,
  ];
}

// ─── SOURCE C — VREDESTEIN CDN ───────────────────────────────────────────────

function vredesteinCandidates(modelSlug: string): string[] {
  return [
    `https://www.vredestein.com/media/catalog/product/${modelSlug}.jpg`,
    `https://www.vredestein.com/sites/default/files/tires/${modelSlug}.jpg`,
  ];
}

// ─── SOURCE D — SIMPLETIRE CDN (universal fallback) ──────────────────────────
//
//   SimpleTire stores line images at:
//   cdn.simpletire.com/images/tireImages/lines/{Brand}/{Model}/{Model}-tire.png
//   and a flat variant at:
//   cdn.simpletire.com/images/tireImages/lines/{Brand}/{Model}-tire.png
//
function simpleTireCandidates(brand: string, modelSlug: string): string[] {
  const b = brand.toLowerCase().replace(/\s+/g, '-');
  // Title-case brand for the nested path variant
  const bTitle = brand.charAt(0).toUpperCase() + brand.slice(1).toLowerCase();
  return [
    `https://cdn.simpletire.com/images/tireImages/lines/${bTitle}/${modelSlug}/${modelSlug}-tire.png`,
    `https://cdn.simpletire.com/images/tireImages/lines/${bTitle}/${modelSlug}-tire.png`,
    `https://cdn.simpletire.com/images/tireImages/lines/${b}/${modelSlug}.jpg`,
    `https://cdn.simpletire.com/images/${b}/${modelSlug}.jpg`,
  ];
}

// ─── URL PROBE ────────────────────────────────────────────────────────────────
//
//   Returns the first URL in `candidates` that responds with HTTP 200 and an
//   image content-type. Uses HEAD to avoid downloading the full image.

const PROBE_UA      = 'Mozilla/5.0 (compatible; GCIBot/1.0)';
const PROBE_TIMEOUT = 8000;

async function probeFirst(candidates: string[]): Promise<string | null> {
  for (const url of candidates) {
    try {
      const controller = new AbortController();
      const timer      = setTimeout(() => controller.abort(), PROBE_TIMEOUT);
      const res        = await fetch(url, {
        method:  'HEAD',
        redirect: 'follow',
        signal:   controller.signal,
        headers:  { 'User-Agent': PROBE_UA, Accept: 'image/*,*/*' },
      });
      clearTimeout(timer);
      const ct = res.headers.get('content-type') ?? '';
      if (res.ok && ct.startsWith('image/')) return url;
    } catch {
      // network error or timeout — try next candidate
    }
  }
  return null;
}

// ─── CANDIDATE BUILDER ───────────────────────────────────────────────────────
//
//   Returns all candidate URLs for a product title in source-priority order.

function candidatesForTitle(title: string): string[] {
  const { brand, modelSlug } = extractBrandAndSlug(title);
  if (!modelSlug) return [];

  const brandUpper = brand.toUpperCase();
  const specific: string[] =
    brandUpper === 'NEXEN'      ? nexenCandidates(modelSlug)     :
    brandUpper === 'COOPER'     ? cooperCandidates(modelSlug)    :
    brandUpper === 'VREDESTEIN' ? vredesteinCandidates(modelSlug):
    [];

  const fallback = simpleTireCandidates(brand, modelSlug);
  return [...specific, ...fallback];
}

// ─── SHOPIFY: FETCH IMAGELESS PRODUCTS ────────────────────────────────────────

interface ShopifyProduct {
  id:     number;
  title:  string;
  images: Array<{ id: number; src: string }>;
}

async function fetchImagelessProducts(brandFilter?: string): Promise<ShopifyProduct[]> {
  const imageless: ShopifyProduct[] = [];
  let url: string | null =
    `${SHOPIFY.baseUrl}/products.json?limit=250&fields=id,title,images`;

  while (url) {
    const res  = await shopifyFetchRaw(url);
    const data: any = await res.json();
    const page: ShopifyProduct[] = (data.products ?? []) as ShopifyProduct[];

    for (const p of page) {
      // A product counts as imageless when it has no attached images,
      // or only a Shopify placeholder (src contains "no-image").
      const hasRealImage = p.images.some(
        img => img.src && !img.src.includes('no-image'),
      );
      if (hasRealImage) continue;

      if (brandFilter && !p.title.toLowerCase().startsWith(brandFilter.toLowerCase())) continue;

      imageless.push(p);
    }

    const link  = res.headers.get('Link') ?? '';
    const nextM = link.match(/<([^>]+)>;\s*rel="next"/);
    url = nextM ? nextM[1] : null;
  }

  return imageless;
}

// ─── SHOPIFY: ATTACH IMAGE ────────────────────────────────────────────────────

async function attachImage(productId: number, src: string): Promise<void> {
  await shopifyFetch(`/products/${productId}/images.json`, {
    method: 'POST',
    body:   JSON.stringify({ image: { src } }),
  });
}

// ─── HANDLER ──────────────────────────────────────────────────────────────────

const CHUNK_SIZE = 50;
const BATCH_SIZE = 5; // concurrent probes per batch (CDN-friendly)

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Content-Type', 'application/json');

  if (!SHOPIFY.domain || !SHOPIFY.token) {
    return res.status(500).json({ error: 'Missing SHOPIFY_STORE_DOMAIN or SHOPIFY_ADMIN_ACCESS_TOKEN' });
  }

  const preview     = req.query.preview === 'true';
  const brandFilter = req.query.brand  ? String(req.query.brand)  : undefined;
  const cursor      = req.query.cursor ? parseInt(String(req.query.cursor), 10) : 0;

  console.log(`🖼  backfillImages — preview=${preview} brand=${brandFilter ?? 'all'} cursor=${cursor}`);

  // ── Fetch all imageless products (fast read pass) ─────────────────────────
  let allImageless: ShopifyProduct[];
  try {
    allImageless = await fetchImagelessProducts(brandFilter);
  } catch (err) {
    return res.status(500).json({ error: `Failed to fetch products: ${String(err)}` });
  }

  const total      = allImageless.length;
  const chunk      = allImageless.slice(cursor, cursor + CHUNK_SIZE);
  const nextCursor = (cursor + CHUNK_SIZE) < total ? cursor + CHUNK_SIZE : null;

  console.log(`  Imageless: ${total} | Chunk: ${chunk.length} (offset ${cursor}) | nextCursor: ${nextCursor}`);

  // ── Probe CDN candidates in batches ──────────────────────────────────────
  interface Match {
    product: ShopifyProduct;
    url:     string;
    source:  string;
  }

  const matches:  Match[]   = [];
  const noMatch:  number[]  = []; // product IDs with no resolvable URL

  for (let i = 0; i < chunk.length; i += BATCH_SIZE) {
    const batch = chunk.slice(i, i + BATCH_SIZE);

    await Promise.all(batch.map(async (product) => {
      const candidates = candidatesForTitle(product.title);
      if (candidates.length === 0) {
        noMatch.push(product.id);
        console.log(`  ⏭  [${product.id}] No candidates — "${product.title}"`);
        return;
      }

      const url = await probeFirst(candidates);
      if (url) {
        // Determine which source matched for reporting
        const source =
          url.includes('nexentire.com')   ? 'Nexen CDN'      :
          url.includes('coopertire')      ? 'Cooper CDN'      :
          url.includes('coopertyres')     ? 'Cooper CDN'      :
          url.includes('vredestein.com')  ? 'Vredestein CDN'  :
          url.includes('simpletire.com')  ? 'SimpleTire CDN'  :
          'Unknown';
        matches.push({ product, url, source });
        console.log(`  ✅ [${product.id}] ${source} — "${product.title}"`);
        console.log(`       ${url}`);
      } else {
        noMatch.push(product.id);
        console.log(`  ❌ [${product.id}] No URL resolved — "${product.title}"`);
      }
    }));

    // Pause between probe batches to be CDN-friendly
    if (i + BATCH_SIZE < chunk.length) await delay(300);
  }

  const previewItems = matches.slice(0, 20).map(({ product, url, source }) => ({
    id:     product.id,
    title:  product.title,
    source,
    url,
  }));

  // ── Preview mode: return plan without writing ──────────────────────────────
  if (preview) {
    return res.status(200).json({
      total,
      attached: matches.length,
      skipped:  noMatch.length,
      failed:   0,
      errors:   [],
      nextCursor,
      preview:  previewItems,
    });
  }

  // ── Write: POST image to Shopify for each match ───────────────────────────
  // Sequential writes (one at a time) to avoid Shopify media processing backlog.
  let attached = 0;
  const errors: string[] = [];

  for (const { product, url } of matches) {
    try {
      await attachImage(product.id, url);
      attached++;
      console.log(`  📎 Attached image to product ${product.id}`);
    } catch (err) {
      const msg = `Product ${product.id} ("${product.title}"): ${String(err)}`;
      console.error(`  ❌ ${msg}`);
      errors.push(msg);
    }
    // Small delay between Shopify writes to respect rate limits
    await delay(300);
  }

  const report = {
    total,
    attached,
    skipped: noMatch.length,
    failed:  errors.length,
    errors,
    nextCursor,
    preview: previewItems,
  };

  console.log(`✅ Chunk done — cursor:${cursor} attached:${attached} skipped:${noMatch.length} failed:${errors.length} nextCursor:${nextCursor}`);
  return res.status(200).json(report);
}
