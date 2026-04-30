#!/usr/bin/env npx tsx
/**
 * scripts/runUpdateOnly.ts
 *
 * Updates price, inventory and cost for all existing ct-sync Shopify products.
 * Unlike runFullImport, this never fetches the full CT catalog — it queries CT
 * for specific SKU batches only, making each call fast (~2-4s vs ~10s).
 *
 * Usage:
 *   npx tsx scripts/runUpdateOnly.ts [--chunkSize=N] [--startChunk=N]
 *
 * Flags:
 *   --chunkSize=N    SKUs per update-chunk call (default 20, max 50)
 *   --startChunk=N   Resume from this chunk index (default 0)
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

function parseArg(name: string, fallback: number): number {
  const arg = process.argv.find(a => a.startsWith(`--${name}=`));
  return arg ? parseInt(arg.split('=')[1], 10) : fallback;
}

const CHUNK_SIZE  = Math.min(parseArg('chunkSize', 20), 50); // API cap is 50
const START_CHUNK = parseArg('startChunk', 0);
const DELAY_MS    = 1000;

// ── Helpers ───────────────────────────────────────────────────────────────────

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

async function apiFetch(path: string, body?: unknown): Promise<any> {
  const res = await fetch(`${VERCEL_URL}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${CRON_SECRET}`,
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
  }
  return res.json();
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n🔄 runUpdateOnly — chunkSize=${CHUNK_SIZE} startChunk=${START_CHUNK}`);
  console.log(`   Target: ${VERCEL_URL}\n`);

  // Step 1: fetch all ct-sync SKUs from Shopify
  console.log('📋 Fetching SKU list from Shopify (list-skus)...');
  let listData: any;
  try {
    listData = await apiFetch('/api/shopifySync?action=list-skus');
  } catch (e: any) {
    console.error(`❌ list-skus failed: ${e.message}`);
    process.exit(1);
  }
  if (!listData.success) { console.error('❌ list-skus error:', listData); process.exit(1); }

  const allSkus: string[] = listData.skus;
  console.log(`   ${allSkus.length} SKUs to update\n`);

  // Step 2: split into chunks
  const chunks: string[][] = [];
  for (let i = 0; i < allSkus.length; i += CHUNK_SIZE) {
    chunks.push(allSkus.slice(i, i + CHUNK_SIZE));
  }
  console.log(`   ${chunks.length} chunk(s) of up to ${CHUNK_SIZE} SKUs each\n`);

  let totalUpdated = 0;
  let totalErrors  = 0;
  let totalNotFound = 0;

  // Step 3: update each chunk
  for (let i = START_CHUNK; i < chunks.length; i++) {
    const chunk = chunks[i];
    console.log(`── Chunk ${i + 1}/${chunks.length}  (${chunk.length} SKUs) ──────────────────────`);

    let data: any;
    try {
      data = await apiFetch('/api/shopifySync?action=update-chunk', { skus: chunk });
    } catch (e: any) {
      console.error(`❌ Request failed: ${e.message}`);
      process.exit(1);
    }

    if (!data.success) {
      console.error(`❌ API error: ${JSON.stringify(data)}`);
      process.exit(1);
    }

    const { updated = 0, errors = 0, errorList, notFoundInCT, ctFound = 0, duration = '?' } = data;
    totalUpdated  += updated;
    totalErrors   += errors;
    totalNotFound += notFoundInCT?.length ?? 0;

    console.log(`   updated=${updated}  ctFound=${ctFound}  errors=${errors}  duration=${duration}`);
    if (notFoundInCT?.length > 0) console.log(`   ⚠️  Not in CT (may be discontinued): ${notFoundInCT.join(', ')}`);
    if (errorList?.length  > 0)   console.log(`   errors: ${errorList.join(', ')}`);

    if (i < chunks.length - 1) {
      console.log(`   ⏳ ${DELAY_MS / 1000}s...\n`);
      await sleep(DELAY_MS);
    }
  }

  console.log(`\n✅ Update complete`);
  console.log(`   Total updated   : ${totalUpdated}`);
  console.log(`   Not found in CT : ${totalNotFound} (may be discontinued — consider archiving)`);
  console.log(`   Total errors    : ${totalErrors}`);
  if (totalErrors > 0) console.log(`   ⚠️  Review errors above`);
}

main().catch(e => { console.error('❌ Fatal:', e); process.exit(1); });
