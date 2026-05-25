// api/tagBackfillCtSync.ts
// ============================================================
// Tag Backfill — ct-sync
// Finds active Tire products missing the 'ct-sync' tag and optionally adds it.
//
// GET /api/tagBackfillCtSync?action=scan                       — audit all active tires
// GET /api/tagBackfillCtSync?action=scan&vendor=Michelin       — scope by brand
// GET /api/tagBackfillCtSync?action=fix                        — dry run (dry=true default)
// GET /api/tagBackfillCtSync?action=fix&dry=false              — live write
// GET /api/tagBackfillCtSync?action=fix&offset=0&chunkSize=50  — chunked execution
// GET /api/tagBackfillCtSync?action=fix&vendor=Michelin        — scope by brand
// ============================================================

import type { VercelRequest, VercelResponse } from '@vercel/node';

export const config = { maxDuration: 300 };

// ─── CONFIG ───────────────────────────────────────────────────────────────────

const SHOPIFY = {
  domain:     process.env.SHOPIFY_STORE_DOMAIN       || '',
  token:      process.env.SHOPIFY_ADMIN_ACCESS_TOKEN || '',
  apiVersion: '2024-01',
  get baseUrl() { return `https://${this.domain}/admin/api/${this.apiVersion}`; },
};

const SYNC_TAG = 'ct-sync';

// ─── HELPERS ──────────────────────────────────────────────────────────────────

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

async function shopifyFetchRaw(url: string, options: RequestInit = {}): Promise<Response> {
  const res = await fetch(url, {
    ...options,
    headers: {
      'Content-Type':            'application/json',
      'X-Shopify-Access-Token':  SHOPIFY.token,
      ...(options.headers || {}),
    },
  });
  if (res.status === 429) { await sleep(2000); return shopifyFetchRaw(url, options); }
  if (!res.ok) throw new Error(`Shopify ${res.status} on ${url}: ${(await res.text()).slice(0, 1000)}`);
  return res;
}

// ─── TYPES ────────────────────────────────────────────────────────────────────

interface ShopifyProduct {
  id:     number;
  title:  string;
  vendor: string;
  tags:   string;
}

// ─── FETCH ────────────────────────────────────────────────────────────────────

async function fetchAllTireProducts(vendorFilter?: string): Promise<ShopifyProduct[]> {
  const all: ShopifyProduct[] = [];
  const vendorParam = vendorFilter ? `&vendor=${encodeURIComponent(vendorFilter)}` : '';
  let url: string | null = `${SHOPIFY.baseUrl}/products.json?status=active&product_type=Tire&limit=250${vendorParam}&fields=id,title,vendor,tags`;
  let page = 0;

  while (url) {
    page++;
    const response = await shopifyFetchRaw(url);
    const data: any = await response.json();
    const products: ShopifyProduct[] = data.products || [];
    all.push(...products);
    console.log(`  [tagBackfillCtSync] page ${page}: fetched ${products.length} (running total: ${all.length})`);
    const link = response.headers.get('Link') || '';
    const next = link.match(/<([^>]+)>;\s*rel="next"/);
    url = next ? next[1] : null;
  }

  console.log(`  [tagBackfillCtSync] done — ${page} page(s), ${all.length} total products`);
  return all;
}

function hasSyncTag(tags: string): boolean {
  return tags.split(',').map(t => t.trim().toLowerCase()).includes(SYNC_TAG);
}

// ─── HANDLER ──────────────────────────────────────────────────────────────────

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Content-Type', 'application/json');

  if (!SHOPIFY.domain || !SHOPIFY.token) {
    return res.status(500).json({ error: 'Missing SHOPIFY_STORE_DOMAIN or SHOPIFY_ADMIN_ACCESS_TOKEN' });
  }

  const action       = (req.query.action    as string) || 'scan';
  const dryRun       = req.query.dry !== 'false';
  const vendorFilter = ((req.query.vendor   as string) || '').trim();
  const chunkSize    = Math.max(1, parseInt((req.query.chunkSize as string) || '50', 10));
  const offset       = Math.max(0, parseInt((req.query.offset    as string) || '0',  10));

  console.log(`🏷️  tagBackfillCtSync — action="${action}" dry=${dryRun} vendor="${vendorFilter}" offset=${offset} chunkSize=${chunkSize}`);

  let allProducts: ShopifyProduct[];
  try {
    allProducts = await fetchAllTireProducts(vendorFilter || undefined);
  } catch (err) {
    return res.status(500).json({ error: `Failed to fetch products: ${String(err)}` });
  }

  const missing = allProducts.filter(p => !hasSyncTag(p.tags));

  // ── action=scan ───────────────────────────────────────────────────────────
  if (action === 'scan') {
    const vendorBreakdown: Record<string, number> = {};
    for (const p of missing) {
      const v = p.vendor || 'Unknown';
      vendorBreakdown[v] = (vendorBreakdown[v] || 0) + 1;
    }

    console.log(`✅ scan — total:${allProducts.length} missing:${missing.length} vendors:${Object.keys(vendorBreakdown).length}`);

    return res.status(200).json({
      total:           allProducts.length,
      missing:         missing.length,
      vendorFilter:    vendorFilter || null,
      vendorBreakdown,
      groups:          missing.map(p => ({ id: p.id, title: p.title, vendor: p.vendor, tags: p.tags })),
    });
  }

  // ── action=fix ────────────────────────────────────────────────────────────
  if (action === 'fix') {
    const chunk      = missing.slice(offset, offset + chunkSize);
    const nextOffset = (offset + chunkSize) < missing.length ? offset + chunkSize : null;

    let fixed   = 0;
    let skipped = 0;
    const errors:  string[] = [];
    const changes: Array<{ productId: number; title: string; vendor: string; newTags: string }> = [];
    const log:     string[] = [];

    log.push(`▶ Fix${dryRun ? ' [DRY RUN]' : ''} — ${chunk.length} products (offset ${offset} / total missing: ${missing.length})`);
    log.push('──────────────────────────────────────────────────');

    for (const p of chunk) {
      const tagArr = (p.tags || '').split(',').map(t => t.trim()).filter(Boolean);
      const hasTag = tagArr.map(t => t.toLowerCase()).includes(SYNC_TAG);

      if (hasTag) {
        log.push(`⏭ [skipped] ${p.title} — already tagged`);
        skipped++;
        continue;
      }

      const newTags = [...tagArr, SYNC_TAG].join(', ');
      log.push(`🏷️  [${dryRun ? 'dry' : 'fix'}] ${p.title}${p.vendor ? ` (${p.vendor})` : ''}`);
      changes.push({ productId: p.id, title: p.title, vendor: p.vendor, newTags });

      if (!dryRun) {
        try {
          await shopifyFetchRaw(`${SHOPIFY.baseUrl}/products/${p.id}.json`, {
            method: 'PUT',
            body:   JSON.stringify({ product: { id: p.id, tags: newTags } }),
          });
          fixed++;
        } catch (err) {
          const msg = `Product ${p.id} ("${p.title}"): ${String(err)}`;
          console.error(`  ❌ ${msg}`);
          errors.push(msg);
          log.push(`❌ ${p.title}: ${String(err).slice(0, 120)}`);
          continue;
        }
        await sleep(400);
      } else {
        fixed++;
      }
    }

    log.push('──────────────────────────────────────────────────');
    log.push(`📊 ${dryRun ? 'DRY RUN' : 'DONE'} — fixed: ${fixed}, skipped: ${skipped}, errors: ${errors.length}${nextOffset !== null ? ` | next offset: ${nextOffset}` : ' | ✅ all done'}`);

    const httpStatus = !dryRun && errors.length > 0 ? 207 : 200;
    return res.status(httpStatus).json({
      dryRun,
      totalMissing: missing.length,
      fixed,
      skipped,
      errors,
      changes,
      offset,
      chunkSize,
      nextOffset,
      log,
      summary: { scanned: chunk.length, fixed, skipped, errors: errors.length },
    });
  }

  return res.status(400).json({
    error:     'Unknown action',
    available: ['scan', 'fix'],
  });
}
