const STORE = process.env.SHOPIFY_STORE_DOMAIN;
const TOKEN = process.env.SHOPIFY_ADMIN_ACCESS_TOKEN;
const API_VERSION = "2024-01";
const BASE = `https://${STORE}/admin/api/${API_VERSION}`;
const SHOPIFY_HEADERS = {
  "X-Shopify-Access-Token": TOKEN,
  "Content-Type": "application/json",
};

const FRENCH_RE = /[àâäéèêëîïôùûüçœ]|\b(accueil|magasinez|pneus|hiver|toutes|saisons|livraison|rapide|achetez|conçu|idéal|fiable|qualité|voiture|camion|notre|nous|pour|chez|les|des|avec|une|sur|par)\b/i;

function isFrench(str) {
  return FRENCH_RE.test(str ?? "");
}

function stripHtml(html) {
  return (html ?? "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

function reinjectTranslation(originalHtml, translatedText) {
  // Replace all text nodes within the HTML with the translated text as a whole
  // Strategy: wrap entire content if no tags, or replace the text content
  if (!/<[^>]+>/.test(originalHtml)) {
    return translatedText;
  }
  // Simple strategy: replace text content between tags
  let result = originalHtml;
  let plainText = stripHtml(originalHtml);
  if (plainText && translatedText) {
    // Replace text runs in the HTML with translated equivalents word-by-word is too fragile
    // Instead, wrap translated text preserving the outer tag structure
    // Find the outermost tag and put translated text inside
    const outerTagMatch = result.match(/^(<[^>]+>)([\s\S]*?)(<\/[^>]+>)$/);
    if (outerTagMatch) {
      return `${outerTagMatch[1]}${translatedText}${outerTagMatch[3]}`;
    }
    // Fallback: just return translated text
    return translatedText;
  }
  return translatedText || originalHtml;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function shopifyGet(path) {
  const res = await fetch(`${BASE}${path}`, { headers: SHOPIFY_HEADERS });
  if (res.status === 429) {
    await sleep(2000);
    return shopifyGet(path);
  }
  return res.json();
}

async function shopifyPut(path, body) {
  await sleep(500);
  const res = await fetch(`${BASE}${path}`, {
    method: "PUT",
    headers: SHOPIFY_HEADERS,
    body: JSON.stringify(body),
  });
  if (res.status === 429) {
    await sleep(2000);
    return shopifyPut(path, body);
  }
  return res.json();
}

async function translateToEnglish(text) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 512,
      messages: [
        {
          role: "user",
          content: `Translate to English. Return only the translated text, no explanation, no markdown:\n\n${text}`,
        },
      ],
    }),
  });
  const json = await res.json();
  return json.content?.[0]?.text?.trim() ?? null;
}

// ── Scope handlers ──────────────────────────────────────────────────

async function fixMenus(dryRun, log, summary) {
  log.push("── Menus ──────────────────────────────────");
  const data = await shopifyGet("/menus.json");
  const menus = data.menus ?? [];
  log.push(`Fetched ${menus.length} menus`);

  for (const menu of menus) {
    let menuModified = false;
    const updatedItems = [];

    for (const item of menu.items ?? []) {
      summary.scanned++;
      if (isFrench(item.title)) {
        const translated = await translateToEnglish(item.title);
        if (translated && translated !== item.title) {
          log.push(`[MENU] "${item.title}" → "${translated}"`);
          updatedItems.push({ ...item, title: translated });
          menuModified = true;
          summary.fixed++;
        } else {
          log.push(`[MENU] "${item.title}" — translation unchanged, skipping`);
          updatedItems.push(item);
          summary.skipped++;
        }
      } else {
        updatedItems.push(item);
        summary.skipped++;
      }
    }

    if (menuModified && !dryRun) {
      try {
        await shopifyPut(`/menus/${menu.id}.json`, {
          menu: { id: menu.id, handle: menu.handle, title: menu.title, items: updatedItems },
        });
        log.push(`[MENU] Updated menu "${menu.title}" (id=${menu.id})`);
      } catch (e) {
        log.push(`[MENU] ERROR updating menu ${menu.id}: ${e.message}`);
        summary.errors++;
      }
    } else if (menuModified && dryRun) {
      log.push(`[MENU] [DRY RUN] Would update menu "${menu.title}"`);
    }
  }
}

async function fixPages(dryRun, log, summary) {
  log.push("── Pages ──────────────────────────────────");
  const data = await shopifyGet("/pages.json?limit=250");
  const pages = data.pages ?? [];
  log.push(`Fetched ${pages.length} pages`);

  for (const page of pages) {
    summary.scanned++;
    const titleFrench = isFrench(page.title);
    const bodyFrench = isFrench(stripHtml(page.body_html));

    if (!titleFrench && !bodyFrench) {
      summary.skipped++;
      continue;
    }

    const updates = {};

    if (titleFrench) {
      const translated = await translateToEnglish(page.title);
      if (translated && translated !== page.title) {
        log.push(`[PAGE] title: "${page.title}" → "${translated}"`);
        updates.title = translated;
      }
    }

    if (bodyFrench) {
      const plainText = stripHtml(page.body_html);
      const translated = await translateToEnglish(plainText);
      if (translated) {
        log.push(`[PAGE] body_html translated for "${page.title}"`);
        updates.body_html = reinjectTranslation(page.body_html, translated);
      }
    }

    if (Object.keys(updates).length === 0) {
      summary.skipped++;
      continue;
    }

    if (!dryRun) {
      try {
        await shopifyPut(`/pages/${page.id}.json`, { page: { id: page.id, ...updates } });
        log.push(`[PAGE] Updated "${page.title}" (id=${page.id})`);
        summary.fixed++;
      } catch (e) {
        log.push(`[PAGE] ERROR updating page ${page.id}: ${e.message}`);
        summary.errors++;
      }
    } else {
      log.push(`[PAGE] [DRY RUN] Would update "${page.title}"`);
      summary.fixed++;
    }
  }
}

async function fixCollections(dryRun, log, summary) {
  log.push("── Collections ────────────────────────────");

  for (const kind of ["smart_collections", "custom_collections"]) {
    const data = await shopifyGet(`/${kind}.json?limit=250`);
    const collections = data[kind] ?? [];
    log.push(`Fetched ${collections.length} ${kind}`);
    const singular = kind === "smart_collections" ? "smart_collection" : "custom_collection";
    const endpoint = kind === "smart_collections" ? "smart_collections" : "custom_collections";

    for (const col of collections) {
      summary.scanned++;
      const bodyFrench = isFrench(stripHtml(col.body_html));

      if (!bodyFrench) {
        summary.skipped++;
        continue;
      }

      const plainText = stripHtml(col.body_html);
      const translated = await translateToEnglish(plainText);

      if (!translated) {
        summary.skipped++;
        continue;
      }

      log.push(`[COLLECTION] body_html translated for "${col.title}"`);
      const updatedBodyHtml = reinjectTranslation(col.body_html, translated);

      if (!dryRun) {
        try {
          await shopifyPut(`/${endpoint}/${col.id}.json`, {
            [singular]: { id: col.id, body_html: updatedBodyHtml },
          });
          log.push(`[COLLECTION] Updated "${col.title}" (id=${col.id})`);
          summary.fixed++;
        } catch (e) {
          log.push(`[COLLECTION] ERROR updating ${col.id}: ${e.message}`);
          summary.errors++;
        }
      } else {
        log.push(`[COLLECTION] [DRY RUN] Would update "${col.title}"`);
        summary.fixed++;
      }
    }
  }
}

async function fixPolicies(dryRun, log, summary) {
  log.push("── Policies ───────────────────────────────");
  const data = await shopifyGet("/policies.json");
  const policies = data.policies ?? [];
  log.push(`Fetched ${policies.length} policies`);

  for (const policy of policies) {
    summary.scanned++;
    const bodyFrench = isFrench(stripHtml(policy.body));

    if (!bodyFrench) {
      summary.skipped++;
      continue;
    }

    const plainText = stripHtml(policy.body);
    const translated = await translateToEnglish(plainText);

    if (!translated) {
      summary.skipped++;
      continue;
    }

    log.push(`[POLICY] "${policy.title}" body translated`);
    const updatedBody = reinjectTranslation(policy.body, translated);

    if (!dryRun) {
      try {
        await shopifyPut(`/policies/${policy.id}.json`, {
          policy: { id: policy.id, body: updatedBody },
        });
        log.push(`[POLICY] Updated "${policy.title}" (id=${policy.id})`);
        summary.fixed++;
      } catch (e) {
        log.push(`[POLICY] ERROR updating policy ${policy.id}: ${e.message}`);
        summary.errors++;
      }
    } else {
      log.push(`[POLICY] [DRY RUN] Would update "${policy.title}"`);
      summary.fixed++;
    }
  }
}

async function fixNotifications(dryRun, log, summary) {
  log.push("── Notifications ──────────────────────────");
  const data = await shopifyGet("/notifications.json");
  const notifications = data.notifications ?? [];
  log.push(`Fetched ${notifications.length} notifications`);

  for (const notif of notifications) {
    summary.scanned++;
    const subjectFrench = isFrench(notif.subject);

    if (!subjectFrench) {
      summary.skipped++;
      continue;
    }

    const translated = await translateToEnglish(notif.subject);

    if (!translated || translated === notif.subject) {
      summary.skipped++;
      continue;
    }

    log.push(`[NOTIF] subject: "${notif.subject}" → "${translated}"`);

    if (!dryRun) {
      try {
        await shopifyPut(`/notifications/${notif.id}.json`, {
          notification: { id: notif.id, subject: translated },
        });
        log.push(`[NOTIF] Updated "${notif.title}" (id=${notif.id})`);
        summary.fixed++;
      } catch (e) {
        log.push(`[NOTIF] ERROR updating notification ${notif.id}: ${e.message}`);
        summary.errors++;
      }
    } else {
      log.push(`[NOTIF] [DRY RUN] Would update "${notif.title}"`);
      summary.fixed++;
    }
  }
}

// ── Main handler ────────────────────────────────────────────────────

export default async function handler(req, res) {
  const { dryRun: dryRunParam, scope = "all" } = req.query ?? {};
  const dryRun = dryRunParam === "true";

  const log = [];
  const summary = { scanned: 0, fixed: 0, skipped: 0, errors: 0 };

  log.push(`▶ fixFrenchContent — scope=${scope}${dryRun ? " [DRY RUN]" : " [LIVE]"}`);

  try {
    const runAll = scope === "all";

    if (runAll || scope === "menus") await fixMenus(dryRun, log, summary);
    if (runAll || scope === "pages") await fixPages(dryRun, log, summary);
    if (runAll || scope === "collections") await fixCollections(dryRun, log, summary);
    if (runAll || scope === "policies") await fixPolicies(dryRun, log, summary);
    if (runAll || scope === "notifications") await fixNotifications(dryRun, log, summary);

    log.push(`✅ Done — scanned=${summary.scanned} fixed=${summary.fixed} skipped=${summary.skipped} errors=${summary.errors}`);
  } catch (err) {
    log.push(`❌ Fatal error: ${err.message}`);
    summary.errors++;
  }

  res.status(200).json({ log, summary });
}
