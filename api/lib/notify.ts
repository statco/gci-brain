// api/lib/notify.ts
// ============================================================
// Notification helper — sends order alerts via Telegram bot
// and/or Resend email.  Both channels are optional; whichever
// credentials are present in env vars will be used.
//
// Usage:
//   import { sendOrderNotification } from './notify.js';
//   await sendOrderNotification({ ... });
// ============================================================

import { Resend } from 'resend';

// ─── CONFIG ───────────────────────────────────────────────────────────────────

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const TELEGRAM_CHAT_ID   = process.env.TELEGRAM_CHAT_ID   || '';
const RESEND_API_KEY      = process.env.RESEND_API_KEY     || '';
const NOTIFY_EMAIL_TO     = process.env.NOTIFY_EMAIL_TO    || ''; // your email
const NOTIFY_EMAIL_FROM   = process.env.NOTIFY_EMAIL_FROM  || 'GCI Orders <orders@updates.gcitires.ca>';

// ─── TYPES ────────────────────────────────────────────────────────────────────

export interface NotifyOrderItem {
  sku:         string;
  title:       string;
  quantity:    number;
  unitCost:    number; // your cost (CAD)
}

export interface NotifyOrderPayload {
  shopifyOrderId:     number;
  orderNumber:        string;
  supplierType:       'TIRE' | 'NUPROZ';
  items:              NotifyOrderItem[];
  totalCost:          number;        // sum of unitCost × qty
  authorizeUrl:       string;        // HMAC-signed link
  customerName:       string;
  shippingCity:       string;
  shippingProvince:   string;
  installerName?:     string;        // set when ship-to-installer
  appointmentDate?:   string;
}

// ─── TELEGRAM ─────────────────────────────────────────────────────────────────

async function sendTelegram(payload: NotifyOrderPayload): Promise<void> {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) return;

  const supplierLabel = payload.supplierType === 'TIRE' ? '🛞 Canada Tire PO' : '📦 CJDropshipping';
  const itemLines = payload.items
    .map(i => `  • ${i.sku}  ×${i.quantity}  @ $${i.unitCost.toFixed(2)} ea  = $${(i.unitCost * i.quantity).toFixed(2)}`)
    .join('\n');

  const installerLine = payload.installerName
    ? `\n🔧 *Installer:* ${payload.installerName}${payload.appointmentDate ? ` (${payload.appointmentDate})` : ''}`
    : '';

  const text = [
    `🚨 *GCI New Order — ${supplierLabel}*`,
    ``,
    `*Order:* #${payload.orderNumber}`,
    `*Customer:* ${payload.customerName}`,
    `*Ship to:* ${payload.shippingCity}, ${payload.shippingProvince}${installerLine}`,
    ``,
    `*Items:*`,
    itemLines,
    ``,
    `*Total cost to GCI:* $${payload.totalCost.toFixed(2)} CAD`,
    ``,
    `✅ [AUTHORIZE & SUBMIT](${payload.authorizeUrl})`,
    ``,
    `_Link expires in 24 hours._`,
  ].join('\n');

  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id:    TELEGRAM_CHAT_ID,
      text,
      parse_mode: 'Markdown',
      disable_web_page_preview: true,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    console.error(`❌ Telegram notify failed: ${res.status} ${body}`);
  } else {
    console.log(`✅ Telegram notification sent for order #${payload.orderNumber}`);
  }
}

// ─── EMAIL (RESEND) ───────────────────────────────────────────────────────────

async function sendEmail(payload: NotifyOrderPayload): Promise<void> {
  if (!RESEND_API_KEY || !NOTIFY_EMAIL_TO) return;

  const resend = new Resend(RESEND_API_KEY);

  const supplierLabel = payload.supplierType === 'TIRE' ? 'Canada Tire Purchase Order' : 'CJDropshipping Order';
  const itemRows = payload.items.map(i => `
    <tr>
      <td style="padding:6px 8px;border-bottom:1px solid #e5e7eb;">${i.sku}</td>
      <td style="padding:6px 8px;border-bottom:1px solid #e5e7eb;">${i.title}</td>
      <td style="padding:6px 8px;border-bottom:1px solid #e5e7eb;text-align:center;">${i.quantity}</td>
      <td style="padding:6px 8px;border-bottom:1px solid #e5e7eb;text-align:right;">$${i.unitCost.toFixed(2)}</td>
      <td style="padding:6px 8px;border-bottom:1px solid #e5e7eb;text-align:right;">$${(i.unitCost * i.quantity).toFixed(2)}</td>
    </tr>`).join('');

  const installerSection = payload.installerName ? `
    <p style="margin:8px 0;color:#374151;">
      <strong>Installer:</strong> ${payload.installerName}
      ${payload.appointmentDate ? `<br><strong>Appointment:</strong> ${payload.appointmentDate}` : ''}
    </p>` : '';

  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><title>GCI Order Alert</title></head>
<body style="margin:0;padding:20px;font-family:Arial,sans-serif;background:#f3f4f6;">
  <div style="max-width:600px;margin:0 auto;background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.1);">
    <div style="background:#ef4444;padding:20px 30px;">
      <h1 style="margin:0;color:#fff;font-size:22px;">GCI Order Alert — Action Required</h1>
    </div>
    <div style="padding:24px 30px;">
      <p style="margin:0 0 4px;font-size:18px;font-weight:bold;color:#111827;">Order #${payload.orderNumber}</p>
      <p style="margin:0 0 4px;color:#374151;"><strong>Supplier:</strong> ${supplierLabel}</p>
      <p style="margin:0 0 4px;color:#374151;"><strong>Customer:</strong> ${payload.customerName}</p>
      <p style="margin:0 0 16px;color:#374151;"><strong>Ship to:</strong> ${payload.shippingCity}, ${payload.shippingProvince}</p>
      ${installerSection}
      <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin-top:16px;">
        <thead>
          <tr style="background:#f9fafb;">
            <th style="padding:8px;text-align:left;font-size:12px;color:#6b7280;border-bottom:2px solid #e5e7eb;">SKU</th>
            <th style="padding:8px;text-align:left;font-size:12px;color:#6b7280;border-bottom:2px solid #e5e7eb;">Product</th>
            <th style="padding:8px;text-align:center;font-size:12px;color:#6b7280;border-bottom:2px solid #e5e7eb;">Qty</th>
            <th style="padding:8px;text-align:right;font-size:12px;color:#6b7280;border-bottom:2px solid #e5e7eb;">Unit Cost</th>
            <th style="padding:8px;text-align:right;font-size:12px;color:#6b7280;border-bottom:2px solid #e5e7eb;">Line Total</th>
          </tr>
        </thead>
        <tbody>${itemRows}</tbody>
        <tfoot>
          <tr>
            <td colspan="4" style="padding:10px 8px;text-align:right;font-weight:bold;color:#111827;">Total Cost to GCI:</td>
            <td style="padding:10px 8px;text-align:right;font-weight:bold;color:#10b981;font-size:18px;">$${payload.totalCost.toFixed(2)} CAD</td>
          </tr>
        </tfoot>
      </table>
      <div style="margin-top:28px;text-align:center;">
        <a href="${payload.authorizeUrl}"
           style="display:inline-block;background:#10b981;color:#fff;text-decoration:none;padding:14px 32px;border-radius:6px;font-weight:bold;font-size:16px;">
          ✅ Authorize &amp; Submit Order
        </a>
        <p style="margin:12px 0 0;font-size:12px;color:#9ca3af;">This link expires in 24 hours.</p>
      </div>
    </div>
  </div>
</body>
</html>`;

  const { error } = await resend.emails.send({
    from:    NOTIFY_EMAIL_FROM,
    to:      [NOTIFY_EMAIL_TO],
    subject: `[GCI] Action Required: Order #${payload.orderNumber} — ${supplierLabel}`,
    html,
  });

  if (error) {
    console.error(`❌ Resend notify failed for order #${payload.orderNumber}:`, error);
  } else {
    console.log(`✅ Email notification sent for order #${payload.orderNumber}`);
  }
}

// ─── PUBLIC API ───────────────────────────────────────────────────────────────

/**
 * Fire notifications via all configured channels (Telegram and/or email).
 * Failures in one channel do not prevent the other.
 */
export async function sendOrderNotification(payload: NotifyOrderPayload): Promise<void> {
  await Promise.allSettled([
    sendTelegram(payload),
    sendEmail(payload),
  ]);
}
