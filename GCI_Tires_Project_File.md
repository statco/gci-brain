# GCI Tires — Project File

Store: gcitires.ca | Shopify: gcitires-ca.myshopify.com | Repo: gci-brain (Vercel)

---

## Top of Mind / Status

| Area | Status |
|------|--------|
| GMC feed | ✅ Live at `/api/feed/gmc` — images self-healing via `lib/image-cdn.ts` |
| GMC account | ⛔ Suspended (account 5729793911) — Over capacity = account-level block. Reinstatement blocked on REQ commercial name update |
| SEO descriptions | ✅ Fixed May 8 2026 — all 2,183 products backfilled, English-only, ≤155 chars |
| Product images | ✅ 3,361/3,361 products have images as of May 8 2026. Vredestein Ultrac + Ultrac Pro added to image map |
| Store content | ✅ All 6 policy pages + About page translated to French in Translate & Adapt |
| ct-sync pipeline | ✅ `"type": "module"` removed from package.json — pipeline stable |
| KENDA brand | 🔲 Confirmed in CT API catalog — VENDOR_MAP patch ready in CLAUDE.md (Step 1), not yet deployed |
| GSC cleanup | ✅ May 8–14 2026 — ghost products deleted, handles cleaned, 2,162+ redirects live, canonical fix applied |
| Hero claims | ✅ Updated May 8 2026 — removed "Best price guarantee", bilingual EN/FR via locale check |
| 404 auto-redirect | ✅ May 14 2026 — smart redirect script in main-404.liquid handles -1/-2/-3 and compact handles permanently |

---

## Foundational

- **Shopify store domain:** `gcitires-ca.myshopify.com` (not `gcitires.myshopify.com` — old domain, causes 404s)
- **Shopify token env var:** `SHOPIFY_ADMIN_ACCESS_TOKEN` (not `SHOPIFY_ADMIN_TOKEN` — several scripts used the wrong name historically)
- **`"type": "module"`** must NOT be in root `package.json` — was reintroduced at some point and broke the ct-sync pipeline; confirm it stays removed after any `npm install` or package.json edits
- **Tire Rack CDN blocked at WAF level** — hotlink protection defeats both URL-based Shopify image import and Node.js fetch with User-Agent spoofing. Do not use Tire Rack URLs as image sources; use Shopify CDN URLs from the same store instead
- **Vercel project:** `gci-brain` — production URL `gci-brain.vercel.app`; functions have `maxDuration: 300`
- **Active product count (as of May 8 2026):** 2,044 active (after deletion of 588 ghost -1 products)

---

## GMC (Google Merchant Center)

- **Feed URL (live):** `gci-brain.vercel.app/api/feed/gmc`
- `cachedResolveImageLink` integrated into `api/feed/gmc/index.ts` — feed now self-heals missing images at generation time via `lib/image-cdn.ts`
- **GMC account 5729793911 suspended** — "Over capacity" = account-level block, not a feed issue. Reinstatement blocked on REQ commercial name update (GCI Tires must appear officially). Submit via GMC Help form once REQ confirms — do **NOT** use the in-dashboard reinstatement button (it is locked/non-functional at this suspension level)
- **Feed audit May 8 2026:** 2,183 products, 0 missing images after fix
- **May 9 2026 — Removed `quantity` column** from feed (`api/feed/gmc/index.ts` lines 19 and 234). Not a recognized field by Google or Microsoft Merchant Center. Feed now 19 columns. Microsoft Merchant Center (account G120NC19) showing 2,183 processed / 0 rejected / 0 warnings after fix
- **Hero claims updated May 8 2026** — removed "Best price guarantee" (GMC policy risk). New badges: "Free shipping across Canada", "AI-powered tire matching", "Backed by 100+ years of expertise"

---

## SEO

- `api/updateSeo.ts` / `generateAiCopy()` fixed — was generating bilingual EN+FR content into a single `description_tag` field, causing 700+ char meta descriptions that violated GMC policy and degraded search snippets
- Fixed to English-only, 155 char max, format: `The [title] delivers [benefit] for [vehicle] drivers in Canada. Free shipping Canada-wide.`
- Both `generateAiCopy()` prompt and `metaDescriptionFallback()` updated to match new format
- **Full backfill run May 8 2026:** 2,183 products updated, 0 errors — script: `scripts/runSeoBackfill.ts`

### GSC Cleanup — May 8–14 2026

**Root cause:** Translate & Adapt + Shopify Markets handle collision created ghost duplicate products with `-1`, `-2`, `-3` URL suffixes. GSC was crawling archived ghost products and flagging canonical conflicts.

**Fixes applied:**

| Fix | Detail |
|-----|--------|
| 588 ghost `-1` products deleted | Matrixify — `duplicate_deletes.xlsx` |
| 101 bad `-1` handles cleaned | Matrixify — `handle_updates.xlsx` |
| 2,162+ redirects created | 3 batches: `duplicate_deletes`, `404_redirects`, `404_redirects_v2` |
| Canonical tag fixed | `theme.liquid` — `{{ canonical_url \| split: '?' \| first }}` strips query params |
| 146 thin SEO descriptions updated | `scripts/generateSeoDescriptions.ts --confirm` |
| Smart 404 redirect script | `sections/main-404.liquid` — handles `-1/-2/-3` and compact handles permanently |
| `shopifySync.ts` patched (3 fixes) | See shopifySync patches section below |

**shopifySync.ts patches (commit de3e9cb):**
1. `fetchExistingProductTitles` — removed `&status=active` so dedup catches archived products, preventing daily sync from re-creating ghost duplicates
2. `fetchExistingProducts` — added secondary index stripping `TIRE-` prefix so CT part numbers match old legacy products during transition
3. `runSync` create loop — handle collision retry now uses 5-digit timestamp suffix instead of SKU slug, preventing Shopify auto-appending `-1`

**GSC metrics (May 11 2026 vs May 8 2026):**
| Metric | Before | After |
|--------|--------|-------|
| Crawled not indexed | 1,523 | 1,035 ✅ (-488) |
| Page with redirect | 4,396 | 6,762 (expected — Google processing redirects) |
| Not found 404 | 3,016 | 3,056 (new patterns being addressed) |

**Permanent 404 fix — `sections/main-404.liquid`:**
```javascript
// Fires on any 404 — strips numeric suffixes and redirects compact handles
var suffixMatch = path.match(/^(\/(?:en-ca|fr-ca)\/products\/.+?)(-\d+)$/);
if (suffixMatch) { window.location.replace(suffixMatch[1]); return; }

var compactMatch = path.match(/\/products\/.+-\d{7}-r$/);
if (compactMatch) { window.location.replace(locale + '/collections/all'); return; }
```
This handles all future `-1/-2/-3` and old compact size format URLs automatically — no manual Matrixify batches needed.

---

## Catalog

- **89 missing images (Vredestein/Ovation):** Identified via Shopify Admin — products in the same ct-sync batch had no images. Fixed via `scripts/backfillImages-direct.ts` using existing Shopify CDN URLs from same-model products already on the store. Result: 89/89 uploaded, 0 failed
- **`scripts/image-map.csv` updated** with 8 model entries — all pointing to Shopify CDN URLs:
  - Vredestein: Pinza HT, Pinza AT, Hitrac All Season, Hypertrac All Season, Sprint Classic, Comtrac Cargo AS
  - Ovation: UN203, Vi-286AT
- **Vredestein Ultrac + Ultrac Pro added to `api/addTireImages.ts` (May 8 2026)** — were missing from image map, causing 2 products with no image. Added Shopify CDN URL: `cdn.shopify.com/s/files/.../vredestein-ultrac-vorti.jpg`
- **Malformed product `Vredestein Pinza At 3111/r`** corrected to `Vredestein Pinza AT 31X10.50R15` — flotation size format caused ct-sync parser failure on the `X` separator
- **`scripts/backfillImages.ts` root cause found:** `list-no-image-products` endpoint returns empty array on first page due to pagination bug — does not iterate pages. Workaround: `scripts/backfillImages-direct.ts` bypasses the endpoint and calls Shopify Admin API directly with known product IDs

---

## Store Content

- All 6 policy pages translated to French in Shopify Translate & Adapt:
  - Contact Information, Legal Notice, Privacy Policy, Return & Refund Policy, Shipping Policy, Terms of Service
- About page translated to French
- **Hero section bilingual (May 8 2026):** Trust badges and stats bar use `{% if request.locale.iso_code == 'fr' %}` liquid conditional — bypasses `| t` translation filter which was not resolving for custom sections
- **`fr-CA.json` locale file updated** with correct hero translations — `free_shipping`, `expert_installation`, `best_price`, `rating` keys updated

---

## ct-sync / Catalog Sync

_(See CLAUDE.md for pending shopifySync.ts patch instructions — Steps 1–6)_

- KENDA confirmed in CT API catalog but missing from `VENDOR_MAP` — patch ready, not yet deployed
- `fetchAllCTTires()` was hardcoded to `page:1` — pagination fix in CLAUDE.md Step 2
- Post-deploy action required: run `POST /api/shopifySync?action=debug-ct-pages` to confirm pagination and discover unmapped brands
- **New actions added to `shopifySync.ts` (May 8 2026):**
  - `clear-french-handles` — clears French URL handle translations via GraphQL Translations API
  - `debug-translations` — inspects T&A translation keys and locales per product

---

## Translate & Adapt (T&A) — Important Notes

- **Do NOT use Auto-translate on URL handle fields** — causes handle collisions → Shopify appends `-1` → ghost duplicate products → GSC canonical errors
- **French handle translations confirmed empty** — `debug-translations` action verified T&A stores no French handle translations (descriptions only). The `-1` issue was at the Shopify product level, not T&A
- **Keep T&A** for navigation, policies, checkout, and collection translations — removing it would break `/fr-ca/` market routing
- **Use `scripts/generateSeoDescriptions.ts`** for product descriptions instead of T&A Auto-translate

---

## Scripts Reference

| Script | Purpose |
|--------|---------|
| `scripts/backfillImages-direct.ts` | Upload images to 89 Vredestein/Ovation products with known Shopify IDs |
| `scripts/runSeoBackfill.ts` | Bulk-overwrite `global.description_tag` for all active tire products |
| `scripts/generateSeoDescriptions.ts` | AI-generated SEO descriptions via Claude API — run with `--confirm` to write |
| `scripts/image-map.csv` | Brand/model → image URL map used by `lib/image-cdn.ts` |
| `api/feed/gmc/index.ts` | Google Merchant Center TSV feed |
| `api/updateSeo.ts` | Per-product SEO field updater (Vercel endpoint) |
| `api/shopifySync.ts` | ct-sync pipeline — imports tires from CT API into Shopify |
| `lib/image-cdn.ts` | CDN resolver — probe chain for product images used by GMC feed |
| `api/shopifyFix.js` | Bulk product fixer — size formats, variant images, SEO translation |

**May 9 2026 — `api/shopifyFix.js` stabilized:** added `maxDuration: 300` to escape Vercel 10s default, reduced default chunkSize 20→5, fixed pagination body read (text→JSON.parse with raw fallback). Same pattern applied to `translateSeo` metafield fetch. Root cause of all prior crash-at-offset errors was timeout, not bad product data.

---

## Recurring Maintenance

| Task | Frequency | Command |
|------|-----------|---------|
| Check missing images | Monthly | `POST /api/shopifySync?action=missing-images` |
| SEO description backfill | Monthly | `npx tsx scripts/generateSeoDescriptions.ts` (dry run first) |
| GSC 404 check | Monthly | GSC → Pages → Not found (404) → Export |
| CT API brand discovery | After sync | `POST /api/shopifySync?action=debug-ct-pages` |
| Sitemap resubmit | After major changes | GSC → Sitemaps → sitemap.xml → Resubmit |