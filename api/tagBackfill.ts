// api/tagBackfill.ts
// ─────────────────────────────────────────────────────────────────────────────
// Audits all ct-sync products for missing season / vehicle-type tags and
// patches only what can be inferred with high confidence from the product title.
// Ambiguous products are reported but NOT modified.
//
// GET /api/tagBackfill                        → audit + fix (default chunkSize=20, offset=0)
// GET /api/tagBackfill?dryRun=true            → audit only, no writes
// GET /api/tagBackfill?chunkSize=20&offset=40 → pagination
// GET /api/tagBackfill?offset=0&chunkSize=250 → run all at once (careful: rate limits)
// ─────────────────────────────────────────────────────────────────────────────

// ─── CONFIG ──────────────────────────────────────────────────────────────────

const SHOPIFY = {
  domain:     process.env.SHOPIFY_STORE_DOMAIN       || '',
  token:      process.env.SHOPIFY_ADMIN_ACCESS_TOKEN || '',
  apiVersion: '2024-01',
  get baseUrl() { return `https://${this.domain}/admin/api/${this.apiVersion}`; },
};

const SYNC_TAG   = 'ct-sync';
const BATCH_SIZE = 5;       // concurrent Shopify PATCH calls
const BATCH_MS   = 350;     // ms between batches

// ─── SEASON INFERENCE ────────────────────────────────────────────────────────
// HIGH CONFIDENCE winter keywords found in product titles / model names.
// If none match → infer all-season (also high confidence for a tire store
// that stocks only Winter and All-Season).
// Anything that matches AMBIGUOUS_KEYWORDS gets reported but not modified.

const WINTER_KEYWORDS = [
  'WINTER', 'WINTRAC', 'BLIZZAK', 'ICE', 'SNOW', 'NORDMAN',
  'HAKKA', 'ARCTEC', 'STUDDED', 'X-ICE', 'XICE', 'ICEGUARD',
  'ICECONTACT', 'WINTERSPORT', 'WINTERCONTACT', 'SNOWFLAKE',
  'SNOWPROX', 'SNOW CLAW', 'SNOWCLAW', 'EURO-WIN', 'EUROWIN',
  'SNOWTREK', 'NORDICTRACK',
];

// Titles with these keywords can't be reliably season-classified — skip them
const AMBIGUOUS_SEASON_KEYWORDS = [
  'ALL WEATHER', 'ALL-WEATHER', 'ALLWEATHER',
  '3PMSF',  // could be all-weather or winter
];

// ─── VEHICLE TYPE INFERENCE ───────────────────────────────────────────────────
// Infer from title keywords and size string embedded in title.
// Returns: 'light_truck' | 'passenger' | null (null = ambiguous, skip)

const LIGHT_TRUCK_TITLE_KEYWORDS = [
  'LT', 'TRUCK', 'SUV', 'LIGHT TRUCK', 'JEEP', '4X4', '4WD',
  'ALL-TERRAIN', 'ALL TERRAIN', 'MUD', 'TERRAIN', 'OPEN COUNTRY',
  'RIDGE GRAPPLER', 'WRANGLER', 'DUELER', 'GRABBER', 'DISCOVERER',
  'TRAIL', 'RUGGED', 'RANGER',
];

// Extract the first size-like token from the title (e.g. "2154517" or "LT265/70R17")
function extractSizeFromTitle(title: string): string {
  // Match LT265/70R17 or P215/55R16 style
  const explicit = title.match(/\b(LT|P)?\d{3}\/\d{2,3}R\d{2}\b/i);
  if (explicit) return explicit[0].toUpperCase();

  // Match compact numeric: 2154517 → 215/45R17
  const compact = title.match(/\b(\d{3})(\d{2})(\d{2})\b/);
  if (compact) return `${compact[1]}/${compact[2]}R${compact[3]}`;

  return '';
}

function inferVehicleType(title: string): 'light_truck' | 'passenger' | null {
  const t = title.toUpperCase();
  const size = extractSizeFromTitle(t);

  // LT prefix on size = definitive light truck
  if (size.startsWith('LT')) return 'light_truck';

  // Title keyword match (check word boundaries to avoid "SUV" inside other words)
  for (const kw of LIGHT_TRUCK_TITLE_KEYWORDS) {
    // Use word-boundary-like match
    const pattern = new RegExp(`(^|\\s|-)${kw}(\\s|-|$)`, 'i');
    if (pattern.test(t)) return 'light_truck';
  }

  // Large rim sizes (18"+ with wide section) often = SUV/truck
  const rimMatch = size.match(/R(\d{2})$/);
  const sectionMatch = size.match(/^(\d{3})/);
  if (rimMatch && sectionMatch) {
    const rim = parseInt(rimMatch[1], 10);
    const section = parseInt(sectionMatch[1], 10);
    if (rim >= 18 && section >= 265) return 'light_truck';
  }

  // Default: passenger
  return 'passenger';
}

function inferSeason(title: string): 'winter' | 'all-season' | null {
  const t = title.toUpperCase();

  // Ambiguous check first — return null so we skip these
  for (const kw of AMBIGUOUS_SEASON_KEYWORDS) {
    if (t.includes(kw)) return null;
  }

  for (const kw of WINTER_KEYWORDS) {
    if (t.includes(kw)) return 'winter';
  }

  return 'all-season'; // high confidence default for this store's catalog
}

// ─── TAG HELPERS ─────────────────────────────────────────────────────────────

function hasSeasonTag(tags: string[]): boolean {
  return tags.some(t => t === 'winter' || t === 'all-season' || t === 'summer');
}

function hasVehicleTypeTag(tags: string[]): boolean {
  return tags.some(t => t.startsWith('tire-type-'));
}

function vehicleTypeTag(vt: 'light_truck' | 'passenger'): string {
  return vt === 'light_truck' ? 'tire-type-light_truck' : 'tire-type-passenger';
}

// ─── SHOPIFY HELPERS ──────────────────────────────────────────────────────────

async function shopifyFetch<T>(
  endpoint: string,
  options: { method?: string; body?: unknown } = {}
): Promise<T> {
  const url = `${SHOPIFY.baseUrl}${endpoint}`;
  const res = await fetch(url, {
    method: options.method || 'GET',
    headers: {
      'X-Shopify-Access-Token': SHOPIFY.token,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    ...(options.body ? { body: JSON.stringify(options.body) } : {}),
  });

  if (res.status === 429) {
    const wait = parseFloat(res.headers.get('Retry-After') || '2') * 1000;
    console.log(`⏳ Rate limited — waiting ${wait}ms`);
    await sleep(wait);
    return shopifyFetch<T>(endpoint, options);
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Shopify ${res.status}: ${text.slice(0, 200)}`);
  }

  return res.json() as Promise<T>;
}

function sleep(ms: number) {
  return new Promise(r => setTimeout(r, ms));
}

async function processBatches<T>(
  items: T[],
  fn: (item: T) => Promise<void>
): Promise<void> {
  for (let i = 0; i < items.length; i += BATCH_SIZE) {
    await Promise.all(items.slice(i, i + BATCH_SIZE).map(fn));
    if (i + BATCH_SIZE < items.length) await sleep(BATCH_MS);
  }
}

// ─── FETCH ALL ct-sync PRODUCTS ───────────────────────────────────────────────

interface ShopifyProduct {
  id: number;
  title: string;
  tags: string;
}

async function fetchAllSyncedProducts(): Promise<ShopifyProduct[]> {
  const all: ShopifyProduct[] = [];
  let sinceId = 0;

  while (true) {
    const q = `tag=${SYNC_TAG}&limit=250&fields=id,title,tags${sinceId ? `&since_id=${sinceId}` : ''}`;
    const data = await shopifyFetch<{ products: ShopifyProduct[] }>(`/products.json?${q}`);
    const products = data.products || [];
    all.push(...products);
    if (products.length < 250) break;
    sinceId = products[products.length - 1].id;
  }

  return all;
}

// ─── MAIN HANDLER ─────────────────────────────────────────────────────────────

export default async function handler(req: any, res: any) {
  const dryRun     = req.query.dryRun === 'true';
  const chunkSize  = parseInt((req.query.chunkSize as string) || '20', 10);
  const offset     = parseInt((req.query.offset     as string) || '0',  10);

  console.log(`🏷️  tagBackfill — dryRun=${dryRun}, chunkSize=${chunkSize}, offset=${offset}`);

  // ── 1. Fetch all synced products ──────────────────────────────────────────
  const allProducts = await fetchAllSyncedProducts();
  const chunk       = allProducts.slice(offset, offset + chunkSize);
  const nextOffset  = offset + chunkSize;
  const done        = nextOffset >= allProducts.length;

  // ── 2. Classify each product ──────────────────────────────────────────────
  interface ProductResult {
    id: number;
    title: string;
    tagsAdded: string[];
    reason: string;
  }

  const fixed:     ProductResult[] = [];
  const skipped:   ProductResult[] = [];  // already has both tags
  const ambiguous: ProductResult[] = [];  // season unclear — not modified
  const errors:    { id: number; title: string; error: string }[] = [];

  await processBatches(chunk, async (p) => {
    const existingTags = p.tags.split(',').map((t: string) => t.trim()).filter(Boolean);
    const needsSeason  = !hasSeasonTag(existingTags);
    const needsVType   = !hasVehicleTypeTag(existingTags);

    if (!needsSeason && !needsVType) {
      skipped.push({ id: p.id, title: p.title, tagsAdded: [], reason: 'already complete' });
      return;
    }

    const tagsToAdd: string[] = [];
    const reasons:   string[] = [];
    let isAmbiguous = false;

    // Season
    if (needsSeason) {
      const season = inferSeason(p.title);
      if (season === null) {
        isAmbiguous = true;
        reasons.push('season unclear (all-weather keyword)');
      } else {
        tagsToAdd.push(season);
        reasons.push(`season inferred: ${season}`);
      }
    }

    // Vehicle type
    if (needsVType) {
      const vt = inferVehicleType(p.title);
      if (vt === null) {
        isAmbiguous = true;
        reasons.push('vehicle type unclear');
      } else {
        tagsToAdd.push(vehicleTypeTag(vt));
        reasons.push(`vehicle type inferred: ${vt}`);
      }
    }

    if (isAmbiguous) {
      ambiguous.push({ id: p.id, title: p.title, tagsAdded: [], reason: reasons.join(' | ') });
      return;
    }

    if (tagsToAdd.length === 0) {
      skipped.push({ id: p.id, title: p.title, tagsAdded: [], reason: 'nothing to add' });
      return;
    }

    // ── 3. PATCH Shopify product tags ────────────────────────────────────────
    if (!dryRun) {
      try {
        const newTagString = [...existingTags, ...tagsToAdd].join(', ');
        await shopifyFetch(`/products/${p.id}.json`, {
          method: 'PUT',
          body: { product: { id: p.id, tags: newTagString } },
        });
        fixed.push({ id: p.id, title: p.title, tagsAdded: tagsToAdd, reason: reasons.join(' | ') });
        console.log(`✅ ${p.title} → +[${tagsToAdd.join(', ')}]`);
      } catch (e: any) {
        errors.push({ id: p.id, title: p.title, error: e.message });
        console.warn(`⚠️  Failed ${p.title}: ${e.message}`);
      }
    } else {
      // Dry run — record what would happen
      fixed.push({ id: p.id, title: p.title, tagsAdded: tagsToAdd, reason: `[DRY RUN] ${reasons.join(' | ')}` });
    }
  });

  // ── 4. Response ────────────────────────────────────────────────────────────
  return res.status(200).json({
    success:     true,
    dryRun,
    totalProducts: allProducts.length,
    chunk:       { offset, size: chunk.length, nextOffset: done ? null : nextOffset, done },
    summary: {
      fixed:     fixed.length,
      skipped:   skipped.length,
      ambiguous: ambiguous.length,
      errors:    errors.length,
    },
    fixed,
    ambiguous,   // season or vehicle type could not be inferred — review manually
    errors,
    // skipped omitted from response (noise) — add ?verbose=true to include
    ...(req.query.verbose === 'true' ? { skipped } : {}),
  });
}
