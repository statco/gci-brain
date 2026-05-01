#!/usr/bin/env npx tsx
/**
 * scripts/backfillImages.ts
 *
 * Finds all ct-sync Shopify products with no images and probes known
 * tire CDN URL patterns to find and attach matching images.
 *
 * Usage:
 *   npx tsx scripts/backfillImages.ts             # dry run (default)
 *   npx tsx scripts/backfillImages.ts --confirm   # attach images
 *
 * Env (read from .env in project root):
 *   VERCEL_URL    — base URL, e.g. https://gci-brain.vercel.app
 *   CRON_SECRET   — value sent as Bearer token
 */

import { resolve } from 'node:path';
import { writeFileSync } from 'node:fs';

try {
  process.loadEnvFile(resolve(process.cwd(), '.env'));
} catch {
  // env vars may already be set in the shell
}

const VERCEL_URL  = process.env.VERCEL_URL?.replace(/\/$/, '');
const CRON_SECRET = process.env.CRON_SECRET;

if (!VERCEL_URL)  { console.error('❌ VERCEL_URL is not set'); process.exit(1); }
if (!CRON_SECRET) { console.error('❌ CRON_SECRET is not set'); process.exit(1); }

const DRY_RUN        = !process.argv.includes('--confirm');
const BATCH_SIZE     = 10;
const BATCH_DELAY_MS = 500;

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }
function authHeaders() { return { 'Authorization': `Bearer ${CRON_SECRET}` } as Record<string, string>; }

// ── CDN URL generators ────────────────────────────────────────────────────────

function toSlug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function extractBrandModel(title: string): { brand: string; model: string } {
  const tokens = title.trim().split(/\s+/);
  const brand = tokens[0] || '';
  const sizeIdx = tokens.findIndex(t => /\d{3}\/\d{2}/.test(t));
  const modelTokens = sizeIdx > 1 ? tokens.slice(1, sizeIdx) : tokens.slice(1, 2);
  return { brand, model: modelTokens.join(' ') };
}

function cdnCandidates(title: string): string[] {
  const { brand, model } = extractBrandModel(title);
  const brandSlug  = toSlug(brand);
  const modelSlug  = toSlug(model);

  return [
    // SimpleTire
    `https://images.simpletire.com/image/upload/w_600/v1/lineitems/${brandSlug}-${modelSlug}.jpg`,
    // TireRack
    `https://www.tirerack.com/content/tirerack/desktop/en_US/tires/${encodeURIComponent(brand.toUpperCase())}/${encodeURIComponent(model.toUpperCase())}/hero.jpg`,
    // DiscountTire
    `https://images.discounttire.com/imgserver/tire_images/${encodeURIComponent(brandSlug)}/${encodeURIComponent(modelSlug)}.jpg`,
  ];
}

async function probeUrl(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(5000) });
    if (!res.ok) return false;
    const ct = res.headers.get('content-type') || '';
    return ct.startsWith('image/');
  } catch {
    return false;
  }
}

async function findImage(title: string): Promise<string | null> {
  for (const url of cdnCandidates(title)) {
    if (await probeUrl(url)) return url;
  }
  return null;
}

// ── API helpers ───────────────────────────────────────────────────────────────

async function fetchPage(sinceId: number): Promise<{ products: Array<{ id: number; title: string; vendor: string }>; nextSinceId: number | null }> {
  const url = `${VERCEL_URL}/api/shopifySync?action=list-no-image-products&sinceId=${sinceId}`;
  const res = await fetch(url, { headers: authHeaders() });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`list-no-image-products HTTP ${res.status}: ${body.slice(0, 200)}`);
  }
  const data: any = await res.json();
  return { products: data.products || [], nextSinceId: data.nextSinceId ?? null };
}

async function attachImage(productId: number, imageUrl: string, alt: string): Promise<void> {
  const url = `${VERCEL_URL}/api/shopifySync?action=attach-image-by-id`
    + `&productId=${productId}`
    + `&imageUrl=${encodeURIComponent(imageUrl)}`
    + `&alt=${encodeURIComponent(alt)}`;
  const res = await fetch(url, { method: 'POST', headers: authHeaders() });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`attach-image-by-id HTTP ${res.status}: ${body.slice(0, 200)}`);
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

interface Result {
  id: number;
  title: string;
  status: 'attached' | 'not_found' | 'error';
  imageUrl?: string;
  error?: string;
}

async function main() {
  console.log(`\n🖼️  backfillImages — mode: ${DRY_RUN ? 'DRY RUN (pass --confirm to attach)' : 'LIVE ATTACH'}`);
  console.log(`   Target: ${VERCEL_URL}\n`);

  // 1. Paginate all no-image products
  const noImageProducts: Array<{ id: number; title: string; vendor: string }> = [];
  let sinceId = 0;
  let page    = 0;

  while (true) {
    page++;
    const { products, nextSinceId } = await fetchPage(sinceId);
    noImageProducts.push(...products);
    console.log(`   📄 Page ${page}: ${products.length} no-image products (running total: ${noImageProducts.length})`);
    if (!nextSinceId) break;
    sinceId = nextSinceId;
    await sleep(300);
  }

  console.log(`\n   🔍 ${noImageProducts.length} products have no image — probing CDN patterns…\n`);

  // 2. Process in batches
  const results: Result[] = [];
  let found = 0, notFound = 0, attached = 0, errors = 0;

  for (let i = 0; i < noImageProducts.length; i += BATCH_SIZE) {
    const batch = noImageProducts.slice(i, i + BATCH_SIZE);
    console.log(`── Batch ${Math.floor(i / BATCH_SIZE) + 1} (${i + 1}–${Math.min(i + BATCH_SIZE, noImageProducts.length)} of ${noImageProducts.length}) ──`);

    await Promise.all(batch.map(async (product) => {
      try {
        const imageUrl = await findImage(product.title);

        if (!imageUrl) {
          notFound++;
          results.push({ id: product.id, title: product.title, status: 'not_found' });
          console.log(`   ❌ No URL found : ${product.title}`);
          return;
        }

        found++;
        console.log(`   ✅ Found : ${product.title}`);
        console.log(`         → ${imageUrl}`);

        if (!DRY_RUN) {
          await attachImage(product.id, imageUrl, product.title);
          attached++;
        }
        results.push({ id: product.id, title: product.title, status: 'attached', imageUrl });
      } catch (e: any) {
        errors++;
        results.push({ id: product.id, title: product.title, status: 'error', error: e.message });
        console.error(`   ⚠️  Error for "${product.title}": ${e.message}`);
      }
    }));

    if (i + BATCH_SIZE < noImageProducts.length) await sleep(BATCH_DELAY_MS);
  }

  // 3. Save results
  const resultsPath = resolve(process.cwd(), 'scripts/image-backfill-results.json');
  writeFileSync(resultsPath, JSON.stringify({
    timestamp: new Date().toISOString(),
    dryRun: DRY_RUN,
    summary: { total: noImageProducts.length, found, notFound, attached, errors },
    results,
  }, null, 2));

  // 4. Summary
  console.log(`\n${'─'.repeat(56)}`);
  console.log(`✅ Complete`);
  console.log(`   Total no-image : ${noImageProducts.length}`);
  console.log(`   URL found      : ${found}`);
  console.log(`   URL not found  : ${notFound}`);
  console.log(`   Attached       : ${DRY_RUN ? '0 (dry run)' : attached}`);
  console.log(`   Errors         : ${errors}`);
  console.log(`   Results saved  : scripts/image-backfill-results.json`);
  if (DRY_RUN && found > 0) {
    console.log(`\n   Re-run with --confirm to attach ${found} found image(s).`);
  }
}

main().catch(e => { console.error('❌ Fatal:', e); process.exit(1); });
