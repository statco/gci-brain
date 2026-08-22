# GCI Tires — Complete Workflow & System Context

> **⚠️ STALE DUPLICATE — CORRECTED 2026-08-22, DO NOT TRUST OTHERWISE.** This file
> is an older, un-synced copy of `GCI_WORKFLOW_CONTEXT.md` at the repo root, which
> is the canonical, actively-maintained version duplicated across all 6 GCI repos.
> Read that one first. This copy is kept only because deleting it outright risked
> losing whatever else in it hasn't been reconciled yet — but its GST claim below
> was **wrong and was the likely root cause of a real pricing bug** (see the
> canonical doc's "Session update — 2026-08-22" entry for the full story). Treat
> everything else in this file with the same suspicion until reconciled.

> Last updated: June 27, 2026 — commit 5badd4f
> Purpose: Full system picture for any future Claude/AI session working on GCI Tires.
> Read this FIRST before touching any file in any repo.

---

## 0. Quick Orientation

| Item | Value |
|------|-------|
| Owner | Patrick Pierre (statco GitHub org, Rouyn-Noranda QC) |
| Store | gcitires.ca / gcitires-ca.myshopify.com |
| Business model | Pure dropship — Canada Tire (CT) wholesale account |
| Revenue streams | 1. Tire sales (Shopify + Walmart CA) 2. Installation platform fee (20% cut) |
| GST registration | **CORRECTED 2026-08-22: GCI IS GST/HST-registered and claims ITCs — GST/HST is fully recoverable.** GCI is NOT registered for PST/QST, so those (not GST/HST) are the real non-recoverable tax cost, and only in QC/BC/SK/MB. ~~Below $30k threshold — NOT registered. Tax paid to CT = hard cost, no ITC.~~ *(struck through, not deleted, so the correction is traceable — this wrong assumption is the confirmed root cause of gci-brain's old flat-12%-tax pricing bug, fixed in PR #146.)* |
| AI app | match.gcitires.com (React/Vite, gci-brain repo, Vercel) |

---


## 1. The 10 Repos (statco org on GitHub)

| Repo | Live URL | What it does | Status |
|------|----------|--------------|--------|
| **gci-brain** | match.gcitires.com + gci-brain.vercel.app | AI tire match, installer booking, all backend APIs, Shopify sync, Walmart sync, Airtable bridge | 🟢 Active — primary repo |
| **gci-order-hub** | internal Vercel fn | Receives Shopify webhooks → creates Airtable Installation Jobs → Walmart zero-push | 🟡 Built, needs testing |
| **gci-walmart-sync** | internal Vercel fn | Walmart CA catalog + inventory sync | 🟡 Active |
| **gcitires-chatbot** | internal | AI customer service, bilingual EN/FR, reads Airtable Conversations + Customers | 🟡 Built |
| **gci-command-center** | internal | Internal dashboard + Installer Portal UI | 🟡 Built |
| **gci-price-monitor** | internal | Competitor price monitoring, feeds bulkPriceUpdate decisions | 🟡 Built |
| **nuprozone** | internal | CJDropshipping NUPROZ- SKUs (zero shipping cost — different supplier) | 🟡 Active |
| **gci-finance-website** | gcitires.ca/finance? | Corporate finance site | 🔲 Minimal |
| **gci-corporate-website** | gcitires.ca | Marketing presence | 🔲 Minimal |
| **gci-order-hub** | internal | Webhook bridge | 🟡 Built |

> **Primary working repo is always gci-brain.** All pricing, sync, AI match, installer, and checkout logic lives there.

---

## 2. Architecture — How the System Fits Together

```
Customer visits gcitires.ca (Shopify Dawn theme)
    │
    └─► GCI AI Match 2.0 page (/en-ca/pages/gci-ai-match-2-0)
            │  Shopify Liquid iframe → match.gcitires.com (gci-brain React app)
            │
            ├─► AI queries CT expert database (Google AI / Gemini)
            ├─► Verifies fitment (tire size + vehicle database)  
            └─► Checks GCI inventory (reads Shopify product prices live)
                    │
                    └─► Returns 3–5 tire recommendation cards (GCI VERIFIED badge)
                            │
                            ├─► Customer picks qty + ticks "Add Installation"
                            └─► SELECT & BOOK → Choose Installer
                                    │
                                    ├─► Map (MapTiler/OpenStreetMap)
                                    ├─► Installer list from Airtable (live read)
                                    │     Fields: name, address, distance, rating, pricePerTire
                                    └─► Calendly booking (installer's own link)
                                            │
                                            └─► Checkout Modal
                                                    │  Tires + Installation bundled
                                                    └─► Shopify Cart API → payment
                                                            │
                                                            ├─► Shopify order created
                                                            ├─► api/send-email.js → Resend → order confirmation email
                                                            └─► gci-order-hub webhook
                                                                    └─► Airtable: Installation Job created
                                                                            └─► Monthly payout to installer (80%)
                                                                                GCI keeps 20% automatically
```

---

## 3. Pricing Model (CRITICAL — just fixed June 27 2026)

### The Formula (now correct in both shopifySync.ts and bulkPriceUpdate.ts)

```
SELLING_PRICE = (CT_cost × 1.12 + shipping_buffer) ÷ (1 − 0.10 − 0.20)
             = COGS ÷ 0.70
```

| Component | Value | Why |
|-----------|-------|-----|
| `CT_cost × 1.12` | dealer cost + 12% avg tax | GST+PST on CT invoice, non-recoverable (below $30k GST threshold) |
| `shipping_buffer` | see table below | GCI's actual CT rate table cost (= customer price ÷ 2) |
| `WALMART_FEE` | 0.10 (10%) | Standard rate. Promo 2.5% runs until Jan 31 2027 → bank as bonus margin |
| `TARGET_NET_MARGIN` | 0.20 (20%) | Net margin after all fees |
| Shopify buyers | same price | Shopify fee = 2.9% not 10% → GCI earns +7.1% bonus margin on same price |

### Shipping Buffers (GCI's actual cost from CT rate table)

| `tireType` | Buffer | When to use |
|------------|--------|-------------|
| `passenger` | $27 | Passenger car tires |
| `light_truck` | $43 | LT tires, rim < 19" |
| `lt_large` | $51 | LT tires, rim ≥ 19" (ON/QC ~70% of LT volume) |
| `heavy_truck` | $67 | Heavy truck / LT extreme sizes |

> **KEY RULE:** The CT rate table shows the CUSTOMER price. GCI pays 50% of that.
> So if rate table shows $102, GCI pays $51. The buffer values above are already GCI's cost.
> Do NOT divide by 2 again.

### Price Example (the $50 loss that triggered all this)
- Vredestein Quatrac Pro+ 275/35R21 @ $363.44 CT cost, lt_large
- Old formula: `$363.44 × 1.58 = $573.99` ← **wrong, lost $50.31**
- New formula: `($363.44 × 1.12 + $51) ÷ 0.70 = $653.99` ← **correct, ~$140 profit**

### Key Constants in Code

**`api/shopifySync.ts`** (Shopify catalog sync — prices new/updated products):
```typescript
const TARGET_NET_MARGIN = 0.20;   // was 0.15
const WALMART_FEE       = 0.10;   // was 0.12
const TAX_RATE_ON_COGS  = 0.12;   // NEW — avg GST+PST on CT invoice
const SHIPPING_BUFFERS  = { passenger: 27, light_truck: 43, lt_large: 51, heavy_truck: 67 };
```

**`api/bulkPriceUpdate.ts`** (bulk repricing of existing catalog):
```typescript
// Inside calculatePrice() else branch:
const WALMART_FEE   = 0.10;   // was 0.025
const TARGET_MARGIN = 0.20;   // was 0.14
// REMOVED: const MARKUP = 1.08  — was incorrectly stacking on top of formula
```

---

## 4. Installation Revenue Stream

### How It Works (confirmed from `src/InstallerPortal.tsx`)

```typescript
const GCI_CUT = 0.20;  // hardcoded — GCI keeps 20% of every installation
```

- Installer sets their own price per tire ($10–$200 range in portal)
- Customer pays installer's listed price through GCI checkout
- GCI keeps 20% automatically at payout time
- Installer earns 80%
- Monthly batch payout via Airtable Installer Payments table

### Current Network (Airtable base: appkYCxXEdmNQxqn6)

| Installer | Location | Price/tire | Status | Notes |
|-----------|----------|------------|--------|-------|
| L'Atelier Mécanique | 2757 Boul Rideau, Rouyn-Noranda | $20/tire | ✅ Active | 128 installs, (819) 768-3431 |
| GCI Tire HQ | 1014 Chemin Des Conifères, Rouyn-Noranda | $25/tire | ✅ Active (internal) | Patrick's address |
| GCI Tire - Val-d'Or | Val-d'Or QC | — | 🔲 Placeholder | No real installer yet |
| Test Garage GCI | — | — | ❌ Delete | Test record |

### Scale Projection
| Monthly orders w/ installation | Avg price | GCI monthly | GCI annual |
|-------------------------------|-----------|-------------|------------|
| 50 (today) | $20 | $800 | $9,600 |
| 200 | $22 | $3,520 | $42,240 |
| 500 (5+ cities) | $25 | **$10,000** | **$120,000** |

---

## 5. What IS and IS NOT Built

### ✅ Built and Working
- AI tire recommendation engine (Google AI / Gemini)
- Fitment verification (manufacturer cross-check)
- Installer map with distance + rating (MapTiler)
- Calendly booking integration
- Checkout modal with tires + installation bundled
- Shopify Cart API checkout
- Order confirmation email (Resend via `api/send-email.js`)
- Airtable Installation Job creation (gci-order-hub webhook)
- Installer portal — installers can set their price, see jobs, see earnings
- 3-email installer outreach drip sequence (`api/installer-outreach.ts`, Resend)
- Bilingual EN/FR throughout (translations.ts + liquid)
- Shopify → Walmart sync (gci-walmart-sync)
- CT API → Shopify sync daily cron 3am ET (`api/shopifySync.ts`)
- Bulk price updater (`api/bulkPriceUpdate.ts`)
- GMC feed (`api/feed/gmc/index.ts`)
- Blog publisher, social scheduler, reviews moderation (internal tools)

### ❌ NOT Built — Installer Coupon System
**There is NO coupon or discount code system for installers.**

What was discussed but not implemented:
- Unique referral codes per installer (e.g. `MECALIGNE10`)
- Customer gets % off tires when they use installer's code
- Installer earns referral credit tracked in Airtable
- Post-purchase email with coupon for next order

**To build this:** Would need:
1. `CouponCode` field in Airtable Installers table
2. Shopify discount code creation via Admin API (one per installer)
3. `ReferralCount` formula field in Airtable (rollup from orders)
4. Post-purchase email flow via Resend referencing the installer's code
5. UI in installer portal showing their code + referral stats

**Current answer: NO, installation coupons are NOT available to send to customers by email yet.**

### 🔲 Built but Pending / Incomplete
- `installer-application.html` exists in gci-brain but the "No installers found" → application form link is **not wired** in `InstallerPortal.tsx` / translations.ts (`noInstallersFound` key exists, link missing)
- KENDA brand in CT API confirmed but NOT added to `VENDOR_MAP` in shopifySync.ts yet (instructions in CLAUDE.md Step 1)
- CT API pagination fix (fetchAllCTTires hardcoded to page 1) — instructions in CLAUDE.md Step 2 — **NOT deployed**
- `GCI Revenue` column missing from Airtable Installer Payments table (should be `Amount × 0.20` formula)
- Minimum installer price floor at $10 — should raise to $15
- L'Atelier Mécanique postal code wrong in Airtable: `J9X 9C2` → should be `J0Z 1Y0`
- Val-d'Or installer placeholder needs a real garage

---

## 6. Airtable Base (appkYCxXEdmNQxqn6)

| Table | ID | Purpose |
|-------|----|---------|
| Installers | tbldbEj2HPhsAAalB | Installer profiles, price, Calendly link, status |
| Installation Jobs | tblWXPeeLdjQX7ksA | Every install job linked to Shopify order |
| Installer Payments | tblfGXjToSO5iBWeC | Monthly payout tracking |
| Notifications | tblHu7lD9014zU7U8 | In-app notifications |
| Customers | tbloxJ79Eyi3rq71q | Customer profiles |
| Conversations | tbllfPe19W0WUErxA | Chatbot conversation log |
| BackInStock_Requests | — | Back-in-stock waitlist |
| Reviews | — | Customer reviews |
| Review_Requests | — | Automated review request queue |
| Outreach Prospects | tbla46b2GmoBtYOo2 | 22 records — garage outreach pipeline |

### Installer Fields (key ones)
```
Name, ShopName, Address, City, Province, PostalCode
Phone, Email, Status (Active/Inactive/Pending)
PricePerTire (number, editable via portal)
CalendlyLink, Rating, TotalInstallations
```

### Outreach Prospects — Current Status (22 records)
- ~7 at `Email3Sent` status → need **phone call** (not more emails)
- ~15 at `New` status → ready for email sequence to fire
- Key prospects for phone call:
  - Mecaligne, Rouyn-Noranda — (819) 764-6710
  - Garage Rheault, Rouyn-Noranda — (819) 762-5733

---

## 7. Known Bugs (Open)

| Bug | File | Severity | Fix |
|-----|------|----------|-----|
| Checkout shows `4 × $15.00 = $80.00` (wrong math) | `src/components/CheckoutModal.tsx` | 🟡 Medium — wrong math shown to buyer | Replace hardcoded `$15.00` with `selectedInstaller?.pricePerTire?.toFixed(2)` (**patch 3 in this session — APPLY NEXT**) |
| `noInstallersFound` key not wired to application form | `src/components/InstallerSelect.tsx` or similar | 🟡 Medium — lost recruitment opportunity | Wire to `installer-application.html` |
| L'Atelier postal code wrong | Airtable | 🟢 Low | Change `J9X 9C2` → `J0Z 1Y0` |
| CT API only fetches page 1 | `api/shopifySync.ts` | 🔴 High — brands on page 2+ silently missing | Apply CLAUDE.md Step 2 (pagination loop) |
| KENDA missing from VENDOR_MAP | `api/shopifySync.ts` | 🔴 High — KENDA tires won't sync | Apply CLAUDE.md Step 1 |

---

## 8. Pricing Operations Playbook

### Sync New Tires from CT API
```
POST /api/shopifySync?action=run-sync
```
Runs daily at 3am ET automatically. Creates new products, updates prices, archives discontinued.

### Reprice Existing Catalog
```
# Always preview first:
POST /api/bulkPriceUpdate?action=price-preview

# Then execute (loop until done=true):
POST /api/bulkPriceUpdate?action=price-execute&offset=0&chunkSize=200
```

### Verify Pricing Config is Live
```
POST /api/shopifySync?action=status
# Should show: { passenger: 27, light_truck: 43, lt_large: 51, heavy_truck: 67 }
```

### Walmart vs Shopify Strategy
- **Identical prices** on both platforms (Walmart policy: marketplace can't be cheaper than your own site)
- Shopify earns GCI +7.1% bonus margin (2.9% vs 10% fee gap) on every sale
- Use this 7.1% bonus to fund installer value-adds or Shopify loyalty programs
- Walmart promo fee (2.5%) runs until Jan 31 2027 — we price at standard 10% NOW to bank the difference

---

## 9. Email / Notifications Stack

| Purpose | Service | From address | File |
|---------|---------|--------------|------|
| Order confirmation | Resend | noreply@updates.gcitires.ca | `api/send-email.js` |
| Installer outreach drip | Resend | partners@updates.gcitires.ca | `api/installer-outreach.ts` |
| Installer portal notifications | Resend | — | `api/installer-portal.ts` |

**Resend API key:** `RESEND_API_KEY` env var in Vercel

---

## 10. Environment Variables (Vercel — gci-brain project)

| Var | Purpose |
|-----|---------|
| `SHOPIFY_ADMIN_ACCESS_TOKEN` | Shopify Admin API (NOT `SHOPIFY_ADMIN_TOKEN` — old name) |
| `SHOPIFY_STORE_DOMAIN` | `gcitires-ca.myshopify.com` |
| `AIRTABLE_API_KEY` | Airtable personal access token |
| `AIRTABLE_BASE_ID` | `appkYCxXEdmNQxqn6` |
| `CT_CUSTOMER_ID` | Canada Tire API customer ID |
| `CT_CUSTOMER_TOKEN` | Canada Tire API token |
| `RESEND_API_KEY` | Email sending |
| `GEMINI_API_KEY` | Google AI (tire matching) |
| `GOOGLE_AI_API_KEY` | Google AI (alternative key name) |

**Critical:** `"type": "module"` must NOT be in root `package.json` — breaks CT sync pipeline. Check after every `npm install`.

---

## 11. What to Build Next (Priority Order)

### Immediate (this session — not yet done)
1. **Apply CheckoutModal.tsx bug fix** — `$15.00` hardcode → `selectedInstaller.pricePerTire` (patch 3 from this session)
2. **Apply CLAUDE.md Steps 1–2** — KENDA vendor map + CT pagination fix (commit to gci-brain)
3. **Fix L'Atelier postal code** in Airtable (J9X 9C2 → J0Z 1Y0)
4. **Wire noInstallersFound** → `installer-application.html` in InstallerSelect component

### Short Term (this month)
5. **Phone call campaign** — Mecaligne + Garage Rheault (Rouyn-Noranda priority)
6. **Activate email outreach** for 15 "New" status prospects (Montreal, Toronto, Ottawa, Vancouver)
7. **Add GCI Revenue column** to Airtable Installer Payments: `Amount × 0.20`
8. **Raise minimum installer price** from $10 to $15 in `src/InstallerPortal.tsx`
9. **Delete Test Garage GCI** record from Airtable

### Medium Term (next 30–60 days)
10. **Installer referral coupon system:**
    - Add `CouponCode` field to Airtable Installers table
    - Create Shopify discount codes via Admin API (one per installer)
    - Add referral tracking rollup in Airtable
    - Wire into post-purchase email (Resend) + installer portal display
11. **Walmart $30k GST threshold monitoring** — when approaching $30k annual revenue, register for GST immediately to start recovering ITCs (changes pricing model — $0.12 tax factor drops)
12. **GMC account reinstatement** — submit via GMC Help form once REQ confirms commercial name (do NOT use in-dashboard button — locked at this suspension level)

### Strategic (60–90 days)
13. **Network expansion to 5 cities** — Montreal, Toronto, Ottawa, Calgary, Vancouver
14. **Val-d'Or real installer** — activate placeholder
15. **Shopify Loyalty Program** — use 7.1% Shopify bonus margin to fund points/rewards driving repeat purchases back to gcitires.ca over Walmart

---

## 12. How to Run a Full System Audit Next Time

To get a complete picture of all repos quickly, run this from gci-brain Codespace:

```bash
# 1. Check all 10 repos exist and their last commit
for repo in gci-brain gci-order-hub gcitires-chatbot gci-walmart-sync gci-command-center gci-price-monitor nuprozone gci-finance-website gci-corporate-website; do
  echo "=== statco/$repo ==="
  git ls-remote --heads "https://github.com/statco/$repo.git" 2>/dev/null | head -3 || echo "no access / private"
done

# 2. Check live API status
curl -s "https://match.gcitires.com/api/shopifySync?action=status" | python3 -m json.tool

# 3. Check pricing model is correct
curl -s "https://match.gcitires.com/api/bulkPriceUpdate?action=price-preview" | \
  python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('pricingModel','?'))"

# 4. Airtable installer count
curl -s "https://api.airtable.com/v0/appkYCxXEdmNQxqn6/Installers" \
  -H "Authorization: Bearer $AIRTABLE_API_KEY" | \
  python3 -c "import sys,json; d=json.load(sys.stdin); print(f'{len(d[\"records\"])} installers')"

# 5. Shopify active product count
# Use shopifySync ?action=status — shows shopifyProductCount
```

---

## 13. Critical Business Rules (Never Violate)

1. **Never price below the formula floor.** The absolute floor is `netCost + effectiveShipping`. The safety guard in `bulkPriceUpdate.ts` enforces this — do not remove it.
2. **Never use `SHOPIFY_ADMIN_TOKEN`** — the correct env var is `SHOPIFY_ADMIN_ACCESS_TOKEN`.
3. **Never auto-translate URL handles** via Translate & Adapt — causes `-1` ghost duplicates.
4. **Never remove `"type": "module"` check** from startup — if it appears in package.json, the CT sync pipeline breaks.
5. **Never exceed Walmart's price parity rule** — gcitires.ca must never charge MORE than Walmart for the same tire.
6. **GCI_CUT = 0.20 is sacred** — installer revenue model depends on this. Any change requires updating: InstallerPortal.tsx, installer-portal.ts, InstallerPortal.tsx earnings display, and payout batch logic.
7. **Shipping buffers = GCI's actual CT cost** (customer price ÷ 2). Do not confuse with what the customer sees on the CT website.