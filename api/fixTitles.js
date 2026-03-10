const STORE       = process.env.SHOPIFY_STORE_DOMAIN;
const TOKEN       = process.env.SHOPIFY_ADMIN_ACCESS_TOKEN;
const API_VERSION = "2024-01";
const BASE        = `https://${STORE}/admin/api/${API_VERSION}`;
const SHOPIFY_HEADERS = {
  "X-Shopify-Access-Token": TOKEN,
  "Content-Type": "application/json",
};

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function parseNextLink(linkHeader) {
  if (!linkHeader) return null;
  const match = linkHeader.match(/<([^>]+)>;\s*rel="next"/);
  return match ? match[1] : null;
}

function isAllCaps(str) {
  const letters = str.replace(/[^a-zA-Z]/g, '');
  return letters.length > 0 && letters === letters.toUpperCase();
}

function toTitleCase(str) {
  const minorWords = new Set(['a','an','the','and','but','or','for','nor','on','at','to','by','in','of','up','as','is']);
  return str.toLowerCase().split(' ').map((word, i) => {
    const clean = word.replace(/[^a-zA-Z]/g, '').toLowerCase();
    if (i === 0 || !minorWords.has(clean)) {
      return word.charAt(0).toUpperCase() + word.slice(1);
    }
    return word;
  }).join(' ');
}

async function fetchAllActiveProducts() {
  const products = [];
  let url = `${BASE}/products.json?status=active&limit=250&fields=id,title`;

  while (url) {
    const res = await fetch(url, { headers: SHOPIFY_HEADERS });
    if (!res.ok) throw new Error(`Failed to fetch products: ${res.status}`);
    const json = await res.json();
    products.push(...(json.products ?? []));
    const link = res.headers.get("Link");
    const next = parseNextLink(link);
    url = next || null;
  }

  return products;
}

export default async function handler(req, res) {
  const { dryRun, chunkSize = "20", offset = "0" } = req.query;
  const isDryRun    = dryRun === "true";
  const limit       = Math.max(1, Math.min(250, parseInt(chunkSize, 10) || 20));
  const startOffset = Math.max(0, parseInt(offset, 10) || 0);

  const log     = [];
  const summary = { scanned: 0, fixed: 0, skipped: 0, errors: 0 };

  log.push(`▶ fixTitles — ${isDryRun ? "[DRY RUN]" : "[LIVE]"} chunkSize=${limit} offset=${startOffset}`);

  try {
    log.push("📦 Fetching all active products…");
    const allProducts = await fetchAllActiveProducts();
    log.push(`📦 Total active products: ${allProducts.length}`);

    const chunk = allProducts.slice(startOffset, startOffset + limit);

    if (chunk.length === 0) {
      log.push("✅ All titles fixed.");
      return res.status(200).json({ log, summary, nextOffset: null });
    }

    log.push(`▶ Processing chunk: offset=${startOffset}, size=${chunk.length}`);

    for (const product of chunk) {
      summary.scanned++;
      const { id, title } = product;

      if (!isAllCaps(title)) {
        log.push(`  [skipped] ${title}`);
        summary.skipped++;
        continue;
      }

      const newTitle = toTitleCase(title);

      if (isDryRun) {
        log.push(`  [fixed] "${title}" → "${newTitle}"`);
        summary.fixed++;
        continue;
      }

      try {
        const putRes = await fetch(`${BASE}/products/${id}.json`, {
          method: "PUT",
          headers: SHOPIFY_HEADERS,
          body: JSON.stringify({ product: { id, title: newTitle } }),
        });

        if (!putRes.ok) {
          const text = await putRes.text();
          log.push(`  ❌ [error] "${title}": ${putRes.status} ${text}`);
          summary.errors++;
        } else {
          log.push(`  [fixed] "${title}" → "${newTitle}"`);
          summary.fixed++;
        }
      } catch (err) {
        log.push(`  ❌ [error] "${title}": ${err.message}`);
        summary.errors++;
      }

      await sleep(300);
    }

    const nextChunkStart = startOffset + limit;
    const hasMore        = nextChunkStart < allProducts.length;
    const nextOffset     = hasMore ? nextChunkStart : null;

    log.push(`📊 Done — scanned=${summary.scanned} fixed=${summary.fixed} skipped=${summary.skipped} errors=${summary.errors}`);

    if (nextOffset != null) {
      log.push(`Next chunk starts at offset=${nextOffset}`);
    } else {
      log.push("✅ All titles fixed.");
    }

    return res.status(200).json({ log, summary, nextOffset });
  } catch (err) {
    log.push(`❌ Unexpected error: ${err.message}`);
    return res.status(500).json({ log, summary, nextOffset: null });
  }
}
