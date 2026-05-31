# NetSuite RESTlet — add real dealer cost to `customscript_item_search_rl`

## Why

`shopifySync` and `bulkPriceUpdate` read item data from the NetSuite RESTlet
`customscript_item_search_rl` / `customdeploy_item_search_rl`. As confirmed by
`ct-cost-lookup&raw=1`, every item the RESTlet returns has `cost` **identical
to `msrp`** — i.e. the RESTlet is putting MSRP into the `cost` field and exposes
**no real dealer/vendor cost**. Example (live, `sandbox:false`):

```json
{ "partNumber":"170003001", "cost":"516.00", "msrp":"516.00", ... }
```

True dealer cost (~$258 for that SKU) lives on the NetSuite item record but is
not being returned. This change adds the real cost field(s) to the response so
the cost band in `shopifySync` has a genuine dealer cost to validate and write,
instead of flagging everything as MSRP-as-cost.

> This file is documentation only — the RESTlet runs **inside NetSuite**, not in
> this repo. Paste the snippet into the deployed Script record in NetSuite.

## What to add

The item's cost lives in standard fields on the NetSuite item record. Depending
on your account's costing setup, the dealer/purchase cost is one of:

| NetSuite field id | Meaning |
|---|---|
| `cost`              | Standard/last purchase cost (base purchase price) |
| `lastpurchaseprice` | Most recent PO unit price |
| `averagecost`       | Moving average cost |
| `c.<id>`            | A custom vendor-cost field if your account uses one |

Return all of them so the consumer can pick — don't pre-collapse to one field
(that pre-collapsing is exactly what created the MSRP-as-cost bug).

## SuiteScript 2.x — saved search column version

If the RESTlet builds its result from a `search.create`/`load`, add these
columns and map them onto each result row. **Do not** overwrite the existing
`msrp` mapping, and **do not** alias any of these as `cost` if `cost` already
carries MSRP downstream — return them as distinct keys.

```javascript
// --- in the search column list ---
columns.push(search.createColumn({ name: 'cost' }));              // base purchase cost
columns.push(search.createColumn({ name: 'lastpurchaseprice' })); // last PO price
columns.push(search.createColumn({ name: 'averagecost' }));       // moving avg cost
// If a custom vendor-cost field exists, e.g. custitem_dealer_cost:
// columns.push(search.createColumn({ name: 'custitem_dealer_cost' }));

// --- when building each result row object ---
var row = {
  partNumber: result.getValue({ name: 'itemid' }),               // or your existing id col
  // ... existing fields (name, brand, model, size, msrp, inventory, etc.) ...

  // NEW — real cost fields, returned as strings to match existing cost/msrp formatting:
  dealerCost:        result.getValue({ name: 'cost' }) || null,
  lastPurchasePrice: result.getValue({ name: 'lastpurchaseprice' }) || null,
  averageCost:       result.getValue({ name: 'averagecost' }) || null,
  // dealerCostCustom: result.getValue({ name: 'custitem_dealer_cost' }) || null,
};
```

## SuiteScript 2.x — record.load version

If the RESTlet loads each item with `record.load`, read the fields directly:

```javascript
var item = record.load({ type: record.Type.INVENTORY_ITEM, id: internalId });

row.dealerCost        = item.getValue({ fieldId: 'cost' })              || null;
row.lastPurchasePrice = item.getValue({ fieldId: 'lastpurchaseprice' }) || null;
row.averageCost       = item.getValue({ fieldId: 'averagecost' })       || null;
// row.dealerCostCustom = item.getValue({ fieldId: 'custitem_dealer_cost' }) || null;
```

## SuiteScript 1.0 version (if the RESTlet is still 1.0 / `nlapi*`)

```javascript
// search columns
columns.push(new nlobjSearchColumn('cost'));
columns.push(new nlobjSearchColumn('lastpurchaseprice'));
columns.push(new nlobjSearchColumn('averagecost'));

// per row
row.dealerCost        = result.getValue('cost')              || null;
row.lastPurchasePrice = result.getValue('lastpurchaseprice') || null;
row.averageCost       = result.getValue('averagecost')       || null;
```

## After deploying the RESTlet change

1. Verify the new fields appear:
   ```
   GET /api/bulkPriceUpdate?action=ct-cost-lookup&parts=170003001&raw=1
   ```
   Confirm `results[0].raw` now contains `dealerCost` / `lastPurchasePrice` /
   `averageCost` and that one of them is the true ~$258 (not 516).

2. Decide which field is authoritative (likely `dealerCost`/`cost`, falling
   back to `lastPurchasePrice`). Then point the cost reader at it — in
   `api/shopifySync.ts`, change the cost source from `ct.cost` to the new field
   in `parseCTDealerCost(ct.<field>)` / `checkCTDealerCost(ct.<field>, ct.msrp)`
   across the four write paths (buildPayload, runSync update loop, update-chunk,
   daily-sync). One-line each; the band gate stays unchanged.

3. Re-run `update-chunk` for the flagged SKUs — they should now pass the band on
   real CT cost, with no manual overrides needed.

## Interim (until the RESTlet is fixed)

`update-chunk` accepts a `costOverrides` map so verified dealer costs from the
vendor price list can be written now. Overrides are still band-checked against
CT's MSRP. See `docs/update-chunk-cost-overrides.md`.
