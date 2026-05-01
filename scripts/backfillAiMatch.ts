#!/usr/bin/env npx tsx
/**
 * scripts/backfillAiMatch.ts
 *
 * Drives the backfill-ai-match action in a loop until all ct-sync products
 * without the 'ai-match' tag have been patched.
 *
 * Usage:
 *   npx tsx scripts/backfillAiMatch.ts [--limit=N] [--startOffset=N]
 *
 * Env (read from .env in project root):
 *   VERCEL_URL    — base URL, e.g. https://your-project.vercel.app
 *   CRON_SECRET   — value sent as Bearer token
 */

import { resolve } from 'node:path';

try {
  process.loadEnvFile(resolve(process.cwd(), '.env'));
} catch {
  // env vars may already be set in the shell
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

const LIMIT        = parseArg('limit', 100);
const START_OFFSET = parseArg('startOffset', 0);
const DELAY_MS     = 1000;

// ── Helpers ───────────────────────────────────────────────────────────────────

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

async function callBackfill(offset: number): Promise<any> {
  const url = `${VERCEL_URL}/api/shopifySync?action=backfill-ai-match&offset=${offset}&limit=${LIMIT}`;
  const res = await fetch(url, {
    headers: { 'Authorization': `Bearer ${CRON_SECRET}` },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status}: ${body.slice(0, 200)}`);
  }
  return res.json();
}

// ── Main loop ─────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n🏷️  backfillAiMatch — limit=${LIMIT} startOffset=${START_OFFSET}`);
  console.log(`   Target: ${VERCEL_URL}\n`);

  let offset       = START_OFFSET;
  let totalPatched = 0;
  let totalErrors  = 0;
  let callCount    = 0;

  while (true) {
    callCount++;
    console.log(`── Call #${callCount}  offset=${offset} ──────────────────────`);

    let data: any;
    try {
      data = await callBackfill(offset);
    } catch (e: any) {
      console.error(`❌ Request failed: ${e.message}`);
      process.exit(1);
    }

    if (!data.success) {
      console.error(`❌ API error: ${JSON.stringify(data)}`);
      process.exit(1);
    }

    const { totalMissing, chunkSize, patched, errors, done, nextOffset } = data;

    totalPatched += patched ?? 0;
    totalErrors  += errors  ?? 0;

    if (callCount === 1) {
      console.log(`   📦 ${totalMissing} products missing ai-match`);
    }

    console.log(`   patched=${patched}  errors=${errors}  chunkSize=${chunkSize}  progress=${totalPatched}/${totalMissing}`);

    if (done) {
      console.log(`\n✅ Backfill complete after ${callCount} call(s)`);
      console.log(`   Total patched : ${totalPatched}`);
      console.log(`   Total errors  : ${totalErrors}`);
      if (totalErrors > 0) console.log(`   ⚠️  Some products failed — re-run to retry`);
      break;
    }

    offset = nextOffset ?? offset + LIMIT;
    console.log(`   ⏳ Waiting ${DELAY_MS / 1000}s before next call…\n`);
    await sleep(DELAY_MS);
  }
}

main().catch(e => { console.error('❌ Fatal:', e); process.exit(1); });
