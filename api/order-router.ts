// api/order-router.ts
// ============================================================
// Shopify Webhook Handler — Order Router
//
// Registers on: orders/paid  (set in Shopify Admin → Settings → Notifications → Webhooks)
// Endpoint:      POST /api/order-router
//
// Flow:
//   1. Verify Shopify HMAC signature
//   2. Read line items, split by SKU prefix
//      • TIRE-   → build Purchase Order + preserve installer metadata
//      • NUPROZ- → create CJ Dropshipping pending order
//   3. For each supplier batch: generate HMAC-signed auth link
//   4. Send notification (Telegram + email) — order NOT submitted until authorized
//   5. Mixed orders (both SKU types) are routed independently
//
// Env vars required:
//   SHOPIFY_WEBHOOK_SECRET   — shared secret set in Shopify webhook config
//   ORDER_ROUTER_SECRET      — HMAC key for authorize-order links (32+ char random string)
//   VERCEL_URL               — set automatically by Vercel; override with APP_BASE_URL
//   (plus CJ_ and notification vars from cj-client.ts and notify.ts)
// ============================================================

import crypto                                         from 'crypto';
import type { VercelRequest, VercelResponse }          from '@vercel/node';
import { createPendingOrder }                          from './lib/cj-client.js';
import { sendOrderNotification, NotifyOrderPayload }   from './lib/notify.js';

export const config = { maxDuration: 60 };

// ─── CONFIG ───────────────────────────────────────────────────────────────────

const WEBHOOK_SECRET = process.env.SHOPIFY_WEBHOOK_SECRET  || '';
const ROUTER_SECRET  = process.env.ORDER_ROUTER_SECRET     || '';
const APP_BASE_URL   = (
  process.env.APP_BASE_URL ||
  (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : '')
).replace(/\/$/, '');

const TIRE_PREFIX   = 'TIRE-';
const NUPROZ_PREFIX = 'NUPROZ-';

// Cost multiplier applied to Shopify line item price to estimate your cost.
// Adjust if you have a different net cost calculation per product type.
const TIRE_COST_RATIO   = 0.50; // 50% of retail (matches existing NET_MULTIPLIER)
const NUPROZ_COST_RATIO = 0.60; // 60% of retail — adjust after reviewing CJ pricing

// ─── SHOPIFY WEBHOOK TYPES ────────────────────────────────────────────────────

interface ShopifyLineItem {
  id:          number;
  sku:         string;
  title:       string;
  quantity:    number;
  price:       string;
  variant_id:  number;
  product_id:  number;
  properties?: Array<{ name: string; value: string }>;
}

interface ShopifyAddress {
  first_name?: string;
  last_name?:  string;
  address1?:   string;
  address2?:   string;
  city?:       string;
  province?:   string;
  province_code?: string;
  zip?:        string;
  country_code?: string;
  phone?:      string;
}

interface ShopifyOrder {
  id:           number;
  name:         string;  // "#1234"
  email:        string;
  line_items:   ShopifyLineItem[];
  shipping_address?: ShopifyAddress;
  billing_address?:  ShopifyAddress;
  note_attributes?: Array<{ name: string; value: string }>;
}

// ─── INSTALLER METADATA ───────────────────────────────────────────────────────

interface InstallerMeta {
  fulfillmentType:  string;   // "direct_to_customer" | "ship_to_installer"
  installerId:      string;
  installerName:    string;
  appointmentDate:  string;
  fitmentVerified:  boolean;
}

function extractInstallerMeta(order: ShopifyOrder): InstallerMeta {
  const attrs: Record<string, string> = {};
  for (const a of order.note_attributes || []) {
    attrs[a.name] = a.value;
  }
  return {
    fulfillmentType: attrs['gci_fulfillment_type'] || 'direct_to_customer',
    installerId:     attrs['gci_installer_id']     || '',
    installerName:   attrs['gci_installer_name']   || '',
    appointmentDate: attrs['gci_appointment_date'] || '',
    fitmentVerified: attrs['gci_fitment_verified'] === 'true',
  };
}

// ─── HMAC VERIFICATION ────────────────────────────────────────────────────────

async function readRawBody(req: VercelRequest): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end',  () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function verifyShopifyHmac(rawBody: Buffer, hmacHeader: string): boolean {
  if (!WEBHOOK_SECRET) {
    console.warn('⚠️  SHOPIFY_WEBHOOK_SECRET not set — skipping HMAC verification');
    return true;
  }
  const digest = crypto
    .createHmac('sha256', WEBHOOK_SECRET)
    .update(rawBody)
    .digest('base64');
  return crypto.timingSafeEqual(Buffer.from(digest), Buffer.from(hmacHeader));
}

// ─── AUTHORIZE-ORDER TOKEN ────────────────────────────────────────────────────

interface AuthTokenPayload {
  orderId:      number;
  orderNumber:  string;
  supplierType: 'TIRE' | 'NUPROZ';
  cjOrderId?:   string;    // set for NUPROZ orders
  exp:          number;    // unix ms
}

function buildAuthorizeUrl(payload: AuthTokenPayload): string {
  if (!ROUTER_SECRET) {
    console.warn('⚠️  ORDER_ROUTER_SECRET not set — authorize links will fail signature check');
  }
  const data    = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig     = crypto.createHmac('sha256', ROUTER_SECRET || 'dev').update(data).digest('hex');
  return `${APP_BASE_URL}/api/authorize-order?data=${data}&sig=${sig}`;
}

// ─── PURCHASE ORDER BUILDER (TIRE-) ───────────────────────────────────────────

interface TirePurchaseOrder {
  shopifyOrderId:   number;
  orderNumber:      string;
  items:            Array<{ sku: string; title: string; quantity: number; unitCost: number }>;
  shippingAddress:  ShopifyAddress;
  installerMeta:    InstallerMeta;
  createdAt:        string;
}

function buildTirePO(
  order:     ShopifyOrder,
  items:     ShopifyLineItem[],
  installer: InstallerMeta,
): TirePurchaseOrder {
  const shippingAddress =
    installer.fulfillmentType === 'ship_to_installer'
      ? {} // installer address looked up via installerId — left blank for manual resolution
      : (order.shipping_address || order.billing_address || {});

  return {
    shopifyOrderId:  order.id,
    orderNumber:     order.name,
    createdAt:       new Date().toISOString(),
    shippingAddress,
    installerMeta:   installer,
    items: items.map(i => ({
      sku:      i.sku,
      title:    i.title,
      quantity: i.quantity,
      unitCost: parseFloat(i.price) * TIRE_COST_RATIO,
    })),
  };
}

// ─── MAIN HANDLER ─────────────────────────────────────────────────────────────

export default async function handler(req: VercelRequest, res: VercelResponse) {

  // Only accept POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Read raw body for HMAC verification (must happen before JSON.parse)
  let rawBody: Buffer;
  let order:   ShopifyOrder;
  try {
    rawBody = await readRawBody(req);
    order   = JSON.parse(rawBody.toString('utf-8')) as ShopifyOrder;
  } catch {
    return res.status(400).json({ error: 'Invalid JSON body' });
  }

  // Verify Shopify webhook signature
  const hmacHeader = (req.headers['x-shopify-hmac-sha256'] as string) || '';
  if (!verifyShopifyHmac(rawBody, hmacHeader)) {
    console.error(`❌ HMAC verification failed for order ${order?.name}`);
    return res.status(401).json({ error: 'HMAC verification failed' });
  }

  // Only process paid orders (belt-and-suspenders; topic set in Shopify admin)
  const topic = req.headers['x-shopify-topic'] as string || '';
  if (topic && topic !== 'orders/paid') {
    return res.status(200).json({ skipped: true, topic });
  }

  console.log(`📦 Processing order ${order.name} (id=${order.id})`);

  // ── Split line items by SKU prefix ──────────────────────────────────────────

  const tireItems:   ShopifyLineItem[] = [];
  const nuProzItems: ShopifyLineItem[] = [];
  const unknownItems: ShopifyLineItem[] = [];

  for (const item of order.line_items) {
    const sku = (item.sku || '').toUpperCase();
    if (sku.startsWith(TIRE_PREFIX))   { tireItems.push(item);    continue; }
    if (sku.startsWith(NUPROZ_PREFIX)) { nuProzItems.push(item);  continue; }
    unknownItems.push(item);
  }

  if (unknownItems.length) {
    console.warn(`⚠️  Order ${order.name}: ${unknownItems.length} item(s) with unrecognised SKU prefix:`,
      unknownItems.map(i => i.sku).join(', '));
  }

  const installer = extractInstallerMeta(order);
  const routeResults: string[] = [];
  const errors:       string[] = [];

  const shippingAddr = order.shipping_address || order.billing_address || {};
  const customerName = [shippingAddr.first_name, shippingAddr.last_name].filter(Boolean).join(' ')
    || order.email;

  // ── Route TIRE- items ────────────────────────────────────────────────────────

  if (tireItems.length > 0) {
    try {
      const po = buildTirePO(order, tireItems, installer);

      const authToken = buildAuthorizeUrl({
        orderId:     order.id,
        orderNumber: order.name,
        supplierType:'TIRE',
        exp:         Date.now() + 24 * 60 * 60 * 1000,
      });

      const notifyItems = po.items.map(i => ({
        sku:      i.sku,
        title:    i.title,
        quantity: i.quantity,
        unitCost: i.unitCost,
      }));

      const totalCost = notifyItems.reduce((s, i) => s + i.unitCost * i.quantity, 0);

      const notifyPayload: NotifyOrderPayload = {
        shopifyOrderId:   order.id,
        orderNumber:      order.name,
        supplierType:     'TIRE',
        items:            notifyItems,
        totalCost,
        authorizeUrl:     authToken,
        customerName,
        shippingCity:     shippingAddr.city     || '',
        shippingProvince: shippingAddr.province  || shippingAddr.province_code || '',
        installerName:    installer.installerName  || undefined,
        appointmentDate:  installer.appointmentDate || undefined,
      };

      await sendOrderNotification(notifyPayload);

      // Log the PO to console (Vercel logs) for record-keeping
      console.log('🛞 TIRE PO:', JSON.stringify(po, null, 2));

      routeResults.push('TIRE: PO created, notification sent');
    } catch (err: any) {
      console.error('❌ TIRE routing error:', err);
      errors.push(`TIRE: ${err.message}`);
    }
  }

  // ── Route NUPROZ- items ──────────────────────────────────────────────────────

  if (nuProzItems.length > 0) {
    try {
      const cjProducts = nuProzItems.map(i => ({
        // CJ variant ID === Shopify SKU for NUPROZ- items (SKU is set to CJ vid at import time)
        vid:      i.sku.replace(/^NUPROZ-/i, ''),
        quantity: i.quantity,
      }));

      const cjOrder = await createPendingOrder({
        orderNumber:          order.name,
        shippingCountry:      shippingAddr.country_code || 'CA',
        shippingCustomerName: customerName,
        shippingPhone:        shippingAddr.phone || '',
        shippingAddress:      shippingAddr.address1 || '',
        shippingAddress2:     shippingAddr.address2 || '',
        shippingCity:         shippingAddr.city     || '',
        shippingProvince:     shippingAddr.province_code || shippingAddr.province || '',
        shippingZip:          shippingAddr.zip      || '',
        products:             cjProducts,
      });

      const authToken = buildAuthorizeUrl({
        orderId:     order.id,
        orderNumber: order.name,
        supplierType:'NUPROZ',
        cjOrderId:   cjOrder.orderId,
        exp:         Date.now() + 24 * 60 * 60 * 1000,
      });

      const notifyItems = nuProzItems.map(i => ({
        sku:      i.sku,
        title:    i.title,
        quantity: i.quantity,
        unitCost: parseFloat(i.price) * NUPROZ_COST_RATIO,
      }));

      const totalCost = notifyItems.reduce((s, i) => s + i.unitCost * i.quantity, 0);

      const notifyPayload: NotifyOrderPayload = {
        shopifyOrderId:   order.id,
        orderNumber:      `${order.name}-NUPROZ`,
        supplierType:     'NUPROZ',
        items:            notifyItems,
        totalCost,
        authorizeUrl:     authToken,
        customerName,
        shippingCity:     shippingAddr.city    || '',
        shippingProvince: shippingAddr.province || shippingAddr.province_code || '',
      };

      await sendOrderNotification(notifyPayload);

      routeResults.push(`NUPROZ: CJ pending order ${cjOrder.orderId} created, notification sent`);
    } catch (err: any) {
      console.error('❌ NUPROZ routing error:', err);
      errors.push(`NUPROZ: ${err.message}`);
    }
  }

  // ── Respond to Shopify ────────────────────────────────────────────────────────
  // Shopify requires a 200 within 5s or it will retry.

  if (errors.length && routeResults.length === 0) {
    // All routes failed — return 500 so Shopify retries
    return res.status(500).json({ error: 'All routing failed', errors });
  }

  return res.status(200).json({
    ok:      true,
    order:   order.name,
    routed:  routeResults,
    ...(errors.length ? { warnings: errors } : {}),
  });
}
