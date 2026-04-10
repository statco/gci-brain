import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Resend } from 'resend';

const BASE = `https://api.airtable.com/v0/${process.env.AIRTABLE_BASE_ID}`;
const resend = new Resend(process.env.RESEND_API_KEY);

function atHeaders() {
  return {
    Authorization: `Bearer ${process.env.AIRTABLE_API_KEY}`,
    'Content-Type': 'application/json',
  };
}

interface LineItem {
  productId: string;
  productTitle: string;
  productHandle: string;
}

function buildEmail(items: Array<{ token: string; item: LineItem }>): string {
  const cards = items
    .map(
      ({ token, item }) => `
    <tr>
      <td style="padding:16px 0;border-bottom:1px solid #2a2a2a;">
        <p style="margin:0 0 10px;font-size:15px;color:#e5e5e5;font-weight:600;">${item.productTitle}</p>
        <a href="https://gcitires.com/en-ca/products/${item.productHandle}?review=${token}"
           style="display:inline-block;background:#B8192E;color:#fff;text-decoration:none;
                  padding:10px 22px;border-radius:4px;font-size:14px;font-weight:600;">
          Leave a Review &rarr;
        </a>
      </td>
    </tr>`
    )
    .join('');

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#111;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" bgcolor="#111">
  <tr><td align="center" style="padding:40px 16px;">
    <table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;">
      <tr>
        <td style="background:#0a0a0a;border-bottom:3px solid #B8192E;padding:24px 32px;text-align:center;border-radius:8px 8px 0 0;">
          <span style="font-size:22px;font-weight:800;color:#fff;">GCI <span style="color:#B8192E;">Tires</span></span>
        </td>
      </tr>
      <tr>
        <td style="background:#1a1a1a;padding:32px;">
          <h1 style="margin:0 0 8px;font-size:22px;color:#fff;font-weight:700;">How was your order?</h1>
          <p style="margin:0 0 24px;font-size:15px;color:#999;line-height:1.6;">
            Your feedback helps Canadian drivers choose the right tires. Takes less than a minute.
          </p>
          <table width="100%" cellpadding="0" cellspacing="0">${cards}</table>
          <p style="margin:28px 0 0;font-size:13px;color:#666;line-height:1.5;">
            Review links are single-use. Questions?
            <a href="mailto:info@gcitires.com" style="color:#B8192E;">info@gcitires.com</a>
          </p>
        </td>
      </tr>
      <tr>
        <td style="background:#0a0a0a;padding:20px 32px;text-align:center;border-radius:0 0 8px 8px;">
          <p style="margin:0;font-size:12px;color:#555;">
            GCI Tires &middot; Quebec, Canada &middot;
            <a href="https://gcitires.com" style="color:#777;text-decoration:none;">gcitires.com</a>
          </p>
        </td>
      </tr>
    </table>
  </td></tr>
</table>
</body>
</html>`;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ sent: 0, errors: ['Method not allowed'] });

  if (req.headers.authorization !== `Bearer ${process.env.ADMIN_SECRET}`) {
    return res.status(401).json({ sent: 0, errors: ['Unauthorized'] });
  }

  const { orderId, email, lineItems } = req.body ?? {};
  if (!orderId || !email || !Array.isArray(lineItems) || lineItems.length === 0) {
    return res.status(400).json({ sent: 0, errors: ['Missing orderId, email, or lineItems'] });
  }

  const errors: string[] = [];
  const itemsWithTokens: Array<{ token: string; item: LineItem }> = [];

  for (const item of lineItems as LineItem[]) {
    const token = crypto.randomUUID();
    try {
      const r = await fetch(`${BASE}/Review_Requests`, {
        method: 'POST',
        headers: atHeaders(),
        body: JSON.stringify({
          fields: {
            ProductId: item.productId,
            ProductTitle: item.productTitle,
            ProductHandle: item.productHandle,
            Email: email,
            OrderId: orderId,
            Token: token,
            SentAt: new Date().toISOString().split('T')[0],
            Submitted: false,
          },
        }),
      });
      if (!r.ok) {
        errors.push(`Airtable error for ${item.productHandle}: ${await r.text()}`);
      } else {
        itemsWithTokens.push({ token, item });
      }
    } catch (e) {
      errors.push(`Exception for ${item.productHandle}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  if (itemsWithTokens.length === 0) return res.status(500).json({ sent: 0, errors });

  try {
    await resend.emails.send({
      from: 'GCI Tires <reviews@gcitires.com>',
      to: email,
      subject: 'How was your GCI Tires order? Share your experience',
      html: buildEmail(itemsWithTokens),
    });
  } catch (e) {
    errors.push(`Email failed: ${e instanceof Error ? e.message : String(e)}`);
    return res.status(500).json({ sent: 0, errors });
  }

  return res.status(200).json({ sent: itemsWithTokens.length, errors });
}
