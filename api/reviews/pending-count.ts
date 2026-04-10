import type { VercelRequest, VercelResponse } from '@vercel/node';

const BASE = `https://api.airtable.com/v0/${process.env.AIRTABLE_BASE_ID}`;

function atHeaders() {
  return { Authorization: `Bearer ${process.env.AIRTABLE_API_KEY}` };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization');
  if (req.method !== 'GET') return res.status(405).end();

  if (req.headers.authorization !== `Bearer ${process.env.ADMIN_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const url = new URL(`${BASE}/Reviews`);
  url.searchParams.set('filterByFormula', '{Status}="pending"');
  url.searchParams.set('pageSize', '100');
  url.searchParams.set('sort[0][field]', 'SubmittedAt');
  url.searchParams.set('sort[0][direction]', 'desc');

  const r = await fetch(url.toString(), { headers: atHeaders() });
  if (!r.ok) return res.status(500).json({ error: 'Airtable fetch failed' });

  const d = await r.json() as { records: { id: string; fields: Record<string, unknown> }[] };
  const reviews = (d.records ?? []).map(rec => ({
    id: rec.id,
    productTitle: rec.fields.ProductTitle ?? '',
    productHandle: rec.fields.ProductHandle ?? '',
    reviewerName: rec.fields.ReviewerName ?? '',
    rating: rec.fields.Rating ?? 0,
    title: rec.fields.Title ?? '',
    body: rec.fields.Body ?? '',
    language: rec.fields.Language ?? 'EN',
    submittedAt: rec.fields.SubmittedAt ?? '',
  }));

  return res.status(200).json({ count: reviews.length, reviews });
}
