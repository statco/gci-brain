#!/usr/bin/env npx tsx
/**
 * scripts/runFullImport.ts
 *
 * Drives the full-import action in a loop until all new CT products are created.
 * Each call creates one chunk of products; the loop advances the offset until
 * the API returns done:true.
 *
 * Usage:
 *   npx tsx scripts/runFullImport.ts [--chunkSize=N] [--startOffset=N]
 *
 * Env (read from .env in project root):
 *   VERCEL_URL    — base URL, e.g. https://your-project.vercel.app
 *   CRON_SECRET   — value sent as Bearer token
 */

import { resolve } from 'node:path';

// Load .env from project root (Node 20.6+)
try {
  process.loadEnvFile(resolve(process.cwd(), '.env'));
} catch {
  // Fall through — env vars may already be set in the shell
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

const CHUNK_SIZE   = parseArg('chunkSize', 10);
const START_OFFSET = parseArg('startOffset', 0);
const DELAY_MS     = 2000;

// ── Helpers ───────────────────────────────────────────────────────────────────

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

async function callImport(offset: number): Promise<any> {
  const url = `${VERCEL_URL}/api/shopifySync?action=full-import&offset=${offset}&chunkSize=${CHUNK_SIZE}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${CRON_SECRET}`,
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status}: ${body.slice(0, 200)}`);
  }
  return res.json();
}

// ── Main loop ─────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n🚀 runFullImport — chunkSize=${CHUNK_SIZE} startOffset=${START_OFFSET}`);
  console.log(`   Target: ${VERCEL_URL}\n`);

  let offset        = START_OFFSET;
  let totalCreated  = 0;
  let totalErrors   = 0;
  let callCount     = 0;

  while (true) {
    callCount++;
    console.log(`── Call #${callCount}  offset=${offset} ──────────────────────`);

    let data: any;
    try {
      data = await callImport(offset);
    } catch (e: any) {
      console.error(`❌ Request failed: ${e.message}`);
      process.exit(1);
    }

    if (!data.success) {
      console.error(`❌ API error: ${JSON.stringify(data)}`);
      process.exit(1);
    }

    const { created = 0, skipped = 0, skippedNoStock = 0, skippedDuplicate = 0,
            errors = 0, errorList = [], duration = '?', done,
            createPoolSize } = data;

    totalCreated += created;
    totalErrors  += errors;

    // On first call, log createPoolSize so we know how many total calls to expect
    if (callCount === 1 && createPoolSize != null) {
      const totalCalls = Math.ceil(createPoolSize / CHUNK_SIZE);
      console.log(`   📦 createPoolSize=${createPoolSize} — expect ~${totalCalls} total call(s)`);
    }

    console.log(`   created=${created}  skipped=${skipped}  skippedNoStock=${skippedNoStock}  skippedDuplicate=${skippedDuplicate}  errors=${errors}  duration=${duration}`);
    if (errorList.length > 0) {
      console.log(`   errors: ${errorList.join(', ')}`);
    }

    if (done) {
      console.log(`\n✅ Import complete after ${callCount} call(s)`);
      console.log(`   Total created : ${totalCreated}`);
      console.log(`   Total errors  : ${totalErrors}`);
      if (totalErrors > 0) console.log(`   ⚠️  Review errors above before running update-only`);
      break;
    }

    offset += CHUNK_SIZE;
    console.log(`   ⏳ Waiting ${DELAY_MS / 1000}s before next call…\n`);
    await sleep(DELAY_MS);
  }
}

main().catch(e => { console.error('❌ Fatal:', e); process.exit(1); });
