// api/addTireImages.ts
// ============================================================
// Attach product images to Shopify tire products
//
// Strategy (in order of priority):
//   1. TireRack product page og:image  (model-specific photo)
//   2. Brand-level CDN fallback        (brand generic image)
//   3. Skip                            (manual upload later)
//
// POST ?action=add-images&offset=0    — process 20 products/call
// POST ?action=status                 — show how many still need images
// ============================================================

import type { VercelRequest, VercelResponse } from '@vercel/node';

export const config = { maxDuration: 120 };

// ─── SHOPIFY CONFIG ───────────────────────────────────────────────────────────

const SHOPIFY = {
  domain:     process.env.SHOPIFY_STORE_DOMAIN       || '',
  token:      process.env.SHOPIFY_ADMIN_ACCESS_TOKEN || '',
  apiVersion: '2024-01',
  get baseUrl() { return `https://${this.domain}/admin/api/${this.apiVersion}`; },
};

const CT_VENDOR = 'Canada Tire';
const SYNC_TAG  = 'ct-sync';

// ─── BRAND-LEVEL FALLBACK IMAGE MAP ──────────────────────────────────────────
// Used when TireRack scrape fails. Stable CDN URLs from manufacturer websites.

// Reliable JPEG product images per brand from TireRack CDN
// No brand fallback — products without a match keep no image

// ─── TIRESOURCECANADA.CA SCRAPER ─────────────────────────────────────────────
// Server-side rendered Canadian tire site with predictable URLs
// Pattern: /tires/{brand-slug}/{model-slug}
// Image in HTML: <img src="/assets/images/tires/reg/{brand}_{model}_..._tires_YYYY.jpg">

function buildTireSourceUrl(brand: string, model: string): string {
  const slug = (s: string) => s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return `https://www.tiresourcecanada.ca/tires/${slug(brand)}/${slug(model)}`;
}

async function fetchTireSourceImage(brand: string, model: string): Promise<string | null> {
  const url = buildTireSourceUrl(brand, model);
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml',
      },
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) return null;
    const html = await res.text();

    // Primary: extract from <img> tag with /assets/images/tires/ path
    const imgMatch = html.match(/src="(https?:\/\/www\.tiresourcecanada\.ca\/assets\/images\/tires\/[^"]+\.(?:jpg|jpeg|png|webp))"/i)
                  || html.match(/src="(\/assets\/images\/tires\/[^"]+\.(?:jpg|jpeg|png|webp))"/i);

    if (imgMatch?.[1]) {
      const src = imgMatch[1];
      return src.startsWith('/') ? `https://www.tiresourcecanada.ca${src}` : src;
    }

    // Fallback: og:image
    const ogMatch = html.match(/<meta[^>]+property="og:image"[^>]+content="([^"]+)"/i)
                 || html.match(/<meta[^>]+content="([^"]+)"[^>]+property="og:image"/i);
    if (ogMatch?.[1]?.match(/\.(jpg|jpeg|png|webp)/i)) {
      return ogMatch[1];
    }

    return null;
  } catch {
    return null;
  }
}

// ─── IN-MEMORY CACHE (per invocation) ────────────────────────────────────────

const imageCache = new Map<string, string | null>();

async function getImageForTire(brand: string, model: string): Promise<string | null> {
  const key = `${brand}::${model}`;
  if (imageCache.has(key)) return imageCache.get(key)!;

  // 1. Try tiresourcecanada.ca (Canadian, SSR, accessible)
  const trImage = await fetchTireSourceImage(brand, model);
  if (trImage) {
    imageCache.set(key, trImage);
    return trImage;
  }

  // 2. No image found — return null (product stays without image)
  imageCache.set(key, null);
  return null;
}

// ─── SHOPIFY HELPERS ──────────────────────────────────────────────────────────

function delay(ms: number) { return new Promise(r => setTimeout(r, ms)); }

async function shopifyFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`${SHOPIFY.baseUrl}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': SHOPIFY.token,
      ...(options.headers || {}),
    },
  });
  if (res.status === 429) { await delay(2000); return shopifyFetch<T>(path, options); }
  if (!res.ok) throw new Error(`Shopify ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json() as Promise<T>;
}

// ─── GET PRODUCTS WITHOUT IMAGES ─────────────────────────────────────────────

interface ShopifyProduct {
  id:       number;
  title:    string;
  vendor:   string;
  images:   { id: number; src: string }[];
  variants: { sku: string }[];
}

async function getProductsWithoutImages(limit: number, sinceId: number = 0): Promise<ShopifyProduct[]> {
  // Paginate through ALL products using since_id, return only those without images
  // We may need multiple Shopify pages to fill our limit since many products have images
  const results: ShopifyProduct[] = [];
  let cursor = sinceId;

  while (results.length < limit) {
    const q = `tag=${encodeURIComponent(SYNC_TAG)}&limit=250&fields=id,title,vendor,images,variants${cursor ? `&since_id=${cursor}` : ''}`;
    const data: any = await shopifyFetch<any>(`/products.json?${q}`);
    const page: ShopifyProduct[] = data.products || [];
    if (page.length === 0) break;

    const withoutImages = page.filter(p => p.images.length === 0);
    results.push(...withoutImages);
    cursor = page[page.length - 1].id; // advance cursor regardless of image status
    if (page.length < 250) break; // last page
  }

  return results.slice(0, limit);
}

async function countProductsWithoutImages(): Promise<{ withImages: number; withoutImages: number; total: number }> {
  let sinceId = 0;
  let withImages = 0;
  let withoutImages = 0;

  while (true) {
    const q = `tag=${encodeURIComponent(SYNC_TAG)}&limit=250&fields=id,images${sinceId ? `&since_id=${sinceId}` : ''}`;
    const data: any = await shopifyFetch<any>(`/products.json?${q}`);
    const products: ShopifyProduct[] = data.products || [];

    for (const p of products) {
      if (p.images.length > 0) withImages++;
      else withoutImages++;
    }

    if (products.length < 250) break;
    sinceId = products[products.length - 1].id;
  }

  return { withImages, withoutImages, total: withImages + withoutImages };
}

// ─── ATTACH IMAGE TO SHOPIFY PRODUCT ─────────────────────────────────────────

async function attachImage(productId: number, imageUrl: string): Promise<void> {
  await shopifyFetch(`/products/${productId}/images.json`, {
    method: 'POST',
    body:   JSON.stringify({ image: { src: imageUrl } }),
  });
}

// ─── PARSE BRAND/MODEL FROM PRODUCT TITLE ────────────────────────────────────
// Title format: "COOPER PROCONTROL 225/50R17"
// We need brand=COOPER, model=PROCONTROL

function parseBrandModel(title: string): { brand: string; model: string } {
  const parts = title.split(' ').filter(Boolean);
  if (parts.length < 2) return { brand: parts[0] || '', model: '' };

  // Known multi-word brands
  const multiWordBrands = ['BF GOODRICH', 'GT RADIAL'];
  for (const mwb of multiWordBrands) {
    if (title.toUpperCase().startsWith(mwb)) {
      const rest   = title.slice(mwb.length).trim().split(' ');
      return { brand: mwb, model: rest[0] || '' };
    }
  }

  // First word = brand, second = model (rest is size)
  return { brand: parts[0], model: parts[1] };
}

// ─── MAIN HANDLER ─────────────────────────────────────────────────────────────

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const secret = process.env.CRON_SECRET || '';
  if (secret) {
    const provided = (req.headers.authorization || '').replace('Bearer ', '');
    if (provided !== secret) return res.status(401).json({ error: 'Unauthorized' });
  }

  if (!SHOPIFY.domain || !SHOPIFY.token) {
    return res.status(500).json({ error: 'Missing SHOPIFY_STORE_DOMAIN or SHOPIFY_ADMIN_ACCESS_TOKEN' });
  }

  const action  = (req.query.action as string) || 'status';
  const offset  = parseInt((req.query.offset as string) || '0', 10);

  try {
    // ── Status ──────────────────────────────────────────────────────────────
    if (action === 'status') {
      const counts = await countProductsWithoutImages();
      return res.status(200).json({
        success: true,
        ...counts,
        nextAction: counts.withoutImages > 0
          ? `Run ?action=add-images in a loop until done`
          : '🎉 All products have images!',
      });
    }

    // ── Add images ───────────────────────────────────────────────────────────
    if (action === 'add-images') {
      const t0 = Date.now();
      const stats = { attached: 0, notFound: 0, errors: 0, errorList: [] as string[], processed: 0 };

      // Fetch one Shopify page (250 products) starting after since_id=offset
      // offset must be a real Shopify product ID (returned as nextOffset from previous call)
      const q = `tag=${encodeURIComponent(SYNC_TAG)}&limit=250&fields=id,title,vendor,images,variants${offset ? `&since_id=${offset}` : ''}`;
      const data: any = await shopifyFetch<any>(`/products.json?${q}`);
      const page: ShopifyProduct[] = data.products || [];
      const toProcess = page.filter(p => p.images.length === 0);
      stats.processed = toProcess.length;

      for (const product of toProcess) {
        try {
          const { brand, model } = parseBrandModel(product.title);
          if (!brand || !model) { stats.notFound++; continue; }

          const imageUrl = await getImageForTire(brand, model);

          if (imageUrl) {
            await attachImage(product.id, imageUrl);
            stats.attached++;
            console.log(`✅ ${product.title} → ${imageUrl.slice(0, 60)}...`);
          } else {
            stats.notFound++;
            console.log(`⚠️ No image: ${brand} ${model}`);
          }

          await delay(200);
        } catch (e: any) {
          stats.errors++;
          stats.errorList.push(`${product.title}: ${e.message}`);
        }
      }

      const duration = `${((Date.now() - t0) / 1000).toFixed(1)}s`;
      const lastId   = page.length > 0 ? page[page.length - 1].id : null;
      const done     = page.length < 250;

      return res.status(200).json({
        success: true,
        ...stats,
        duration,
        done,
        nextOffset: done ? null : lastId,
        message: done ? '🎉 All products processed!' : `Run again with offset=${lastId}`,
      });
    }

    return res.status(400).json({ error: 'Unknown action', available: ['status', 'add-images'] });

  } catch (e: any) {
    console.error('❌ addTireImages error:', e);
    return res.status(500).json({ success: false, error: e.message });
  }
}
