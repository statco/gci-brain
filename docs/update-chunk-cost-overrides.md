# update-chunk — manual dealer-cost overrides

## Purpose

A stopgap until the NetSuite RESTlet returns real dealer cost (see
`docs/netsuite-restlet-add-dealer-cost.md`). The CT RESTlet currently returns
**MSRP in the `cost` field**, so the plausible-cost band in `shopifySync`
correctly flags those SKUs as out-of-band and refuses to write them. This lets
you supply verified dealer costs from the vendor price list and have them
written now — while keeping the same safety gate.

## How it works

`POST /api/shopifySync?action=update-chunk` accepts an optional `costOverrides`
object in the body, mapping **CT part number → dealer cost**:

```jsonc
{
  "skus": ["MB5027", "M347U", "M1087L"],
  "costOverrides": {
    "MB5027": 226.00,
    "M347U":  136.00,
    "M1087L":  77.00
  }
}
```

For each SKU:

1. If an override is present, that value is the cost source; otherwise CT's
   `cost` is used (current behavior).
2. **The override is still band-checked** against CT's MSRP
   (`msrp*0.25 <= cost < msrp*0.90`). A fat-fingered or out-of-band override is
   **skipped + flagged** in `outOfBandSkus`, exactly like a bad CT cost — it is
   never written. Only the *source* of the cost changes, not the safety gate.
3. A non-numeric / non-positive override value is reported in `badOverrides` and
   that SKU falls back to nothing (skipped).
4. Written cost goes to **both** Shopify "Cost per item" and the
   `canada_tire.cost` metafield, same as a normal CT write.

## Example

```bash
curl -X POST "https://gci-brain.vercel.app/api/shopifySync?action=update-chunk" \
  -H "Authorization: Bearer $CRON_SECRET" \
  -H "Content-Type: application/json" \
  -d '{
    "skus": ["MB5027","MB4155","M347U","M1087L"],
    "costOverrides": { "MB5027": 226.00, "MB4155": 215.00, "M347U": 136.00, "M1087L": 77.00 }
  }'
```

## Response

```jsonc
{
  "success": true,
  "mode": "update-chunk",
  "skusRequested": 4,
  "ctFound": 4,
  "updated": 4,
  "overridden": 4,          // how many used a manual override (vs CT cost)
  "errors": 0,
  "badOverrides": [ ... ],  // override values that were non-numeric/non-positive (only if any)
  "outOfBandSkus": [ ... ], // overrides (or CT costs) rejected by the band (only if any)
  "noCostSkus": [ ... ],    // SKUs with no usable cost from either source (only if any)
  "duration": "2.1s"
}
```

## Important notes

- **Use CT part numbers**, not the `TIRE-` Shopify SKU. For the bare-number
  Coopers send `170003001` / `166122006`, not `TIRE-…`.
- Overrides are **not persisted** anywhere — they apply only to that one call.
  This is intentional: it's a manual correction, not a new source of record. The
  durable fix is the RESTlet change.
- The band still governs: if you genuinely need to write a value outside
  `msrp*0.25–0.90`, the band thresholds (`COST_MSRP_FLOOR` / `COST_MSRP_CEIL`
  env vars) must be adjusted — overrides do not bypass it.
- Max 50 SKUs per call (unchanged).
