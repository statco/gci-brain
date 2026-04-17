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

// ─── ANTHROPIC CONFIG ─────────────────────────────────────────────────────────

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || '';

// ─── SEASON / VEHICLE LABEL MAPS (French) ────────────────────────────────────
const SEASON_LABELS: Record<string, string> = {
  'winter':      'Winter',
  'all-season':  'All-Season',
  'all-weather': 'All-Weather',
  'all-terrain': 'All-Terrain',
  'summer':      'Summer',
};
const VEHICLE_LABELS: Record<string, string> = {
  'passenger':   'passenger car',
  'suv':         'SUV/crossover',
  'light-truck': 'light truck',
  'light_truck': 'light truck',
};
const SEASON_TAGS  = Object.keys(SEASON_LABELS);
const VEHICLE_TAGS = Object.keys(VEHICLE_LABELS);
// Products to skip — non-tire items and excluded keywords
const NON_TIRE_TITLES    = ['installation', 'service', 'balancing', 'mounting'];
const EXCLUDE_KEYWORDS   = ['bottle', 'vacuum', 'cleaner', 'massager', 'cervical', 'neck relaxer',
                            'shoulder relaxer', 'nuproz', 'nuprozone', 'appliance', 'wireless cleaning'];
const EXCLUDED_VENDORS   = new Set(['nuprozone']);
// Tire products must have at least one of these signals
const TIRE_SIGNALS_RE    = /R1[5-9]|R2[0-2]|\bLT\b|tire|tyre|\d{3}\/\d{2}R/i;

// ─── AI COPY GENERATION ───────────────────────────────────────────────────────

async function generateAiCopy(
  productTitle: string,
  season: string,
  vehicle: string,
): Promise<{ description: string; metaDescription: string } | null> {
  if (!ANTHROPIC_API_KEY) return null;

  const s = SEASON_LABELS[season]  || 'All-Season';
  const v = VEHICLE_LABELS[vehicle] || 'passenger car';

  const prompt = `You are an e-commerce copywriter specializing in tires for the Canadian market. Generate English content for this tire product.

Product: ${productTitle}
Type: ${s} tire for ${v}
Market: Canada (Quebec and all provinces)

Respond ONLY with a valid JSON object, no markdown, no extra text:
{
  "description": "<p>2-3 HTML sentences describing the tire compellingly. Mention season, vehicle type, and Canadian driving conditions. Natural tone, no hollow superlatives.</p>",
  "metaDescription": "SEO meta max 155 chars. Start: Shop the [title] at GCI Tires. [Vehicle cap] fitment. Free shipping across Canada."
}`;

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type':    'application/json',
        'x-api-key':       ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model:      'claude-haiku-4-5-20251001',
        max_tokens: 300,
        messages:   [{ role: 'user', content: prompt }],
      }),
    });

    if (!res.ok) {
      console.error(`  ⚠️  Anthropic ${res.status} for "${productTitle}"`);
      return null;
    }

    const data: any = await res.json();
    const raw = data?.content?.[0]?.text?.trim() || '';
    const clean = raw.replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim();
const parsed = JSON.parse(clean);

    if (!parsed.description || !parsed.metaDescription) return null;

    // Hard-cap metaDescription at 155 chars
    if (parsed.metaDescription.length > 155) {
      parsed.metaDescription = parsed.metaDescription.slice(0, 152) + '…';
    }

    return parsed;
  } catch (err) {
    console.error(`  ⚠️  generateAiCopy failed for "${productTitle}": ${String(err)}`);
    return null;
  }
}

// ─── STATIC FALLBACKS ─────────────────────────────────────────────────────────

function metaDescriptionFallback(productTitle: string, season: string, vehicle: string): string {
  // English GMC-compliant meta: max 155 chars
  const s = SEASON_LABELS[season]  || 'All-Season';
  const v = VEHICLE_LABELS[vehicle] || 'passenger car';
  const vCap = v.charAt(0).toUpperCase() + v.slice(1);
  return `Shop the ${productTitle} at GCI Tires. ${vCap} fitment. Free shipping across Canada.`.slice(0, 155);
}

function productDescriptionFallback(productTitle: string, season: string, vehicle: string): string {
  // Keep existing body_html unchanged — only SEO fields are updated by this script
  return '';
}

// ─── REMAINING STATIC HELPERS ─────────────────────────────────────────────────

// Extract load index and speed rating from tags
function extractLoadIndex(tags: string): { li: string; sr: string } {
  const tagArr = tags.split(',').map(t => t.trim());
  const li = tagArr.find(t => t.startsWith('loadindex:'))?.slice(10) || '';
  const sr = tagArr.find(t => t.startsWith('speedrating:'))?.slice(12) || '';
  return { li, sr };
}
function seoTitle(productTitle: string, tags: string = ''): string {
  // Template: [Title] – [LI][SR] | GCI Tires (max 60 chars)
  const { li, sr } = extractLoadIndex(tags);
  const suffix = (li && sr) ? ` – ${li}${sr}` : '';
  const base   = `${productTitle}${suffix} | GCI Tires`;
  if (base.length <= 60) return base;
  // Drop load/speed rating if too long
  const shorter = `${productTitle} | GCI Tires`;
  if (shorter.length <= 60) return shorter;
  // Truncate title
  const maxTitle = 60 - ' | GCI Tires'.length;
  return `${productTitle.slice(0, maxTitle)} | GCI Tires`;
}
function imageAlt(productTitle: string, season: string, vehicle: string): string {
  // English image alts for GMC compliance
  const s = season.replace('all-season', 'All-Season').replace('winter', 'Winter')
                   .replace('summer', 'Summer').replace('all-weather', 'All-Weather')
                   .replace('all-terrain', 'All-Terrain');
  const v = vehicle === 'passenger' ? 'passenger car'
          : vehicle === 'suv' ? 'SUV'
          : vehicle === 'light_truck' || vehicle === 'light-truck' ? 'light truck'
          : 'tire';
  return `${productTitle} ${s} ${v} tire`.trim();
}
// ─── TAG DETECTION ────────────────────────────────────────────────────────────
function detectFromTags(tags: string): { season: string; vehicle: string } {
  const tagList = tags.split(',').map(t => t.trim().toLowerCase());
  // Match bare tags (e.g. "all-season") OR prefixed (e.g. "season:all-season")
  let season = tagList.find(t => SEASON_TAGS.includes(t)) || '';
  if (!season) {
    const prefixed = tagList.find(t => t.startsWith('season:'));
    if (prefixed) season = prefixed.slice(7).trim();
  }
  // Match bare vehicle tags OR vehicle_type:X prefixed
  const VEHICLE_BARE = ['passenger', 'suv', 'light_truck', 'light-truck'];
  let vehicle = tagList.find(t => VEHICLE_BARE.includes(t)) || '';
  if (!vehicle) {
    const prefixed = tagList.find(t => t.startsWith('vehicle_type:'));
    if (prefixed) {
      const val = prefixed.slice(13).toLowerCase();
      vehicle = val === 'suv' ? 'suv' : val.includes('truck') ? 'light_truck' : 'passenger';
    }
  }
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
  id:  number;
  alt: string | null;
}
interface ShopifyProduct {
  id:        number;
  title:     string;
  tags:      string;
  images:    ShopifyImage[];
  body_html: string;
}
interface ShopifyMetafield {
  id:        number;
  namespace: string;
  key:       string;
  value:     string;
}
interface ChangeRecord {
  id:                 number;
  title:              string;
  seoTitle:           string;
  metaDescription:    string;
  imageAltsUpdated:   number;
  descriptionUpdated: boolean;
  aiGenerated:        boolean;
}
// ─── FETCH ALL PRODUCTS ───────────────────────────────────────────────────────
async function fetchAllProducts(): Promise<ShopifyProduct[]> {
  const all: ShopifyProduct[] = [];
  let url: string = `${SHOPIFY.baseUrl}/products.json?limit=250&fields=id,title,tags,images,body_html`;
  let page = 0;
  while (url) {
    page++;
    const response = await shopifyFetchRaw(url);
    const data: any = await response.json();
    const products: ShopifyProduct[] = data.products || [];
    all.push(...products);
    console.log(`  [updateSeo] page ${page}: fetched ${products.length} products (running total: ${all.length})`);
    const link = response.headers.get('Link') || '';
    const next  = link.match(/<([^>]+)>;\s*rel="next"/);
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
  existing:  ShopifyMetafield | undefined,
  key:       string,
  value:     string,
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
        metafield: { namespace: 'global', key, value, type: 'single_line_text_field' },
      }),
    });
  }
}
// ─── PROCESS A SINGLE PRODUCT ─────────────────────────────────────────────────
async function processProduct(
  product: ShopifyProduct,
  dryRun:  boolean,
): Promise<{ change: ChangeRecord; error: string | null }> {
  const { season, vehicle } = detectFromTags(product.tags);

  const newSeoTitle = seoTitle(product.title, product.tags);
  const newAlt      = imageAlt(product.title, season, vehicle);

  // ── AI copy (with static fallback) ────────────────────────────────────────
  const aiCopy      = await generateAiCopy(product.title, season, vehicle);
  const newMetaDesc = aiCopy?.metaDescription ?? metaDescriptionFallback(product.title, season, vehicle);
  const newBodyHtml = aiCopy?.description     ?? productDescriptionFallback(product.title, season, vehicle);
  const aiGenerated = aiCopy !== null;

  console.log(`  ${aiGenerated ? '🤖 AI copy' : '📄 fallback copy'} for "${product.title}"`);

  let imageAltsUpdated   = 0;
  let descriptionUpdated = false;

  if (!dryRun) {
    // ── Metafields ────────────────────────────────────────────────────────────
    let metafields: ShopifyMetafield[];
    try {
      metafields = await getProductMetafields(product.id);
    } catch (err) {
      return {
        change: { id: product.id, title: product.title, seoTitle: newSeoTitle, metaDescription: newMetaDesc, imageAltsUpdated: 0, descriptionUpdated: false, aiGenerated },
        error: `Product ${product.id}: failed to fetch metafields — ${String(err)}`,
      };
    }
    const existingTitle = metafields.find(m => m.key === 'title_tag');
    const existingDesc  = metafields.find(m => m.key === 'description_tag');
    try {
      await upsertMetafield(product.id, existingTitle, 'title_tag', newSeoTitle);
    } catch (err) {
      return {
        change: { id: product.id, title: product.title, seoTitle: newSeoTitle, metaDescription: newMetaDesc, imageAltsUpdated: 0, descriptionUpdated: false, aiGenerated },
        error: `Product ${product.id}: failed to upsert title_tag — ${String(err)}`,
      };
    }
    try {
      await upsertMetafield(product.id, existingDesc, 'description_tag', newMetaDesc);
    } catch (err) {
      return {
        change: { id: product.id, title: product.title, seoTitle: newSeoTitle, metaDescription: newMetaDesc, imageAltsUpdated: 0, descriptionUpdated: false, aiGenerated },
        error: `Product ${product.id}: failed to upsert description_tag — ${String(err)}`,
      };
    }
    // ── Product description (body_html) ───────────────────────────────────────
    try {
      await shopifyFetch(`/products/${product.id}.json`, {
        method: 'PUT',
        body: JSON.stringify({ product: { id: product.id, body_html: newBodyHtml } }),
      });
      descriptionUpdated = true;
    } catch (err) {
      return {
        change: { id: product.id, title: product.title, seoTitle: newSeoTitle, metaDescription: newMetaDesc, imageAltsUpdated: 0, descriptionUpdated: false, aiGenerated },
        error: `Product ${product.id}: failed to update body_html — ${String(err)}`,
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
        console.error(`  ⚠️  Product ${product.id} image ${image.id}: failed to set alt — ${String(err)}`);
      }
    }
  } else {
    imageAltsUpdated   = product.images.length;
    descriptionUpdated = true;
  }
  return {
    change: { id: product.id, title: product.title, seoTitle: newSeoTitle, metaDescription: newMetaDesc, imageAltsUpdated, descriptionUpdated, aiGenerated },
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
      const data: any = await shopifyFetch<any>(`/products/${productId}.json?fields=id,title,tags,images,body_html`);
      product = data.product as ShopifyProduct;
      if (!product) throw new Error('Product not found');
    } catch (err) {
      return res.status(404).json({ error: `Failed to fetch product ${productId}: ${String(err)}` });
    }
    const titleLower = product.title.toLowerCase();
    if (NON_TIRE_TITLES.some(kw => titleLower.includes(kw))) {
      return res.status(200).json({
        dryRun, total: 1, updated: 0, skipped: 1, errors: [], changes: [],
        offset: 0, chunkSize, nextOffset: null,
      });
    }
    const { change, error } = await processProduct(product, dryRun);
    return res.status(200).json({
      dryRun,
      total:      1,
      updated:    error ? 0 : 1,
      skipped:    0,
      errors:     error ? [error] : [],
      changes:    error ? [] : [change],
      offset:     0,
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

  const chunk      = allProducts.slice(offset, offset + chunkSize);
  const nextOffset = (offset + chunkSize) < allProducts.length ? offset + chunkSize : null;
  let updated = 0;
  let skipped = 0;
  const errors:  string[]       = [];
  const changes: ChangeRecord[] = [];
  for (const product of chunk) {
    const titleLower = product.title.toLowerCase();
    // Skip non-tire products: excluded keywords, vendors, or no tire signal
    const isExcludedKeyword = EXCLUDE_KEYWORDS.some(kw => titleLower.includes(kw));
    const isExcludedVendor  = EXCLUDED_VENDORS.has((product.vendor || '').toLowerCase());
    const hasTireSignal     = TIRE_SIGNALS_RE.test(product.title) ||
                              product.tags.toLowerCase().includes('ct-sync') ||
                              product.tags.toLowerCase().includes('ai-match');
    if (NON_TIRE_TITLES.some(kw => titleLower.includes(kw)) || isExcludedKeyword || isExcludedVendor || !hasTireSignal) {
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
