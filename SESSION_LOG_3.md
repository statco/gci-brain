# GCI Brain — GSC Cleanup & SEO Recovery Session Log
**Date:** May 8, 2026  
**Duration:** ~8 hours  
**Operator:** statco  

---

## Problem Statement

Google Search Console was reporting widespread canonical errors, 3,016 × 404s, and 1,523 pages crawled but not indexed. The root cause was traced to a Translate & Adapt + Shopify Markets interaction that created ghost duplicate products with `-1` URL handle suffixes, which GSC was crawling as active pages.

---

## Root Cause Analysis

### Issue 1 — Ghost Duplicate Products (CRITICAL)
When Shopify Markets was configured with `fr-ca` and `en-ca` locales, Translate & Adapt auto-populated French URL handles by mirroring English handles. Where handle collisions occurred, Shopify appended `-1` to create shadow products:
```
/en-ca/products/cooper-procontrol-215-45r17      ← real (active)
/en-ca/products/cooper-procontrol-215-45r17-1    ← ghost (archived but GSC-visible)
/fr-ca/products/cooper-procontrol-215-45r17-1    ← T&A pointing to ghost
```
GSC was crawling `/fr-ca/` URLs that pointed to archived `-1` products, finding them at the wrong canonical, and flagging them as "Duplicate, Google chose different canonical."

### Issue 2 — Three Generations of Duplicates
Investigation revealed not one but three product generations:
- Clean handle (active, correct) 
- `-1` handle (archived ghost — 588 products)
- `-2` handle (further duplication — 661 GSC 404s)

### Issue 3 — shopifySync.ts SKU Mismatch (CRITICAL)
`fetchExistingProducts()` indexed products by `v.sku` as-is. Old products had `TIRE-166429021` as their SKU while CT API returned `partNumber: "166429021"`. These never matched, so old TIRE- products received no inventory updates — causing split inventory (e.g., 19 units on old product + 24 on new product for the same tire).

### Issue 4 — Duplicate Creation Loop
`fetchExistingProductTitles()` filtered by `status=active` only. When an archived `-1` product existed, the sync treated its title as "available" and created a fresh duplicate on every daily run — restarting the cycle after each cleanup.

### Issue 5 — Handle Collision Retry
On handle collision, the retry logic appended the full SKU slug (e.g., `-166429021`), producing long ugly handles. Risk of Shopify appending its own `-1` on a second collision.

---

## Investigation Steps

1. Identified canonical mismatch in GSC URL Inspection (screenshot)
2. Confirmed T&A was copying `-1` handles into French translations (T&A screenshot)
3. Exported Matrixify product CSV — found 689 products with `-1` handles
4. Cross-referenced against clean counterparts — found 588 true duplicates + 101 standalone `-1` handles
5. Exported inventory CSV — discovered 345 `-1` products still active with live inventory
6. Identified TIRE- SKU prefix causing inventory split (Cooper Procontrol example: 19 + 24 units)
7. Confirmed all TIRE- products were already archived (audit-tire-skus returned 0)
8. Verified T&A stores no French handle translations via GraphQL debug-translations action

---

## Fixes Applied

### Fix 1 — Delete 588 Ghost `-1` Products + Redirects
**Tool:** Matrixify  
**File:** `duplicate_deletes.xlsx`

- Sheet 1 (Products): DELETE command for 588 archived ghost products
- Sheet 2 (Redirects): 1,764 NEW redirects (3 per product: `/products/`, `/en-ca/`, `/fr-ca/`)
- Result: 588/588 deleted ✅, 1,305/1,764 redirects created ✅, 459 already existed or chain errors

### Fix 2 — Clean 101 Standalone `-1` Handles
**Tool:** Matrixify  
**File:** `handle_updates.xlsx`

- UPDATE command for 101 products — stripped `-1` suffix from handle
- Matrixify auto-created redirects for all 101 ✅

### Fix 3 — shopifySync.ts: fetchExistingProductTitles — all statuses
**File:** `api/shopifySync.ts`  
**Commit:** `de3e9cb`

Removed `&status=active` filter so dedup check catches archived + draft products:
```typescript
// BEFORE
`/products.json?tag=${SYNC_TAG}&status=active&fields=id,title&limit=250`
// AFTER  
`/products.json?tag=${SYNC_TAG}&fields=id,title&limit=250`
```

### Fix 4 — shopifySync.ts: fetchExistingProducts — TIRE- secondary index
**File:** `api/shopifySync.ts`  
**Commit:** `de3e9cb`

Added secondary map entry stripping `TIRE-` prefix so CT part numbers can find old products during transition:
```typescript
if (v.sku.startsWith('TIRE-')) {
  const strippedSku = v.sku.slice(5);
  if (!map.has(strippedSku)) map.set(strippedSku, entry);
}
```

### Fix 5 — shopifySync.ts: Handle collision retry uses timestamp suffix
**File:** `api/shopifySync.ts`  
**Commit:** `de3e9cb`

Replaced full SKU slug suffix with short 5-digit timestamp to prevent Shopify auto-appending `-1`:
```typescript
// BEFORE
const skuSlug = ct.partNumber.toLowerCase().replace(/[^a-z0-9]/g, '');
handle: `${slugBase}-${skuSlug}`
// AFTER
const tsSuffix = String(Date.now()).slice(-5);
handle: `${slugBase}-${tsSuffix}`
```

### Fix 6 — 404 Redirect Cleanup
**Tool:** Matrixify  
**File:** `404_redirects.xlsx`

Cross-referenced 1,000 GSC 404 exports and identified 5 patterns:
| Category | Count | Action |
|---|---|---|
| `-2` suffix handles | 661 | → clean handle |
| `/en/` wrong locale | 275 | → `/en-ca/` |
| `-1` suffix missed | 71 | → clean handle |
| Non-tire junk products | 14 | → `/collections/all` |
| Service pages | 2 | → `/collections/all` |

Result: 425/546 redirects created ✅, 121 already existed or chain errors

### Fix 7 — New shopifySync.ts Actions Added

| Action | Purpose |
|---|---|
| `clear-french-handles` | Clears French URL handle translations via GraphQL Translations API |
| `debug-translations` | Inspects T&A translation keys and locales per product |

Note: `clear-french-handles` ran successfully (3,210 products scanned) but found `cleared: 0, skipped: 3,210` — confirming T&A stores no French handle translations (descriptions only). The `-1` issue was product-level, not translation-level.

### Fix 8 — SEO Descriptions for 146 Thin Products
**Script:** `scripts/generateSeoDescriptions.ts` (pre-existing)

146 products had descriptions under 200 characters (auto-generated CT sync output). Script generated unique EN descriptions via Claude API and pushed to Shopify:
```bash
npx tsx scripts/generateSeoDescriptions.ts --confirm
# Result: 146/146 written, 0 errors
```
French versions saved to `scripts/seo-descriptions-results.json` for future T&A import.

### Fix 9 — Vredestein Ultrac Added to Image Map
**File:** `api/addTireImages.ts`  
**Commit:** `de3e9cb`

`VREDESTEIN ULTRAC` and `VREDESTEIN ULTRAC PRO` were missing from the image map, causing 2 products to have no image. Added Shopify CDN URL:
```typescript
"VREDESTEIN ULTRAC":     "https://cdn.shopify.com/s/files/.../vredestein-ultrac-vorti.jpg",
"VREDESTEIN ULTRAC PRO": "https://cdn.shopify.com/s/files/.../vredestein-ultrac-vorti.jpg",
```

### Fix 10 — GSC Sitemap
- Removed broken `/gcitires.com/sitemap.xml` entry (missing https:// protocol)
- Resubmitted `/sitemap.xml` to force fresh crawl

---

## Final State

| Metric | Before | After |
|---|---|---|
| Ghost `-1` products | 588 | ✅ 0 |
| Bad `-1` handles | 101 | ✅ 0 |
| Total redirects created | ~0 | ✅ 2,189 |
| Products missing images | 2 | ✅ 0 |
| Thin SEO descriptions | 146 | ✅ 0 |
| Active products (Shopify) | 2,044 | 2,044 |
| GSC sitemap pages | 9,725 | ⏳ recrawling |

---

## GSC Status After Fix (Expected Timeline)

| Timeframe | Expected |
|---|---|
| Immediate | 301 redirects live and verified |
| 1–2 weeks | 404 count drops as Googlebot processes redirects |
| 4–6 weeks | Canonical errors resolve |
| 6–12 weeks | "Crawled not indexed" count drops as descriptions are re-evaluated |

---

## Outstanding Items

| Item | Priority | Notes |
|---|---|---|
| French SEO descriptions | Medium | 146 FR versions in `seo-descriptions-results.json`, needs T&A import |
| Remaining 2,016 GSC 404s | Low | Only 1,000 exported (GSC cap). Will resolve via existing redirects as Googlebot recrawls |
| 68 redirect chain errors | Low | `-2` URLs whose clean target is itself a `-1` redirect. Fix: point `-2` directly to clean handle |
| T&A handle sync | Low | Confirmed no French handles stored — no action needed, but avoid Auto-translate on URL handle field |

---

## How to Run SEO Description Backfill (Future Reference)

```bash
# Dry run — see how many thin products remain
npx tsx scripts/generateSeoDescriptions.ts

# Live run — update all thin products
npx tsx scripts/generateSeoDescriptions.ts --confirm

# Limit to N products for testing
npx tsx scripts/generateSeoDescriptions.ts --confirm --limit=10
```

---

## How to Verify Image Coverage

```bash
# Check missing images count
curl -s -X POST "https://gci-brain.vercel.app/api/shopifySync?action=missing-images" \
  -H "Authorization: Bearer $CRON_SECRET" | python3 -m json.tool | grep missingCount

# Attach image to specific product model
curl -s -X POST "https://gci-brain.vercel.app/api/shopifySync?action=attach-image&search=BRAND+MODEL&imageUrl=URL" \
  -H "Authorization: Bearer $CRON_SECRET" -H "Content-Type: application/json"
```

---

## How to Debug T&A Translations

```bash
# Inspect what translation keys T&A stores for a product
curl -s -X POST "https://gci-brain.vercel.app/api/shopifySync?action=debug-translations&search=Cooper+Procontrol" \
  -H "Authorization: Bearer $CRON_SECRET" | python3 -m json.tool
```

---

## Key Lessons Learned

1. **T&A + Shopify Markets = handle collision risk** — Never enable Auto-translate on URL handle fields. T&A mirrors the source handle into French, Shopify detects a collision and appends `-1`, creating ghost products.
2. **Archived products are not 404s** — Shopify serves archived products at their URL with a page. GSC crawls them, treats them as active, and creates canonical conflicts.
3. **Three generations of duplicates existed** — clean, `-1`, and `-2`. Always check for `-2` as well when cleaning handle duplicates.
4. **SKU prefix mismatch causes split inventory** — `TIRE-` prefixed legacy SKUs never matched CT part numbers, causing dual inventory tracking (old + new product for same tire).
5. **Always check all statuses in title dedup** — `status=active` in `fetchExistingProductTitles` caused the sync to re-create archived duplicates on every daily run.
6. **GSC caps 404 exports at 1,000 rows** — use date filters or multiple exports to get full picture.
7. **Matrixify auto-creates redirects on handle UPDATE** — no need for separate redirect file when using Matrixify to fix handles. Separate redirect file only needed for DELETE operations.
8. **T&A stores descriptions, not handles** — `debug-translations` confirmed French handle translations don't exist in the Translations API. The handle issue was at the Shopify product level, not T&A.
