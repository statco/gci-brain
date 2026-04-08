import type { VercelRequest, VercelResponse } from '@vercel/node';

const BASE = `https://api.airtable.com/v0/${process.env.AIRTABLE_BASE_ID}`;

function atHeaders() {
  return {
    Authorization: `Bearer ${process.env.AIRTABLE_API_KEY}`,
    'Content-Type': 'application/json',
  };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ success: false });

  if (req.headers.authorization !== `Bearer ${process.env.ADMIN_SECRET}`) {
    return res.status(401).json({ success: false, message: 'Unauthorized' });
  }

  const { reviewId, action } = req.body ?? {};
  if (!reviewId || (action !== 'approve' && action !== 'reject')) {
    return res.status(400).json({ success: false, message: 'reviewId and action (approve|reject) required' });
  }

  const fields: Record<string, unknown> = {
    Status: action === 'approve' ? 'approved' : 'rejected',
  };
  if (action === 'approve') fields.ApprovedAt = new Date().toISOString().split('T')[0];

  const r = await fetch(`${BASE}/Reviews/${reviewId}`, {
    method: 'PATCH',
    headers: atHeaders(),
    body: JSON.stringify({ fields }),
  });

  if (!r.ok) {
    const text = await r.text();
    return res.status(500).json({ success: false, message: `Airtable error: ${text}` });
  }

  return res.status(200).json({ success: true, action });
}
