#!/usr/bin/env npx tsx
/**
 * scripts/auditTireSkus.ts
 *
 * Audits all ct-sync Shopify products whose SKU starts with "TIRE-" and
 * classifies them into two groups:
 *
 *   hasRealMatch  — another ct-sync product exists with the same title
 *                   but a real CT part number SKU (safe to delete the TIRE- copy)
 *   trulyStale    — no real CT counterpart shares the title (investigate first)
 *
 * Paginates locally via the lightweight `list-products` action so the
 * serverless function never times out.
 *
 * Usage:
 *   npx tsx scripts/auditTireSkus.ts
 *
 * Env (read from .env in project root):
 *   VERCEL_URL    — e.g. https://your-project.vercel.app
 *   CRON_SECRET   — Bearer token for the API
 *
 * Output:
 *   - Summary table printed to stdout
 *   - Full results written to scripts/audit-results.json
 */

import { resolve, dirname } from 'node:path';
import { writeFileSync }    from 'node:fs';
import { fileURLToPath }    from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Load .env ─────────────────────────────────────────────────────────────────

try {
  process.loadEnvFile(resolve(process.cwd(), '.env'));
} catch {
  // env vars may already be set in the shell
}

const VERCEL_URL  = process.env.VERCEL_URL?.replace(/\/$/, '');
const CRON_SECRET = process.env.CRON_SECRET;

if (!VERCEL_URL)  { console.error('❌ VERCEL_URL is not set');  process.exit(1); }
if (!CRON_SECRET) { console.error('❌ CRON_SECRET is not set'); process.exit(1); }

// ── Types ─────────────────────────────────────────────────────────────────────

interface ShopifyProduct { id: number; title: string; tags: string; sku: string; }

interface HasRealMatchEntry {
  tireProduct: { id: number; title: string; sku: string };
  realProduct:  { id: number; title: string; sku: string };
}

interface TrulyStaleEntry { id: number; title: string; sku: string; }

// ── Helpers ───────────────────────────────────────────────────────────────────

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

function normalizeTitle(title: string): string {
  return title.toLowerCase().trim().replace(/\s+/g, ' ');
}

async function fetchPage(sinceId: number): Promise<{ products: ShopifyProduct[]; nextSinceId: number | null }> {
  const url = `${VERCEL_URL}/api/shopifySync?action=list-products&sinceId=${sinceId}`;
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
  const data: any = await res.json();
  if (!data.success) throw new Error(`API error: ${JSON.stringify(data)}`);
  return { products: data.products, nextSinceId: data.nextSinceId };
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n🔍 auditTireSkus — paginating ct-sync products`);
  console.log(`   Target: ${VERCEL_URL}\n`);

  const tireSkuProducts: ShopifyProduct[]                           = [];
  const realSkuByTitle:  Map<string, ShopifyProduct>                = new Map();

  let sinceId    = 0;
  let pageCount  = 0;
  let totalSeen  = 0;

  // ── Paginate all ct-sync products ──────────────────────────────────────────
  while (true) {
    pageCount++;
    process.stdout.write(`   page ${pageCount} (sinceId=${sinceId})…`);

    const { products, nextSinceId } = await fetchPage(sinceId);
    totalSeen += products.length;

    for (const p of products) {
      if (p.sku.startsWith('TIRE-')) {
        tireSkuProducts.push(p);
      } else if (p.sku) {
        realSkuByTitle.set(normalizeTitle(p.title), p);
      }
    }

    console.log(` ${products.length} products (${tireSkuProducts.length} TIRE- so far)`);

    if (nextSinceId === null) break;
    sinceId = nextSinceId;
    await sleep(300); // be kind to the API
  }

  console.log(`\n📦 Fetched ${totalSeen} total ct-sync products across ${pageCount} page(s)`);
  console.log(`   TIRE- products : ${tireSkuProducts.length}`);
  console.log(`   Real-SKU products : ${realSkuByTitle.size}\n`);

  // ── Classify ───────────────────────────────────────────────────────────────
  const hasRealMatch: HasRealMatchEntry[] = [];
  const trulyStale:   TrulyStaleEntry[]   = [];

  for (const p of tireSkuProducts) {
    const match = realSkuByTitle.get(normalizeTitle(p.title));
    if (match) {
      hasRealMatch.push({
        tireProduct: { id: p.id, title: p.title, sku: p.sku },
        realProduct:  { id: match.id, title: match.title, sku: match.sku },
      });
    } else {
      trulyStale.push({ id: p.id, title: p.title, sku: p.sku });
    }
  }

  // ── Summary table ──────────────────────────────────────────────────────────
  console.log('════════════════════════════════════════════════════════════');
  console.log(' AUDIT RESULTS');
  console.log('════════════════════════════════════════════════════════════');
  console.log(` Total TIRE- SKU products : ${tireSkuProducts.length}`);
  console.log(` Has real CT match        : ${hasRealMatch.length}  ← safe to delete TIRE- copy`);
  console.log(` Truly stale (no match)   : ${trulyStale.length}   ← investigate before deleting`);
  console.log('════════════════════════════════════════════════════════════\n');

  if (hasRealMatch.length > 0) {
    console.log('── Sample: hasRealMatch (up to 10) ─────────────────────────');
    for (const e of hasRealMatch.slice(0, 10)) {
      console.log(`  TIRE id=${e.tireProduct.id}  sku=${e.tireProduct.sku}`);
      console.log(`    title: ${e.tireProduct.title}`);
      console.log(`    real  id=${e.realProduct.id}  sku=${e.realProduct.sku}\n`);
    }
  }

  if (trulyStale.length > 0) {
    console.log('── Sample: trulyStale (up to 10) ───────────────────────────');
    for (const e of trulyStale.slice(0, 10)) {
      console.log(`  id=${e.id}  sku=${e.sku}  title: ${e.title}`);
    }
    console.log('');
  }

  // ── Save full results ──────────────────────────────────────────────────────
  const outPath = resolve(__dirname, 'audit-results.json');
  const output = {
    generatedAt: new Date().toISOString(),
    summary: {
      totalTireSkuProducts: tireSkuProducts.length,
      realCtSkuProducts:    realSkuByTitle.size,
      hasRealMatch:         hasRealMatch.length,
      trulyStale:           trulyStale.length,
    },
    hasRealMatch,
    trulyStale,
  };
  writeFileSync(outPath, JSON.stringify(output, null, 2));
  console.log(`💾 Full results saved to scripts/audit-results.json`);
}

main().catch(e => { console.error('❌ Fatal:', e); process.exit(1); });
