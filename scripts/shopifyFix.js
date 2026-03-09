#!/usr/bin/env node
/**
 * scripts/shopifyFix.js
 *
 * Shopify store automation — fixes tire sizes, assigns variant images,
 * and translates SEO metafields to English via Claude AI.
 *
 * Usage:
 *   node scripts/shopifyFix.js [--dry-run] [--offset=N] [--chunkSize=N]
 *
 * Flags:
 *   --dry-run          Log planned changes without writing anything to Shopify
 *   --offset=N         Skip the first N products (for resumable runs, default 0)
 *   --chunkSize=N      Number of products to process per run (default 50)
 *
 * Required .env:
 *   SHOPIFY_STORE        e.g. gcitires.myshopify.com
 *   SHOPIFY_ADMIN_TOKEN  Shopify Admin API access token
 *   ANTHROPIC_API_KEY    Anthropic API key (for SEO translation)
 *
 * Install deps first:
 *   npm install dotenv
 */

import { createRequire } from 'module';
// Support both ESM project (type:module) and CommonJS. Dotenv loaded via
// createRequire so we don't need to change the project's module type.
const require = createRequire(import.meta.url);
try {
  require('dotenv').config();
} catch {
  // dotenv not installed – fall through; env vars may already be set
  console.warn('⚠️  dotenv not found. Using existing process.env values.');
}

// ─── CONFIG ───────────────────────────────────────────────────────────────────

const STORE       = process.env.SHOPIFY_STORE        || '';
const TOKEN       = process.env.SHOPIFY_ADMIN_TOKEN  || '';
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY  || '';
const API_VERSION = '2024-01';
const BASE_URL    = `https://${STORE}/admin/api/${API_VERSION}`;

/** Minimum gap between Shopify API calls: 500 ms = max 2 req/sec */
const RATE_DELAY_MS = 500;

// ─── CLI ARGS ─────────────────────────────────────────────────────────────────

const args      = process.argv.slice(2);
const DRY_RUN   = args.includes('--dry-run');
const OFFSET    = parseInt(args.find(a => a.startsWith('--offset='))?.split('=')[1]    ?? '0',  10);
const CHUNK_SIZE = parseInt(args.find(a => a.startsWith('--chunkSize='))?.split('=')[1] ?? '50', 10);

// ─── TIRE SIZE REGEX ──────────────────────────────────────────────────────────
// Malformed format: optional metric prefix + 7 consecutive digits + /R or /r
//
//   Plain:    2057016/R   →  205/70R16
//             1956515/R   →  195/65R15
//   P-metric: P2057016/R  →  P205/70R16
//   LT:       LT2657017/R →  LT265/70R17
//   ST/C:     ST2057015/R →  ST205/70R15
//
// Prefix group: LT | ST | P | C  (case-insensitive, optional)
// Digit groups: (\d{3}) width | (\d{2}) aspect ratio | (\d{2}) rim diameter
// Negative look-arounds prevent matching inside longer alphanumeric tokens.

const TIRE_SIZE_REPLACE_RE = /(?<![A-Za-z\d])((?:LT|ST|[PC])?)(\d{3})(\d{2})(\d{2})\/[Rr](?!\d)/gi;
const TIRE_SIZE_TEST_RE    = /(?<![A-Za-z\d])(?:LT|ST|[PC])?\d{7}\/[Rr](?!\d)/i; // no 'g', safe for .test()

/** Replace every malformed tire size in `text` with the standard notation. */
function fixTireSize(text) {
  if (!text) return text;
  return text.replace(TIRE_SIZE_REPLACE_RE, (_, prefix, w, r, d) => `${prefix}${w}/${r}R${d}`);
}

/** Return true if `text` contains at least one malformed tire size. */
function hasTireSizeIssue(text) {
  if (!text) return false;
  return TIRE_SIZE_TEST_RE.test(text);
}

// ─── UTILITY HELPERS ──────────────────────────────────────────────────────────

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Wrapper around fetch() that:
 *  - Injects Shopify auth header
 *  - Retries automatically on HTTP 429
 *  - Returns { data, linkHeader } so callers can paginate
 */
async function shopifyRequest(pathOrUrl, options = {}) {
  const url = pathOrUrl.startsWith('http') ? pathOrUrl : `${BASE_URL}${pathOrUrl}`;

  const res = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': TOKEN,
      ...(options.headers ?? {}),
    },
  });

  if (res.status === 429) {
    console.warn('  ⏳ Rate limited by Shopify, backing off 2 s…');
    await delay(2000);
    return shopifyRequest(pathOrUrl, options);
  }

  const linkHeader = res.headers.get('Link') ?? '';

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Shopify ${res.status} on ${url}: ${body.slice(0, 300)}`);
  }

  if (res.status === 204 || res.headers.get('content-length') === '0') {
    return { data: null, linkHeader };
  }

  const data = await res.json();
  return { data, linkHeader };
}

/** Parse the 'next' cursor URL from a Shopify Link header. */
function parseNextLink(linkHeader) {
  const m = linkHeader.match(/<([^>]+)>;\s*rel="next"/);
  return m ? m[1] : null;
}

// ─── LANGUAGE DETECTION HEURISTIC ────────────────────────────────────────────
// Cheap pre-filter before making an Anthropic API call.
// If the text contains accented characters common in French/Spanish/other
// Romance languages, OR matches a set of high-frequency French stopwords,
// we assume it may be non-English and pass it to Claude.
// Pure-ASCII English-looking text skips the API call entirely.

const NON_ASCII_RE  = /[éèêëàâùûôîïçœæÉÈÊËÀÂÙÛÔÎÏÇŒÆñÑ]/;
const FRENCH_WORDS_RE = /\b(?:pneu[sx]?|voiture|livraison|gratuit|toutes?|saisons?|été|hiver|neige|achat|boutique|qualité|qualite|prix|meilleur[es]?|disponible|garantie|de la|du |des |les |une |pour les?)\b/i;

/** Return true if the text is likely non-English and worth translating. */
function looksNonEnglish(text) {
  return NON_ASCII_RE.test(text) || FRENCH_WORDS_RE.test(text);
}

// ─── ANTHROPIC TRANSLATION ────────────────────────────────────────────────────

/**
 * Detect the language of `text`. If it is not English, return the English
 * translation. If it is already English (or passes the heuristic), return null.
 *
 * A cheap local heuristic runs first so we skip the API call for text that
 * is clearly already English.
 */
async function translateToEnglish(text) {
  if (!ANTHROPIC_KEY || !text?.trim()) return null;

  // Skip API call if the heuristic says it's already English
  if (!looksNonEnglish(text)) return null;

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type':      'application/json',
        'x-api-key':         ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model:      'claude-haiku-4-5-20251001', // Haiku 4.5 — fast & cost-effective
        max_tokens: 400,
        messages: [{
          role:    'user',
          content:
            'Detect the language of the following text.\n' +
            'If it is already in English, reply with exactly: ALREADY_ENGLISH\n' +
            'If it is NOT in English, translate it to English and reply with ONLY the ' +
            'translated text — no explanations, no labels.\n\n' +
            text,
        }],
      }),
    });

    if (!res.ok) {
      console.error(`  ⚠️  Anthropic ${res.status}: ${(await res.text()).slice(0, 200)}`);
      return null;
    }

    const responseData = await res.json();
    const result = responseData?.content?.[0]?.text?.trim() ?? '';

    if (result === 'ALREADY_ENGLISH') return null; // already English — no-op
    return result || null;
  } catch (err) {
    console.error(`  ⚠️  Translation error: ${err.message}`);
    return null;
  }
}

// ─── PAGINATED PRODUCT FETCHER ────────────────────────────────────────────────

/**
 * Async generator that yields every Shopify product one at a time,
 * following the page_info cursor via the Link header.
 *
 * We request only the fields we actually need to keep response sizes small.
 */
async function* fetchAllProducts() {
  const fields = 'id,title,body_html,variants,images,options';
  let url = `${BASE_URL}/products.json?limit=250&fields=${fields}`;
  let pageNum = 0;

  while (url) {
    pageNum++;
    const { data, linkHeader } = await shopifyRequest(url);
    const batch = data?.products ?? [];
    console.log(`  [paginate] page ${pageNum}: ${batch.length} products`);

    for (const p of batch) yield p;

    url = parseNextLink(linkHeader);
    if (url) await delay(RATE_DELAY_MS);
  }
}

// ─── TASK 1 — FIX DESCRIPTION (body_html) ────────────────────────────────────

async function fixBodyHtml(product) {
  const original = product.body_html ?? '';
  const fixed    = fixTireSize(original);

  if (fixed === original) return false;

  console.log(`    📝 body_html: reformat tire size(s) in description`);

  if (!DRY_RUN) {
    await delay(RATE_DELAY_MS);
    await shopifyRequest(`/products/${product.id}.json`, {
      method: 'PUT',
      body:   JSON.stringify({ product: { id: product.id, body_html: fixed } }),
    });
  }

  return true;
}

// ─── TASK 2 — FIX VARIANT TITLES & OPTION VALUES ─────────────────────────────

async function fixVariantSizes(product) {
  let count = 0;

  for (const variant of (product.variants ?? [])) {
    const patch = {};

    if (hasTireSizeIssue(variant.title))   patch.title   = fixTireSize(variant.title);
    if (hasTireSizeIssue(variant.option1)) patch.option1 = fixTireSize(variant.option1);
    if (hasTireSizeIssue(variant.option2)) patch.option2 = fixTireSize(variant.option2);
    if (hasTireSizeIssue(variant.option3)) patch.option3 = fixTireSize(variant.option3);

    if (Object.keys(patch).length === 0) continue;

    const changedFields = Object.entries(patch)
      .map(([k, v]) => `${k}: "${v}"`)
      .join(', ');
    console.log(`    🔧 Variant ${variant.id}: ${changedFields}`);

    if (!DRY_RUN) {
      await delay(RATE_DELAY_MS);
      await shopifyRequest(`/variants/${variant.id}.json`, {
        method: 'PUT',
        body:   JSON.stringify({ variant: { id: variant.id, ...patch } }),
      });
    }

    count++;
  }

  return count;
}

// ─── TASK 3 — ASSIGN PRODUCT IMAGE TO UNIMAGED VARIANTS ──────────────────────

async function assignMissingVariantImages(product) {
  // Guard: product.images may be undefined, null, or [] (no images uploaded).
  // Optional chaining + falsy check handles all three cases safely.
  const firstImage = product.images?.[0];
  if (!firstImage) return 0;

  let count = 0;

  for (const variant of (product.variants ?? [])) {
    if (variant.image_id != null) continue; // already assigned

    console.log(`    🖼️  Variant ${variant.id}: assign image_id=${firstImage.id}`);

    if (!DRY_RUN) {
      await delay(RATE_DELAY_MS);
      await shopifyRequest(`/variants/${variant.id}.json`, {
        method: 'PUT',
        body:   JSON.stringify({ variant: { id: variant.id, image_id: firstImage.id } }),
      });
    }

    count++;
  }

  return count;
}

// ─── TASK 4 — TRANSLATE SEO METAFIELDS ───────────────────────────────────────

async function translateSeoMetafields(product) {
  await delay(RATE_DELAY_MS);
  const { data } = await shopifyRequest(
    `/products/${product.id}/metafields.json?namespace=global`,
  );
  const metafields = data?.metafields ?? [];

  let count = 0;

  for (const key of ['title_tag', 'description_tag']) {
    const mf = metafields.find(m => m.namespace === 'global' && m.key === key);
    if (!mf) continue;

    const translated = await translateToEnglish(mf.value);
    if (!translated) continue; // already English or translation failed

    const preview = (s) => s.length > 70 ? s.slice(0, 67) + '…' : s;
    console.log(
      `    🌐 ${key}: "${preview(mf.value)}" → "${preview(translated)}"`,
    );

    if (!DRY_RUN) {
      await delay(RATE_DELAY_MS);
      await shopifyRequest(`/products/${product.id}/metafields/${mf.id}.json`, {
        method: 'PUT',
        body:   JSON.stringify({ metafield: { id: mf.id, value: translated } }),
      });
    }

    count++;
  }

  return count;
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────

async function main() {
  // Validate env
  if (!STORE || !TOKEN) {
    console.error('❌  Missing required environment variables:');
    if (!STORE)  console.error('    SHOPIFY_STORE is not set');
    if (!TOKEN)  console.error('    SHOPIFY_ADMIN_TOKEN is not set');
    process.exit(1);
  }

  console.log('');
  console.log('══════════════════════════════════════════════════════');
  console.log('  🛒  Shopify Automation Fix Script');
  console.log('══════════════════════════════════════════════════════');
  console.log(`  Store       : ${STORE}`);
  console.log(`  Dry run     : ${DRY_RUN}`);
  console.log(`  Offset      : ${OFFSET}`);
  console.log(`  Chunk size  : ${CHUNK_SIZE}`);
  console.log(`  Translate   : ${ANTHROPIC_KEY ? 'yes (Claude Haiku)' : 'no — ANTHROPIC_API_KEY not set'}`);
  console.log('══════════════════════════════════════════════════════');
  console.log('');
  if (DRY_RUN) {
    console.log('  ⚠️   DRY RUN MODE — no changes will be written\n');
  }
  if (OFFSET > 0) {
    console.log(
      `  ℹ️   --offset=${OFFSET}: Shopify cursor pagination has no native seek.\n` +
      `      The script must stream through all ${OFFSET} preceding products\n` +
      `      before it can start processing. This is expected behaviour.\n`,
    );
  }

  // ── Summary counters ────────────────────────────────────────────────────────
  let scanned          = 0;
  let imagesAssigned   = 0;
  let variantsUpdated  = 0;
  let seoTranslated    = 0;
  let errorCount       = 0;

  // ── Stream products, skip offset, process chunk ─────────────────────────────
  let globalIndex = 0;

  for await (const product of fetchAllProducts()) {
    // Skip products before the offset window
    if (globalIndex < OFFSET) {
      globalIndex++;
      continue;
    }

    // Stop when chunk is exhausted
    if (globalIndex >= OFFSET + CHUNK_SIZE) {
      console.log(`\n  ⏹  Chunk limit reached (offset=${OFFSET}, chunkSize=${CHUNK_SIZE}).`);
      console.log(`     Resume with: --offset=${globalIndex}`);
      break;
    }

    globalIndex++;
    scanned++;

    console.log(`\n[${globalIndex}] Product ${product.id}: "${product.title}"`);

    try {
      // Task 1 — Fix description
      await fixBodyHtml(product);

      // Task 2 — Fix variant sizes
      const vc = await fixVariantSizes(product);
      variantsUpdated += vc;

      // Task 3 — Assign images to unimaged variants
      const ic = await assignMissingVariantImages(product);
      imagesAssigned += ic;

      // Task 4 — Translate SEO metafields
      const sc = await translateSeoMetafields(product);
      seoTranslated += sc;

    } catch (err) {
      console.error(`  ❌  Error processing product ${product.id}: ${err.message}`);
      errorCount++;
    }

    // Throttle: ensure ≤ 2 req/sec between products
    await delay(RATE_DELAY_MS);
  }

  // ── Final summary ────────────────────────────────────────────────────────────
  console.log('');
  console.log('══════════════════════════════════════════════════════');
  console.log('  ✅  COMPLETED' + (DRY_RUN ? ' (dry run — no writes)' : ''));
  console.log('══════════════════════════════════════════════════════');
  console.log(`  Products scanned       : ${scanned}`);
  console.log(`  Variants size-fixed    : ${variantsUpdated}`);
  console.log(`  Variant images assigned: ${imagesAssigned}`);
  console.log(`  SEO fields translated  : ${seoTranslated}`);
  console.log(`  Errors                 : ${errorCount}`);
  console.log('══════════════════════════════════════════════════════');

  if (globalIndex < OFFSET + CHUNK_SIZE) {
    console.log('  📋  All products processed (no more pages).');
  } else {
    console.log(`  ▶️   Next run: node scripts/shopifyFix.js --offset=${globalIndex} --chunkSize=${CHUNK_SIZE}`);
  }

  console.log('');

  if (errorCount > 0) process.exitCode = 1;
}

main().catch(err => {
  console.error('\n💥  Fatal error:', err.message ?? err);
  process.exit(1);
});
