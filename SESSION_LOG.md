# GCI Brain — CT → Shopify Sync Session Log
**Date:** May 1, 2026  
**Duration:** ~4 hours  
**Operator:** statco  

---

## Problem Statement

Only 3 brands (Cooper, Nexen, Vredestein) were syncing from the Canada Tire catalog to Shopify despite 13 brands being available. The CT API was returning products across 4 pages (~2,993 tires total) but the sync code was hardcoded to fetch only page 1 (~1,000 tires), silently dropping everything else.

---

## Root Cause Analysis

### Issue 1 — CT API pagination (CRITICAL)
`fetchAllCTTires()` in `api/shopifySync.ts` had `page: 1` hardcoded in the request body with no loop. Brands that happened to appear on pages 2–4 of the CT API response were never fetched, never synced.

### Issue 2 — check-tags action (Medium)
Loop condition `while (nextUrl && found.length === 0)` stopped paginating Shopify as soon as any match was found on page 1. Products on later pages were never returned.

### Issue 3 — dedup action (Medium)
`safetyLimit = 20` capped Shopify pagination at 5,000 products (20 × 250). Silent truncation risk as catalog grows.

### Issue 4 — getLocationId() (Low)
`/locations.json?limit=10` — could silently use wrong location if store has more than 10 locations.

---

## Fixes Applied

### Fix 1 — CT API pagination loop
**File:** `api/shopifySync.ts`  
**Commit:** `b1e775a`

Added `CT_PAGE_SIZE = 50` constant and replaced single-page fetch with a `while (page <= PAGE_CAP)` loop that:
- Increments `page` on each request
- Stops when CT returns an empty page or fewer than `CT_PAGE_SIZE` items
- Has a safety cap of 100 pages (~100,000 tires max)
- Adds 300ms delay between pages to respect CT rate limits
- Logs page-by-page progress to Vercel console

### Fix 2 — check-tags full pagination
**File:** `api/shopifySync.ts`  
Changed `while (nextUrl && found.length === 0)` → `while (nextUrl)` with an explicit break once 3 matches are collected.

### Fix 3 — dedup safety limit
**File:** `api/shopifySync.ts`  
`safetyLimit` raised from `20` → `100` (covers up to 25,000 products).

### Fix 4 — getLocationId limit
**File:** `api/shopifySync.ts`  
`limit=10` → `limit=50` with a console warning if exactly 50 locations are returned. Note: set `SHOPIFY_LOCATION_ID` env var explicitly to avoid ambiguity.

### Fix 5 — VENDOR_MAP additions
**File:** `api/shopifySync.ts`  
**Commit:** `c3307f8`

Added 6 missing brands discovered via `debug-ct-pages`:
```typescript
'KENDA':      'Kenda',
'TRANSEAGLE': 'Transeagle',
'PIRELLI':    'Pirelli',
'GT RADIAL':  'GT Radial',
'FALKEN':     'Falken',
'KELLY':      'Kelly',
```

### Fix 6 — Handle collision auto-retry
**File:** `api/shopifySync.ts`  
**Commit:** `3ba146c`  
When product creation fails with `"handle has already been taken"`, automatically retries once with SKU appended to the handle slug.

---

## New Actions Added to shopifySync.ts

| Action | Purpose |
|--------|---------|
| `debug-ct-pages` | Probes CT API across all pages, returns total tires, page sizes, brand breakdown, and unmapped brands |
| `update-only` | Updates prices + inventory only, skips creates entirely |
| `update-chunk` | Accepts a list of SKUs in POST body, fetches only those from CT, updates Shopify |
| `list-skus` | Returns all Shopify product SKUs paginated (used by runUpdateOnly script) |
| `list-products` | Returns one page of 250 ct-sync products with id, title, tags, SKU |
| `audit-tire-skus` | Audits TIRE- prefixed SKUs, classifies as hasRealMatch vs trulyStale |

---

## New Scripts Added

| Script | Purpose |
|--------|---------|
| `scripts/runFullImport.ts` | Loops full-import in chunks of 10, supports `--startOffset=N` for resuming |
| `scripts/runUpdateOnly.ts` | Fetches all non-TIRE- SKUs, splits into chunks of 20, calls update-chunk for each |
| `scripts/auditTireSkus.ts` | Paginates all ct-sync products locally, classifies TIRE- SKUs |

---

## CT Catalog Discovery (debug-ct-pages results)

**Total tires:** 2,993 across 4 pages  
**Page sizes:** [1000, 1000, 942, 51]

| Brand | Tires | VENDOR_MAP Status |
|-------|-------|-------------------|
| NEXEN | 806 | ✅ Pre-existing |
| VREDESTEIN | 600 | ✅ Pre-existing |
| COOPER | 555 | ✅ Pre-existing |
| OVATION | 397 | ✅ Pre-existing |
| MINERVA | 359 | ✅ Pre-existing |
| MAXTREK | 182 | ✅ Pre-existing |
| STARFIRE | 43 | ✅ Pre-existing |
| KENDA | 37 | ✅ Added this session |
| TRANSEAGLE | 8 | ✅ Added this session |
| PIRELLI | 2 | ✅ Added this session |
| GT RADIAL | 2 | ✅ Added this session |
| FALKEN | 1 | ✅ Added this session |
| KELLY | 1 | ✅ Added this session |

---

## Import & Sync Results

### Full Import Run 1 (offset 0–250)
- Created: 1 new product
- Timed out at offset 250 — resumed with `--startOffset=260`

### Full Import Run 2 (offset 260–590)
- Created: 678 new products
- Errors: 3 (handle collisions — SKUs: 18759NXK, MW015599, 15604NXK)
- Duration: 98 calls

### Orphan Audit
- Total orphans found: 812 (all TIRE- prefixed, discontinued from CT)
- Archived: 812 in 8 batches of 100
- Redirects created: 812 (old URLs redirect to /collections/all)

### Full Import Run 3 (after archive)
- Create pool: 1,093
- Created: 506 new products
- Errors: 3 new handle collisions (SKUs: 13321NXK, AP27565018RPHBA0E, 601014)
- Auto-retry fix deployed after this run

### Update-Only Run (final)
- Legacy TIRE- SKUs filtered: 926 skipped
- Real CT SKUs updated: 1,476
- Not found in CT: 0
- Errors: 0
- Chunks: 74 × 20 SKUs

---

## Final Totals for Session

| Metric | Value |
|--------|-------|
| ✅ New products created | 1,184 |
| 🔄 Products updated | 1,476 |
| 🗑️ Orphans archived | 812 |
| 🏷️ Brands syncing | 13 (was 3) |
| 🚫 Zero stock filtered | 932 |
| ❌ Remaining errors | 3 (handle collisions) |
| 🔍 CT tires visible | 2,993 (was ~1,000) |

---

## Commits This Session

| Commit | Description |
|--------|-------------|
| `b1e775a` | Apply shopifySync pagination fixes (all 6 patches from CLAUDE.md) |
| `c3307f8` | Add 5 brands to VENDOR_MAP (Kenda, Transeagle, Pirelli, GT Radial, Falken, Kelly) |
| `ac99905` | Fix done flag in full-import — based on create pool exhaustion only |
| `f55bf1b` | Add update-chunk action + runUpdateOnly script |
| `3ba146c` | Fix: retry product create with SKU-suffixed handle on collision + filter TIRE- SKUs from update runs |

---

## Outstanding Tasks (Next Session)

### 1 — Archive 926 legacy TIRE- products
These are still visible in Shopify but receive no updates. Add an `archive-tire-skus` action to `shopifySync.ts` that archives all products whose SKU starts with `TIRE-`.

### 2 — Fix daily cron
The 3am ET Vercel cron currently calls `daily-sync` which will timeout because it fetches all 2,993 CT tires in one serverless call. Needs to be rewired to use the chunked `update-chunk` approach via a scheduled job or chained calls.

### 3 — Retry 6 handle collision SKUs
The following SKUs failed with "handle already taken" across both import runs:
- `18759NXK`
- `MW015599`  
- `15604NXK`
- `13321NXK`
- `AP27565018RPHBA0E`
- `601014`

The auto-retry fix (`3ba146c`) is now deployed. Re-run `npx tsx scripts/runFullImport.ts --startOffset=0` — these should create cleanly this time since the retry appends the SKU to the handle slug.

### 4 — Run auditCatalogCoverage periodically
The `scripts/auditTireSkus.ts` script gives a CT vs Shopify coverage comparison. Consider scheduling this weekly to catch catalog drift early.

---

## Environment Variables Required

| Variable | Purpose |
|----------|---------|
| `CT_CONSUMER_KEY` | CT OAuth consumer key |
| `CT_CONSUMER_SECRET` | CT OAuth consumer secret |
| `CT_TOKEN_ID` | CT OAuth token ID |
| `CT_TOKEN_SECRET` | CT OAuth token secret |
| `CT_CUSTOMER_NUMBER` | CT customer number (default: 19997) |
| `CT_CUSTOMER_API_TOKEN` | CT customer API token |
| `CT_USE_SANDBOX` | Set to `false` for production CT API |
| `SHOPIFY_STORE_DOMAIN` | Shopify store domain |
| `SHOPIFY_ADMIN_ACCESS_TOKEN` | Shopify admin API token |
| `SHOPIFY_LOCATION_ID` | Explicit location ID (recommended to avoid ambiguity) |
| `CRON_SECRET` | Bearer token for protecting manual API calls |

---

## How to Run a Manual Full Sync (Future Reference)

```bash
# Step 1 — Check what CT has vs what Shopify has
POST /api/shopifySync?action=debug-ct-pages

# Step 2 — Create any new products
npx tsx scripts/runFullImport.ts --startOffset=0

# Step 3 — Update prices + inventory on all existing products  
npx tsx scripts/runUpdateOnly.ts

# Step 4 — Archive any products no longer in CT
POST /api/shopifySync?action=archive-orphans&dryRun=true   # review first
POST /api/shopifySync?action=archive-orphans&dryRun=false&limit=100  # repeat until remaining=0
```
