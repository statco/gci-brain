import type { VercelRequest, VercelResponse } from '@vercel/node';

const BASE = `https://api.airtable.com/v0/${process.env.AIRTABLE_BASE_ID}`;

function atHeaders() {
  return { Authorization: `Bearer ${process.env.AIRTABLE_API_KEY}` };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method !== 'GET') return res.status(405).end();

  const handle = typeof req.query.productHandle === 'string' ? req.query.productHandle : '';
  const language = typeof req.query.language === 'string' ? req.query.language.toUpperCase() : '';
  const limit = Math.min(
    parseInt(typeof req.query.limit === 'string' ? req.query.limit : '10', 10) || 10,
    100
  );

  if (!handle) return res.status(400).json({ error: 'productHandle is required' });

  let formula = `AND({ProductHandle}="${handle}",{Status}="approved")`;
  if (language === 'EN' || language === 'FR') {
    formula = `AND({ProductHandle}="${handle}",{Status}="approved",{Language}="${language}")`;
  }

  const url = new URL(`${BASE}/Reviews`);
  url.searchParams.set('filterByFormula', formula);
  url.searchParams.set('maxRecords', String(limit));
  url.searchParams.set('sort[0][field]', 'ApprovedAt');
  url.searchParams.set('sort[0][direction]', 'desc');

  const r = await fetch(url.toString(), { headers: atHeaders() });
  if (!r.ok) return res.status(500).json({ error: 'Failed to fetch reviews' });

  const data = await r.json() as { records: { id: string; fields: Record<string, unknown> }[] };
  const reviews = (data.records ?? []).map(rec => ({
    id: rec.id,
    reviewerName: rec.fields.ReviewerName ?? 'Anonymous',
    rating: rec.fields.Rating ?? 0,
    title: rec.fields.Title ?? '',
    body: rec.fields.Body ?? '',
    language: rec.fields.Language ?? 'EN',
    approvedAt: rec.fields.ApprovedAt ?? '',
  }));

  const avg = reviews.length
    ? Math.round((reviews.reduce((s, r) => s + Number(r.rating), 0) / reviews.length) * 10) / 10
    : 0;

  return res.status(200).json({ reviews, averageRating: avg, count: reviews.length });
}
