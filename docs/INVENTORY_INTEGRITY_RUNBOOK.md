# Inventory Integrity Runbook — gci-brain (Canada Tire → Shopify)

> Companion doc: `gci-order-hub/docs/WALMART_INVENTORY_RUNBOOK.md` (Shopify → Walmart).
> Read both for the full picture. The **Inventory Invariants** section below is shared
> verbatim between the two repos — keep them in sync if either is edited.

---

## 1. What problem this system prevents

Customers were buying tires on Walmart that were already out of stock at Canada Tire (CT),
forcing manual order cancellations and apologies. The failure was **stale inventory**, and
it had three independent paths:

1. **Active products losing CT backing.** A clearance item sells out at CT. CT either drops
   it from the feed or reports an out-of-band cost (clearance net far below dealer cost). The
   old cost-band gate `continue`d *before* the inventory write, so Shopify froze at its last
   quantity. Walmart faithfully pushed that frozen number → oversell.
2. **Orphaned legacy listings.** Products migrated from `TIRE-`prefixed SKUs to bare CT part
   numbers. The old `TIRE-` listings stayed live on Walmart with no active Shopify product
   behind them, frozen at their last pushed quantity.
3. **Stranded archived inventory.** Archiving a product does **not** zero its inventory. An
   archived record kept its quantity and was served to tools (storefront, Agentic assistant)
   as phantom stock.

This system closes all three at the root and adds redundant, fail-safe coverage so none can
recur.

---

## 2. Inventory Invariants (shared — do not violate)

These four rules are the contract. Every component obeys them.

1. **Inventory is decoupled from price/cost.** A suspect or missing cost may block a *price*
   write, but must **never** block the *inventory* write. Inventory has its own authoritative
   writer (`inventory-reconcile`).
2. **Zeros-only is always safe.** Pushing quantity `0` can only ever *under*-sell (recoverable),
   never *over*-sell. Every sweep/reconcile/reactive-push writes only real quantities or `0`.
   This is why all of them are safe to re-run.
3. **Zero before archive — never archive before zero.** Archiving strands inventory outside the
   active-only scans. Any archive step must set qty `0` (Shopify + Walmart) *first*, then flip
   status.
4. **Dry-run first, verify after.** Any operation with per-SKU writes is previewed with
   `dryRun=true` (which never writes) and confirmed afterward with a read-back.

---

## 3. System data flow

```
Canada Tire (NetSuite RESTlet)
        │   hourly: inventory-reconcile (authoritative qty)
        │   (price / new products: shopifySync daily-sync — see §8 known gaps)
        ▼
Shopify (gcitires.com)  ──►  storefront + Agentic assistant
        │                    tagOos (every 6h): sold-out tag only, no qty writes
        │
        │   reactive: pushWalmartZeros(newlyZeroed)  ─────────────┐
        ▼                                                          ▼
   gci-order-hub  ──►  Walmart Marketplace        gci-order-hub/api/walmart-zero
   (daily walmart-sync + daily orphan-sweep)      (reactive zero target)
```

Three surfaces read Shopify inventory: the storefront, the Agentic assistant, and (via
gci-order-hub) Walmart. A single wrong number corrupts all three — which is why there is one
authoritative writer.

---

## 4. Components in this repo

### `api/shopifySync.ts`

CT → Shopify sync. Multi-action handler. Key actions:

| Action | Purpose |
| --- | --- |
| `inventory-reconcile` | **Authoritative inventory writer** (see below). |
| `daily-sync` | Price + cost refresh for existing SKUs, chunked. |
| `full-import` / `update-only` / `update-chunk` | Create / bulk-update products. |
| `archive-orphans` / `archive-tire-skus` | Retire products with no CT counterpart (now zero-before-archive). |
| `find-orphans` / `cost-analysis` / `status` | Read-only diagnostics. |

### `inventory-reconcile` (the fix)

Hourly. Fully decoupled from the cost gate. One full `fetchAllCTTires()`, build
`partNumber → CTTire`, scan all **active `ct-sync`** Shopify products, and set inventory:

| CT state for the SKU | Target qty |
| --- | --- |
| In stock | real `getTotalQty(ct)` |
| Reports qty 0 | `0` |
| Absent from feed | `0` |
| `out_of_band` cost (clearance) | `0` |
| `no_cost` | `0` |

`inventory_policy` is already `deny`, so `0` = unbuyable. Products stay **active** so
gci-order-hub still sees them and pushes the `0`. Diff-skips SKUs already at target, so
steady-state runs are tiny and finish well inside `maxDuration: 300`. Supports
`?dryRun=true`, `?offset`/`?limit`, and chains via `nextUrl`.

After zeroing, it calls `pushWalmartZeros(newlyZeroed)` — a best-effort reactive push to
gci-order-hub's `walmart-zero` endpoint (see §6). **Never throws**; if it fails, the daily
gci-order-hub sweep is the backstop.

### `api/tagOos.ts`

Tagging only. Reads **Shopify** inventory (not CT), and the only Shopify write is the
`sold-out` tag + back-in-stock emails (Resend/Airtable). It does **not** write
`inventory_quantity` and has no cost logic — so it cannot conflict with `inventory-reconcile`.
It simply reflects whatever inventory the reconciler has already set.

### Cost gate (unchanged, price-only)

`checkCTDealerCost()` with `COST_MSRP_FLOOR` (0.25) and `COST_MSRP_CEIL` (0.90). A cost outside
`msrp*floor ≤ cost < msrp*ceil` is `out_of_band`; missing/invalid is `no_cost`. This still
governs **price** writes in the create/update paths. It no longer touches inventory.

### Zero-before-archive guard

`archive-orphans` and `archive-tire-skus` now set qty `0` (Shopify + push Walmart `0`) **before**
flipping `status: archived`. This stops new stranded-inventory vectors from being minted.

---

## 5. Cron schedule (this repo's `vercel.json`)

| Path | Schedule | Purpose |
| --- | --- | --- |
| `/api/shopifySync?action=inventory-reconcile` | `0 * * * *` (hourly) | **Authoritative inventory writer.** |
| `/api/feed/gmc` | `0 */6 * * *` | Google Merchant feed. |
| `/api/tagOos` | `0 */6 * * *` | sold-out tagging + restock emails. |
| `/api/fixTireSize?autorun=true` | daily 2am | Title/size normalization. |
| `installer-outreach` / `blog-publisher` / `social-scheduler` | various | Unrelated. |

---

## 6. Env vars (reactive Walmart push — Phase 3)

| Variable | Value |
| --- | --- |
| `ORDER_HUB_ZERO_URL` | `https://gci-order-hub.vercel.app/api/walmart-zero` |
| `ORDER_HUB_ZERO_SECRET` | shared secret (Vercel env only — never in code/chat) |

If unset, `pushWalmartZeros` no-ops and reconcile still runs standalone (Shopify zeroed; Walmart
catches up on the daily sweep). The matching `WALMART_ZERO_SECRET` lives in gci-order-hub.

**Secret hygiene:** generate in Vercel, set in the dashboard, never paste into chat or shell
history. Rotate immediately if exposed.

---

## 7. Operating procedures

### Health check (read-only)
- `GET /api/shopifySync?action=inventory-reconcile&dryRun=true` → `pendingChanges` should be
  small in steady state. A large number means inventory drifted (something stopped running).
- `cost-integrity-audit` (gci-order-hub) reads the `canada_tire.cost_synced_at` stamp — its age
  distribution is your coverage report.

### Manual reconcile
1. Dry run first. Read `pendingChanges` and `newlyZeroedSample`.
2. If `pendingChanges` exceeds the chunk `limit`, walk `nextUrl` to `done:true`.
3. Re-run dry to confirm `pendingChanges → ~0`.

### Golden rules (learned the hard way)
- **Dry-run before any write.** `dryRun=true` never writes.
- **Chunk anything per-SKU.** Un-chunked full-catalog per-SKU work → `504 FUNCTION_INVOCATION_TIMEOUT`.
  Use `offset`/`limit` (≈150) and walk `nextUrl`.
- **Idempotent + zeros-only.** Re-running a chunk is harmless.
- **Zero before archive.** Always.

---

## 8. Known gaps / follow-ups

- **`daily-sync` (price + new-product) scheduling.** `inventory-reconcile` drives *inventory*
  hourly, but the price/new-product `daily-sync` path has **no Vercel cron** in this repo
  (its in-code "3am ET cron" comment is stale). Confirm whether it's driven externally; if not,
  schedule it. Inventory correctness does **not** depend on this, but price freshness does.
- **Legacy `TIRE-` cleanup.** Once all `TIRE-`prefixed products are archived/retired, the
  `TIRE-` alias branches in `fetchExistingProducts` can be removed.

---

## 9. Change log

| PR / commit | Repo | Change |
| --- | --- | --- |
| #123 | gci-brain | `inventory-reconcile` (hourly) + zero-before-archive guard + `pushWalmartZeros`. |
| #28 | gci-order-hub | `walmart-zero`, `walmart-orphan-sweep`, tail crons (offset 2700/3000). |
| `75e6ac5` | gci-order-hub | Fix `parseInt`→NaN chunking bug (`chunkSize:0`, `offset:null`). |

Initial backfill result: 680/680 orphans swept, 108 live Walmart oversell vectors → 0,
372 phantom Shopify records zeroed, verified by post-sweep dry run (`liveVectorCount: 0` ×5).
