const STORE = process.env.SHOPIFY_STORE_DOMAIN;
const TOKEN = process.env.SHOPIFY_ADMIN_ACCESS_TOKEN;
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const API_VERSION = "2024-01";
const BASE = `https://${STORE}/admin/api/${API_VERSION}`;
const SHOPIFY_HEADERS = {
  "X-Shopify-Access-Token": TOKEN,
  "Content-Type": "application/json",
};

const FRENCH_RE = /[àâäéèêëîïôùûüçœ]|\b(accueil|magasinez|pneus|hiver|toutes|saisons|livraison|rapide|achetez|conçu|idéal|fiable|qualité|voiture|camion|notre|nous|pour|chez|les|des|avec|une|sur|par|pneu|quatre|hiver|performant|idéaux)\b/i;

function looksNonEnglish(str) {
  return FRENCH_RE.test(str ?? "");
}

function stripHtml(html) {
  return (html ?? "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function translateWithClaude(text) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": ANTHROPIC_KEY,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1024,
      messages: [
        {
          role: "user",
          content: `Translate the following product description to English. Return only the translated text in plain sentences, no markdown, no bullet points:\n\n${text}`,
        },
      ],
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Claude API error ${res.status}: ${err}`);
  }

  const json = await res.json();
  return json.content?.[0]?.text?.trim() ?? "";
}

async function fetchProductPage(url) {
  const res = await fetch(url, { headers: SHOPIFY_HEADERS });
  if (res.status === 429) {
    await sleep(2000);
    return fetchProductPage(url);
  }
  const linkHeader = res.headers.get("link") ?? "";
  const json = await res.json();
  return { products: json.products ?? [], linkHeader };
}

async function updateProductBodyHtml(id, bodyHtml) {
  await sleep(500);
  const res = await fetch(`${BASE}/products/${id}.json`, {
    method: "PUT",
    headers: SHOPIFY_HEADERS,
    body: JSON.stringify({ product: { id, body_html: bodyHtml } }),
  });
  if (res.status === 429) {
    await sleep(2000);
    return updateProductBodyHtml(id, bodyHtml);
  }
  return res.json();
}

function parseNextLink(linkHeader) {
  if (!linkHeader) return null;
  const parts = linkHeader.split(",");
  for (const part of parts) {
    const [urlPart, relPart] = part.split(";").map((s) => s.trim());
    if (relPart === 'rel="next"') {
      return urlPart.replace(/^<|>$/g, "");
    }
  }
  return null;
}

export default async function handler(req, res) {
  const { searchParams } = new URL(req.url, `http://${req.headers.host}`);
  const dryRun = searchParams.get("dryRun") === "true";
  const chunkSize = Math.min(250, Math.max(1, parseInt(searchParams.get("chunkSize") ?? "20", 10)));
  const offset = Math.max(0, parseInt(searchParams.get("offset") ?? "0", 10));

  const log = [];
  const summary = { scanned: 0, translated: 0, skipped: 0, errors: 0 };

  log.push(`▶ Starting${dryRun ? " [DRY RUN]" : ""} — chunkSize=${chunkSize} offset=${offset}`);

  try {
    // Paginate to the offset position using cursor pagination
    let nextUrl = `${BASE}/products.json?limit=250&fields=id,title,body_html`;
    let allProducts = [];
    let totalFetched = 0;

    // Collect products, skipping until we reach offset
    while (nextUrl && allProducts.length < chunkSize) {
      const { products, linkHeader } = await fetchProductPage(nextUrl);
      if (products.length === 0) break;

      for (const product of products) {
        if (totalFetched < offset) {
          totalFetched++;
          continue;
        }
        allProducts.push(product);
        totalFetched++;
        if (allProducts.length >= chunkSize) break;
      }

      if (allProducts.length >= chunkSize) break;
      nextUrl = parseNextLink(linkHeader);
    }

    const chunk = allProducts;
    log.push(`📦 Fetched ${chunk.length} products (offset=${offset})`);

    let nextOffset = null;
    if (chunk.length >= chunkSize) {
      nextOffset = offset + chunk.length;
    }

    for (const product of chunk) {
      summary.scanned++;
      const plainText = stripHtml(product.body_html ?? "");

      if (!plainText || !looksNonEnglish(plainText)) {
        summary.skipped++;
        log.push(`  ⬜ [${product.id}] "${product.title}" — skipped (English or empty)`);
        continue;
      }

      log.push(`  🔍 [${product.id}] "${product.title}" — French detected`);

      if (dryRun) {
        summary.translated++;
        log.push(`  🔍 [DRY RUN] Would translate: "${plainText.slice(0, 80)}…"`);
        continue;
      }

      try {
        const translated = await translateWithClaude(plainText);
        if (!translated) {
          summary.errors++;
          log.push(`  ❌ [${product.id}] Empty translation returned`);
          continue;
        }

        const newBodyHtml = `<p>${translated}</p>`;
        await updateProductBodyHtml(product.id, newBodyHtml);
        summary.translated++;
        log.push(`  ✅ [${product.id}] Translated → "${translated.slice(0, 80)}…"`);
      } catch (err) {
        summary.errors++;
        log.push(`  ❌ [${product.id}] Error: ${err.message}`);
      }
    }

    if (chunk.length === 0) {
      log.push("✅ All done! Full catalog processed.");
      nextOffset = null;
    }

    log.push(`📊 Done — scanned=${summary.scanned} translated=${summary.translated} skipped=${summary.skipped} errors=${summary.errors}`);

    return res.status(200).json({ log, summary, nextOffset });
  } catch (err) {
    log.push(`❌ Fatal error: ${err.message}`);
    return res.status(500).json({ log, summary, nextOffset: null });
  }
}
