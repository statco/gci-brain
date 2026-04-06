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

// ─── SOURCE A — NEXEN IMAGE MAP ──────────────────────────────────────────────
//
//   Nexen CDN uses unpredictable WordPress media upload paths, so we maintain
//   a hardcoded map of known-good URLs keyed by lowercase model name
//   (brand prefix and size suffix stripped).

const NEXEN_IMAGE_MAP: Record<string, string> = {
  'winguard sport 2':          'https://www.nexentireusa.com/wp-content/uploads/2025/11/Winguard_Sport_2_Main-350x416-5.jpg',
  'roadian mtx':               'https://www.nexentireusa.com/wp-content/uploads/2025/11/Roadian_MTX_Main-350x416-2.jpg',
  'roadian mtx rm7':           'https://www.nexentireusa.com/wp-content/uploads/2025/11/RO-MTX-Main350-4.jpg',
  'roadian htx 2':             'https://www.nexentireusa.com/wp-content/uploads/2025/11/Roadian_HTX2_Main-350x416-5.jpg',
  'roadian htx2':              'https://www.nexentireusa.com/wp-content/uploads/2025/11/Roadian_HTX2_Main-350x416-5.jpg',
  'roadian htx 2 all-weather': 'https://www.nexentireusa.com/wp-content/uploads/2025/11/Roadian_HTX2_Main-350x416-5.jpg',
  'npriz s':                   'https://www.nexentireusa.com/wp-content/uploads/2026/02/NPriz-S_Tilt.jpg',
  'npriz s oe':                'https://www.nexentireusa.com/wp-content/uploads/2026/02/NPriz-S_Tilt.jpg',
};

// Returns the mapped URL for a Nexen product title, or null if not in the map.
// Strips brand ("Nexen") and size suffix, then does a lowercase key lookup.
function nexenMappedUrl(title: string): string | null {
  const withoutSize = title
    .replace(TIRE_SIZE_RE, '')
    .replace(COMPACT_RE, '')
    .replace(TRAILING_JUNK, '');

  // Remove leading brand word "Nexen" (case-insensitive)
  const modelName = withoutSize.replace(/^nexen\s+/i, '').trim().toLowerCase();
  return NEXEN_IMAGE_MAP[modelName] ?? null;
}

// ─── SOURCE B — COOPER IMAGE MAP ─────────────────────────────────────────────
//
//   Cooper CDN paths are not reliably slug-predictable. Use hardcoded
//   SimpleTire image URLs (images.simpletire.com) with known line IDs.

const COOPER_IMAGE_MAP: Record<string, string> = {
  'cs5 grand touring': 'https://images.simpletire.com/images/q_auto/line-images/9406/9406-sidetread/cooper-cs5-grand-touring.png',
  'cs5 ultra touring': 'https://images.simpletire.com/images/q_auto/line-images/9407/9407-sidetread/cooper-cs5-ultra-touring.png',
  'procontrol':        'https://images.simpletire.com/images/q_auto/line-images/19705/19705-sidetread/cooper-procontrol.png',
  'zeon rs3-g1':       'https://images.simpletire.com/images/q_auto/line-images/12161/12161-sidetread/cooper-zeon-rs3-g1.png',
};

// Returns the mapped URL for a Cooper product title, or null if not in the map.
// Strips brand ("Cooper") and size suffix, then does a lowercase key lookup.
function cooperMappedUrl(title: string): string | null {
  const withoutSize = title
    .replace(TIRE_SIZE_RE, '')
    .replace(COMPACT_RE, '')
    .replace(TRAILING_JUNK, '');

  const modelName = withoutSize.replace(/^cooper\s+/i, '').trim().toLowerCase();
  return COOPER_IMAGE_MAP[modelName] ?? null;
}

// ─── SOURCE C — VREDESTEIN CDN ───────────────────────────────────────────────

function vredesteinCandidates(modelSlug: string): string[] {
  return [
    `https://www.vredestein.com/media/catalog/product/${modelSlug}.jpg`,
    `https://www.vredestein.com/sites/default/files/tires/${modelSlug}.jpg`,
  ];
}

// ─── SOURCE D — SIMPLETIRE FALLBACK (best-effort) ────────────────────────────
//
//   SimpleTire image URLs require a numeric line ID which we don't have for
//   arbitrary products. The reliable format is:
//     images.simpletire.com/images/q_auto/line-images/{id}/{id}-sidetread/{brand}-{model}.png
//
//   Without the line ID we can't construct a working URL, so this fallback
//   is best-effort only. The hardcoded brand maps (NEXEN_IMAGE_MAP,
//   COOPER_IMAGE_MAP) are the primary reliable sources.
//
function simpleTireCandidates(brand: string, modelSlug: string): string[] {
  const b = brand.toLowerCase().replace(/\s+/g, '-');
  return [
    // Correct domain with slug-based guess (low hit rate without line ID)
    `https://images.simpletire.com/images/q_auto/line-images/${b}-${modelSlug}/${b}-${modelSlug}-sidetread/${b}-${modelSlug}.png`,
    `https://images.simpletire.com/images/q_auto/tire-images/${b}/${modelSlug}/${b}-${modelSlug}.png`,
  ];
}

// ─── URL PROBE ────────────────────────────────────────────────────────────────
//
//   Tries every candidate URL and records the outcome for each attempt.
//   Returns the first successful URL plus a full attempt log for diagnostics.

const PROBE_UA      = 'Mozilla/5.0 (compatible; GCIBot/1.0)';
const PROBE_TIMEOUT = 8000;

type SourceLabel =
  | 'nexen-cdn'
  | 'cooper-cdn'
  | 'vredestein-cdn'
  | 'simpletire'
  | 'tirerack'
  | 'not-found';

interface ProbeOutcome {
  imageUrl:  string | null;
  source:    SourceLabel;
  attempted: string[];  // "https://url → reason" for every URL tried
}

function urlToSource(url: string): SourceLabel {
  if (url.includes('nexentireusa.com'))  return 'nexen-cdn';
  if (url.includes('nexentire.com'))     return 'nexen-cdn';
  if (url.includes('coopertire'))        return 'cooper-cdn';
  if (url.includes('coopertyres'))       return 'cooper-cdn';
  if (url.includes('vredestein.com'))    return 'vredestein-cdn';
  if (url.includes('simpletire.com'))    return 'simpletire';   // matches both cdn. and images.
  if (url.includes('tirerack.com'))      return 'tirerack';
  return 'not-found';
}

async function probeAllWithDetails(candidates: string[]): Promise<ProbeOutcome> {
  const attempted: string[] = [];

  for (const url of candidates) {
    let reason: string;
    try {
      const controller = new AbortController();
      const timer      = setTimeout(() => controller.abort(), PROBE_TIMEOUT);
      const res        = await fetch(url, {
        method:   'HEAD',
        redirect: 'follow',
        signal:   controller.signal,
        headers:  { 'User-Agent': PROBE_UA, Accept: 'image/*,*/*' },
      });
      clearTimeout(timer);
      const ct = res.headers.get('content-type') ?? '';
      if (res.ok && ct.startsWith('image/')) {
        attempted.push(`${url} → ok (${ct})`);
        return { imageUrl: url, source: urlToSource(url), attempted };
      }
      reason = res.ok
        ? `wrong content-type: ${ct || 'none'}`
        : `HTTP ${res.status}`;
    } catch (err: any) {
      reason = err?.name === 'AbortError'
        ? 'timeout'
        : `error: ${String(err?.message ?? err).slice(0, 100)}`;
    }
    attempted.push(`${url} → ${reason}`);
  }

  return { imageUrl: null, source: 'not-found', attempted };
}

// ─── CANDIDATE BUILDER ───────────────────────────────────────────────────────
//
//   Returns all candidate URLs for a product title in source-priority order.

function candidatesForTitle(title: string): string[] {
  const { brand, modelSlug } = extractBrandAndSlug(title);
  if (!modelSlug) return [];

  const brandUpper = brand.toUpperCase();

  let specific: string[] = [];
  if (brandUpper === 'NEXEN') {
    // Use hardcoded image map — Nexen CDN paths aren't slug-predictable
    const mapped = nexenMappedUrl(title);
    if (mapped) specific = [mapped];
    // No CDN slug fallback for Nexen; fall through to SimpleTire below
  } else if (brandUpper === 'COOPER') {
    // Use hardcoded image map — Cooper CDN paths aren't slug-predictable
    const mapped = cooperMappedUrl(title);
    if (mapped) specific = [mapped];
    // Unmatched Cooper products fall through to SimpleTire below
  } else if (brandUpper === 'VREDESTEIN') {
    specific = vredesteinCandidates(modelSlug);
  }

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
  let pageNum   = 0;
  let totalSeen = 0;

  while (url) {
    pageNum++;
    const res  = await shopifyFetchRaw(url);
    const data: any = await res.json();
    const page: ShopifyProduct[] = (data.products ?? []) as ShopifyProduct[];
    totalSeen += page.length;

    console.log(`  [fetchImageless] page ${pageNum}: ${page.length} products (${totalSeen} total so far)`);

    // Log first product on page 1 for structure inspection
    if (pageNum === 1 && page.length > 0) {
      const sample = page[0];
      const sampleImages = (sample.images ?? []).map(i => ({ id: i.id, src: i.src?.slice(0, 80) }));
      console.log(`  [fetchImageless] sample product — id:${sample.id} title:"${sample.title}" images:${JSON.stringify(sampleImages)}`);
    }

    for (const p of page) {
      const images = p.images ?? [];

      // A product counts as imageless when:
      //   (a) it has no attached images at all, OR
      //   (b) every image is a Shopify placeholder (src contains "no-image" or "placeholder")
      const hasRealImage = images.some(img => {
        if (!img.src) return false;
        const src = img.src.toLowerCase();
        return !src.includes('no-image') && !src.includes('placeholder');
      });
      if (hasRealImage) continue;

      if (brandFilter && !p.title.toLowerCase().startsWith(brandFilter.toLowerCase())) continue;

      imageless.push(p);
    }

    const link  = res.headers.get('Link') ?? '';
    const nextM = link.match(/<([^>]+)>;\s*rel="next"/);
    url = nextM ? nextM[1] : null;
  }

  console.log(`  [fetchImageless] done — totalSeen:${totalSeen} imageless:${imageless.length} (${totalSeen - imageless.length} had real images)`);
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

  console.log(`🖼  backfillImages called — preview=${preview} brand=${brandFilter ?? 'all'} cursor=${cursor}`);
  console.log(`  SHOPIFY_STORE_DOMAIN set: ${!!SHOPIFY.domain} | token set: ${!!SHOPIFY.token}`);

  // ── Fetch all imageless products (fast read pass) ─────────────────────────
  let allImageless: ShopifyProduct[];
  try {
    allImageless = await fetchImagelessProducts(brandFilter);
  } catch (err) {
    console.error(`  fetchImagelessProducts threw: ${String(err)}`);
    return res.status(500).json({ error: `Failed to fetch products: ${String(err)}` });
  }

  console.log(`  imageless products found: ${allImageless.length}`);
  if (allImageless.length > 0) {
    console.log(`  first imageless product: ${JSON.stringify({ id: allImageless[0].id, title: allImageless[0].title, imageCount: (allImageless[0].images ?? []).length })}`);
  } else {
    console.log(`  ⚠️  No imageless products found — either all products have real images or fetch returned nothing`);
  }

  const total      = allImageless.length;
  const chunk      = allImageless.slice(cursor, cursor + CHUNK_SIZE);
  const nextCursor = (cursor + CHUNK_SIZE) < total ? cursor + CHUNK_SIZE : null;

  console.log(`  Imageless total: ${total} | chunk.length: ${chunk.length} (cursor=${cursor}, CHUNK_SIZE=${CHUNK_SIZE}) | nextCursor: ${nextCursor}`);

  // ── Probe CDN candidates in batches ──────────────────────────────────────
  // Every product gets a result entry — found or not-found.
  interface ProductResult {
    productId: string;
    title:     string;
    source:    SourceLabel;
    imageUrl:  string | null;
    attempted: string[];   // "https://url → reason" for every URL tried
  }

  const results: ProductResult[] = [];

  for (let i = 0; i < chunk.length; i += BATCH_SIZE) {
    const batch = chunk.slice(i, i + BATCH_SIZE);

    const batchResults = await Promise.all(batch.map(async (product) => {
      const candidates = candidatesForTitle(product.title);

      if (candidates.length === 0) {
        console.log(`  ⏭  [${product.id}] No candidates — "${product.title}"`);
        return {
          productId: String(product.id),
          title:     product.title,
          source:    'not-found' as SourceLabel,
          imageUrl:  null,
          attempted: ['(no candidates generated for this title)'],
        };
      }

      const outcome = await probeAllWithDetails(candidates);

      if (outcome.imageUrl) {
        console.log(`  ✅ [${product.id}] ${outcome.source} — "${product.title}"`);
        console.log(`       ${outcome.imageUrl}`);
      } else {
        console.log(`  ❌ [${product.id}] not-found — "${product.title}"`);
        outcome.attempted.forEach(a => console.log(`       ${a}`));
      }

      return {
        productId: String(product.id),
        title:     product.title,
        source:    outcome.source,
        imageUrl:  outcome.imageUrl,
        attempted: outcome.attempted,
      };
    }));

    results.push(...batchResults);

    // Pause between probe batches to be CDN-friendly
    if (i + BATCH_SIZE < chunk.length) await delay(300);
  }

  const found   = results.filter(r => r.imageUrl !== null);
  const notFound = results.filter(r => r.imageUrl === null);

  // ── Preview mode: return full results without writing ──────────────────────
  if (preview) {
    console.log(`  [preview] returning results.length=${results.length} found=${found.length} notFound=${notFound.length}`);
    if (results.length === 0) {
      console.log(`  [preview] ⚠️  results[] is empty — chunk.length was ${chunk.length} (total imageless: ${total}, cursor: ${cursor})`);
    }
    return res.status(200).json({
      total,
      attached:  found.length,
      skipped:   notFound.length,
      failed:    0,
      errors:    [],
      nextCursor,
      results,   // every product in chunk with probe details
    });
  }

  // ── Write: POST image to Shopify for each match ───────────────────────────
  // Sequential writes (one at a time) to avoid Shopify media processing backlog.
  let attached = 0;
  const errors: string[] = [];

  for (const result of found) {
    try {
      await attachImage(parseInt(result.productId, 10), result.imageUrl!);
      attached++;
      console.log(`  📎 Attached image to product ${result.productId}`);
    } catch (err) {
      const msg = `Product ${result.productId} ("${result.title}"): ${String(err)}`;
      console.error(`  ❌ ${msg}`);
      errors.push(msg);
    }
    // Small delay between Shopify writes to respect rate limits
    await delay(300);
  }

  const report = {
    total,
    attached,
    skipped:   notFound.length,
    failed:    errors.length,
    errors,
    nextCursor,
    results,   // full probe details included in write-mode response too
  };

  console.log(`✅ Chunk done — cursor:${cursor} attached:${attached} skipped:${notFound.length} failed:${errors.length} nextCursor:${nextCursor}`);
  return res.status(200).json(report);
}
