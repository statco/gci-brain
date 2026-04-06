// api/notifyMe.ts
// ============================================================
// Saves a back-in-stock notification request to the Airtable
// "BackInStock_Requests" table. Called from the Shopify product
// page notify-me form when a product is out of stock.
//
// POST /api/notifyMe
//   Body: { productId, productTitle, email }
//   Returns: { success: true }
//
// Duplicate requests (same email + productId, not yet notified)
// are silently accepted without creating a second record.
// ============================================================

import type { VercelRequest, VercelResponse } from '@vercel/node';

export const config = { maxDuration: 15 };

const AIRTABLE_API_KEY = process.env.AIRTABLE_API_KEY || '';
const AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID || '';
const TABLE            = 'BackInStock_Requests';
const AIRTABLE_URL     = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${encodeURIComponent(TABLE)}`;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin',  'https://gcitires.com');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST')   return res.status(405).json({ error: 'Method not allowed' });

  if (!AIRTABLE_API_KEY || !AIRTABLE_BASE_ID) {
    return res.status(500).json({ error: 'Airtable credentials not configured' });
  }

  const { productId, productTitle, email } =
    (req.body ?? {}) as Record<string, string>;

  if (!productId || !email) {
    return res.status(400).json({ error: 'Missing required fields: productId, email' });
  }

  // Basic email validation
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'Invalid email address' });
  }

  const emailNorm = email.toLowerCase().trim();
  const authHeader = { Authorization: `Bearer ${AIRTABLE_API_KEY}` };

  // ── Deduplicate: skip if already subscribed and not yet notified ───────────
  const dupeFilter = `AND({ProductId}="${productId}",{Email}="${emailNorm}",{Notified}=FALSE())`;
  try {
    const dupeRes = await fetch(
      `${AIRTABLE_URL}?filterByFormula=${encodeURIComponent(dupeFilter)}&maxRecords=1`,
      { headers: authHeader },
    );
    if (dupeRes.ok) {
      const dupeData: any = await dupeRes.json();
      if ((dupeData.records ?? []).length > 0) {
        return res.status(200).json({ success: true });
      }
    }
  } catch {
    // Non-fatal — continue and save anyway
  }

  // ── Save to Airtable ───────────────────────────────────────────────────────
  const saveRes = await fetch(AIRTABLE_URL, {
    method:  'POST',
    headers: { ...authHeader, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      records: [{
        fields: {
          ProductId:    String(productId),
          ProductTitle: String(productTitle ?? ''),
          Email:        emailNorm,
          Timestamp:    new Date().toISOString(),
          Notified:     false,
        },
      }],
    }),
  });

  if (!saveRes.ok) {
    const err: any = await saveRes.json().catch(() => ({}));
    console.error('[notifyMe] Airtable error:', saveRes.status, JSON.stringify(err));
    return res.status(500).json({ error: 'Failed to save notification request' });
  }

  return res.status(200).json({ success: true });
}
