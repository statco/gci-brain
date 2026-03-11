// api/tagBackfill.js
// ─────────────────────────────────────────────────────────────────────────────
// Audits all ct-sync products for missing season / vehicle-type tags and
// patches only what can be inferred with high confidence from the product title.
// Ambiguous products are reported but NOT modified.
//
// GET /api/tagBackfill                        → audit + fix (default chunkSize=20, offset=0)
// GET /api/tagBackfill?dryRun=true            → audit only, no writes
// GET /api/tagBackfill?chunkSize=20&offset=40 → pagination
// ─────────────────────────────────────────────────────────────────────────────

const SHOPIFY_DOMAIN  = process.env.SHOPIFY_STORE_DOMAIN       || '';
const SHOPIFY_TOKEN   = process.env.SHOPIFY_ADMIN_ACCESS_TOKEN || '';
const SHOPIFY_VERSION = '2024-01';
const SHOPIFY_BASE    = `https://${SHOPIFY_DOMAIN}/admin/api/${SHOPIFY_VERSION}`;

const SYNC_TAG   = 'ct-sync';
const BATCH_SIZE = 5;
const BATCH_MS   = 350;

// ─── SEASON INFERENCE ────────────────────────────────────────────────────────

const WINTER_KEYWORDS = [
  'WINTER','WINTRAC','BLIZZAK','ICE','SNOW','NORDMAN',
  'HAKKA','ARCTEC','STUDDED','X-ICE','XICE','ICEGUARD',
  'ICECONTACT','WINTERSPORT','WINTERCONTACT','SNOWFLAKE',
  'SNOWPROX','SNOW CLAW','SNOWCLAW','EURO-WIN','EUROWIN',
  'SNOWTREK','NORDICTRACK',
];

const ALL_WEATHER_KEYWORDS = [
  'ALL WEATHER','ALL-WEATHER','ALLWEATHER',
];

// 3PMSF alone is still ambiguous — keep skipping
const AMBIGUOUS_SEASON_KEYWORDS = ['3PMSF'];

function inferSeason(title) {
  const t = title.toUpperCase();

  // All-weather is its own season — resolve before checking winter keywords
  for (const kw of ALL_WEATHER_KEYWORDS) {
    if (t.includes(kw)) return 'all-weather';
  }

  for (const kw of AMBIGUOUS_SEASON_KEYWORDS) {
    if (t.includes(kw)) return null;
  }

  for (const kw of WINTER_KEYWORDS) {
    if (t.includes(kw)) return 'winter';
  }

  return 'all-season';
}

// ─── VEHICLE TYPE INFERENCE ───────────────────────────────────────────────────

const LIGHT_TRUCK_KEYWORDS = [
  'TRUCK','SUV','LIGHT TRUCK','JEEP','4X4','4WD',
  'ALL-TERRAIN','ALL TERRAIN','MUD','TERRAIN','OPEN COUNTRY',
  'RIDGE GRAPPLER','WRANGLER','DUELER','GRABBER','DISCOVERER',
  'TRAIL','RUGGED','RANGER',
];

function extractSize(title) {
  const explicit = title.match(/\b(LT|P)?(\d{3}\/\d{2,3}R\d{2})\b/i);
  if (explicit) return explicit[0].toUpperCase();
  const compact = title.match(/\b(\d{3})(\d{2})(\d{2})\b/);
  if (compact) return `${compact[1]}/${compact[2]}R${compact[3]}`;
  return '';
}

function inferVehicleType(title) {
  const t    = title.toUpperCase();
  const size = extractSize(t);

  if (size.startsWith('LT')) return 'light_truck';

  for (const kw of LIGHT_TRUCK_KEYWORDS) {
    const pattern = new RegExp(`(^|\\s|-)${kw}(\\s|-|$)`, 'i');
    if (pattern.test(t)) return 'light_truck';
  }

  // Wide section + large rim heuristic
  const rimMatch     = size.match(/R(\d{2})$/);
  const sectionMatch = size.match(/^(\d{3})/);
  if (rimMatch && sectionMatch) {
    if (parseInt(rimMatch[1]) >= 18 && parseInt(sectionMatch[1]) >= 265) {
      return 'light_truck';
    }
  }

  return 'passenger';
}

// ─── TAG HELPERS ─────────────────────────────────────────────────────────────

function hasSeasonTag(tags)     { return tags.some(t => t === 'winter' || t === 'all-season' || t === 'all-weather' || t === 'summer'); }
function hasVehicleTypeTag(tags){ return tags.some(t => t.startsWith('tire-type-')); }
function vehicleTypeTag(vt)     { return vt === 'light_truck' ? 'tire-type-light_truck' : 'tire-type-passenger'; }

// ─── SHOPIFY HELPERS ──────────────────────────────────────────────────────────

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function shopifyFetch(endpoint, options = {}) {
  const url = `${SHOPIFY_BASE}${endpoint}`;
  const res = await fetch(url, {
    method: options.method || 'GET',
    headers: {
      'X-Shopify-Access-Token': SHOPIFY_TOKEN,
      'Content-Type': 'application/json',
      'Accept':       'application/json',
    },
    ...(options.body ? { body: JSON.stringify(options.body) } : {}),
  });

  if (res.status === 429) {
    const wait = parseFloat(res.headers.get('Retry-After') || '2') * 1000;
    console.log(`⏳ Rate limited — waiting ${wait}ms`);
    await sleep(wait);
    return shopifyFetch(endpoint, options);
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Shopify ${res.status}: ${text.slice(0, 200)}`);
  }

  return res.json();
}

async function processBatches(items, fn) {
  for (let i = 0; i < items.length; i += BATCH_SIZE) {
    await Promise.all(items.slice(i, i + BATCH_SIZE).map(fn));
    if (i + BATCH_SIZE < items.length) await sleep(BATCH_MS);
  }
}

async function fetchAllSyncedProducts() {
  const all = [];
  let sinceId = 0;
  while (true) {
    const q    = `tag=${SYNC_TAG}&limit=250&fields=id,title,tags${sinceId ? `&since_id=${sinceId}` : ''}`;
    const data = await shopifyFetch(`/products.json?${q}`);
    const products = data.products || [];
    all.push(...products);
    if (products.length < 250) break;
    sinceId = products[products.length - 1].id;
  }
  return all;
}

// ─── MAIN HANDLER ─────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  const dryRun    = req.query.dryRun === 'true';
  const chunkSize = parseInt(req.query.chunkSize || '20', 10);
  const offset    = parseInt(req.query.offset    || '0',  10);

  console.log(`🏷️  tagBackfill — dryRun=${dryRun}, chunkSize=${chunkSize}, offset=${offset}`);

  if (!SHOPIFY_DOMAIN || !SHOPIFY_TOKEN) {
    return res.status(500).json({ error: 'Missing SHOPIFY_STORE_DOMAIN or SHOPIFY_ADMIN_ACCESS_TOKEN' });
  }

  const allProducts = await fetchAllSyncedProducts();
  const chunk       = allProducts.slice(offset, offset + chunkSize);
  const nextOffset  = offset + chunkSize;
  const done        = nextOffset >= allProducts.length;

  const fixed     = [];
  const skipped   = [];
  const ambiguous = [];
  const errors    = [];

  await processBatches(chunk, async (p) => {
    const existingTags = p.tags.split(',').map(t => t.trim()).filter(Boolean);
    const needsSeason  = !hasSeasonTag(existingTags);
    const needsVType   = !hasVehicleTypeTag(existingTags);

    if (!needsSeason && !needsVType) {
      skipped.push({ id: p.id, title: p.title, reason: 'already complete' });
      return;
    }

    const tagsToAdd = [];
    const reasons   = [];
    let isAmbiguous = false;

    if (needsSeason) {
      const season = inferSeason(p.title);
      if (season === null) {
        isAmbiguous = true;
        reasons.push('season unclear (all-weather keyword)');
      } else {
        tagsToAdd.push(season);
        reasons.push(`season → ${season}`);
      }
    }

    if (needsVType) {
      const vt = inferVehicleType(p.title);
      tagsToAdd.push(vehicleTypeTag(vt));
      reasons.push(`vehicle type → ${vt}`);
    }

    if (isAmbiguous) {
      ambiguous.push({ id: p.id, title: p.title, reason: reasons.join(' | ') });
      return;
    }

    if (!dryRun) {
      try {
        const newTagString = [...existingTags, ...tagsToAdd].join(', ');
        await shopifyFetch(`/products/${p.id}.json`, {
          method: 'PUT',
          body: { product: { id: p.id, tags: newTagString } },
        });
        fixed.push({ id: p.id, title: p.title, tagsAdded: tagsToAdd, reason: reasons.join(' | ') });
        console.log(`✅ ${p.title} → +[${tagsToAdd.join(', ')}]`);
      } catch (e) {
        errors.push({ id: p.id, title: p.title, error: e.message });
        console.warn(`⚠️  Failed ${p.title}: ${e.message}`);
      }
    } else {
      fixed.push({ id: p.id, title: p.title, tagsAdded: tagsToAdd, reason: `[DRY RUN] ${reasons.join(' | ')}` });
    }
  });

  return res.status(200).json({
    success: true,
    dryRun,
    totalProducts: allProducts.length,
    chunk: { offset, size: chunk.length, nextOffset: done ? null : nextOffset, done },
    summary: {
      fixed:     fixed.length,
      skipped:   skipped.length,
      ambiguous: ambiguous.length,
      errors:    errors.length,
    },
    fixed,
    ambiguous,
    errors,
    ...(req.query.verbose === 'true' ? { skipped } : {}),
  });
}
