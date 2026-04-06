// api/fixTireSize.ts
// ============================================================
// Shopify Tire Size Format Fixer
//
// Finds products whose titles contain compact/malformed tire size
// codes (e.g. "2154517/r", "2756520/rlt", "2154517/rxl") and
// rewrites them to the correct retail format (215/45R17, etc.).
// Also rebuilds the full title with brand, model, season, and
// updates the SEO meta title metafield.
//
// MODES
//   GET /api/fixTireSize                  — fix all products
//   GET /api/fixTireSize?preview=true     — dry run, no writes
//   GET /api/fixTireSize?brand=Nexen      — one brand only
//
// RESPONSE
//   { total, fixed, skipped, errors, preview }
//   preview: first 20 changed pairs { before, after }
// ============================================================

import type { VercelRequest, VercelResponse } from '@vercel/node';

export const config = { maxDuration: 300 };

// ─── SHOPIFY CONFIG ────────────────────────────────────────────────────────────

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

// ─── TIRE SIZE REGEX ──────────────────────────────────────────────────────────
//
//   Matches: 3-digit width + 2-digit aspect + 2-digit rim + /r + optional suffix
//   Examples:
//     2154517/r    →  215/45R17
//     2756520/rlt  →  275/65R20 LT
//     2154517/rxl  →  215/45R17 XL
//
const SIZE_RE = /(\d{3})(\d{2})(\d{2})\/r(lt|xl)?/gi;

function fixSizeCode(_match: string, w: string, a: string, r: string, suffix: string | undefined): string {
  const base = `${w}/${a}R${r}`;
  if (!suffix) return base;
  return `${base} ${suffix.toUpperCase()}`;
}

// Returns the corrected size string, or null if no match found.
function extractAndFixSize(title: string): { correctedSize: string; } | null {
  SIZE_RE.lastIndex = 0;
  const m = SIZE_RE.exec(title);
  if (!m) return null;
  return { correctedSize: fixSizeCode(m[0], m[1], m[2], m[3], m[4]) };
}

// ─── SEASON DETECTION ─────────────────────────────────────────────────────────

const SEASON_MAP: Array<{ keywords: string[]; season: string }> = [
  { keywords: ['winguard', 'ice', 'blizzak', 'winter', 'snow', 'claw', 'arctic', 'artic', 'arctik', 'nordic', 'hakka', 'studdable'], season: 'Winter' },
  { keywords: ['all weather', 'all-weather', 'allweather', '4season', '4s'],                                                          season: 'All-Weather' },
  { keywords: ['all season', 'all-season', 'htx', 'roadian', 'crossclimate', 'weatherpeak'],                                         season: 'All-Season' },
  { keywords: ['cobra', 'instinct', 'nfera', 'sport', 'hp', 'uhp', 'performance', 'pilot', 'eagle', 'potenza', 're', 'summer'],      season: 'Summer' },
];

function detectSeason(titleLower: string): string {
  for (const { keywords, season } of SEASON_MAP) {
    if (keywords.some(kw => titleLower.includes(kw))) return season;
  }
  return 'All-Season'; // safe default
}

// ─── TITLE REBUILDER ──────────────────────────────────────────────────────────
//
//   Input:  "Nexen Winguard Sport 2 2154517/r"
//   Output: "Nexen Winguard Sport 2 215/45R17 Winter Tire"
//
//   Strategy:
//   1. Strip the raw size token and everything after it from the title.
//   2. Trim the remainder — that is "Brand + Model Name".
//   3. Append corrected size, then season + " Tire".
//
function rebuildTitle(original: string, correctedSize: string): string {
  SIZE_RE.lastIndex = 0;
  // Remove the compact size code (and anything trailing, e.g. stray suffixes)
  const withoutSize = original.replace(SIZE_RE, '').trim().replace(/\s{2,}/g, ' ');
  // Also strip any trailing "tire", "tyre" already present so we don't double it
  const brandModel = withoutSize.replace(/\s*tir(e|es|e)?\s*$/i, '').trim();
  const season = detectSeason(original.toLowerCase());
  return `${brandModel} ${correctedSize} ${season} Tire`;
}

// ─── SEO META TITLE ───────────────────────────────────────────────────────────
//
//   Format: "[Brand] [Model] [Size] — Buy Online | GCI Tires Canada"
//   Max 60 chars — truncate the model portion if needed.
//
const SEO_SUFFIX = ' — Buy Online | GCI Tires Canada';
const SEO_MAX    = 60;

function buildSeoTitle(newTitle: string): string {
  // newTitle = "Nexen Winguard Sport 2 215/45R17 Winter Tire"
  // We want: "Nexen Winguard Sport 2 215/45R17 — Buy Online | GCI Tires Canada"
  // Drop the trailing " [Season] Tire" for the SEO title to save characters
  const base = newTitle.replace(/\s+(Winter|All-Season|All-Weather|Summer)\s+Tire\s*$/i, '').trim();
  const full = `${base}${SEO_SUFFIX}`;
  if (full.length <= SEO_MAX) return full;

  // Truncate by shrinking `base`
  const allowedBase = SEO_MAX - SEO_SUFFIX.length;
  return `${base.slice(0, allowedBase).trimEnd()}${SEO_SUFFIX}`;
}

// ─── SHOPIFY PRODUCT FETCHER (cursor pagination) ───────────────────────────────

interface ShopifyProduct {
  id:    number;
  title: string;
}

async function fetchAllProducts(brandFilter?: string): Promise<ShopifyProduct[]> {
  const all: ShopifyProduct[] = [];
  let url: string | null = `${SHOPIFY.baseUrl}/products.json?limit=250&fields=id,title`;

  while (url) {
    const res = await shopifyFetchRaw(url);
    const data: any = await res.json();
    const page: ShopifyProduct[] = (data.products ?? []) as ShopifyProduct[];

    const filtered = brandFilter
      ? page.filter(p => p.title.toLowerCase().startsWith(brandFilter.toLowerCase()))
      : page;

    all.push(...filtered);

    // Follow Link header for cursor-based pagination
    const link  = res.headers.get('Link') ?? '';
    const nextM = link.match(/<([^>]+)>;\s*rel="next"/);
    url = nextM ? nextM[1] : null;
  }

  return all;
}

// ─── SEO METAFIELD UPSERT ─────────────────────────────────────────────────────

interface ShopifyMetafield {
  id:    number;
  key:   string;
  value: string;
}

async function upsertSeoTitleMetafield(productId: number, value: string): Promise<void> {
  const data: any = await shopifyFetch(
    `/products/${productId}/metafields.json?namespace=global`,
  );
  const existing: ShopifyMetafield | undefined = (data.metafields ?? [])
    .find((m: ShopifyMetafield) => m.key === 'title_tag');

  if (existing) {
    if (existing.value === value) return; // already correct
    await shopifyFetch(`/metafields/${existing.id}.json`, {
      method: 'PUT',
      body:   JSON.stringify({ metafield: { id: existing.id, value } }),
    });
  } else {
    await shopifyFetch(`/products/${productId}/metafields.json`, {
      method: 'POST',
      body:   JSON.stringify({
        metafield: { namespace: 'global', key: 'title_tag', value, type: 'single_line_text_field' },
      }),
    });
  }
}

// ─── HANDLER ──────────────────────────────────────────────────────────────────

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Content-Type', 'application/json');

  if (!SHOPIFY.domain || !SHOPIFY.token) {
    return res.status(500).json({ error: 'Missing SHOPIFY_STORE_DOMAIN or SHOPIFY_ADMIN_ACCESS_TOKEN' });
  }

  const preview     = req.query.preview === 'true';
  const brandFilter = req.query.brand ? String(req.query.brand) : undefined;

  console.log(`🔧 fixTireSize — preview=${preview} brand=${brandFilter ?? 'all'}`);

  // ── Step 1: Fetch products ────────────────────────────────────────────────
  let products: ShopifyProduct[];
  try {
    products = await fetchAllProducts(brandFilter);
  } catch (err) {
    return res.status(500).json({ error: `Failed to fetch products: ${String(err)}` });
  }

  console.log(`  Fetched ${products.length} products`);

  // ── Steps 2–5: Process each product ──────────────────────────────────────
  let fixed   = 0;
  let skipped = 0;
  const errors:  string[]                         = [];
  const previewItems: Array<{ before: string; after: string }> = [];

  for (const product of products) {
    // Step 2: Check for the malformed size pattern
    const result = extractAndFixSize(product.title);
    if (!result) {
      skipped++;
      continue;
    }

    // Step 3: Rebuild full title
    const newTitle = rebuildTitle(product.title, result.correctedSize);

    // Skip if nothing actually changed (product already in correct format)
    if (newTitle === product.title) {
      skipped++;
      continue;
    }

    // Step 4: Build SEO title
    const seoTitle = buildSeoTitle(newTitle);

    console.log(`  [${product.id}] "${product.title}"`);
    console.log(`         → "${newTitle}"`);
    console.log(`         SEO: "${seoTitle}"`);

    if (previewItems.length < 20) {
      previewItems.push({ before: product.title, after: newTitle });
    }

    if (preview) {
      fixed++;
      continue; // no writes in preview mode
    }

    // Step 5: Write changes to Shopify (title update + SEO metafield)
    try {
      // Update product title
      await shopifyFetch(`/products/${product.id}.json`, {
        method: 'PUT',
        body:   JSON.stringify({ product: { id: product.id, title: newTitle } }),
      });

      // Update SEO meta title metafield
      await upsertSeoTitleMetafield(product.id, seoTitle);

      fixed++;
    } catch (err) {
      const msg = `Product ${product.id} ("${product.title}"): ${String(err)}`;
      console.error(`  ❌ ${msg}`);
      errors.push(msg);
      continue;
    }

    // Respect Shopify rate limits between writes
    await delay(500);
  }

  // ── Step 6: Return report ─────────────────────────────────────────────────
  const report = {
    total:   products.length,
    fixed,
    skipped,
    errors,
    preview: previewItems,
  };

  console.log(`✅ Done — total:${report.total} fixed:${fixed} skipped:${skipped} errors:${errors.length}`);
  return res.status(200).json(report);
}
