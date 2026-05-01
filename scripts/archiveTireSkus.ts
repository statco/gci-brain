#!/usr/bin/env npx tsx
/**
 * scripts/archiveTireSkus.ts
 *
 * Finds all active Shopify products whose first variant SKU starts with "TIRE-"
 * and optionally archives them, one at a time, with a delay between each call.
 *
 * Searches two product sets:
 *   1. ct-sync tagged products  (via list-products action)
 *   2. All active products      (via list-all-products action, no tag filter)
 * Results are merged and deduplicated by product ID.
 *
 * Usage:
 *   npx tsx scripts/archiveTireSkus.ts             ← dry run (default)
 *   npx tsx scripts/archiveTireSkus.ts --dryRun    ← explicit dry run
 *   npx tsx scripts/archiveTireSkus.ts --confirm   ← live mode, archives everything found
 *
 * Env (read from .env in project root):
 *   VERCEL_URL    — base URL, e.g. https://your-project.vercel.app
 *   CRON_SECRET   — value sent as Bearer token
 */

import { resolve } from 'node:path';

try {
  process.loadEnvFile(resolve(process.cwd(), '.env'));
} catch {
  // env vars may already be set in shell
}

const VERCEL_URL  = process.env.VERCEL_URL?.replace(/\/$/, '');
const CRON_SECRET = process.env.CRON_SECRET;

if (!VERCEL_URL)  { console.error('❌ VERCEL_URL is not set'); process.exit(1); }
if (!CRON_SECRET) { console.error('❌ CRON_SECRET is not set'); process.exit(1); }

// ── CLI args ──────────────────────────────────────────────────────────────────

const CONFIRM  = process.argv.includes('--confirm');
const DRY_RUN  = !CONFIRM;
const DELAY_MS = 400;

// ── Helpers ───────────────────────────────────────────────────────────────────

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

async function apiFetch(url: string): Promise<any> {
  const res = await fetch(`${VERCEL_URL}${url}`, {
    method: 'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${CRON_SECRET}`,
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
  }
  return res.json();
}

interface Product {
  id:     number;
  title:  string;
  handle: string;
  sku:    string;
}

// Paginates a list action using sinceId, collecting products where predicate returns true.
async function collectTireSKUs(action: string): Promise<Product[]> {
  const collected: Product[] = [];
  let sinceId = 0;
  let page    = 1;

  while (true) {
    const url  = `/api/shopifySync?action=${action}${sinceId ? `&sinceId=${sinceId}` : ''}`;
    const data = await apiFetch(url);
    if (!data.success) throw new Error(`${action} returned error: ${JSON.stringify(data)}`);

    const products: Product[] = data.products || [];
    const matches = products.filter(p => p.sku.startsWith('TIRE-'));
    collected.push(...matches);

    console.log(`   ${action} page ${page}: ${products.length} products, ${matches.length} TIRE- matches (running: ${collected.length})`);

    if (data.nextSinceId == null) break;
    sinceId = data.nextSinceId;
    page++;
  }

  return collected;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n🔍 archiveTireSkus — ${DRY_RUN ? 'DRY RUN (pass --confirm to archive)' : 'LIVE MODE'}`);
  console.log(`   Target: ${VERCEL_URL}\n`);

  // Step 1: collect TIRE- products from ct-sync set
  console.log('📋 Paginating ct-sync products (list-products)...');
  const ctSyncTires = await collectTireSKUs('list-products');
  console.log(`   → ${ctSyncTires.length} TIRE- products in ct-sync set\n`);

  // Step 2: collect TIRE- products from all active products (no tag filter)
  console.log('📋 Paginating all active products (list-all-products)...');
  const allTires = await collectTireSKUs('list-all-products');
  console.log(`   → ${allTires.length} TIRE- products across all active products\n`);

  // Step 3: merge and deduplicate by product id
  const seen = new Set<number>();
  const merged: Product[] = [];
  for (const p of [...ctSyncTires, ...allTires]) {
    if (!seen.has(p.id)) { seen.add(p.id); merged.push(p); }
  }
  console.log(`📦 Total unique TIRE- products: ${merged.length}`);

  if (merged.length === 0) {
    console.log('\n✅ No TIRE- products found — nothing to do.');
    return;
  }

  // Step 4: dry-run report
  if (DRY_RUN) {
    console.log('\n── Sample (up to 10) ────────────────────────────────────');
    merged.slice(0, 10).forEach((p, i) =>
      console.log(`   ${i + 1}. [${p.id}] ${p.sku}  —  "${p.title}"`)
    );
    console.log(`\n   Run with --confirm to archive all ${merged.length} product(s).`);
    return;
  }

  // Step 5: archive each product one at a time
  console.log(`\n🗑️  Archiving ${merged.length} product(s) with ${DELAY_MS}ms delay...\n`);

  let archived    = 0;
  let redirected  = 0;
  let errors      = 0;
  const errorList: string[] = [];

  for (let i = 0; i < merged.length; i++) {
    const p   = merged[i];
    const num = `[${i + 1}/${merged.length}]`;
    const url = `/api/shopifySync?action=archive-single&id=${p.id}${p.handle ? `&handle=${encodeURIComponent(p.handle)}` : ''}`;

    try {
      const data = await apiFetch(url);
      if (!data.success) throw new Error(JSON.stringify(data));
      archived++;
      if (data.redirected) redirected++;
      console.log(`   ${num} ✅ ${p.sku}  —  "${p.title}"`);
    } catch (e: any) {
      errors++;
      const msg = `${p.sku} [${p.id}]: ${e.message}`;
      errorList.push(msg);
      console.error(`   ${num} ❌ ${msg}`);
    }

    if (i < merged.length - 1) await sleep(DELAY_MS);
  }

  console.log(`\n── Summary ──────────────────────────────────────────────`);
  console.log(`   Archived   : ${archived}`);
  console.log(`   Redirected : ${redirected}`);
  console.log(`   Errors     : ${errors}`);
  if (errorList.length > 0) {
    console.log('\n   Error details:');
    errorList.forEach(e => console.log(`     • ${e}`));
  }
  console.log();
}

main().catch(e => { console.error('❌ Fatal:', e); process.exit(1); });
