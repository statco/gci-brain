#!/usr/bin/env npx tsx
/**
 * scripts/backfillImages.ts
 *
 * Finds all ct-sync Shopify products with no images and uses the Claude API
 * with web_search to locate and attach matching product images.
 *
 * Usage:
 *   npx tsx scripts/backfillImages.ts              # dry run (default)
 *   npx tsx scripts/backfillImages.ts --confirm    # attach images
 *   npx tsx scripts/backfillImages.ts --limit=10   # test: first N products
 *
 * Env (read from .env in project root):
 *   VERCEL_URL         — base URL, e.g. https://gci-brain.vercel.app
 *   CRON_SECRET        — value sent as Bearer token
 *   ANTHROPIC_API_KEY  — Claude API key
 *
 * Est. cost: ~$0.002 per product × 1128 products ≈ $2.25 total
 */

import { resolve } from 'node:path';
import { writeFileSync } from 'node:fs';

try {
  process.loadEnvFile(resolve(process.cwd(), '.env'));
} catch {
  // env vars may already be set in the shell
}

const VERCEL_URL        = process.env.VERCEL_URL?.replace(/\/$/, '');
const CRON_SECRET       = process.env.CRON_SECRET;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

if (!VERCEL_URL)        { console.error('❌ VERCEL_URL is not set');        process.exit(1); }
if (!CRON_SECRET)       { console.error('❌ CRON_SECRET is not set');       process.exit(1); }
if (!ANTHROPIC_API_KEY) { console.error('❌ ANTHROPIC_API_KEY is not set'); process.exit(1); }

const DRY_RUN        = !process.argv.includes('--confirm');
const BATCH_SIZE     = 3;   // stay within Anthropic rate limits
const BATCH_DELAY_MS = 5000;

function parseArg(name: string): number | null {
  const arg = process.argv.find(a => a.startsWith(`--${name}=`));
  return arg ? parseInt(arg.split('=')[1], 10) : null;
}

const LIMIT = parseArg('limit') ?? Infinity;

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }
function authHeaders(): Record<string, string> {
  return { 'Authorization': `Bearer ${CRON_SECRET}` };
}

// ── Claude web_search image finder ───────────────────────────────────────────

const IMAGE_URL_RE = /https:\/\/[^\s"'<>]+(?:\/(?:image|images|img|media|cdn|product|tire)[^\s"'<>]*|[^\s"'<>]*\.(?:jpg|jpeg|png|webp|avif)(?:[?#][^\s"'<>]*)?|[^\s"'<>]*(?:cloudinary|imgix|akamai|fastly)[^\s"'<>]*)/i;

let firstProduct = true;

async function findImageViaAI(title: string): Promise<string | null> {
  const prompt =
    `Find a product image URL for this tire: ${title}\n` +
    `Search manufacturer websites, tire retailers, and distributor sites.\n` +
    `Look for the main product/hero image on the product page.\n` +
    `Return ONLY a single direct image URL that is publicly accessible.\n` +
    `The URL should point directly to an image file or image CDN.\n` +
    `No explanation, no markdown, just the raw URL.`;

  const MAX_RETRIES  = 3;
  const RETRY_DELAYS = [10_000, 20_000, 40_000];
  let   attempt      = 0;
  let   data: any;

  while (true) {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type':      'application/json',
        'x-api-key':         ANTHROPIC_API_KEY!,
        'anthropic-version': '2023-06-01',
        'anthropic-beta':    'web-search-2025-03-05',
      },
      body: JSON.stringify({
        model:      'claude-haiku-4-5-20251001',
        max_tokens: 512,
        tools:      [{ type: 'web_search_20250305', name: 'web_search' }],
        messages:   [{ role: 'user', content: prompt }],
      }),
    });

    if (res.status === 429 && attempt < MAX_RETRIES) {
      const delaySec = RETRY_DELAYS[attempt] / 1000;
      console.log(`   ⏳ Rate limited, retrying in ${delaySec}s (attempt ${attempt + 1}/${MAX_RETRIES})`);
      await sleep(RETRY_DELAYS[attempt]);
      attempt++;
      continue;
    }

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Anthropic API HTTP ${res.status}: ${body.slice(0, 300)}`);
    }

    data = await res.json();
    break;
  }

  // The final answer lives in the last text content block after tool use
  const textBlock = [...(data.content || [])].reverse().find((b: any) => b.type === 'text');
  const text = textBlock?.text?.trim() || '';

  if (firstProduct) {
    firstProduct = false;
    console.log(`   🔬 Raw Claude response for first product:\n      "${text}"\n`);
  }

  const match = text.match(IMAGE_URL_RE);
  return match ? match[0] : null;
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
  status: 'attached' | 'not_found' | 'invalid_url' | 'error';
  imageUrl?: string;
  error?: string;
}

async function main() {
  console.log(`\n🖼️  backfillImages — mode: ${DRY_RUN ? 'DRY RUN (pass --confirm to attach)' : 'LIVE ATTACH'}`);
  if (LIMIT !== Infinity) console.log(`   Limit: ${LIMIT} products`);
  console.log(`   Target: ${VERCEL_URL}`);
  console.log(`   Model:  claude-haiku-4-5-20251001 + web_search\n`);

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

  console.log(`\n   🔍 ${subset.length} products — searching via Claude web_search…`);
  console.log(`   Est. cost: ~$${(subset.length * 0.002).toFixed(2)} (${subset.length} × $0.002)\n`);

  // 2. Process in batches of 3
  const results: Result[] = [];
  let found = 0, notFound = 0, invalidUrl = 0, attached = 0, errors = 0;

  for (let i = 0; i < subset.length; i += BATCH_SIZE) {
    const batch = subset.slice(i, i + BATCH_SIZE);
    console.log(`── Batch ${Math.floor(i / BATCH_SIZE) + 1} (${i + 1}–${Math.min(i + BATCH_SIZE, subset.length)} of ${subset.length}) ──`);

    await Promise.all(batch.map(async (product) => {
      try {
        const rawUrl = await findImageViaAI(product.title);

        if (!rawUrl) {
          notFound++;
          results.push({ id: product.id, title: product.title, status: 'not_found' });
          console.log(`   ❌ No URL in response : ${product.title}`);
          return;
        }

        const valid = await probeUrl(rawUrl);
        if (!valid) {
          invalidUrl++;
          results.push({ id: product.id, title: product.title, status: 'invalid_url', imageUrl: rawUrl });
          console.log(`   ⚠️  URL failed validation : ${product.title}`);
          console.log(`         → ${rawUrl}`);
          return;
        }

        found++;
        console.log(`   ✅ Found : ${product.title}`);
        console.log(`         → ${rawUrl}`);

        if (!DRY_RUN) {
          await attachImage(product.id, rawUrl, product.title);
          attached++;
          results.push({ id: product.id, title: product.title, status: 'attached', imageUrl: rawUrl });
        } else {
          results.push({ id: product.id, title: product.title, status: 'attached', imageUrl: rawUrl });
        }
      } catch (e: any) {
        errors++;
        results.push({ id: product.id, title: product.title, status: 'error', error: e.message });
        console.error(`   ⚠️  Error for "${product.title}": ${e.message}`);
      }
    }));

    if (i + BATCH_SIZE < subset.length) {
      console.log(`   ⏳ Waiting ${BATCH_DELAY_MS / 1000}s…\n`);
      await sleep(BATCH_DELAY_MS);
    }
  }

  // 3. Save results
  const resultsPath = resolve(process.cwd(), 'scripts/image-backfill-results.json');
  writeFileSync(resultsPath, JSON.stringify({
    timestamp: new Date().toISOString(),
    dryRun:    DRY_RUN,
    model:     'claude-haiku-4-5-20251001',
    summary:   { total: subset.length, found, notFound, invalidUrl, attached, errors },
    results,
  }, null, 2));

  // 4. Summary
  console.log(`\n${'─'.repeat(56)}`);
  console.log(`✅ Complete`);
  console.log(`   Total no-image : ${subset.length}`);
  console.log(`   URL found      : ${found}`);
  console.log(`   URL not found  : ${notFound}`);
  console.log(`   Invalid URL    : ${invalidUrl}`);
  console.log(`   Attached       : ${DRY_RUN ? '0 (dry run)' : attached}`);
  console.log(`   Errors         : ${errors}`);
  console.log(`   Results saved  : scripts/image-backfill-results.json`);
  if (DRY_RUN && found > 0) {
    console.log(`\n   Re-run with --confirm to attach ${found} found image(s).`);
  }
}

main().catch(e => { console.error('❌ Fatal:', e); process.exit(1); });
