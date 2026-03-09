const STORE       = process.env.SHOPIFY_STORE_DOMAIN;
const TOKEN       = process.env.SHOPIFY_ADMIN_ACCESS_TOKEN;
const API_VERSION = "2024-01";
const BASE        = `https://${STORE}/admin/api/${API_VERSION}`;
const SHOPIFY_HEADERS = {
  "X-Shopify-Access-Token": TOKEN,
  "Content-Type": "application/json",
};

const FRENCH_POLICY_MAP = {
  "Politique de confidentialité": "Privacy Policy",
  "Conditions d'utilisation": "Terms of Service",
  "Politique de remboursement": "Refund Policy",
};

const TYPO_FIX_MAP = {
  "Refund Polycy": "Refund Policy",
};

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function shopifyGet(path) {
  const res = await fetch(`${BASE}${path}`, { headers: SHOPIFY_HEADERS });
  if (!res.ok) throw new Error(`GET ${path} failed: ${res.status}`);
  return res.json();
}

async function shopifyPut(path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method: "PUT",
    headers: SHOPIFY_HEADERS,
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`PUT ${path} failed: ${res.status} ${text}`);
  }
  return res.json();
}

async function fixFooterLegal(isDryRun, log, summary) {
  // Search metafields for the French legal line
  const FRENCH_LEGAL = "GCITires.Com est un site web propriété";
  const ENGLISH_LEGAL = "GCITires.com is a website owned by Groupe de Commerce Intercontinental Inc. NEQ: 1178796265";

  try {
    // Try shop metafields
    const metafieldsData = await shopifyGet("/metafields.json?limit=250");
    const metafields = metafieldsData.metafields ?? [];

    let found = false;
    for (const mf of metafields) {
      const val = mf.value ?? "";
      if (val.includes(FRENCH_LEGAL)) {
        found = true;
        const newVal = val.replace(FRENCH_LEGAL, ENGLISH_LEGAL);
        log.push(`  📝 [metafield] id=${mf.id} namespace=${mf.namespace} key=${mf.key}`);
        log.push(`     Before: "${val.slice(0, 80)}…"`);
        log.push(`     After:  "${newVal.slice(0, 80)}…"`);
        if (!isDryRun) {
          await shopifyPut(`/metafields/${mf.id}.json`, { metafield: { id: mf.id, value: newVal, type: mf.type } });
          log.push(`     ✅ Updated`);
        } else {
          log.push(`     🔍 [dry run] skipped write`);
        }
        summary.fixed++;
      }
    }

    if (!found) {
      log.push(`  ℹ️  Footer legal line not found in shop metafields (may be in theme settings)`);
      summary.skipped++;
    }
  } catch (err) {
    log.push(`  ❌ Error fixing footer legal: ${err.message}`);
    summary.errors++;
  }
}

async function fixMenuItems(isDryRun, log, summary) {
  try {
    const menusData = await shopifyGet("/menus.json");
    const menus = menusData.custom_collections ?? menusData.menus ?? [];

    if (menus.length === 0) {
      log.push(`  ℹ️  No menus returned from /menus.json`);
      summary.skipped++;
      return;
    }

    for (const menu of menus) {
      const items = menu.items ?? [];
      let menuChanged = false;
      const updatedItems = items.map(item => {
        const title = item.title ?? "";

        // Check French → English mapping
        if (FRENCH_POLICY_MAP[title]) {
          const newTitle = FRENCH_POLICY_MAP[title];
          log.push(`  🌐 [menu "${menu.handle}"] "${title}" → "${newTitle}"`);
          summary.fixed++;
          menuChanged = true;
          return { ...item, title: newTitle };
        }

        // Check typo fix
        if (TYPO_FIX_MAP[title]) {
          const newTitle = TYPO_FIX_MAP[title];
          log.push(`  ✏️  [menu "${menu.handle}"] typo fix "${title}" → "${newTitle}"`);
          summary.fixed++;
          menuChanged = true;
          return { ...item, title: newTitle };
        }

        return item;
      });

      if (menuChanged && !isDryRun) {
        await sleep(300);
        await shopifyPut(`/menus/${menu.id}.json`, { menu: { id: menu.id, items: updatedItems } });
        log.push(`  ✅ Menu "${menu.handle}" updated`);
      } else if (menuChanged && isDryRun) {
        log.push(`  🔍 [dry run] Menu "${menu.handle}" would be updated`);
      }
    }
  } catch (err) {
    log.push(`  ❌ Error fixing menus: ${err.message}`);
    summary.errors++;
  }
}

export default async function handler(req, res) {
  const { dryRun } = req.query;
  const isDryRun = dryRun === "true";

  const log     = [];
  const summary = { fixed: 0, skipped: 0, errors: 0 };

  log.push(`▶ fixThemeContent — ${isDryRun ? "[DRY RUN]" : "[LIVE]"}`);

  try {
    log.push(`\n🔍 Step 1: Fix footer legal line`);
    await fixFooterLegal(isDryRun, log, summary);

    log.push(`\n🔍 Step 2: Fix footer policy menu item labels`);
    await fixMenuItems(isDryRun, log, summary);

    log.push(`\n📊 Done — fixed=${summary.fixed} skipped=${summary.skipped} errors=${summary.errors}`);

    return res.status(200).json({ log, summary });
  } catch (err) {
    log.push(`❌ Unexpected error: ${err.message}`);
    return res.status(500).json({ log, summary });
  }
}
