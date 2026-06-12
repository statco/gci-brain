# GCI Tires — Walmart Project Context (v13)
**Updated:** May 31, 2026 (end of session)
**Owner:** Patrick B. Pierre — info@gcitires.ca · 438-402-6616 — President, Groupe de Commerce Intercontinental Inc.

This supersedes v12 (`GCITires_Walmart_Project_Context_12.md`). Read this first in a new session.

---

## 0. ONE-LINE STATUS

The below-cost pricing crisis is **resolved and structurally prevented**. Root cause (the cost-halving bug) is **permanently removed from production** across all 5 code paths, and a write-time band check now makes bad cost physically unwritable. The 17 bad-cost SKUs are **diagnosed (a CT data problem, not code)** and now have a **safe, band-checked write mechanism** (`costOverrides`) plus a documented source fix. Remaining work is cleanup + one operational gap (order-sync alerts), not crisis.

---

## 1. WHAT WAS FIXED THIS SESSION (all merged + deployed to `gci-brain` main)

### PR #114 — Root cause removed (the cost-halving / MSRP-substitution bug)
The original disease. `shopifySync` had a rule `cost ≥ msrp×0.90 → substitute msrp×NET_MULTIPLIER (0.50)` — i.e. when real CT cost looked "too high," it threw away the real cost and stored **half the MSRP**. This corrupted cost on ~145 SKUs and was the ultimate origin of the entire $285 saga (wrong cost → wrong floor → wrong prices).
- Rule existed in **5 paths**: `buildPayload` (create), retry-create, `runSync` update loop (2 branches), `update-chunk`, **and the daily-sync cron** (the hidden 5th path — processed non-`TIRE-` Maxtrek SKUs, wrote `parseFloat(ct.cost)||0`, would have re-poisoned the cache nightly).
- **Fix:** single shared `parseCTDealerCost()` gate on all 5 paths. Returns real CT dealer cost unmodified, or `null` if missing/non-numeric → SKU is **skipped + flagged** (added to `noCostSkus`), never substituted, never halved, never `||0`.
- Both `Cost per item` AND the `canada_tire.cost` metafield now write the same strict-parsed value on every path (previously the update paths left the metafield stale).
- `NET_MULTIPLIER` constant fully removed (declaration + last usage).
- Metafield write no longer `.catch()`-swallowed — a failure surfaces as an error instead of silently diverging the two cost fields.

### PR #115 — MSRP-ratio band enforcement (write-time guard)
Server-side band check on every write: cost must satisfy **`msrp×0.25 ≤ cost < msrp×0.90`**. Out-of-band costs are **skipped and reported in `outOfBandSkus`**, never written. Missing-MSRP tires still write through. Thresholds tunable at runtime via `COST_MSRP_FLOOR` / `COST_MSRP_CEIL` env vars (no redeploy). The `status` endpoint now reports the active band under `pricingConfig.costBand`. This is the structural backstop that makes bad cost physically unwritable.

### PR #116 — Raw CT diagnostic
Added `?raw=1` to the deployed `ct-cost-lookup` endpoint (lives at `bulkPriceUpdate?action=ct-cost-lookup`), returning the complete unmodified CT/NetSuite object per part number instead of the projected `{ctCost, msrp, name}`. Used to diagnose the 17-SKU cost problem (see §3). Accepts a comma-separated `parts=` list, so one call returns all raw objects at once.

### PR #117 — Manual dealer-cost overrides + NetSuite RESTlet fix doc
Two responses to the §3 finding that CT has no dealer-cost field:
- **`update-chunk` now accepts an optional `costOverrides` map** (CT part# → dealer cost) in the POST body. The override is the cost source when present, else CT's `cost`. **Crucially, an override is STILL band-checked** against CT's MSRP before writing — a fat-fingered/out-of-band override is skipped + flagged in `outOfBandSkus`, never written. Non-numeric values → `badOverrides`. Written to **both** Cost per item and `canada_tire.cost`. New response fields: `overridden` count, `badOverrides`. Overrides are **not persisted** (manual correction, not a new source of record). This is the safe write mechanism for §3 path 2.
- **`docs/netsuite-restlet-add-dealer-cost.md`** — SuiteScript snippet (saved-search column, `record.load`, and SuiteScript 1.0 variants) to add real cost fields (`cost` / `lastpurchaseprice` / `averagecost`) to `customscript_item_search_rl` as **distinct keys** (not pre-collapsed to `cost` — that pre-collapsing is what created the bug), plus the one-line `shopifySync` follow-up to point `parseCTDealerCost` at the new field. The RESTlet lives in NetSuite, not the repo — this is the durable source fix.
- **`docs/update-chunk-cost-overrides.md`** — override usage + response reference.

### Production-commit verification (this session)
Confirmed via Vercel deployment API that live prod = commit `23072061…` (the #115 merge), with #114 (`429943a8`) as its ancestor — so **#114/#115/#116 are all live**, and **#117 merged on top.** This settled the "are we one redeploy away?" question: the code is as ready as it gets; the 17-SKU problem is purely a data-source issue.

---

## 2. THE WALMART FLOOR (already live in gci-order-hub, from prior sessions)

`safeWalmartPrice({shopifyPrice, cost})` is the only sanctioned price-write path. `PRICE_FLOOR_MULTIPLIER = 1.15`. Returns `max(shopifyPrice, cost×1.15)` rounded to `.99`; returns **null if cost missing → caller skips the write**. Hard assertion backstop throws on any below-cost write.

**Prior session: ran `walmart-price-audit` live → `corrected: 482`, `skippedNoCost: 9`, zero below-cost writes.** The catalog is corrected and safe. Endpoint: `https://gci-order-hub.vercel.app/api/walmart-price-audit?offset=0&limit=2755` (add `&dryRun=true` to preview). Splits into 300-batches if it 504s. **Re-run after the §3 SKUs get real cost** so the 9 `skippedNoCost` get priced.

---

## 3. THE 17 SKUs THAT STILL NEED REAL COST — DIAGNOSED, WRITE MECHANISM READY, COSTS NOT YET ENTERED

**Finding (definitive, via #116 raw dump, `sandbox: false`):** For all 17 SKUs, **CT's API returns `cost` === `msrp` (byte-for-byte identical)** — CT hands back list price in the cost field, with NO dealer-cost field anywhere in the object (no `dealerCost`/`purchasePrice`/`lastPurchasePrice`/`listPrice`/`wholesale`). The band check correctly rejects all 17 (they're `1.00×msrp`). This is a **CT data problem, not a code problem.** No re-pull/field-swap can fix it — the dealer cost is not in CT's response. (Raw payload for all 17 captured in chat; every object has only: partNumber, name, performanceCategory, brand, model, size, isWinter, isRunFlat, isTire, isWheel, cost, msrp, inventory.)

The 17 (all confirmed `cost = msrp`):
| SKU | CT cost=msrp | Real cost band (msrp×0.25–0.90 → use as sanity range) |
|---|---|---|
| 170003001 (Cooper Discoverer AT3 LT) | 516.00 | 232–372 |
| 166122006 (Cooper Evolution Winter) | 304.00 | 137–219 |
| MB5027 (Maxtrek Trek M900 Ice) — **247 units in stock** | 452.00 | 203–325 |
| MB4155 | 430.00 | 194–310 |
| MB502L | 363.00 | 163–261 |
| MB5054 | 359.00 | 162–258 |
| MB4148 | 351.00 | 158–253 |
| MB6059 | 334.00 | 150–240 |
| MB6114 | 329.00 | 148–237 |
| MB4016U — **22 units in stock** | 303.00 | 136–218 |
| MB4003U | 299.00 | 135–215 |
| MB4062L | 279.00 | 126–201 |
| M347U | 273.00 | 123–197 |
| MB4277 | 231.00 | 104–166 |
| M2164 | 210.00 | 94–151 |
| M2031U | 179.00 | 81–129 |
| M1087L | 155.00 | 70–112 |

**Current state of these 17 in Shopify:** still holding BAD clearance values from a failed manual pull earlier (e.g. `170003001` = $24.97, `MB5027` = $119.97, `M1087L` = $49.97). These are wrong but **floor-protected** — the Walmart price is the correct Shopify retail (e.g. `170003001` storefront = $407.99), which wins the floor's `max()`. So no below-cost risk; the bad cost only distorts margin reporting and weakens the floor's backstop if retail ever drops. Latent, not active.

**FIXED earlier this session (3 Coopers, real in-band cost, written manually via `inventoryItemUpdate`):**
- 166497021 → $202.40 ✓
- 166483021 → $199.18 ✓
- 166006004 → $177.56 ✓

**Two resolution paths for the 17 (do both):**
1. **Source fix at CT — email to Amanda Muise (amuise@cdatire.com), DRAFTED, ready to send.** Reports `cost = msrp` symptom with 170003001 + MB5027 as reproducible examples; asks CT to check why dealer cost shows as MSRP for the Maxtrek line + these 2 Coopers. If CT fixes it at source, a single re-pull corrects all 17 automatically. **If CT can't/won't fix the API quickly**, the alternative source fix is the NetSuite RESTlet change in `docs/netsuite-restlet-add-dealer-cost.md` (add a real cost field server-side) — same end result, owned by us.
2. **Manual entry via `update-chunk` `costOverrides`** (NEW this session, PR #117) for in-stock SKUs (MB5027 247u, MB4016U 22u, MB5054, etc.). Take dealer cost from purchase invoices/POs and pass it in the `costOverrides` map — the band check validates every entry, so a wrong number ($24.97) is auto-rejected (`outOfBandSkus`). Zero-inventory SKUs can wait for the CT/RESTlet fix. See `docs/update-chunk-cost-overrides.md`. **Pat: paste the part#→cost list to Claude Code and it will build the exact band-checked request.**

**Also still excluded / unresolved (not reachable by `update-chunk`):** 4 Vredestein Winter dupes, Nitto Ridge Grappler V2 (`TIRE-NIT-RG2-2857017-117T`), Toyo Open Country AT3 (`TIRE-TOY-AT3-2756518-116T`), merged `MB515L / MB515U`. These had no cached cost; need investigation (mapping or source). The Vredestein winter SKUs each have a non-winter duplicate listing owning the bare `AP…` SKU — overrides/re-pull would hit the wrong listing; needs targeting by variant ID.

---

## 4. PENDING WORK (priority order)

1. **[HIGHEST — real operational risk] Order-sync resilience.** `walmart-order-sync` fails on transient Walmart errors (seen: HTTP 520 `GMP_GATEWAY_API`, and `fetch failed`) and DIES instead of retrying — so an order arriving during a failed window is never seen. The first real order (Jason Harrisson) produced NO Telegram alert, likely for this reason. **Three fixes for Claude Code:** (a) add a "new order received" Telegram alert that fires BEFORE the CT PO step (so problem/mispriced orders are never invisible); (b) retry-with-backoff (3–4 attempts, 2s/4s/8s) on 5xx/520/`fetch` errors, alert only after all retries fail; (c) catch-up logic — fetch orders since last *successful* sync timestamp, not last run, so a dead pass self-heals. The Telegram bot itself is healthy (price alerts arrive fine — bot "GCI Orders").
2. **Resolve the 17:** send the Amanda CT email (drafted) and/or apply the NetSuite RESTlet doc; meanwhile manual `costOverrides` entry for in-stock SKUs. Then re-run `walmart-price-audit` so the 9 `skippedNoCost` get priced.
3. **Layer 2 — `walmart-reconcile.ts`** (daily cron: force Walmart price+inventory to match Shopify for all matched SKUs via the floor; fixes the ~339 inventory gaps). See `Walmart_Permanent_Fix_Spec_for_ClaudeCode.md`.
4. **Layer 4 — `cost-integrity-audit.ts`** (daily read-only: compare CT cost vs Shopify cost, flag divergence/missing/stale; now meaningful since both cost fields are gated). Spec in same file.
5. **Layer 3 — fix `walmart-item-feed.ts`** so new items never default to $285, then re-submit feed for the items still showing $285.
6. The ~662 unmatched Walmart listings / archived null-SKU products; flotation-size parser (~25 SKUs).

---

## 5. KEY OPERATIONAL FACTS

- **Claude Code session** (`claude.ai/code`) does all code work — has GitHub + Vercel + Shopify connectors and can edit/commit/deploy/query. **BUT its sandbox has egress hard-blocked (403 to NetSuite, Vercel, even ops.gcitires.com) and no CT_*/WALMART_* creds** — it cannot run live CT pulls or hit deployed endpoints. Pat runs those from a browser. (Claude Code CAN read Shopify live via the Shopify MCP, and CAN read Vercel deployment metadata via the Vercel MCP — that's how the prod-commit check in §1 was done.)
- **Running deployed endpoints from a locked-down work laptop (no terminal/Codespaces budget):** GET endpoints → paste URL in browser address bar. POST endpoints → DevTools Console `fetch()` **from a tab already on `gci-brain.vercel.app`** (same-origin avoids CORS — running from the storefront tab gives `CORS policy` errors). Multi-line snippets get mangled on paste → **paste as ONE line.** Fallback: hoppscotch.io with Proxy on. Network tab shows the real status when Console only shows `Promise {<pending>}`.
- **`CRON_SECRET` was exposed in chat (v12 session) and MUST be rotated** (Vercel → gci-brain → Settings → Env Vars → edit CRON_SECRET → redeploy). Use `openssl rand -hex 32`. Never paste the real secret again — use `<CRON_SECRET>` placeholder. **Still outstanding** as of this session — rotate before the next `update-chunk` run. Note: Claude Code's Vercel MCP can deploy/read but has **no env-var write tool**, so Pat must do the rotation in the dashboard/CLI.
- **`update-chunk` request:** `POST https://gci-brain.vercel.app/api/shopifySync?action=update-chunk`, header `Authorization: Bearer <CRON_SECRET>` (handler strips `Bearer `, compares to `process.env.CRON_SECRET`; auth only enforced if the env var is set), body `{"skus":[...]}` (max 50). **Optional:** `"costOverrides": {"<part>": <cost>, ...}` to supply manual dealer cost (band-checked, PR #117). **SKU strings must be CT part numbers in STRIPPED form (no `TIRE-` prefix)** — `170003001` not `TIRE-170003001`; Maxtrek codes (`MB5027`) as-is.
- **Raw CT diagnostic:** `GET https://gci-brain.vercel.app/api/bulkPriceUpdate?action=ct-cost-lookup&raw=1&parts=<comma,list>` — returns full unmodified CT objects (one call handles the whole list). Likely no auth (read-only). Watch `envCheck.sandbox` (was `false` — production data confirmed).
- **CT source = NetSuite RESTlet via OAuth** (`CT_*` creds), script `customscript_item_search_rl` / deploy `customdeploy_item_search_rl`. **Confirmed this session to return MSRP-in-`cost` with no dealer-cost field** (root of §3). CT contact: Amanda Muise, amuise@cdatire.com.

---

## 6. HARD CONSTRAINTS (do not break)

- `vercel.json` `functions` block is an **allowlist** — unlisted API files 404. Add every new endpoint.
- Use `crypto.randomUUID()`, never the `uuid` npm pkg (ESM crash on Vercel CJS) for WM_QOS.CORRELATION_ID.
- Do NOT add `"type":"module"` to root `package.json` (ESM/TS Vercel conflict).
- Shopify variant pagination MUST use GraphQL (REST Link header caps ~2,527).
- TS strict: `noImplicitAny`, `noUnusedParameters` (prefix unused `_`).
- **Cost rule (permanent):** always store real CT dealer cost unmodified; if missing → skip + flag, NEVER substitute MSRP, NEVER halve, NEVER `||0`. (Enforced by `parseCTDealerCost` + the band check — do not reintroduce any cost transformation. Manual `costOverrides` are the ONLY sanctioned way to inject a non-CT cost, and they are still band-checked.)
- Walmart price payload: `{sku, pricing:[{currentPriceType:'BASE', currentPrice:{currency:'CAD', amount}}]}`. Inventory: PUT `/v3/inventory?sku=X` body `{sku, quantity:{unit:'EACH', amount}}`. Items: GET `/v3/items` (NOT `/v3/ca/items`), offset pagination 200/page. Market via `WM_MARKET: ca` header.
- Walmart deal: 75% referral-fee discount until Jan 31 2027 (effective 2.5%); submit promotions, don't cut prices.
- cjdropshipping Shopify location intentionally kept for Driver & Crew Essentials — do not remove.

---

## 7. REPOS / IDS

- `statco/gci-brain` → gci-brain.vercel.app (Shopify sync, cost, CT pulls, tools). **Current prod commit includes #114/#115/#116/#117.**
- `statco/gci-order-hub` → gci-order-hub.vercel.app (Walmart sync/feed/orders, the floor, price-audit).
- Walmart Seller ID 10002930522, store "GC Tires". Walmart support: Amar (Amarjeet Singh). API v3.1, `WM_MARKET=ca`, base marketplace.walmartapis.com.
- Shopify: gcitires.myshopify.com / storefront gcitirescanada.com (Dawn theme, FR default + EN).
- Cancelled bad order (reference): Jason Harrisson, order 600000103212221, 4× Cooper AT3 XLT `TIRE-170034002` at $285 vs correct $537.99.
- Dev branch for Claude Code work on gci-brain this session: `claude/happy-newton-vrnt1` (PRs #114–#117 all merged from it).

---

## 8. RELATED FILES
- `docs/netsuite-restlet-add-dealer-cost.md` (in `gci-brain` repo) — SuiteScript snippet to add real dealer cost to the CT RESTlet + the `shopifySync` follow-up. **The durable §3 source fix.**
- `docs/update-chunk-cost-overrides.md` (in `gci-brain` repo) — `costOverrides` usage + response reference.
- `Walmart_Permanent_Fix_Spec_for_ClaudeCode.md` — full 4-layer spec (floor, reconcile, correct-at-creation, cost-integrity).
- `CT_cost_repull_combined.csv` — the 28 SKUs with validation bands (superset; the 17 unfixed + 3 fixed Coopers + excluded).
- `null_cost_repull_worklist.csv`, `missing_cost_backfill_worklist.csv`, `suspicious_low_cost_verify.csv` — earlier worklists.
- Storefront bug noted for a future session (unrelated to Walmart): `merchantWidgetScript.addEventListener is not a function` firing repeatedly on gcitirescanada.com console — investigate, may be breaking a live widget.
