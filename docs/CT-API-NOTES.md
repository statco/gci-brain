# Canada Tire API — Notes for `gci-brain`

**Last updated:** 2026-07-27
**Scope of this repo's CT usage:** catalog and pricing, **read-only.**

Order submission lives in **`gci-order-hub`**, not here. See
`gci-order-hub/CT-INTEGRATION-CONTEXT.md` for the full picture. This file
records the CT API facts verified on 2026-07-27 that also apply to this repo.

---

## Boundary

| Concern | Repo |
|---|---|
| Catalog / price / stock reads | **`gci-brain`** (this repo) |
| Purchase-order submission to CT | `gci-order-hub` |
| Idempotency ledger (`ct_orders`) | `gci-order-hub` |

`gci-brain` must not gain order-submission code. If a future task seems to
require it, it belongs in `gci-order-hub` behind that repo's safety gates.

---

## 🔴 Do not touch `api/shopifySync.ts`

Live catalog integration. It uses `customscript_item_search_rl` (read-only) and
is **confirmed working**. It was deliberately left untouched during the
2026-07-27 CT integration work.

---

## Verified CT API facts (2026-07-27, production realm 8031691)

These were verified against the live API and correct several errors in the
V1.4 integration guide.

### customerId is 19997, not 7329

CT's onboarding email referred to "customer 7329". **7329 is not a customer
id** — it is a dealer number appearing as `addrId 378931: 7329 GCI TIRES INC`
under customer **19997**. Anything in this repo passing a customer id must use
`19997`.

### HTTP 200 does not mean success

CT returns 200 on failure. Check `body.success` (boolean) and `error.code`.
Any code treating a 200 status as success is wrong.

### Warehouse names — the guide's examples are WRONG

Live, case-sensitive values:

```
Toronto, ON | Montreal, QC | Sherbrooke, QC | Levis, QC
Dartmouth, NS | Moncton, NB | Mount Pearl, NFLD
```

The guide references **Valleyfield**, **Mississauga**, and a bare
**Sherbrooke** — none exist in the live API. If any code or config in this repo
maps or displays CT locations, verify it against this list.

### Endpoints in use / available

- **Product search (used here):** `customscript_item_search_rl` /
  `customdeploy_item_search_rl`
- Ship-to search: `customscript_get_cust_addr_rl` /
  `customdeploy_get_cust_addr_rl`
- Base URL:
  `https://8031691.restlets.api.netsuite.com/app/site/hosting/restlet.nl`
- Sandbox realm `8031691_SB1` @ `8031691-sb1.restlets.api.netsuite.com` —
  credentials not yet issued as of 2026-07-27.

Auth is OAuth 1.0a **HMAC-SHA256**, verified working.

### Reference data point

Part `200E1059`: cost $97.50, MSRP $125.00. Stock at verification —
Toronto 1, Montreal 7, Mount Pearl 11, all other locations 0. **CT stock runs
thin**; treat zero-stock as a normal result, not an anomaly.

---

## SKU shape

Product SKUs across Shopify and Walmart are **mixed**: some carry a legacy
`TIRE-` prefix (`TIRE-166028008`), some are bare CT part numbers (`200E1059`).
CT part numbers follow **no discernible pattern**, so prefix matching cannot be
used to identify them — catalog lookup is the only reliable test. Stripping the
optional `TIRE-` prefix yields the CT `partNumber`.
