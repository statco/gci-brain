#!/usr/bin/env npx tsx
/**
 * scripts/backfillImages.ts
 *
 * Finds all ct-sync Shopify products with no images and attaches images
 * using a manually curated CSV lookup table (scripts/image-map.csv).
 *
 * Usage:
 *   npx tsx scripts/backfillImages.ts              # dry run (default)
 *   npx tsx scripts/backfillImages.ts --confirm    # attach images
 *   npx tsx scripts/backfillImages.ts --limit=10   # test: first N products
 *
 * Env (read from .env in project root):
 *   VERCEL_URL    — base URL, e.g. https://gci-brain.vercel.app
 *   CRON_SECRET   — value sent as Bearer token
 *
 * To add more image URLs, edit scripts/image-map.csv.
 * See scripts/README-images.md for instructions.
 */

import { resolve }                        from 'node:path';
import { readFileSync, writeFileSync }    from 'node:fs';

try {
  process.loadEnvFile(resolve(process.cwd(), '.env'));
} catch {
  // env vars may already be set in the shell
}

const VERCEL_URL  = process.env.VERCEL_URL?.replace(/\/$/, '');
const CRON_SECRET = process.env.CRON_SECRET;

if (!VERCEL_URL)  { console.error('❌ VERCEL_URL is not set');  process.exit(1); }
if (!CRON_SECRET) { console.error('❌ CRON_SECRET is not set'); process.exit(1); }

const DRY_RUN    = !process.argv.includes('--confirm');
const BATCH_SIZE = 10;
const BATCH_DELAY_MS = 1000;

function parseArg(name: string): number | null {
  const arg = process.argv.find(a => a.startsWith(`--${name}=`));
  return arg ? parseInt(arg.split('=')[1], 10) : null;
}

const LIMIT = parseArg('limit') ?? Infinity;

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }
function authHeaders(): Record<string, string> {
  return { 'Authorization': `Bearer ${CRON_SECRET}` };
}

// ── CSV image map ─────────────────────────────────────────────────────────────

interface ImageEntry {
  brand: string;
  model: string;
  imageUrl: string;
}

function loadImageMap(csvPath: string): ImageEntry[] {
  let raw: string;
  try {
    raw = readFileSync(csvPath, 'utf8');
  } catch {
    console.error(`❌ Cannot read ${csvPath} — run from project root`);
    process.exit(1);
  }

  const entries: ImageEntry[] = [];
  const lines = raw.split('\n').map(l => l.trim()).filter(Boolean);

  for (let i = 1; i < lines.length; i++) { // skip header row
    const firstComma  = lines[i].indexOf(',');
    const secondComma = lines[i].indexOf(',', firstComma + 1);
    if (firstComma === -1 || secondComma === -1) continue;

    const brand    = lines[i].slice(0, firstComma).trim();
    const model    = lines[i].slice(firstComma + 1, secondComma).trim();
    const imageUrl = lines[i].slice(secondComma + 1).trim();

    if (brand && model && imageUrl) {
      entries.push({ brand, model, imageUrl });
    }
  }

  return entries;
}

function findImageUrl(title: string, entries: ImageEntry[]): string | null {
  const t = title.toLowerCase();
  for (const entry of entries) {
    if (
      t.includes(entry.brand.toLowerCase()) &&
      t.includes(entry.model.toLowerCase())
    ) {
      return entry.imageUrl;
    }
  }
  return null;
}

// ── URL validation ────────────────────────────────────────────────────────────

async function probeUrl(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(8000) });
    if (!res.ok) return false;
    const ct = res.headers.get('content-type') || '';
    return ct.startsWith('image/');
  } catch {
    return false;
  }
}

// ── Shopify API helpers ───────────────────────────────────────────────────────

async function fetchPage(sinceId: number): Promise<{
  products: Array<{ id: number; title: string; vendor: string }>;
  nextSinceId: number | null;
}> {
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
  status: 'attached' | 'no_match' | 'invalid_url' | 'error';
  imageUrl?: string;
  error?: string;
}

async function main() {
  const csvPath = resolve(process.cwd(), 'scripts/image-map.csv');
  const imageMap = loadImageMap(csvPath);

  console.log(`\n🖼️  backfillImages — mode: ${DRY_RUN ? 'DRY RUN (pass --confirm to attach)' : 'LIVE ATTACH'}`);
  if (LIMIT !== Infinity) console.log(`   Limit: ${LIMIT} products`);
  console.log(`   Target: ${VERCEL_URL}`);
  console.log(`   Image map: ${imageMap.length} entries from ${csvPath}\n`);

  // 1. Paginate all no-image products
  const noImageProducts: Array<{ id: number; title: string; vendor: string }> = [];
  let sinceId = 0;
  let page    = 0;

  outer: while (true) {
    page++;
    const { products, nextSinceId } = await fetchPage(sinceId);
    for (const p of products) {
      noImageProducts.push(p);
      if (noImageProducts.length >= LIMIT) break outer;
    }
    console.log(`   📄 Page ${page}: ${products.length} no-image products (running total: ${noImageProducts.length})`);
    if (!nextSinceId) break;
    sinceId = nextSinceId;
    await sleep(300);
  }

  const subset = noImageProducts.slice(0, LIMIT === Infinity ? noImageProducts.length : LIMIT);
  console.log(`\n   🔍 ${subset.length} products to process (${imageMap.length} CSV entries loaded)\n`);

  // 2. Process in batches
  const results: Result[] = [];
  let matched = 0, noMatch = 0, invalidUrl = 0, attached = 0, errors = 0;

  for (let i = 0; i < subset.length; i += BATCH_SIZE) {
    const batch = subset.slice(i, i + BATCH_SIZE);
    console.log(`── Batch ${Math.floor(i / BATCH_SIZE) + 1} (${i + 1}–${Math.min(i + BATCH_SIZE, subset.length)} of ${subset.length}) ──`);

    await Promise.all(batch.map(async (product) => {
      try {
        const imageUrl = findImageUrl(product.title, imageMap);

        if (!imageUrl) {
          noMatch++;
          results.push({ id: product.id, title: product.title, status: 'no_match' });
          console.log(`   ⬜ No CSV match : ${product.title}`);
          return;
        }

        const valid = await probeUrl(imageUrl);
        if (!valid) {
          invalidUrl++;
          results.push({ id: product.id, title: product.title, status: 'invalid_url', imageUrl });
          console.log(`   ⚠️  URL failed HEAD check : ${product.title}`);
          console.log(`         → ${imageUrl}`);
          return;
        }

        matched++;
        console.log(`   ✅ Matched : ${product.title}`);
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

    if (i + BATCH_SIZE < subset.length) {
      await sleep(BATCH_DELAY_MS);
    }
  }

  // 3. Save results
  const resultsPath = resolve(process.cwd(), 'scripts/image-backfill-results.json');
  writeFileSync(resultsPath, JSON.stringify({
    timestamp:  new Date().toISOString(),
    dryRun:     DRY_RUN,
    csvEntries: imageMap.length,
    summary:    { total: subset.length, matched, noMatch, invalidUrl, attached, errors },
    results,
  }, null, 2));

  // 4. Summary
  const noMatchTitles = results
    .filter(r => r.status === 'no_match')
    .map(r => r.title)
    .slice(0, 20);

  console.log(`\n${'─'.repeat(56)}`);
  console.log(`✅ Complete`);
  console.log(`   Total no-image : ${subset.length}`);
  console.log(`   CSV matched    : ${matched}`);
  console.log(`   No CSV match   : ${noMatch}`);
  console.log(`   Invalid URL    : ${invalidUrl}`);
  console.log(`   Attached       : ${DRY_RUN ? '0 (dry run)' : attached}`);
  console.log(`   Errors         : ${errors}`);
  console.log(`   Results saved  : scripts/image-backfill-results.json`);

  if (noMatch > 0) {
    console.log(`\n   Unmatched sample (add to image-map.csv to fill these):`);
    for (const t of noMatchTitles) console.log(`     • ${t}`);
    if (noMatch > 20) console.log(`     … and ${noMatch - 20} more (see results JSON)`);
  }

  if (DRY_RUN && matched > 0) {
    console.log(`\n   Re-run with --confirm to attach ${matched} matched image(s).`);
  }
}

main().catch(e => { console.error('❌ Fatal:', e); process.exit(1); });
