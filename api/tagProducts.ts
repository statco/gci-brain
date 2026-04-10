// api/tagProducts.ts
// ============================================================
// GMC Tag Backfiller — assigns season: and vehicle_type: tags
// to Shopify products based on keywords in the product title.
//
// GET /api/tagProducts               — chunk 0 (50 products)
// GET /api/tagProducts?cursor=50     — next chunk
// GET /api/tagProducts?preview=true  — show first 20 changes, no writes
//
// RESPONSE
//   { fixed, skipped, total, nextCursor, preview, errors }
//   fixed      — products updated (or would-be updated in preview)
//   skipped    — products already fully tagged or non-tire
//   total      — total products in store
//   nextCursor — numeric offset for the next call; null when done
//   preview    — first 20 changes { id, title, addedTags }
//   errors     — per-product error strings
//
// SEASON RULES (first match wins; no season tag added if none match):
//   "Winter"      → season:Winter
//   "All-Season"  → season:All-Season
//   "All-Weather" → season:All-Weather
//   "Summer"      → season:Summer
//   "All-Terrain" → season:All-Terrain
//
// VEHICLE-TYPE RULES (first match wins; default → Passenger):
//   "Passenger Car"          → vehicle_type:Passenger
//   "Light Truck" | word "LT" → vehicle_type:Light Truck
//   "SUV" | "Crossover"      → vehicle_type:SUV
//   "All-Terrain"            → vehicle_type:Truck/SUV
//   (none of the above)      → vehicle_type:Passenger
//
// A product is SKIPPED if it already has BOTH a season:* tag AND a
// vehicle_type:* tag. Tags are only added, never removed.
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

const CHUNK_SIZE = 50;

// ─── HELPERS ──────────────────────────────────────────────────────────────────

function delay(ms: number) { return new Promise(r => setTimeout(r, ms)); }

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

// ─── TAG RULES ────────────────────────────────────────────────────────────────

const SEASON_RULES: Array<{ match: (t: string) => boolean; tag: string }> = [
  { match: t => t.includes('winter'),      tag: 'season:Winter'      },
  { match: t => t.includes('all-season'),  tag: 'season:All-Season'  },
  { match: t => t.includes('all-weather'), tag: 'season:All-Weather' },
  { match: t => t.includes('summer'),      tag: 'season:Summer'      },
  { match: t => t.includes('all-terrain'), tag: 'season:All-Terrain' },
];

const VEHICLE_RULES: Array<{ match: (t: string) => boolean; tag: string }> = [
  { match: t => t.includes('passenger car'),                   tag: 'vehicle_type:Passenger'   },
  { match: t => t.includes('light truck') || /\blt\b/.test(t), tag: 'vehicle_type:Light Truck' },
  { match: t => t.includes('suv') || t.includes('crossover'),  tag: 'vehicle_type:SUV'         },
  { match: t => t.includes('all-terrain'),                     tag: 'vehicle_type:Truck/SUV'   },
];

const VEHICLE_DEFAULT = 'vehicle_type:Passenger';

// Keywords that identify non-tire service/accessory products to skip
const NON_TIRE_KEYWORDS = [
  'installation', 'service', 'balancing', 'mounting', 'valve', 'tpms',
  'bottle', 'vacuum', 'cleaner', 'massager', 'cervical', 'neck',
  'shoulder', 'relaxer', 'nuproz', 'water', 'gym', 'sports drinking',
  'home appliance', 'cordless', 'handheld', 'suction',
];

// Product must contain at least one tire-related term to be processed
const TIRE_TERMS_RE = /tire|tyre|pneu|R1[5-9]|R2[0-2]|\bLT\b|\bXL\b|3PMSF/i;

function deriveTags(title: string): string[] {
  const t = title.toLowerCase();
  const tags: string[] = [];

  const seasonRule = SEASON_RULES.find(r => r.match(t));
  if (seasonRule) tags.push(seasonRule.tag);

  const vehicleRule = VEHICLE_RULES.find(r => r.match(t));
  tags.push(vehicleRule ? vehicleRule.tag : VEHICLE_DEFAULT);

  return tags;
}

// ─── PRODUCT FETCHER ──────────────────────────────────────────────────────────

interface ShopifyProduct { id: number; title: string; tags: string; }

async function fetchAllProducts(): Promise<ShopifyProduct[]> {
  const all: ShopifyProduct[] = [];
  let url: string | null = `${SHOPIFY.baseUrl}/products.json?limit=250&fields=id,title,tags`;
  let page = 0;
  while (url) {
    page++;
    const res = await shopifyFetchRaw(url);
    const data: any = await res.json();
    const products: ShopifyProduct[] = data.products ?? [];
    all.push(...products);
    console.log(`[tagProducts] page ${page}: ${products.length} products (total: ${all.length})`);
    const link  = res.headers.get('Link') ?? '';
    const nextM = link.match(/<([^>]+)>;\s*rel="next"/);
    url = nextM ? nextM[1] : null;
  }
  return all;
}

// ─── HANDLER ──────────────────────────────────────────────────────────────────

export interface PreviewItem { id: number; title: string; addedTags: string[]; }

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Content-Type', 'application/json');

  if (!SHOPIFY.domain || !SHOPIFY.token) {
    return res.status(500).json({ error: 'Missing SHOPIFY_STORE_DOMAIN or SHOPIFY_ADMIN_ACCESS_TOKEN' });
  }

  const cursor  = req.query.cursor  ? parseInt(req.query.cursor as string, 10) : 0;
  const preview = req.query.preview === 'true';

  let allProducts: ShopifyProduct[];
  try {
    allProducts = await fetchAllProducts();
  } catch (err) {
    return res.status(500).json({ error: `Failed to fetch products: ${String(err)}` });
  }

  const total      = allProducts.length;
  const chunk      = allProducts.slice(cursor, cursor + CHUNK_SIZE);
  const nextCursor = (cursor + CHUNK_SIZE) < total ? cursor + CHUNK_SIZE : null;

  let fixed   = 0;
  let skipped = 0;
  const errors: string[]      = [];
  const previewItems: PreviewItem[] = [];

  for (const product of chunk) {
    // Skip non-tire products (blocklist) or products with no tire-related term (allowlist)
    const titleLower = product.title.toLowerCase();
    if (NON_TIRE_KEYWORDS.some(kw => titleLower.includes(kw))) { skipped++; continue; }
    if (!TIRE_TERMS_RE.test(product.title)) { skipped++; continue; }

    // Parse existing tags
    const existingTags  = product.tags.split(',').map(t => t.trim()).filter(Boolean);
    const hasSeasonTag  = existingTags.some(t => t.startsWith('season:'));
    const hasVehicleTag = existingTags.some(t => t.startsWith('vehicle_type:'));

    // Skip if already fully tagged
    if (hasSeasonTag && hasVehicleTag) { skipped++; continue; }

    // Determine which tags to add (respect already-present season/vehicle tags)
    const derived = deriveTags(product.title);
    const toAdd   = derived.filter(tag => {
      if (tag.startsWith('season:')       && hasSeasonTag)  return false;
      if (tag.startsWith('vehicle_type:') && hasVehicleTag) return false;
      return !existingTags.includes(tag);
    });

    if (toAdd.length === 0) { skipped++; continue; }

    // Collect for preview (always, capped at 20 in response)
    previewItems.push({ id: product.id, title: product.title, addedTags: toAdd });
    fixed++;

    if (!preview) {
      try {
        const merged = [...existingTags, ...toAdd].join(', ');
        await shopifyFetch(`/products/${product.id}.json`, {
          method: 'PUT',
          body: JSON.stringify({ product: { id: product.id, tags: merged } }),
        });
      } catch (err) {
        errors.push(`Product ${product.id} ("${product.title}"): ${String(err)}`);
        fixed--; // didn't actually fix it
      }
    }
  }

  console.log(`[tagProducts] cursor=${cursor} total=${total} chunk=${chunk.length} fixed=${fixed} skipped=${skipped} errors=${errors.length} preview=${preview} nextCursor=${nextCursor}`);

  return res.status(200).json({
    fixed,
    skipped,
    total,
    nextCursor,
    preview: previewItems.slice(0, 20),
    errors,
  });
}
