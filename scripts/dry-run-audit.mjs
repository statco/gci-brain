/**
 * dry-run-audit.mjs
 * =================
 * Paginates through all GET /api/tagProducts?dry=true&chunkSize=25 offsets
 * and collects every product whose mergedTags (after the dry-run merge) still
 * lacks a season tag or a vehicleType tag — meaning classifyTire() returned
 * null for that field.
 *
 * Usage:
 *   node scripts/dry-run-audit.mjs
 *   BASE_URL=https://match.gcitires.com node scripts/dry-run-audit.mjs
 */

const BASE = process.env.BASE_URL ?? 'https://match.gcitires.com';
const ENDPOINT = `${BASE}/api/tagProducts`;
const CHUNK = 25;

const SEASON_TAGS  = new Set(['winter', 'all-season', 'all-weather', 'all-terrain', 'summer']);
const VEHICLE_TAGS = new Set(['passenger', 'suv', 'light-truck']);

async function fetchChunk(offset) {
  const url = `${ENDPOINT}?dry=true&chunkSize=${CHUNK}&offset=${offset}`;
  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status} at offset=${offset}: ${body.slice(0, 200)}`);
  }
  return res.json();
}

async function run() {
  let offset = 0;
  let total = null;
  const nullSeason  = [];
  const nullVehicle = [];
  const nullBoth    = [];
  let chunksProcessed = 0;
  let totalChanges = 0;

  while (true) {
    process.stderr.write(`  Fetching offset=${offset}…\n`);
    const data = await fetchChunk(offset);

    if (total === null) {
      total = data.total;
      const estimatedChunks = Math.ceil(total / CHUNK);
      process.stderr.write(`  Total products in catalog: ${total} (~${estimatedChunks} chunks)\n\n`);
    }

    for (const c of (data.changes ?? [])) {
      totalChanges++;
      const tags       = c.mergedTags.split(',').map(t => t.trim()).filter(Boolean);
      const hasSeason  = tags.some(t => SEASON_TAGS.has(t));
      const hasVehicle = tags.some(t => VEHICLE_TAGS.has(t));

      const entry = { id: c.id, title: c.title, added: c.added, mergedTags: c.mergedTags };

      if (!hasSeason && !hasVehicle) nullBoth.push(entry);
      else if (!hasSeason)            nullSeason.push(entry);
      else if (!hasVehicle)           nullVehicle.push(entry);
    }

    chunksProcessed++;
    if (data.nextOffset === null || data.nextOffset === undefined) break;
    offset = data.nextOffset;
  }

  // ── Report ────────────────────────────────────────────────────────────────

  const totalNull = nullBoth.length + nullSeason.length + nullVehicle.length;

  console.log('\n════════════════════════════════════════════════════════');
  console.log('  DRY-RUN TAG AUDIT — NULL CLASSIFICATION REPORT');
  console.log('════════════════════════════════════════════════════════');
  console.log(`  Catalog size  : ${total} products`);
  console.log(`  Chunks fetched: ${chunksProcessed}`);
  console.log(`  Products with tag changes : ${totalChanges}`);
  console.log(`  Products with NULL season AND vehicleType : ${nullBoth.length}`);
  console.log(`  Products with NULL season only            : ${nullSeason.length}`);
  console.log(`  Products with NULL vehicleType only       : ${nullVehicle.length}`);
  console.log(`  Total needing lookup expansion            : ${totalNull}`);
  console.log('════════════════════════════════════════════════════════\n');

  if (nullBoth.length > 0) {
    console.log('── NULL season + vehicleType ─────────────────────────');
    for (const p of nullBoth) {
      console.log(`  [${p.id}] ${p.title}`);
      console.log(`          mergedTags: ${p.mergedTags || '(none)'}`);
    }
    console.log('');
  }

  if (nullSeason.length > 0) {
    console.log('── NULL season only ──────────────────────────────────');
    for (const p of nullSeason) {
      console.log(`  [${p.id}] ${p.title}`);
      console.log(`          mergedTags: ${p.mergedTags}`);
    }
    console.log('');
  }

  if (nullVehicle.length > 0) {
    console.log('── NULL vehicleType only ─────────────────────────────');
    for (const p of nullVehicle) {
      console.log(`  [${p.id}] ${p.title}`);
      console.log(`          mergedTags: ${p.mergedTags}`);
    }
    console.log('');
  }

  if (totalNull === 0) {
    console.log('✅  All changed products received both a season and a vehicleType tag.');
  } else {
    console.log(`⚠️  ${totalNull} product title(s) produced a null classification.`);
    console.log('   These models are not yet represented in lib/classifyTire.ts.');
  }

  // Machine-readable JSON to stdout for piping
  process.stdout.write('\n\n--- JSON SUMMARY ---\n');
  console.log(JSON.stringify({ total, chunksProcessed, totalChanges, nullSeason, nullVehicle, nullBoth }, null, 2));
}

run().catch(err => { console.error('Fatal:', err); process.exit(1); });
