// api/authorize-order.ts
// ============================================================
// Manual Payment Authorization Endpoint
//
// GET /api/authorize-order?data=<base64url>&sig=<hex>
//
// When you click the "Authorize & Submit" link from the notification:
//   • TIRE orders:   logs the approved PO and marks the supplier order
//                   as authorized (you then place the order with Canada Tire
//                   manually via your existing process or PO email)
//   • NUPROZ orders: calls CJ Dropshipping to confirm/submit the order
//                   to the supplier automatically
//
// Security:
//   - Link is HMAC-SHA256 signed with ORDER_ROUTER_SECRET
//   - Link expires after 24 hours (exp field in payload)
//   - Uses timing-safe comparison to prevent timing attacks
// ============================================================

import crypto                               from 'crypto';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { submitOrder }                       from './lib/cj-client.js';

export const config = { maxDuration: 30 };

const ROUTER_SECRET = process.env.ORDER_ROUTER_SECRET || '';

// ─── TOKEN TYPES ──────────────────────────────────────────────────────────────

interface AuthTokenPayload {
  orderId:      number;
  orderNumber:  string;
  supplierType: 'TIRE' | 'NUPROZ';
  cjOrderId?:   string;
  exp:          number; // unix ms
}

// ─── SIGNATURE VERIFICATION ───────────────────────────────────────────────────

function verifyToken(data: string, sig: string): AuthTokenPayload | null {
  if (!ROUTER_SECRET) {
    console.error('❌ ORDER_ROUTER_SECRET is not set — cannot verify authorize links');
    return null;
  }

  const expected = crypto.createHmac('sha256', ROUTER_SECRET).update(data).digest('hex');

  let expectedBuf: Buffer;
  let sigBuf:      Buffer;
  try {
    expectedBuf = Buffer.from(expected, 'hex');
    sigBuf      = Buffer.from(sig,      'hex');
  } catch {
    return null;
  }

  if (expectedBuf.length !== sigBuf.length) return null;
  if (!crypto.timingSafeEqual(expectedBuf, sigBuf)) return null;

  try {
    const payload = JSON.parse(Buffer.from(data, 'base64url').toString('utf-8')) as AuthTokenPayload;
    return payload;
  } catch {
    return null;
  }
}

// ─── HTML RESPONSES ───────────────────────────────────────────────────────────

function htmlPage(title: string, body: string, isError = false): string {
  const color = isError ? '#ef4444' : '#10b981';
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${title} — GCI Orders</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: Arial, sans-serif; background: #f3f4f6; display: flex;
           align-items: center; justify-content: center; min-height: 100vh; padding: 20px; }
    .card { background: #fff; border-radius: 12px; padding: 40px; max-width: 480px;
            width: 100%; box-shadow: 0 4px 16px rgba(0,0,0,.1); text-align: center; }
    .icon { font-size: 56px; margin-bottom: 16px; }
    h1 { font-size: 22px; color: #111827; margin-bottom: 12px; }
    p { color: #4b5563; line-height: 1.6; margin-bottom: 8px; }
    .badge { display: inline-block; background: ${color}; color: #fff;
             border-radius: 6px; padding: 4px 12px; font-size: 13px; font-weight: bold;
             margin-top: 16px; }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">${isError ? '❌' : '✅'}</div>
    <h1>${title}</h1>
    ${body}
  </div>
</body>
</html>`;
}

// ─── MAIN HANDLER ─────────────────────────────────────────────────────────────

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Accept GET (link click from email/Telegram) or POST (programmatic)
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const data = (req.query.data as string) || '';
  const sig  = (req.query.sig  as string) || '';

  if (!data || !sig) {
    res.setHeader('Content-Type', 'text/html');
    return res.status(400).send(
      htmlPage('Invalid Link', '<p>This authorization link is missing required parameters.</p>', true)
    );
  }

  // Verify signature
  const payload = verifyToken(data, sig);
  if (!payload) {
    res.setHeader('Content-Type', 'text/html');
    return res.status(401).send(
      htmlPage('Invalid Signature', '<p>This authorization link is invalid or has been tampered with.</p>', true)
    );
  }

  // Check expiry
  if (Date.now() > payload.exp) {
    res.setHeader('Content-Type', 'text/html');
    return res.status(410).send(
      htmlPage(
        'Link Expired',
        `<p>This authorization link for order <strong>${payload.orderNumber}</strong> has expired (links are valid for 24 hours).</p>
         <p>To re-authorize, replay the Shopify webhook from your Shopify admin or contact support.</p>`,
        true
      )
    );
  }

  // ── TIRE orders ───────────────────────────────────────────────────────────────
  if (payload.supplierType === 'TIRE') {
    // For tire orders: we log the authorization and display a confirmation.
    // The actual PO placement with Canada Tire follows your existing manual process
    // or can be extended here to call a PO submission API.
    console.log(`✅ TIRE PO AUTHORIZED — Order ${payload.orderNumber} (Shopify ID: ${payload.orderId})`);
    console.log(`   Place order with Canada Tire via your standard PO process.`);

    // TODO: Extend this block to auto-email your Canada Tire rep or trigger
    //       an automated PO system when one becomes available.

    res.setHeader('Content-Type', 'text/html');
    return res.status(200).send(htmlPage(
      'Tire Order Authorized',
      `<p>Order <strong>${payload.orderNumber}</strong> has been authorized.</p>
       <p>Proceed with placing the Canada Tire purchase order using your standard process.</p>
       <span class="badge">TIRE — Canada Tire PO</span>`
    ));
  }

  // ── NUPROZ orders (CJ Dropshipping) ──────────────────────────────────────────
  if (payload.supplierType === 'NUPROZ') {
    if (!payload.cjOrderId) {
      res.setHeader('Content-Type', 'text/html');
      return res.status(400).send(
        htmlPage('Missing CJ Order ID', '<p>This NUPROZ authorization token is missing the CJ order reference.</p>', true)
      );
    }

    try {
      await submitOrder(payload.cjOrderId);
      console.log(`✅ NUPROZ order AUTHORIZED & SUBMITTED — CJ order ${payload.cjOrderId}, Shopify order ${payload.orderNumber}`);

      res.setHeader('Content-Type', 'text/html');
      return res.status(200).send(htmlPage(
        'Nuproz Order Submitted',
        `<p>Order <strong>${payload.orderNumber}</strong> has been authorized and submitted to CJ Dropshipping.</p>
         <p>CJ Order ID: <strong>${payload.cjOrderId}</strong></p>
         <span class="badge">NUPROZ — CJDropshipping</span>`
      ));
    } catch (err: any) {
      console.error(`❌ CJ order submission failed for ${payload.cjOrderId}:`, err);

      res.setHeader('Content-Type', 'text/html');
      return res.status(500).send(htmlPage(
        'Submission Failed',
        `<p>Authorization was confirmed but submitting CJ order <strong>${payload.cjOrderId}</strong> failed:</p>
         <p style="color:#ef4444;font-family:monospace;font-size:13px;">${err.message}</p>
         <p>Please log into CJ Dropshipping and confirm the order manually.</p>`,
        true
      ));
    }
  }

  // Unknown supplier type
  res.setHeader('Content-Type', 'text/html');
  return res.status(400).send(
    htmlPage('Unknown Order Type', `<p>Unrecognised supplier type: ${payload.supplierType}</p>`, true)
  );
}
