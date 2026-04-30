# Claude Code — shopifySync.ts Patch Instructions

Apply the following changes to `api/shopifySync.ts` in the exact order listed.
Each step is a self-contained edit. Do not reorder or combine steps.
After all edits are applied, run the verification checklist at the bottom.

---

## STEP 1 — Add KENDA to VENDOR_MAP

**File:** `api/shopifySync.ts`
**Why:** KENDA is confirmed in the CT API catalog but was missing from the map.

Find this block:
```typescript
const VENDOR_MAP: Record<string, string> = {
  'COOPER':     'Cooper',
  'NEXEN':      'Nexen',
  'VREDESTEIN': 'Vredestein',
  'MAXTREK':    'Maxtrek',
  'MINERVA':    'Minerva',
  'OVATION':    'Ovation',
  'STARFIRE':   'Starfire',
  // NUPROZONE removed — CJ Dropshipping non-tire products handled separately
};
```

Replace it with:
```typescript
const VENDOR_MAP: Record<string, string> = {
  'COOPER':     'Cooper',
  'NEXEN':      'Nexen',
  'VREDESTEIN': 'Vredestein',
  'MAXTREK':    'Maxtrek',
  'MINERVA':    'Minerva',
  'OVATION':    'Ovation',
  'STARFIRE':   'Starfire',
  'KENDA':      'Kenda',       // confirmed in CT API screenshots
  // Add further brands here after running ?action=debug-ct-pages
};
```

---

## STEP 2 — Fix fetchAllCTTires() — add pagination loop (CRITICAL)

**File:** `api/shopifySync.ts`
**Why:** Was hardcoded to page:1 with no loop. Every brand beyond CT's first
page was silently dropped — root cause of missing brands in Shopify.

Add this constant directly above the `fetchAllCTTires` function:
```typescript
// CT_PAGE_SIZE: stop paginating when a page returns fewer items than this.
// Adjust if CT uses a different page size — run ?action=debug-ct-pages to confirm.
const CT_PAGE_SIZE = 50;
```

Then find the entire `fetchAllCTTires` function:
```typescript
async function fetchAllCTTires(): Promise<CTTire[]> {
  const fullUrl = `${CT.baseUrl}?script=${CT_SCRIPT}&deploy=${CT_DEPLOY}`;
  const res = await fetch(fullUrl, {
    method: 'POST',
    headers: {
      'Authorization': buildAuthHeader(),
      'Content-Type':  'application/json',
      'Accept':        'application/json',
    },
    body: JSON.stringify({
      customerId:    CT.customerId,
      customerToken: CT.customerToken,
      filters: {
        width:'', rimSize:'', aspectRatio:'', size:'',
        partNumber:[], brand:'', searchKey:'',
        isWinter:'', isRunFlat:'', isTire:true, isWheel:false, page:1,
      },
    }),
  });

  if (!res.ok) throw new Error(`CT API HTTP ${res.status}: ${(await res.text()).slice(0,200)}`);
  const data: any = await res.json();
  if (!data.success) throw new Error(`CT API error: ${JSON.stringify(data.error)}`);
  return data.data as CTTire[];
}
```

Replace it with:
```typescript
async function fetchAllCTTires(): Promise<CTTire[]> {
  const fullUrl  = `${CT.baseUrl}?script=${CT_SCRIPT}&deploy=${CT_DEPLOY}`;
  const allTires: CTTire[] = [];
  let   page     = 1;
  const PAGE_CAP = 100; // safety: prevents infinite loop if CT never returns empty page

  while (page <= PAGE_CAP) {
    const res = await fetch(fullUrl, {
      method: 'POST',
      headers: {
        'Authorization': buildAuthHeader(),
        'Content-Type':  'application/json',
        'Accept':        'application/json',
      },
      body: JSON.stringify({
        customerId:    CT.customerId,
        customerToken: CT.customerToken,
        filters: {
          width:'', rimSize:'', aspectRatio:'', size:'',
          partNumber:[], brand:'', searchKey:'',
          isWinter:'', isRunFlat:'', isTire:true, isWheel:false,
          page, // increments each iteration
        },
      }),
    });

    if (!res.ok) throw new Error(`CT API HTTP ${res.status} on page ${page}: ${(await res.text()).slice(0,200)}`);
    const data: any = await res.json();
    if (!data.success) throw new Error(`CT API error on page ${page}: ${JSON.stringify(data.error)}`);

    const tires = data.data as CTTire[];
    if (!tires || tires.length === 0) {
      console.log(`📄 CT page ${page}: 0 tires — pagination complete`);
      break;
    }

    allTires.push(...tires);
    console.log(`📄 CT page ${page}: ${tires.length} tires (running total: ${allTires.length})`);

    // Stop if this page returned fewer items than the expected page size —
    // CT's signal that there are no more pages
    if (tires.length < CT_PAGE_SIZE) {
      console.log(`📄 CT page ${page} returned ${tires.length} < ${CT_PAGE_SIZE} — last page reached`);
      break;
    }

    page++;
    await delay(300); // respect CT API rate limits between pages
  }

  if (page > PAGE_CAP) {
    console.warn(`⚠️ CT pagination safety cap hit at ${PAGE_CAP} pages — ${allTires.length} tires fetched. Increase PAGE_CAP if catalog is larger.`);
  }

  console.log(`✅ CT fetch complete: ${allTires.length} tires across ${page} page(s)`);
  return allTires;
}
```

---

## STEP 3 — Fix getLocationId() — raise location fetch limit

**File:** `api/shopifySync.ts`
**Why:** Was fetching only 10 locations with no pagination. Could silently use
the wrong location if the store ever has more than 10 locations.

Find:
```typescript
  const data: any = await shopifyFetch<any>('/locations.json?limit=10');
  const locations = data.locations || [];
  const primary = locations.find((l: any) => !l.legacy && l.active) || locations[0];
```

Replace with:
```typescript
  // Raised from limit=10 to limit=50 (Shopify's max for this endpoint).
  // If exactly 50 locations are returned, log a warning — set
  // SHOPIFY_LOCATION_ID env var explicitly to avoid ambiguity.
  const data: any = await shopifyFetch<any>('/locations.json?limit=50');
  const locations = data.locations || [];
  if (locations.length === 50) {
    console.warn('⚠️ getLocationId: received exactly 50 locations — store may have more. Set SHOPIFY_LOCATION_ID env var to be explicit.');
  }
  const primary = locations.find((l: any) => !l.legacy && l.active) || locations[0];
```

---

## STEP 4 — Fix dedup action — raise safetyLimit

**File:** `api/shopifySync.ts`
**Why:** safetyLimit of 20 silently capped pagination at 5,000 products
(20 pages × 250). Raised to 100 to cover up to 25,000 products.

Find (inside the `case 'dedup':` block):
```typescript
        let safetyLimit = 20;
```

Replace with:
```typescript
        let safetyLimit = 100; // raised from 20 → 100 (covers up to 25,000 products)
```

---

## STEP 5 — Fix check-tags action — full pagination

**File:** `api/shopifySync.ts`
**Why:** Loop condition `while (nextUrl && found.length === 0)` exited as soon
as any match was found on page 1. Products matching the search term on page 2+
were never returned.

Find (inside the `case 'check-tags':` block):
```typescript
        while (nextUrl && found.length === 0) {
          const r: Response = await fetch(nextUrl, {
            headers: { 'Content-Type':'application/json', 'X-Shopify-Access-Token': SHOPIFY.token },
          });
          const data: any = await r.json();
          for (const p of (data.products || [])) {
            if (p.title.toLowerCase().includes(search.toLowerCase())) {
              found.push({ id: p.id, title: p.title, tags: p.tags });
              if (found.length >= 3) break;
            }
          }
          const link: string | null = r.headers.get('link');
          const m = link ? link.match(/<([^>]+)>;\s*rel="next"/) : null;
          nextUrl = m ? m[1] : null;
        }
```

Replace with:
```typescript
        // Fixed: was `while (nextUrl && found.length === 0)` which stopped
        // paginating as soon as anything was found on page 1.
        // Now paginates all pages and breaks only once 3 matches are collected.
        while (nextUrl) {
          const r: Response = await fetch(nextUrl, {
            headers: { 'Content-Type':'application/json', 'X-Shopify-Access-Token': SHOPIFY.token },
          });
          if (r.status === 429) { await delay(2000); continue; }
          if (!r.ok) break;
          const data: any = await r.json();
          for (const p of (data.products || [])) {
            if (p.title.toLowerCase().includes(search.toLowerCase())) {
              found.push({ id: p.id, title: p.title, tags: p.tags });
              if (found.length >= 3) break;
            }
          }
          if (found.length >= 3) break;
          const link: string | null = r.headers.get('link');
          const m = link ? link.match(/<([^>]+)>;\s*rel="next"/) : null;
          nextUrl = m ? m[1] : null;
        }
```

---

## STEP 6 — Add debug-ct-pages action

**File:** `api/shopifySync.ts`
**Why:** New diagnostic endpoint. Probes CT API across all pages and returns
total tire count, page sizes, brand breakdown, and any brands missing from
VENDOR_MAP. Must be run after deploy to confirm pagination and discover new brands.

Find the opening of the switch block handler (the first case after the try {):
```typescript
      case 'status': {
```

Insert the entire new case block BEFORE `case 'status':`:
```typescript
      // ── NEW: debug-ct-pages ─────────────────────────────────────────────────
      // Probes the CT API across pages and returns:
      //   - total tires found across all pages
      //   - tires per page (confirms CT_PAGE_SIZE constant is correct)
      //   - brand breakdown sorted by count
      //   - any brands NOT yet in VENDOR_MAP (so you can add them)
      //
      // Run this first after deploy to verify pagination and discover all brands.
      // Usage: POST /api/shopifySync?action=debug-ct-pages
      //   Optional: &maxPages=10  (default: up to 20 pages)
      case 'debug-ct-pages': {
        const maxPages = parseInt(req.query.maxPages as string || '20', 10);
        const fullUrl  = `${CT.baseUrl}?script=${CT_SCRIPT}&deploy=${CT_DEPLOY}`;

        const brandCounts:  Record<string, number> = {};
        const pageSizes:    number[]               = [];
        let   totalTires  = 0;
        let   page        = 1;
        let   stoppedEarly = false;

        while (page <= maxPages) {
          const ctRes = await fetch(fullUrl, {
            method: 'POST',
            headers: {
              'Authorization': buildAuthHeader(),
              'Content-Type':  'application/json',
              'Accept':        'application/json',
            },
            body: JSON.stringify({
              customerId:    CT.customerId,
              customerToken: CT.customerToken,
              filters: {
                width:'', rimSize:'', aspectRatio:'', size:'',
                partNumber:[], brand:'', searchKey:'',
                isWinter:'', isRunFlat:'', isTire:true, isWheel:false,
                page,
              },
            }),
          });

          if (!ctRes.ok) {
            return res.status(502).json({
              success: false,
              mode: 'debug-ct-pages',
              error: `CT API HTTP ${ctRes.status} on page ${page}`,
              pagesCompleted: page - 1,
              totalTiresSoFar: totalTires,
              brandCounts,
              pageSizes,
            });
          }

          const data: any = await ctRes.json();
          if (!data.success) {
            return res.status(502).json({
              success: false,
              mode: 'debug-ct-pages',
              error: `CT API error on page ${page}: ${JSON.stringify(data.error)}`,
              pagesCompleted: page - 1,
              totalTiresSoFar: totalTires,
              brandCounts,
              pageSizes,
            });
          }

          const tires = (data.data || []) as CTTire[];

          if (tires.length === 0) {
            console.log(`📄 debug-ct-pages: page ${page} empty — done`);
            break;
          }

          pageSizes.push(tires.length);
          totalTires += tires.length;

          for (const t of tires) {
            brandCounts[t.brand] = (brandCounts[t.brand] || 0) + 1;
          }

          console.log(`📄 debug-ct-pages: page ${page} → ${tires.length} tires`);

          if (tires.length < CT_PAGE_SIZE) {
            break; // partial page = last page
          }

          if (page === maxPages) {
            stoppedEarly = true;
          }

          page++;
          await delay(300);
        }

        // Flag brands missing from VENDOR_MAP
        const unmappedBrands = Object.keys(brandCounts)
          .filter(b => !VENDOR_MAP[b.toUpperCase()])
          .sort();

        // Sort brands by count descending
        const sortedBrands = Object.entries(brandCounts)
          .sort(([, a], [, b]) => b - a)
          .reduce<Record<string, number>>((acc, [k, v]) => { acc[k] = v; return acc; }, {});

        return res.status(200).json({
          success: true,
          mode: 'debug-ct-pages',
          summary: {
            totalPages:  pageSizes.length,
            totalTires,
            stoppedEarlyAtPage: stoppedEarly ? maxPages : null,
            pageSizes,
            note: stoppedEarly
              ? `Stopped at maxPages=${maxPages}. Re-run with ?maxPages=50 if you expect more pages.`
              : 'All pages fetched — this is the complete CT catalog.',
          },
          brands: {
            total:         Object.keys(brandCounts).length,
            sortedByCount: sortedBrands,
            unmappedBrands: unmappedBrands.length > 0
              ? { count: unmappedBrands.length, brands: unmappedBrands, action: 'Add these to VENDOR_MAP in shopifySync.ts' }
              : { count: 0, message: '✅ All brands are already in VENDOR_MAP' },
          },
        });
      }

```

---

## Verification checklist

After applying all 6 steps, confirm the following before committing:

- [ ] `VENDOR_MAP` contains `'KENDA': 'Kenda'`
- [ ] `CT_PAGE_SIZE` constant exists above `fetchAllCTTires`
- [ ] `fetchAllCTTires` contains a `while (page <= PAGE_CAP)` loop
- [ ] `fetchAllCTTires` no longer contains `page:1` as a hardcoded value
- [ ] `getLocationId` uses `limit=50` and logs a warning at exactly 50
- [ ] `dedup` case has `safetyLimit = 100`
- [ ] `check-tags` case uses `while (nextUrl)` not `while (nextUrl && found.length === 0)`
- [ ] `case 'debug-ct-pages':` exists in the switch block before `case 'status':`
- [ ] TypeScript compiles without errors: `npx tsc --noEmit`

---

## After deploy — run in this order

```
# 1. Confirm CT pagination and discover all brands
POST /api/shopifySync?action=debug-ct-pages

# 2. Check response — if brands.unmappedBrands.count > 0,
#    add those brands to VENDOR_MAP and redeploy before continuing.

# 3. Run full import in chunks (adjust offset/chunkSize as needed)
POST /api/shopifySync?action=full-import&offset=0&chunkSize=50

# 4. Repeat with increasing offset until done:true is returned
POST /api/shopifySync?action=full-import&offset=50&chunkSize=50
POST /api/shopifySync?action=full-import&offset=100&chunkSize=50
# ...and so on
```
