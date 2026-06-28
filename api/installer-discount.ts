// api/installer-discount.ts
// ─────────────────────────────────────────────────────────────────────────────
// GCI Tires — Installer Loyalty Coupon Provisioning
//
// Creates one $30-off discount code per installation partner and stores it back
// on the Airtable "Installers" record (CouponCode field). The code is surfaced
// in the order-confirmation email for Shopify buyers who add installation.
//
// $30 off, minimum order $200, all customers, no expiry. Funded by the 7.1%
// fee advantage Shopify has over Walmart (≈2.4% cost on an avg $1,235 order).
//
// POST /api/installer-discount
//   Body: { installerRecordId: string, installerName: string }
//   Returns: { couponCode, priceRuleId, discountCodeId, alreadyExisted }
//
// Idempotent: if the Installers record already has a CouponCode, it is returned
// as-is and no new Shopify objects are created.
//
// Env: SHOPIFY_ADMIN_ACCESS_TOKEN, SHOPIFY_STORE_DOMAIN,
//      AIRTABLE_API_KEY, AIRTABLE_BASE_ID
// ─────────────────────────────────────────────────────────────────────────────

import type { VercelRequest, VercelResponse } from '@vercel/node';

const SHOPIFY = {
  domain:     process.env.SHOPIFY_STORE_DOMAIN       || '',
  token:      process.env.SHOPIFY_ADMIN_ACCESS_TOKEN || '',
  apiVersion: '2024-01',
  get baseUrl() { return `https://${this.domain}/admin/api/${this.apiVersion}`; },
};

const AT_BASE  = process.env.AIRTABLE_BASE_ID || '';
const AT_KEY   = process.env.AIRTABLE_API_KEY || '';
const AT_TABLE = 'Installers';

const DISCOUNT_AMOUNT = 30;  // $ off
const MIN_ORDER       = 200; // $ minimum subtotal

// ─── Airtable helpers ──────────────────────────────────────────────────────

async function atFetch(path: string, options: RequestInit = {}): Promise<any> {
  const res = await fetch(
    `https://api.airtable.com/v0/${AT_BASE}/${encodeURIComponent(AT_TABLE)}${path}`,
    { ...options, headers: { Authorization: `Bearer ${AT_KEY}`, 'Content-Type': 'application/json', ...((options.headers as any) || {}) } }
  );
  if (!res.ok) throw new Error(`Airtable ${res.status}: ${await res.text()}`);
  return res.json();
}

// ─── Shopify helpers ───────────────────────────────────────────────────────

async function shopifyFetch(path: string, options: RequestInit = {}) {
  const res = await fetch(`${SHOPIFY.baseUrl}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': SHOPIFY.token,
      ...((options.headers as any) || {}),
    },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Shopify ${res.status} on ${path}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : {};
}

// ─── Code derivation ───────────────────────────────────────────────────────
// "L'Atelier Mécanique" → "LATELIER30"
//   strip accents, keep the first word's letters/digits, append the amount.
function deriveCouponCode(installerName: string): string {
  const firstWord = (installerName || '').trim().split(/\s+/)[0] || 'INSTALLER';
  const base = firstWord
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // drop diacritics (Mécanique → Mecanique)
    .replace(/[^a-zA-Z0-9]/g, '')    // drop apostrophes, punctuation
    .toUpperCase();
  return `${base || 'INSTALLER'}${DISCOUNT_AMOUNT}`;
}

// ─── Vercel handler ────────────────────────────────────────────────────────

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'POST only' });
  }

  if (!SHOPIFY.domain || !SHOPIFY.token || !AT_BASE || !AT_KEY) {
    return res.status(500).json({
      success: false,
      error: 'Missing env config',
      missing: [
        !SHOPIFY.domain ? 'SHOPIFY_STORE_DOMAIN' : null,
        !SHOPIFY.token  ? 'SHOPIFY_ADMIN_ACCESS_TOKEN' : null,
        !AT_BASE        ? 'AIRTABLE_BASE_ID' : null,
        !AT_KEY         ? 'AIRTABLE_API_KEY' : null,
      ].filter(Boolean),
    });
  }

  const { installerRecordId, installerName } = (req.body || {}) as {
    installerRecordId?: string;
    installerName?: string;
  };

  if (!installerRecordId || !installerName) {
    return res.status(400).json({ success: false, error: 'installerRecordId and installerName are required' });
  }

  try {
    // 1. Idempotency — return the existing code if one is already set.
    const existing = await atFetch(`/${installerRecordId}`);
    const existingCode: string | undefined = existing?.fields?.CouponCode;
    if (existingCode) {
      console.log(`♻️ Installer ${installerName} already has coupon ${existingCode}`);
      return res.status(200).json({
        success: true,
        couponCode: existingCode,
        priceRuleId: null,
        discountCodeId: null,
        alreadyExisted: true,
      });
    }

    const couponCode = deriveCouponCode(installerName);

    // 2. Create the Shopify price rule — $30 fixed amount off, min $200, no expiry.
    const priceRulePayload = {
      price_rule: {
        title: `Installer Loyalty — ${installerName}`,
        target_type: 'line_item',
        target_selection: 'all',
        allocation_method: 'across',
        value_type: 'fixed_amount',
        value: `-${DISCOUNT_AMOUNT.toFixed(2)}`,
        customer_selection: 'all',
        prerequisite_subtotal_range: { greater_than_or_equal_to: MIN_ORDER.toFixed(2) },
        once_per_customer: true,
        starts_at: new Date().toISOString(),
      },
    };

    const priceRuleRes = await shopifyFetch('/price_rules.json', {
      method: 'POST',
      body: JSON.stringify(priceRulePayload),
    });
    const priceRuleId = priceRuleRes?.price_rule?.id;
    if (!priceRuleId) throw new Error(`Price rule creation returned no id: ${JSON.stringify(priceRuleRes)}`);

    // 3. Attach the discount code to that price rule.
    const discountRes = await shopifyFetch(`/price_rules/${priceRuleId}/discount_codes.json`, {
      method: 'POST',
      body: JSON.stringify({ discount_code: { code: couponCode } }),
    });
    const discountCodeId = discountRes?.discount_code?.id || null;

    console.log(`🎟️ Created coupon ${couponCode} (price rule ${priceRuleId}) for ${installerName}`);

    // 4. Write the code back to Airtable.
    await atFetch(`/${installerRecordId}`, {
      method: 'PATCH',
      body: JSON.stringify({ fields: { CouponCode: couponCode } }),
    });

    return res.status(200).json({
      success: true,
      couponCode,
      priceRuleId,
      discountCodeId,
      alreadyExisted: false,
    });
  } catch (err: any) {
    console.error('❌ installer-discount error:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
}
