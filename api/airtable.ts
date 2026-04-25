import type { VercelRequest, VercelResponse } from '@vercel/node';
const AIRTABLE_API_KEY = process.env.AIRTABLE_API_KEY || '';
const AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID || '';
const AIRTABLE_API_URL = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}`;
const ALLOWED_TABLES = [
  'Installers',
  'Installation Jobs',
  'Installer Payments',
  'Notifications',
  'Outreach Prospects',
];
export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
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
