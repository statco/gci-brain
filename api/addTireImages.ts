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
// Pattern: content.tirerack.com/tires/[brand]/[model]/[brand]_[model]_[size].jpg
// Fallback: use known-good product images per brand

const BRAND_IMAGES: Record<string, string> = {
  'COOPER':       'https://content.tirerack.com/tires/Cooper/Cobra/Cooper_Cobra_Radial_GT_P235_60R14_96T_BW.jpg',
  'MICHELIN':     'https://content.tirerack.com/tires/Michelin/Defender2/Michelin_Defender2_225_65R17_102T_BW.jpg',
  'BRIDGESTONE':  'https://content.tirerack.com/tires/Bridgestone/Turanza/Bridgestone_Turanza_QuietTrack_225_50R17_94V_BW.jpg',
  'GOODYEAR':     'https://content.tirerack.com/tires/Goodyear/AssuranceWeatherReady/Goodyear_Assurance_WeatherReady_225_65R17_102H_BW.jpg',
  'CONTINENTAL':  'https://content.tirerack.com/tires/Continental/TrueContactTour/Continental_TrueContact_Tour_225_65R17_102T_BW.jpg',
  'BFGOODRICH':   'https://content.tirerack.com/tires/BFGoodrich/AllTerrainTA_KO2/BFGoodrich_All-Terrain_TA_KO2_265_70R17_121_118S_OWL.jpg',
  'FIRESTONE':    'https://content.tirerack.com/tires/Firestone/WeatherGrip/Firestone_WeatherGrip_225_65R17_102H_BW.jpg',
  'GENERAL':      'https://content.tirerack.com/tires/General/AltiMAX365AW/General_AltiMAX_365AW_225_65R17_102H_BW.jpg',
  'YOKOHAMA':     'https://content.tirerack.com/tires/Yokohama/BluEarth/Yokohama_BluEarth-GT_AE51_225_50R17_94W_BW.jpg',
  'TOYO':         'https://content.tirerack.com/tires/Toyo/CelsiusSport/Toyo_Celsius_Sport_225_50R17_98V_BW.jpg',
  'HANKOOK':      'https://content.tirerack.com/tires/Hankook/Kinergy4S2/Hankook_Kinergy_4S2_225_50R17_98V_BW.jpg',
  'NEXEN':        'https://content.tirerack.com/tires/Nexen/NFera/Nexen_NFera_AU7_225_50R17_98W_BW.jpg',
  'PIRELLI':      'https://content.tirerack.com/tires/Pirelli/CinturratoP7/Pirelli_Cinturato_P7_225_50R17_94W_BW.jpg',
  'FALKEN':       'https://content.tirerack.com/tires/Falken/SinceraSN250AS/Falken_Sincera_SN250_A_S_225_65R17_102H_BW.jpg',
  'NITTO':        'https://content.tirerack.com/tires/Nitto/NeoGen/Nitto_Neo_Gen_225_50R17_98W_BW.jpg',
  'KUMHO':        'https://content.tirerack.com/tires/Kumho/SolusTa51a/Kumho_Solus_TA51a_225_65R17_102H_BW.jpg',
  'HERCULES':     'https://content.tirerack.com/tires/Hercules/TerraTraxATX/Hercules_Terra_Trac_AT-X_265_70R17_121_118S_OWL.jpg',
  'UNIROYAL':     'https://content.tirerack.com/tires/Uniroyal/TigerPaw/Uniroyal_Tiger_Paw_Touring_A_S_225_65R17_102H_BW.jpg',
  'DUNLOP':       'https://content.tirerack.com/tires/Dunlop/SP/Dunlop_SP_Sport_Maxx_225_50R17_94W_BW.jpg',
  'GT RADIAL':    'https://content.tirerack.com/tires/GTRadial/Champiro/GT_Radial_Champiro_228_225_65R17_102H_BW.jpg',
};

// Generic tire fallback if brand not in map
const GENERIC_TIRE_IMAGE = 'https://content.tirerack.com/tires/Cooper/ProControl/Cooper_ProControl_225_65R17_102H_BW.jpg';

// ─── TIRERACK URL PATTERNS ────────────────────────────────────────────────────
// New clean URL pattern: /tires/[brand-slug]-[model-slug]

function buildTireRackUrl(brand: string, model: string): string {
  const slug = (s: string) => s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

  return `https://www.tirerack.com/tires/${slug(brand)}-${slug(model)}`;
}

// ─── SCRAPE OG:IMAGE FROM TIRERACK ───────────────────────────────────────────

async function fetchTireRackImage(brand: string, model: string): Promise<string | null> {
  const url = buildTireRackUrl(brand, model);

  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; GCITires/1.0)',
        'Accept':     'text/html',
      },
      signal: AbortSignal.timeout(8000),
    });

    if (!res.ok) return null;

    const html = await res.text();

    // Extract og:image
    const match = html.match(/<meta\s+(?:property|name)="og:image"\s+content="([^"]+)"/i)
                || html.match(/<meta\s+content="([^"]+)"\s+(?:property|name)="og:image"/i);

    if (match?.[1]) {
      const imgUrl = match[1].startsWith('//') ? `https:${match[1]}` : match[1];
      // Only accept actual image URLs, not logos or SVGs
      if (imgUrl.match(/\.(jpg|jpeg|png|webp)/i)) {
        return imgUrl;
      }
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

  // 1. Try TireRack
  const trImage = await fetchTireRackImage(brand, model);
  if (trImage) {
    imageCache.set(key, trImage);
    return trImage;
  }

  // 2. Brand-level fallback JPEG (always returns something)
  const brandKey   = brand.toUpperCase();
  const brandImage = BRAND_IMAGES[brandKey] || GENERIC_TIRE_IMAGE;
  imageCache.set(key, brandImage);
  return brandImage;
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
  // Filter by ct-sync tag since vendor = brand name (COOPER, MICHELIN etc), not "Canada Tire"
  const q = `tag=${encodeURIComponent(SYNC_TAG)}&limit=250&fields=id,title,vendor,images,variants${sinceId ? `&since_id=${sinceId}` : ''}`;
  const data: any = await shopifyFetch<any>(`/products.json?${q}`);
  const all: ShopifyProduct[] = data.products || [];
  return all.filter(p => p.images.length === 0).slice(0, limit);
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
  const chunkSize = 20; // 20 products per call (each needs a TireRack fetch)

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

      // Fetch products without images (paginated by offset via sinceId approximation)
      const products = await getProductsWithoutImages(chunkSize, offset);
      stats.processed = products.length;

      for (const product of products) {
        try {
          const { brand, model } = parseBrandModel(product.title);
          if (!brand || !model) { stats.notFound++; continue; }

          const imageUrl = await getImageForTire(brand, model);

          if (imageUrl) {
            await attachImage(product.id, imageUrl);
            stats.attached++;
            console.log(`✅ Image attached: ${product.title} → ${imageUrl.slice(0, 60)}...`);
          } else {
            stats.notFound++;
            console.log(`⚠️ No image found: ${brand} ${model}`);
          }

          await delay(200); // gentle rate limit
        } catch (e: any) {
          stats.errors++;
          stats.errorList.push(`${product.title}: ${e.message}`);
        }
      }

      const duration = `${((Date.now() - t0) / 1000).toFixed(1)}s`;
      const done     = products.length < chunkSize;

      return res.status(200).json({
        success: true,
        ...stats,
        duration,
        done,
        nextOffset: done ? null : offset + chunkSize,
        message: done
          ? '🎉 All products processed!'
          : `Run again with offset=${offset + chunkSize} to continue`,
      });
    }

    return res.status(400).json({ error: 'Unknown action', available: ['status', 'add-images'] });

  } catch (e: any) {
    console.error('❌ addTireImages error:', e);
    return res.status(500).json({ success: false, error: e.message });
  }
}
