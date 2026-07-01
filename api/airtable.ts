import type { VercelRequest, VercelResponse } from '@vercel/node';
const AIRTABLE_API_KEY = process.env.AIRTABLE_API_KEY || '';
const AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID || '';
const AIRTABLE_API_URL = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}`;
const INTERNAL_API_SECRET = process.env.INTERNAL_API_SECRET || '';
const ALLOWED_TABLES = [
  'Installers',
  'Installation Jobs',
  'Installer Payments',
  'Notifications',
  'Outreach Prospects',
];

// SECURITY FIX (2026-07): this proxy previously had NO caller
// authentication and open CORS (Access-Control-Allow-Origin: '*'), and
// was reachable from the browser (via airtableService.ts, bundled into
// the client-side app). That meant anyone who found this endpoint could
// read or write ANY of the tables above -- including Installers, which
// has installer bank account info -- with no credentials required.
//
// The browser-facing use cases (installer search, application submission)
// have been moved to purpose-built endpoints that never expose sensitive
// fields (see api/nearby-installers.ts, api/submit-installer-application.ts).
// This proxy is now ONLY for legitimate server-to-server callers
// (currently: gci-order-hub's installer-dispatch.ts, after payment is
// confirmed) and requires a shared secret. Set INTERNAL_API_SECRET to the
// same value in both gci-brain's and gci-order-hub's Vercel env vars.
export default async function handler(req: VercelRequest, res: VercelResponse) {
  // No CORS headers at all -- this is not meant to be called from a
  // browser anymore. A missing/wrong Origin doesn't block a direct
  // server-to-server fetch, which is the only caller this should have.
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  if (!INTERNAL_API_SECRET) {
    console.error('[airtable] INTERNAL_API_SECRET not configured -- refusing all requests');
    return res.status(500).json({ error: 'Server misconfigured' });
  }
  const providedSecret = req.headers['x-internal-secret'];
  if (providedSecret !== INTERNAL_API_SECRET) {
    console.warn('[airtable] rejected request with invalid/missing X-Internal-Secret header');
    return res.status(401).json({ error: 'Unauthorized' });
  }

  if (!AIRTABLE_API_KEY || !AIRTABLE_BASE_ID) {
    return res.status(500).json({ error: 'Airtable credentials not configured' });
  }
  const { table, method = 'GET', body, filter, recordId } =
    (req.body ?? {}) as Record<string, any>;
  if (!table || !ALLOWED_TABLES.includes(table)) {
    return res.status(400).json({ error: 'Invalid or missing table name' });
  }
  try {
    let url = `${AIRTABLE_API_URL}/${encodeURIComponent(table)}`;
    if (recordId) url += `/${recordId}`;
    if (filter) url += `?filterByFormula=${encodeURIComponent(filter)}`;
    const upstream = await fetch(url, {
      method,
      headers: {
        'Authorization': `Bearer ${AIRTABLE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await upstream.json();
    if (!upstream.ok) {
      console.error('[airtable] upstream error:', upstream.status, data);
      return res.status(upstream.status).json({ error: 'Airtable API error', details: data });
    }
    return res.status(200).json(data);
  } catch (err) {
    console.error('[airtable] unexpected error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
