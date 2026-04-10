import type { VercelRequest, VercelResponse } from '@vercel/node';

const BASE = `https://api.airtable.com/v0/${process.env.AIRTABLE_BASE_ID}`;

function atHeaders() {
  return {
    Authorization: `Bearer ${process.env.AIRTABLE_API_KEY}`,
    'Content-Type': 'application/json',
  };
}

async function findReviewRequest(token: string) {
  const formula = encodeURIComponent(`AND({Token}="${token}",{Submitted}=FALSE())`);
  const r = await fetch(`${BASE}/Review_Requests?filterByFormula=${formula}&maxRecords=1`, {
    headers: atHeaders(),
  });
  if (!r.ok) return null;
  const data = await r.json() as { records: { id: string; fields: Record<string, unknown> }[] };
  return data.records?.[0] ?? null;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ success: false, message: 'Method not allowed' });

  const { token, rating, title, body, reviewerName, language } = req.body ?? {};

  if (!token || !rating || !reviewerName || !body) {
    return res.status(400).json({ success: false, message: 'Missing required fields: token, rating, reviewerName, body' });
  }

  const ratingNum = Number(rating);
  if (!Number.isInteger(ratingNum) || ratingNum < 1 || ratingNum > 5) {
    return res.status(400).json({ success: false, message: 'Rating must be between 1 and 5' });
  }

  const request = await findReviewRequest(token);
  if (!request) {
    return res.status(400).json({ success: false, message: 'Invalid or already used review token' });
  }

  const { ProductId, ProductTitle, ProductHandle, Email, OrderId } = request.fields;

  const createRes = await fetch(`${BASE}/Reviews`, {
    method: 'POST',
    headers: atHeaders(),
    body: JSON.stringify({
      fields: {
        ProductId,
        ProductTitle,
        ProductHandle,
        ReviewerName: String(reviewerName).slice(0, 100),
        Email,
        Rating: ratingNum,
        Title: title ? String(title).slice(0, 200) : '',
        Body: String(body).slice(0, 5000),
        Language: language === 'FR' ? 'FR' : 'EN',
        Status: 'pending',
        Token: token,
        SubmittedAt: new Date().toISOString().split('T')[0],
        OrderId,
      },
    }),
  });

  if (!createRes.ok) {
    const text = await createRes.text();
    console.error('Airtable create error:', text);
    return res.status(500).json({ success: false, message: 'Failed to save review' });
  }

  await fetch(`${BASE}/Review_Requests/${request.id}`, {
    method: 'PATCH',
    headers: atHeaders(),
    body: JSON.stringify({ fields: { Submitted: true } }),
  });

  return res.status(200).json({ success: true, message: 'Review submitted successfully. Thank you!' });
}
