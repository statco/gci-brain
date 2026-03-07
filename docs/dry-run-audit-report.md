# Dry-Run Tag Audit Report

**Date:** 2026-03-07
**Endpoint:** `GET /api/tagProducts?dry=true&chunkSize=25&offset=N`
**Branch:** `claude/dry-run-tag-audit-b7L4x`

---

## Summary

The dry-run audit checks every product in the Shopify catalog against `classifyTire()` and
reports any title where **`season`** or **`vehicleType`** would remain `null` after the tag
backfill — meaning the model name is not yet represented in `lib/classifyTire.ts`.

### How to run the live audit

```bash
# From the repo root (requires network access to match.gcitires.com)
node scripts/dry-run-audit.mjs
```

---

## Static Analysis Findings

The `classifyTire()` function only has `SEASON_MAP` and `VEHICLE_MAP` entries for
**Cooper**, **Nexen**, and the two Vredestein model families (Wintrac / Quatrac).

All nine brands added to `BRAND_MAP` in PR #39 have **no** season or vehicleType keys,
so every product from those brands will produce `season: null` and `vehicleType: null`
in the dry-run changes.

### Brands with NULL season + NULL vehicleType

| Brand | Coverage |
|---|---|
| `brand-bridgestone` | ❌ No season / vehicleType keys in lookup |
| `brand-michelin` | ❌ No season / vehicleType keys in lookup |
| `brand-nokian` | ❌ No season / vehicleType keys in lookup |
| `brand-pirelli` | ❌ No season / vehicleType keys in lookup |
| `brand-nitto` | ❌ No season / vehicleType keys in lookup |
| `brand-toyo` | ❌ No season / vehicleType keys in lookup |
| `brand-continental` | ❌ No season / vehicleType keys in lookup |
| `brand-goodyear` | ❌ No season / vehicleType keys in lookup |
| `brand-bfgoodrich` | ❌ No season / vehicleType keys in lookup |
| `brand-minerva` | ❌ No season / vehicleType keys in lookup |
| `brand-ovation` | ❌ No season / vehicleType keys in lookup |
| `brand-kenda` | ❌ No season / vehicleType keys in lookup |
| `brand-mastertrack` | ❌ No season / vehicleType keys in lookup |
| `brand-starfire` | ❌ No season / vehicleType keys in lookup |
| `brand-vredestein` | ⚠️ Partial — Wintrac / Quatrac covered; Ultrac, Sportrac, etc. = null |

### Brands with NULL season only (get vehicleType via generic keyword)

| Title pattern | vehicleType match | season |
|---|---|---|
| `Michelin … SUV …` | `suv` via generic `['suv','suv']` rule | ❌ null |
| `Nokian … SUV …` | `suv` via generic `['suv','suv']` rule | ❌ null |

> **Note on LT-metric sizes:** Titles like `"Nitto Ridge Grappler LT285/70R17"` do NOT
> trigger the `' lt '` (space-padded) light-truck rule because the LT prefix is
> concatenated with the size (`LT285`). Only titles where `" LT "` appears as a
> standalone word (e.g., `"Discoverer AT3 LT All-Weather"`) match that rule.

---

## Root Cause

`SEASON_MAP` and `VEHICLE_MAP` in `lib/classifyTire.ts` are keyed on specific
**Cooper / Nexen / Vredestein model names**. The 14 additional brands added in PR #39
were only added to `BRAND_MAP` — there are no corresponding model-name keys in the
season or vehicle-type maps.

---

## Recommended Next Step

Extend `SEASON_MAP` and `VEHICLE_MAP` in `lib/classifyTire.ts` with model-name
entries for each new brand. A few starting examples:

```ts
// SEASON_MAP additions
['blizzak',         'winter'],          // Bridgestone winter line
['x-ice',           'winter'],          // Michelin winter line
['hakkapeliitta',   'winter'],          // Nokian winter line
['scorpion winter', 'winter'],          // Pirelli winter line
['vikingcontact',   'winter'],          // Continental winter line
['ultra grip',      'winter'],          // Goodyear winter line
['crossclimate',    'all-weather'],     // Michelin all-weather
['seasonproof',     'all-weather'],     // Nokian all-weather
['cinturato all season', 'all-weather'],// Pirelli all-weather
['celsius',         'all-weather'],     // Toyo all-weather
['weatherready',    'all-weather'],     // Goodyear all-weather
['open country at', 'all-terrain'],     // Toyo AT
['terra grappler',  'all-terrain'],     // Nitto AT
['ridge grappler',  'all-terrain'],     // Nitto AT/MT
['all-terrain t/a', 'all-terrain'],     // BFGoodrich AT
['wrangler',        'all-terrain'],     // Goodyear truck/SUV
['defender',        'all-season'],      // Michelin AS
['turanza',         'all-season'],      // Bridgestone touring AS
['proxes sport a/s','all-season'],      // Toyo AS
['purecontact',     'all-season'],      // Continental AS
['assurance',       'all-season'],      // Goodyear AS

// VEHICLE_MAP additions
['blizzak dm',      'suv'],             // Blizzak DM-V = SUV/truck
['dueler',          'suv'],             // Bridgestone SUV line
['pilot alpin',     'suv'],             // Michelin SUV winter
['scorpion',        'suv'],             // Pirelli SUV line
['wrangler',        'light-truck'],     // Goodyear LT/SUV
['open country',    'light-truck'],     // Toyo LT/SUV
['terra grappler',  'light-truck'],     // Nitto LT
['ridge grappler',  'light-truck'],     // Nitto LT
['all-terrain t/a', 'light-truck'],     // BFGoodrich LT
```

These entries should be added in a follow-up PR before running the live backfill.
