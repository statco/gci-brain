const STORE       = process.env.SHOPIFY_STORE_DOMAIN;
const TOKEN       = process.env.SHOPIFY_ADMIN_ACCESS_TOKEN;
const API_VERSION = "2024-01";
const BASE        = `https://${STORE}/admin/api/${API_VERSION}`;
const SHOPIFY_HEADERS = {
  "X-Shopify-Access-Token": TOKEN,
  "Content-Type": "application/json",
};

const FRENCH_RE = /[àâäéèêëîïôùûüçœ]|\b(pneu|hiver|voiture|vus|camion|toutes|saisons|été|performance|pour|chez|les|des|avec|une|sur|par|notre|nos)\b/i;
function looksNonEnglish(str) { return FRENCH_RE.test(str ?? ""); }

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function parseNextLink(linkHeader) {
  if (!linkHeader) return null;
  const match = linkHeader.match(/<([^>]+)>;\s*rel="next"/);
  return match ? match[1] : null;
}

async function generateAltText(productTitle, currentAlt, isFrench) {
  const prompt = isFrench
    ? `Write a concise English alt text for a tire product image. Product name: ${productTitle}. Current alt: ${currentAlt}. Return only the alt text, max 125 characters, no quotes.`
    : `Write a concise English alt text for a tire product image. Product name: ${productTitle}. Return only the alt text, max 125 characters, no quotes.`;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 150,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  const json = await res.json();
  const text = json.content?.[0]?.text?.trim() ?? "";
  return text.slice(0, 125);
}

export default async function handler(req, res) {
  const { dryRun, chunkSize = "20", offset = "0" } = req.query;
  const isDryRun    = dryRun === "true";
  const limit       = Math.max(1, Math.min(250, parseInt(chunkSize, 10) || 20));
  const startOffset = Math.max(0, parseInt(offset, 10) || 0);

  const log     = [];
  const summary = { scanned: 0, fixed: 0, skipped: 0, errors: 0 };

  log.push(`▶ fixAltTags — ${isDryRun ? "[DRY RUN]" : "[LIVE]"} chunkSize=${limit} offset=${startOffset}`);

  try {
    // Paginate to startOffset using cursor pagination
    let nextUrl = `${BASE}/products.json?limit=${limit}&fields=id,title,images`;
    let pageIndex = 0;

    // Skip pages until we reach the desired offset
    // offset is product-count based; we skip pages of `limit` products
    const pagesToSkip = Math.floor(startOffset / limit);
    for (let i = 0; i < pagesToSkip; i++) {
      const r = await fetch(nextUrl, { headers: SHOPIFY_HEADERS });
      if (!r.ok) {
        log.push(`❌ Pagination error at skip page ${i}: ${r.status}`);
        return res.status(500).json({ log, summary, nextOffset: null });
      }
      const linkHeader = r.headers.get("Link");
      const next = parseNextLink(linkHeader);
      if (!next) {
        log.push(`✅ All done! Full catalog processed.`);
        return res.status(200).json({ log, summary, nextOffset: null });
      }
      nextUrl = next;
      pageIndex++;
    }

    // Fetch one page of products
    const productsRes = await fetch(nextUrl, { headers: SHOPIFY_HEADERS });
    if (!productsRes.ok) {
      log.push(`❌ Failed to fetch products: ${productsRes.status}`);
      return res.status(500).json({ log, summary, nextOffset: null });
    }

    const linkHeader = productsRes.headers.get("Link");
    const nextPageUrl = parseNextLink(linkHeader);

    const productsJson = await productsRes.json();
    const products = productsJson.products ?? [];

    if (products.length === 0) {
      log.push(`✅ All done! Full catalog processed.`);
      return res.status(200).json({ log, summary, nextOffset: null });
    }

    log.push(`📦 Processing ${products.length} products (offset=${startOffset})`);

    for (const product of products) {
      summary.scanned++;
      const images = product.images ?? [];

      if (images.length === 0) {
        summary.skipped++;
        continue;
      }

      for (const image of images) {
        const alt = image.alt ?? "";
        const isEmpty   = alt.trim() === "";
        const isFrench  = !isEmpty && looksNonEnglish(alt);

        if (!isEmpty && !isFrench) {
          summary.skipped++;
          continue;
        }

        try {
          const newAlt = await generateAltText(product.title, alt, isFrench);

          if (isFrench) {
            log.push(`  🌐 [translate] "${product.title}" image ${image.id} — "${alt}" → "${newAlt}"`);
          } else {
            log.push(`  ✏️ [generate]  "${product.title}" image ${image.id} — (empty) → "${newAlt}"`);
          }

          if (!isDryRun) {
            await sleep(500);
            const updateRes = await fetch(
              `${BASE}/products/${product.id}/images/${image.id}.json`,
              {
                method: "PUT",
                headers: SHOPIFY_HEADERS,
                body: JSON.stringify({ image: { id: image.id, alt: newAlt } }),
              }
            );
            if (!updateRes.ok) {
              const errText = await updateRes.text();
              log.push(`  ❌ Failed to update image ${image.id}: ${updateRes.status} ${errText}`);
              summary.errors++;
              continue;
            }
          }

          summary.fixed++;
        } catch (err) {
          log.push(`  ❌ Error on image ${image.id}: ${err.message}`);
          summary.errors++;
        }
      }
    }

    const nextOffset = nextPageUrl ? startOffset + limit : null;

    log.push(`📊 Done — scanned=${summary.scanned} fixed=${summary.fixed} skipped=${summary.skipped} errors=${summary.errors}`);
    if (nextOffset != null) {
      log.push(`Next chunk starts at offset=${nextOffset}`);
    } else {
      log.push(`✅ All done! Full catalog processed.`);
    }

    return res.status(200).json({ log, summary, nextOffset });
  } catch (err) {
    log.push(`❌ Unexpected error: ${err.message}`);
    return res.status(500).json({ log, summary, nextOffset: null });
  }
}
