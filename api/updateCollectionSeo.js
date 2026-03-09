const SEO_DATA = [
  {
    title: "Winter Tires",
    seo_title: "Winter Tires Canada | AI-Matched for Your Vehicle — GCI Tires",
    seo_description: "Browse our winter tire selection, AI-matched to your exact vehicle and driving conditions. Designed for Quebec winters. Fast delivery across Canada."
  },
  {
    title: "Summer Tires",
    seo_title: "Summer Tires Canada | AI-Recommended High-Performance Tires — GCI Tires",
    seo_description: "Shop summer tires recommended by AI for your vehicle. Maximum grip on dry and wet pavement. Order online with fast delivery across Canada."
  },
  {
    title: "All-Season Tires",
    seo_title: "All-Season Tires Canada | AI-Fitted for Year-Round Driving — GCI Tires",
    seo_description: "Discover all-season tires matched to your vehicle by AI. Reliable performance in rain, sun and light snow. Shop online with fast delivery across Canada."
  },
  {
    title: "All-Weather Tires",
    seo_title: "All-Weather Tires Canada | AI-Matched, 3PMSF Rated — GCI Tires",
    seo_description: "All-weather tires with the 3-Peak Mountain Snowflake rating, AI-matched to your vehicle. Drive confidently year-round. Fast delivery across Canada."
  },
  {
    title: "SUV & Crossover Tires",
    seo_title: "SUV & Crossover Tires Canada | AI-Recommended — GCI Tires",
    seo_description: "Shop SUV and crossover tires selected by AI for your exact make and model. Winter, summer and all-season options. Fast delivery across Canada."
  },
  {
    title: "Light Truck Tires",
    seo_title: "Light Truck Tires Canada | AI-Matched for Trucks & Vans — GCI Tires",
    seo_description: "Browse light truck tires AI-matched to your vehicle. Built for durability and load capacity. Winter, all-season and all-terrain options. Fast delivery across Canada."
  },
  {
    title: "All-Terrain Tires",
    seo_title: "All-Terrain Tires Canada | AI-Matched for Off-Road & Highway — GCI Tires",
    seo_description: "Shop all-terrain tires recommended by AI for your truck or SUV. Built for off-road adventure and highway driving. Fast delivery across Canada at GCI Tires."
  },
  {
    title: "Passenger Car Tires",
    seo_title: "Passenger Car Tires Canada | AI-Matched for Your Car — GCI Tires",
    seo_description: "Find the right passenger car tire with AI. Winter, all-season and summer options matched to your exact vehicle. Competitive prices and fast delivery across Canada."
  },
  {
    title: "Cooper Tires",
    seo_title: "Cooper Tires Canada | AI-Matched Cooper Tires Online — GCI Tires",
    seo_description: "Shop the full Cooper tire lineup, AI-matched to your vehicle. Winter, all-season and performance options. Competitive prices and fast delivery across Canada."
  },
  {
    title: "Nexen Tires",
    seo_title: "Nexen Tires Canada | AI-Recommended Nexen Tires Online — GCI Tires",
    seo_description: "Browse Nexen tires matched to your vehicle by AI. Reliable performance at competitive prices. Winter, all-season and summer options. Fast delivery across Canada."
  },
  {
    title: "Vredestein Tires",
    seo_title: "Vredestein Tires Canada | AI-Matched Vredestein Online — GCI Tires",
    seo_description: "Shop Vredestein tires recommended by AI for your exact vehicle. European-engineered performance for Canadian roads. Fast delivery across Canada at GCI Tires."
  }
];

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function shopifyFetch(domain, token, path) {
  const url = `https://${domain}${path}`;
  const res = await fetch(url, {
    headers: {
      "X-Shopify-Access-Token": token,
      "Content-Type": "application/json",
    },
  });
  if (!res.ok) {
    throw new Error(`GET ${path} failed: ${res.status} ${res.statusText}`);
  }
  return res.json();
}

async function shopifyPut(domain, token, path, body) {
  const url = `https://${domain}${path}`;
  const res = await fetch(url, {
    method: "PUT",
    headers: {
      "X-Shopify-Access-Token": token,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`PUT ${path} failed: ${res.status} ${res.statusText} — ${text}`);
  }
  return res.json();
}

export default async function handler(req, res) {
  const domain = process.env.SHOPIFY_STORE_DOMAIN;
  const token = process.env.SHOPIFY_ADMIN_ACCESS_TOKEN;

  if (!domain || !token) {
    return res.status(500).json({ error: "Missing SHOPIFY_STORE_DOMAIN or SHOPIFY_ADMIN_ACCESS_TOKEN env vars." });
  }

  const dryRun = req.query.dryRun === "true";
  const log = [];
  const summary = { updated: 0, skipped: 0, errors: 0 };

  log.push(`🚀 Collection SEO Updater — ${dryRun ? "DRY RUN (no writes)" : "LIVE MODE"}`);
  log.push(`📋 ${SEO_DATA.length} collections to process`);

  // Fetch all collections (custom + smart)
  let allCollections = [];
  try {
    const [customData, smartData] = await Promise.all([
      shopifyFetch(domain, token, "/admin/api/2024-01/custom_collections.json?limit=250"),
      shopifyFetch(domain, token, "/admin/api/2024-01/smart_collections.json?limit=250"),
    ]);

    const customCollections = (customData.custom_collections || []).map(c => ({ ...c, _type: "custom_collections" }));
    const smartCollections = (smartData.smart_collections || []).map(c => ({ ...c, _type: "smart_collections" }));
    allCollections = [...customCollections, ...smartCollections];

    log.push(`📦 Found ${customCollections.length} custom + ${smartCollections.length} smart collections (${allCollections.length} total)`);
  } catch (err) {
    log.push(`❌ Failed to fetch collections: ${err.message}`);
    return res.status(500).json({ log, summary, error: err.message });
  }

  // Build a title → collection map
  const collectionMap = {};
  for (const col of allCollections) {
    collectionMap[col.title] = col;
  }

  // Process each SEO entry
  for (const entry of SEO_DATA) {
    const col = collectionMap[entry.title];

    if (!col) {
      log.push(`⚠️  [SKIP] "${entry.title}" — no matching collection found`);
      summary.skipped++;
      continue;
    }

    if (dryRun) {
      log.push(`🔍 [DRY RUN] "${entry.title}" (id=${col.id}, type=${col._type})`);
      log.push(`   seo_title:       ${entry.seo_title}`);
      log.push(`   seo_description: ${entry.seo_description}`);
      summary.updated++;
      continue;
    }

    try {
      const putPath = `/admin/api/2024-01/${col._type}/${col.id}.json`;
      const collectionKey = col._type === "smart_collections" ? "smart_collection" : "custom_collection";
      const payload = {
        [collectionKey]: {
          id: col.id,
          title: col.title,
          body_html: col.body_html || "",
          metafields_global_title_tag: entry.seo_title,
          metafields_global_description_tag: entry.seo_description,
        },
      };

      await shopifyPut(domain, token, putPath, payload);
      log.push(`✅ Updated "${entry.title}" (id=${col.id})`);
      summary.updated++;

      await delay(500);
    } catch (err) {
      log.push(`❌ Error updating "${entry.title}": ${err.message}`);
      summary.errors++;
    }
  }

  log.push(`──────────────────────────────────────`);
  log.push(`📊 Summary: ${summary.updated} updated, ${summary.skipped} skipped, ${summary.errors} errors`);
  if (!dryRun && summary.errors === 0) {
    log.push(`✅ All done!`);
  }

  return res.status(200).json({ log, summary });
}
