#!/usr/bin/env npx tsx
/**
 * scripts/generateSeoDescriptions.ts
 *
 * Generates bilingual (EN/FR québécois) SEO body_html for Shopify products
 * whose existing description text is under 200 characters.
 *
 * Usage:
 *   npx tsx scripts/generateSeoDescriptions.ts                       # dry run
 *   npx tsx scripts/generateSeoDescriptions.ts --confirm             # write to Shopify
 *   npx tsx scripts/generateSeoDescriptions.ts --limit=10            # test: 10 products
 *   npx tsx scripts/generateSeoDescriptions.ts --confirm --limit=5   # write 5 products
 *
 * Env (read from .env in project root):
 *   VERCEL_URL        — base URL, e.g. https://gci-brain.vercel.app
 *   CRON_SECRET       — value sent as Bearer token
 *   ANTHROPIC_API_KEY — Claude API key
 */

import { resolve } from 'node:path';
import { writeFileSync } from 'node:fs';

try {
  process.loadEnvFile(resolve(process.cwd(), '.env'));
} catch {
  // env vars may already be set in the shell
}

const VERCEL_URL       = process.env.VERCEL_URL?.replace(/\/$/, '');
const CRON_SECRET      = process.env.CRON_SECRET;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

if (!VERCEL_URL)        { console.error('❌ VERCEL_URL is not set');        process.exit(1); }
if (!CRON_SECRET)       { console.error('❌ CRON_SECRET is not set');       process.exit(1); }
if (!ANTHROPIC_API_KEY) { console.error('❌ ANTHROPIC_API_KEY is not set'); process.exit(1); }

const DRY_RUN        = !process.argv.includes('--confirm');
const BATCH_SIZE     = 5;
const BATCH_DELAY_MS = 2000; // buffer for Anthropic rate limits
const MIN_DESC_CHARS = 200;

function parseArg(name: string): number | null {
  const arg = process.argv.find(a => a.startsWith(`--${name}=`));
  return arg ? parseInt(arg.split('=')[1], 10) : null;
}

const LIMIT = parseArg('limit') ?? Infinity;

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }
function authHeaders(): Record<string, string> {
  return { 'Authorization': `Bearer ${CRON_SECRET}` };
}

// ── Text helpers ──────────────────────────────────────────────────────────────

function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function extractSize(title: string): string {
  const m = title.match(/(\d{3}\/\d{2}R?\d{2})/i);
  return m ? m[1] : 'N/A';
}

function extractSeason(tags: string): string {
  const t = tags.toLowerCase();
  if (t.includes('winter') || t.includes('hiver'))   return 'Winter / Hiver';
  if (t.includes('summer') || t.includes('été'))     return 'Summer / Été';
  if (t.includes('all-season'))                      return 'All-Season / Quatre saisons';
  return 'All-Season / Quatre saisons';
}

function extractBrandModel(title: string): { brand: string; model: string } {
  const tokens  = title.trim().split(/\s+/);
  const brand   = tokens[0] || '';
  const sizeIdx = tokens.findIndex(t => /\d{3}\/\d{2}/.test(t));
  const modelTokens = sizeIdx > 1 ? tokens.slice(1, sizeIdx) : tokens.slice(1, 2);
  return { brand, model: modelTokens.join(' ') };
}

// ── Anthropic API ─────────────────────────────────────────────────────────────

async function generateDescription(product: {
  title: string;
  vendor: string;
  tags: string;
}): Promise<string> {
  const { brand, model } = extractBrandModel(product.title);
  const effectiveBrand   = product.vendor || brand;
  const size             = extractSize(product.title);
  const season           = extractSeason(product.tags);

  const prompt = `You are an SEO copywriter for GCI Tires, a Canadian online tire retailer. Write a product description in both English and French for this tire: ${product.title}

Brand: ${effectiveBrand}
Season: ${season}
Size: ${size}

Return ONLY valid HTML with no markdown, using this exact structure:
<div class='gci-product-description'>
<p>[2 sentence English description targeting keywords: ${effectiveBrand} ${model} tire Canada, buy ${effectiveBrand} tires online, free shipping tires Canada]</p>
<p class='fr'>[Same 2 sentences in French québécois targeting: pneus ${effectiveBrand} Canada, acheter pneus en ligne, livraison gratuite pneus]</p>
<ul>
<li>Season: ${season}</li>
<li>Size: ${size}</li>
<li>Free shipping across Canada</li>
<li>Part of the Canada Tire Inc. catalog (est. 1928)</li>
</ul>
</div>`;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type':    'application/json',
      'x-api-key':       ANTHROPIC_API_KEY!,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model:      'claude-sonnet-4-20250514',
      max_tokens: 1000,
      messages:   [{ role: 'user', content: prompt }],
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Anthropic API HTTP ${res.status}: ${body.slice(0, 200)}`);
  }

  const data: any = await res.json();
  return (data.content?.[0]?.text || '').trim();
}

function validateDescription(html: string): boolean {
  return (
    html.startsWith('<div') &&
    html.includes('<p>') &&
    html.includes("<p class='fr'>")
  );
}

// ── Shopify API helpers ───────────────────────────────────────────────────────

async function fetchPage(sinceId: number): Promise<{
  products: Array<{ id: number; title: string; vendor: string; tags: string; body_html: string }>;
  nextSinceId: number | null;
}> {
  const url = `${VERCEL_URL}/api/shopifySync?action=list-products-seo&sinceId=${sinceId}`;
  const res = await fetch(url, { headers: authHeaders() });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`list-products-seo HTTP ${res.status}: ${body.slice(0, 200)}`);
  }
  const data: any = await res.json();
  return { products: data.products || [], nextSinceId: data.nextSinceId ?? null };
}

async function updateDescription(productId: number, body_html: string): Promise<void> {
  const url = `${VERCEL_URL}/api/shopifySync?action=update-description`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ productId, body_html }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`update-description HTTP ${res.status}: ${body.slice(0, 200)}`);
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

interface SeoResult {
  id: number;
  title: string;
  charsBefore: number;
  charsAfter: number;
  status: 'generated' | 'written' | 'invalid_response' | 'error';
  error?: string;
}

async function main() {
  console.log(`\n✍️  generateSeoDescriptions — mode: ${DRY_RUN ? 'DRY RUN (pass --confirm to write)' : 'LIVE WRITE'}`);
  if (LIMIT !== Infinity) console.log(`   Limit: ${LIMIT} products`);
  console.log(`   Target: ${VERCEL_URL}\n`);

  // 1. Paginate all ct-sync products, filter for thin descriptions
  const thinProducts: Array<{
    id: number; title: string; vendor: string; tags: string; charsBefore: number;
  }> = [];
  let sinceId = 0;
  let page    = 0;

  outer: while (true) {
    page++;
    const { products, nextSinceId } = await fetchPage(sinceId);

    for (const p of products) {
      const text = stripHtml(p.body_html || '');
      if (text.length < MIN_DESC_CHARS) {
        thinProducts.push({
          id: p.id, title: p.title, vendor: p.vendor,
          tags: p.tags, charsBefore: text.length,
        });
        if (thinProducts.length >= LIMIT) break outer;
      }
    }

    console.log(`   📄 Page ${page}: ${products.length} scanned, ${thinProducts.length} thin so far`);
    if (!nextSinceId) break;
    sinceId = nextSinceId;
    await sleep(300);
  }

  console.log(`\n   📝 ${thinProducts.length} products need SEO descriptions\n`);

  // 2. Process in batches
  const results: SeoResult[] = [];
  let generated = 0, written = 0, invalid = 0, errors = 0;

  for (let i = 0; i < thinProducts.length; i += BATCH_SIZE) {
    const batch = thinProducts.slice(i, i + BATCH_SIZE);
    console.log(`── Batch ${Math.floor(i / BATCH_SIZE) + 1} (${i + 1}–${Math.min(i + BATCH_SIZE, thinProducts.length)} of ${thinProducts.length}) ──`);

    for (const product of batch) {
      try {
        const html       = await generateDescription(product);
        const charsAfter = stripHtml(html).length;

        if (!validateDescription(html)) {
          invalid++;
          results.push({ id: product.id, title: product.title, charsBefore: product.charsBefore, charsAfter, status: 'invalid_response' });
          console.log(`   ⚠️  Invalid response for "${product.title}"`);
          console.log(`      Preview: ${html.slice(0, 100)}…`);
          continue;
        }

        generated++;
        console.log(`   ✅ ${product.title}`);
        console.log(`      ${product.charsBefore} chars → ${charsAfter} chars`);

        if (!DRY_RUN) {
          await updateDescription(product.id, html);
          written++;
          console.log(`      Written to Shopify ✓`);
          results.push({ id: product.id, title: product.title, charsBefore: product.charsBefore, charsAfter, status: 'written' });
        } else {
          results.push({ id: product.id, title: product.title, charsBefore: product.charsBefore, charsAfter, status: 'generated' });
        }
      } catch (e: any) {
        errors++;
        results.push({ id: product.id, title: product.title, charsBefore: product.charsBefore, charsAfter: 0, status: 'error', error: e.message });
        console.error(`   ❌ Error for "${product.title}": ${e.message}`);
      }

      await sleep(200); // small gap between individual Anthropic calls
    }

    if (i + BATCH_SIZE < thinProducts.length) {
      console.log(`   ⏳ Waiting ${BATCH_DELAY_MS / 1000}s before next batch…\n`);
      await sleep(BATCH_DELAY_MS);
    }
  }

  // 3. Save results
  const resultsPath = resolve(process.cwd(), 'scripts/seo-descriptions-results.json');
  writeFileSync(resultsPath, JSON.stringify({
    timestamp: new Date().toISOString(),
    dryRun:    DRY_RUN,
    summary:   { total: thinProducts.length, generated, written, invalid, errors },
    results,
  }, null, 2));

  // 4. Summary
  console.log(`\n${'─'.repeat(56)}`);
  console.log(`✅ Complete`);
  console.log(`   Thin products  : ${thinProducts.length}`);
  console.log(`   Generated      : ${generated}`);
  console.log(`   Written        : ${DRY_RUN ? '0 (dry run)' : written}`);
  console.log(`   Invalid resp   : ${invalid}`);
  console.log(`   Errors         : ${errors}`);
  console.log(`   Results saved  : scripts/seo-descriptions-results.json`);
  if (DRY_RUN && generated > 0) {
    console.log(`\n   Re-run with --confirm to write ${generated} description(s) to Shopify.`);
  }
}

main().catch(e => { console.error('❌ Fatal:', e); process.exit(1); });
