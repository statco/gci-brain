// api/installer-portal.ts
// Magic link auth + installer profile read/write
// GET  /api/installer-portal?action=verify&token=xxx   — validate token, return installer data
// POST /api/installer-portal?action=generate&email=xxx — generate + email magic link
// POST /api/installer-portal?action=update              — update price per tire

import type { VercelRequest, VercelResponse } from '@vercel/node';
import crypto from 'crypto';
import { Resend } from 'resend';

const AIRTABLE_API_KEY = process.env.AIRTABLE_API_KEY || '';
const AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID || '';
const RESEND_API_KEY   = process.env.RESEND_API_KEY || '';
const PORTAL_SECRET    = process.env.PORTAL_SECRET || 'gci-portal-secret-2026';
const BASE_URL         = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'https://match.gcitires.com';

const resend = new Resend(RESEND_API_KEY);

// ─── Token helpers ─────────────────────────────────────────────────────────────
function generateToken(installerId: string, email: string): string {
  const payload = `${installerId}:${email}:${Date.now() + 7 * 24 * 60 * 60 * 1000}`; // 7 days
  const hmac = crypto.createHmac('sha256', PORTAL_SECRET).update(payload).digest('hex');
  return Buffer.from(`${payload}:${hmac}`).toString('base64url');
}

function verifyToken(token: string): { installerId: string; email: string } | null {
  try {
    const decoded = Buffer.from(token, 'base64url').toString();
    const parts = decoded.split(':');
    if (parts.length < 4) return null;

    const hmac = parts.pop()!;
    const expiry = Number(parts[parts.length - 1]);
    if (Date.now() > expiry) return null;

    const payload = parts.join(':');
    const expected = crypto.createHmac('sha256', PORTAL_SECRET).update(payload).digest('hex');
    if (!crypto.timingSafeEqual(Buffer.from(hmac), Buffer.from(expected))) return null;

    return { installerId: parts[0], email: parts[1] };
  } catch {
    return null;
  }
}

// ─── Airtable helpers ──────────────────────────────────────────────────────────
async function getInstallerByEmail(email: string) {
  const filter = encodeURIComponent(`{Email} = "${email}"`);
  const res = await fetch(
    `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/Installers?filterByFormula=${filter}`,
    { headers: { Authorization: `Bearer ${AIRTABLE_API_KEY}` } }
  );
  const data = await res.json();
  return data.records?.[0] || null;
}

async function getInstallerById(id: string) {
  const res = await fetch(
    `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/Installers/${id}`,
    { headers: { Authorization: `Bearer ${AIRTABLE_API_KEY}` } }
  );
  return res.json();
}

async function getInstallerJobs(installerId: string) {
  const filter = encodeURIComponent(`{InstallerId} = "${installerId}"`);
  const res = await fetch(
    `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/Installation Jobs?filterByFormula=${filter}&sort[0][field]=Created&sort[0][direction]=desc&maxRecords=20`,
    { headers: { Authorization: `Bearer ${AIRTABLE_API_KEY}` } }
  );
  const data = await res.json();
  return data.records || [];
}

async function updateInstallerPrice(id: string, pricePerTire: number) {
  const res = await fetch(
    `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/Installers/${id}`,
    {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${AIRTABLE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ fields: { PricePerTire: pricePerTire } }),
    }
  );
  return res.json();
}

// ─── Main handler ──────────────────────────────────────────────────────────────
export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const action = req.query.action as string;

  try {
    // ── Generate magic link ────────────────────────────────────────────────────
    if (action === 'generate' && req.method === 'POST') {
      const { email } = req.body;
      if (!email) return res.status(400).json({ error: 'Email required' });

      const installer = await getInstallerByEmail(email);
      if (!installer) return res.status(404).json({ error: 'Installer not found' });

      const token = generateToken(installer.id, email);
      const link = `${BASE_URL}/installer-portal?token=${token}`;

      await resend.emails.send({
        from: 'GCI Tires <noreply@updates.gcitires.ca>',
        to: [email],
        subject: 'Your GCI Installer Portal Access Link',
        html: `
          <div style="font-family:Inter,sans-serif;max-width:520px;margin:0 auto;padding:32px">
            <img src="https://gcitires.com/cdn/shop/files/gci-logo.png" height="40" alt="GCI Tires" style="margin-bottom:24px">
            <h2 style="margin:0 0 12px;color:#0f172a">Your Installer Portal</h2>
            <p style="color:#475569;margin:0 0 24px">Click the button below to access your GCI Installer Portal. This link expires in <strong>7 days</strong>.</p>
            <a href="${link}" style="display:inline-block;background:#dc2626;color:white;font-weight:700;padding:14px 28px;border-radius:8px;text-decoration:none">
              Open My Portal →
            </a>
            <p style="color:#94a3b8;font-size:12px;margin-top:24px">
              If you didn't request this link, you can safely ignore this email.<br>
              Questions? Reply to this email or call info@gcitires.ca
            </p>
          </div>
        `,
      });

      return res.json({ success: true });
    }

    // ── Verify token + return installer data ───────────────────────────────────
    if (action === 'verify' && req.method === 'GET') {
      const token = req.query.token as string;
      if (!token) return res.status(400).json({ error: 'Token required' });

      const payload = verifyToken(token);
      if (!payload) return res.status(401).json({ error: 'Invalid or expired link' });

      const [installer, jobs] = await Promise.all([
        getInstallerById(payload.installerId),
        getInstallerJobs(payload.installerId),
      ]);

      if (!installer || installer.error) return res.status(404).json({ error: 'Installer not found' });

      return res.json({
        installer: {
          id: installer.id,
          name: installer.fields.Name || '',
          email: installer.fields.Email || '',
          phone: installer.fields.Phone || '',
          address: installer.fields.Address || '',
          city: installer.fields.City || '',
          pricePerTire: installer.fields.PricePerTire || 20,
          status: installer.fields.Status || 'Active',
        },
        jobs: jobs.map((j: any) => ({
          id: j.id,
          customer: j.fields.CustomerName || '',
          tire: j.fields.TireProduct || '',
          quantity: j.fields.Quantity || 0,
          installationPrice: j.fields.InstallationPrice || 0,
          status: j.fields.Status || 'Pending',
          created: j.fields.Created || j.createdTime,
        })),
      });
    }

    // ── Update price per tire ──────────────────────────────────────────────────
    if (action === 'update' && req.method === 'POST') {
      const token = req.query.token as string || req.body.token;
      if (!token) return res.status(400).json({ error: 'Token required' });

      const payload = verifyToken(token);
      if (!payload) return res.status(401).json({ error: 'Invalid or expired link' });

      const { pricePerTire } = req.body;
      if (!pricePerTire || pricePerTire < 10 || pricePerTire > 200) {
        return res.status(400).json({ error: 'Price must be between $10 and $200' });
      }

      await updateInstallerPrice(payload.installerId, Number(pricePerTire));
      return res.json({ success: true, pricePerTire: Number(pricePerTire) });
    }

    return res.status(400).json({ error: 'Unknown action' });

  } catch (err: any) {
    console.error('installer-portal error:', err);
    return res.status(500).json({ error: err.message });
  }
}
