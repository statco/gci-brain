import type { VercelRequest, VercelResponse } from '@vercel/node';

const BASE = `https://api.airtable.com/v0/${process.env.AIRTABLE_BASE_ID}`;

function atHeaders() {
  return { Authorization: `Bearer ${process.env.AIRTABLE_API_KEY}` };
}

function csvCell(v: unknown): string {
  const s = String(v ?? '');
  return s.includes(',') || s.includes('"') || s.includes('\n')
    ? `"${s.replace(/"/g, '""')}"`
    : s;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') return res.status(405).end();
  if (req.headers.authorization !== `Bearer ${process.env.ADMIN_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const records: { id: string; fields: Record<string, unknown> }[] = [];
  let offset: string | undefined;

  do {
    const url = new URL(`${BASE}/Reviews`);
    url.searchParams.set('filterByFormula', '{Status}="approved"');
    url.searchParams.set('pageSize', '100');
    url.searchParams.set('sort[0][field]', 'ApprovedAt');
    url.searchParams.set('sort[0][direction]', 'desc');
    if (offset) url.searchParams.set('offset', offset);

    const r = await fetch(url.toString(), { headers: atHeaders() });
    if (!r.ok) return res.status(500).json({ error: 'Airtable fetch failed' });

    const d = await r.json() as { records: typeof records; offset?: string };
    records.push(...d.records);
    offset = d.offset;
  } while (offset);

  const header = 'product_handle,reviewer_name,rating,title,body,created_at';
  const rows = records.map(r =>
    [
      csvCell(r.fields.ProductHandle),
      csvCell(r.fields.ReviewerName),
      csvCell(r.fields.Rating),
      csvCell(r.fields.Title),
      csvCell(r.fields.Body),
      csvCell(r.fields.ApprovedAt ?? r.fields.SubmittedAt),
    ].join(',')
  );

  const date = new Date().toISOString().split('T')[0];
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="gci-reviews-${date}.csv"`);
  return res.status(200).send([header, ...rows].join('\n'));
}
