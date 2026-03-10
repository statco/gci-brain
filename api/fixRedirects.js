const STORE       = process.env.SHOPIFY_STORE_DOMAIN;
const TOKEN       = process.env.SHOPIFY_ADMIN_ACCESS_TOKEN;
const API_VERSION = "2024-01";
const BASE        = `https://${STORE}/admin/api/${API_VERSION}`;
const SHOPIFY_HEADERS = {
  "X-Shopify-Access-Token": TOKEN,
  "Content-Type": "application/json",
};

const DUPLICATE_RE = /-\d+$/;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function parseNextLink(linkHeader) {
  if (!linkHeader) return null;
  const match = linkHeader.match(/<([^>]+)>;\s*rel="next"/);
  return match ? match[1] : null;
}

async function fetchAllActiveProducts() {
  const products = [];
  let url = `${BASE}/products.json?status=active&limit=250&fields=id,handle`;

  while (url) {
    const res = await fetch(url, { headers: SHOPIFY_HEADERS });
    if (!res.ok) throw new Error(`Failed to fetch active products: ${res.status}`);
    const json = await res.json();
    products.push(...(json.products ?? []));
    const link = res.headers.get("Link");
    const next = parseNextLink(link);
    url = next || null;
  }

  return products;
}

async function createRedirect(path, target, isDryRun) {
  if (isDryRun) return { ok: true, dryRun: true };

  const res = await fetch(`${BASE}/redirects.json`, {
    method: "POST",
    headers: SHOPIFY_HEADERS,
    body: JSON.stringify({ redirect: { path, target } }),
  });

  if (res.status === 422) {
    return { ok: false, alreadyExists: true };
  }

  if (!res.ok) {
    const text = await res.text();
    return { ok: false, error: `${res.status} ${text}` };
  }

  return { ok: true };
}

export default async function handler(req, res) {
  const { dryRun, chunkSize = "50", offset = "0" } = req.query;
  const isDryRun    = dryRun === "true";
  const limit       = Math.max(1, Math.min(250, parseInt(chunkSize, 10) || 50));
  const startOffset = Math.max(0, parseInt(offset, 10) || 0);

  const log     = [];
  const summary = { scanned: 0, redirected: 0, skipped: 0, errors: 0 };

  log.push(`▶ fixRedirects — ${isDryRun ? "[DRY RUN]" : "[LIVE]"} chunkSize=${limit} offset=${startOffset}`);

  try {
    log.push("📦 Fetching all active products…");
    const allActive = await fetchAllActiveProducts();
    log.push(`📦 Total active products: ${allActive.length}`);

    // Filter to canonical handles (those NOT ending in -\d+)
    const canonicals = allActive.filter(p => !DUPLICATE_RE.test(p.handle));
    log.push(`🔍 Canonical handles found: ${canonicals.length}`);

    if (canonicals.length === 0) {
      log.push("✅ No canonical active products found.");
      return res.status(200).json({ log, summary, nextOffset: null });
    }

    // Apply offset + chunk window
    const chunk = canonicals.slice(startOffset, startOffset + limit);

    if (chunk.length === 0) {
      log.push("✅ All redirects created.");
      return res.status(200).json({ log, summary, nextOffset: null });
    }

    log.push(`▶ Processing chunk: offset=${startOffset}, size=${chunk.length}`);

    for (const product of chunk) {
      summary.scanned++;
      const handle = product.handle;

      for (const n of [1, 2, 3]) {
        const dupHandle = `${handle}-${n}`;
        const path1   = `/products/${dupHandle}`;
        const target1 = `/products/${handle}`;
        const path2   = `/en-ca/products/${dupHandle}`;
        const target2 = `/en-ca/products/${handle}`;

        // First redirect
        const r1 = await createRedirect(path1, target1, isDryRun);
        if (isDryRun) {
          log.push(`  🔍 [dry-run] ${path1} → ${target1}`);
          summary.redirected++;
        } else if (r1.alreadyExists) {
          log.push(`  ⏭  [skipped] ${path1} already exists`);
          summary.skipped++;
        } else if (r1.ok) {
          log.push(`  ✅ [redirect] ${path1} → ${target1}`);
          summary.redirected++;
        } else {
          log.push(`  ❌ [error] ${path1}: ${r1.error}`);
          summary.errors++;
        }

        if (!isDryRun) await sleep(300);

        // Second redirect (en-ca)
        const r2 = await createRedirect(path2, target2, isDryRun);
        if (isDryRun) {
          log.push(`  🔍 [dry-run] ${path2} → ${target2}`);
          summary.redirected++;
        } else if (r2.alreadyExists) {
          log.push(`  ⏭  [skipped] ${path2} already exists`);
          summary.skipped++;
        } else if (r2.ok) {
          log.push(`  ✅ [redirect] ${path2} → ${target2}`);
          summary.redirected++;
        } else {
          log.push(`  ❌ [error] ${path2}: ${r2.error}`);
          summary.errors++;
        }

        if (!isDryRun) await sleep(300);
      }
    }

    const nextChunkStart = startOffset + limit;
    const hasMore        = nextChunkStart < canonicals.length;
    const nextOffset     = hasMore ? nextChunkStart : null;

    log.push(`📊 Done — scanned=${summary.scanned} redirected=${summary.redirected} skipped=${summary.skipped} errors=${summary.errors}`);

    if (nextOffset != null) {
      log.push(`Next chunk starts at offset=${nextOffset}`);
    } else {
      log.push("✅ All redirects created.");
    }

    return res.status(200).json({ log, summary, nextOffset });
  } catch (err) {
    log.push(`❌ Unexpected error: ${err.message}`);
    return res.status(500).json({ log, summary, nextOffset: null });
  }
}
