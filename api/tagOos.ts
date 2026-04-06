// api/tagOos.ts
// ============================================================
// Syncs the "sold-out" tag on every Shopify product based on
// live variant inventory, then sends back-in-stock notification
// emails (via Resend) to Airtable subscribers for any product
// that just transitioned sold-out → in-stock.
//
// A product is considered OOS when:
//   • At least one variant tracks inventory (inventory_management ≠ null)
//   • AND every tracked variant has inventory_quantity ≤ 0
//
// Products whose variants don't track inventory are never tagged.
//
// Runs every 6 hours via Vercel cron.
// Also callable manually: GET /api/tagOos
// ============================================================

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Resend } from 'resend';

export const config = { maxDuration: 300 };

// ─── CONFIG ───────────────────────────────────────────────────────────────────

const SHOPIFY = {
  domain:     process.env.SHOPIFY_STORE_DOMAIN       || '',
  token:      process.env.SHOPIFY_ADMIN_ACCESS_TOKEN || '',
  apiVersion: '2024-01',
  get baseUrl() { return `https://${this.domain}/admin/api/${this.apiVersion}`; },
};

const AIRTABLE_API_KEY = process.env.AIRTABLE_API_KEY || '';
const AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID || '';
const AIRTABLE_TABLE   = 'BackInStock_Requests';

const resend  = new Resend(process.env.RESEND_API_KEY);
const OOS_TAG = 'sold-out';

function delay(ms: number) { return new Promise(r => setTimeout(r, ms)); }

// ─── SHOPIFY ──────────────────────────────────────────────────────────────────

async function shopifyFetchRaw(url: string, options: RequestInit = {}): Promise<Response> {
  let wait = 2000;
  while (true) {
    const res = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': SHOPIFY.token,
        ...(options.headers ?? {}),
      },
    });
    if (res.status === 429) { await delay(wait); wait = Math.min(wait * 2, 16000); continue; }
    return res;
  }
}

interface ShopifyVariant {
  inventory_quantity:   number;
  inventory_management: string | null;
}

interface ShopifyProduct {
  id:       number;
  title:    string;
  tags:     string;         // comma-separated string
  variants: ShopifyVariant[];
}

async function fetchAllProducts(): Promise<ShopifyProduct[]> {
  const all: ShopifyProduct[] = [];
  let url: string | null =
    `${SHOPIFY.baseUrl}/products.json?limit=250&fields=id,title,tags,variants`;

  while (url) {
    const res  = await shopifyFetchRaw(url);
    const data: any = await res.json();
    all.push(...(data.products ?? []));
    const link = res.headers.get('Link') ?? '';
    const next = link.match(/<([^>]+)>;\s*rel="next"/);
    url = next ? next[1] : null;
  }

  return all;
}

function parseTags(raw: string): Set<string> {
  return new Set(raw.split(',').map(t => t.trim()).filter(Boolean));
}

function stringifyTags(tags: Set<string>): string {
  return Array.from(tags).join(', ');
}

// A product is OOS when every tracked variant has qty ≤ 0.
// Products with no tracked variants (digital, untracked) are never OOS.
function isOos(product: ShopifyProduct): boolean {
  const tracked = product.variants.filter(v => v.inventory_management !== null);
  if (tracked.length === 0) return false;
  return tracked.every(v => v.inventory_quantity <= 0);
}

async function updateProductTags(productId: number, tags: Set<string>): Promise<void> {
  const res = await shopifyFetchRaw(`${SHOPIFY.baseUrl}/products/${productId}.json`, {
    method: 'PUT',
    body:   JSON.stringify({ product: { id: productId, tags: stringifyTags(tags) } }),
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 120)}`);
  }
}

// ─── AIRTABLE ─────────────────────────────────────────────────────────────────

interface BackInStockRecord {
  id:     string;
  fields: { Email: string; ProductId: string; ProductTitle: string; Notified: boolean };
}

async function fetchSubscribers(productId: number): Promise<BackInStockRecord[]> {
  if (!AIRTABLE_API_KEY || !AIRTABLE_BASE_ID) return [];
  const filter = `AND({ProductId}="${productId}",{Notified}=FALSE())`;
  const res = await fetch(
    `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${encodeURIComponent(AIRTABLE_TABLE)}?filterByFormula=${encodeURIComponent(filter)}`,
    { headers: { Authorization: `Bearer ${AIRTABLE_API_KEY}` } },
  );
  if (!res.ok) return [];
  const data: any = await res.json();
  return data.records ?? [];
}

async function markNotified(recordIds: string[]): Promise<void> {
  // Airtable PATCH supports up to 10 records per call
  for (let i = 0; i < recordIds.length; i += 10) {
    const batch = recordIds.slice(i, i + 10);
    await fetch(
      `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${encodeURIComponent(AIRTABLE_TABLE)}`,
      {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${AIRTABLE_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ records: batch.map(id => ({ id, fields: { Notified: true } })) }),
      },
    );
    if (i + 10 < recordIds.length) await delay(200);
  }
}

// ─── EMAIL ────────────────────────────────────────────────────────────────────

async function sendBackInStockEmail(email: string, productTitle: string): Promise<void> {
  await resend.emails.send({
    from:    'GCI Tires <noreply@updates.gcitires.ca>',
    to:      [email],
    subject: `${productTitle} is back in stock!`,
    html: `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
        <table width="100%" cellpadding="0" cellspacing="0"
               style="background:#B8192E;padding:20px 24px;border-radius:4px 4px 0 0;">
          <tr>
            <td>
              <table cellpadding="0" cellspacing="0">
                <tr>
                  <td style="padding-right:10px;">
                    <img src="https://gci-brain.vercel.app/gci-mark-white.png"
                         width="22" height="28" alt="" style="display:block;" />
                  </td>
                  <td>
                    <div style="color:#fff;font-size:15px;font-weight:700;letter-spacing:0.08em;line-height:1.2;">
                      GCI TIRES
                    </div>
                    <div style="color:rgba(255,255,255,0.7);font-size:11px;letter-spacing:0.06em;">
                      gcitires.com
                    </div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
        <div style="background:#fff;padding:32px 24px;border:1px solid #e5e5e5;
                    border-top:none;border-radius:0 0 4px 4px;">
          <h1 style="font-size:22px;color:#111;margin:0 0 16px;">Good news — it's back! 🎉</h1>
          <p style="color:#444;font-size:15px;line-height:1.6;margin:0 0 24px;">
            <strong>${productTitle}</strong> is now back in stock at GCI Tires.
          </p>
          <a href="https://gcitires.com/collections/all"
             style="display:inline-block;background:#B8192E;color:#fff;text-decoration:none;
                    font-size:14px;font-weight:700;padding:12px 24px;border-radius:3px;
                    letter-spacing:0.05em;">
            SHOP NOW →
          </a>
          <p style="color:#999;font-size:12px;margin:24px 0 0;line-height:1.6;">
            You received this because you asked to be notified about this product.<br/>
            <a href="https://gcitires.com" style="color:#B8192E;">Visit GCI Tires</a>
          </p>
        </div>
      </div>
    `,
  });
}

// ─── HANDLER ──────────────────────────────────────────────────────────────────

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Content-Type', 'application/json');

  if (!SHOPIFY.domain || !SHOPIFY.token) {
    return res.status(500).json({ error: 'Missing SHOPIFY_STORE_DOMAIN or SHOPIFY_ADMIN_ACCESS_TOKEN' });
  }

  console.log('tagOos: starting run');

  let allProducts: ShopifyProduct[];
  try {
    allProducts = await fetchAllProducts();
  } catch (err) {
    return res.status(500).json({ error: `Failed to fetch products: ${String(err)}` });
  }

  console.log(`tagOos: fetched ${allProducts.length} products`);

  let tagged          = 0;
  let untagged        = 0;
  let notified        = 0;
  const errors: string[] = [];
  const backInStock: ShopifyProduct[] = [];   // products that just became available

  for (const product of allProducts) {
    try {
      const tags   = parseTags(product.tags);
      const wasOos = tags.has(OOS_TAG);
      const nowOos = isOos(product);

      if (nowOos && !wasOos) {
        tags.add(OOS_TAG);
        await updateProductTags(product.id, tags);
        tagged++;
        console.log(`  + tagged   [${product.id}] "${product.title}"`);
      } else if (!nowOos && wasOos) {
        tags.delete(OOS_TAG);
        await updateProductTags(product.id, tags);
        untagged++;
        backInStock.push(product);
        console.log(`  - untagged [${product.id}] "${product.title}"`);
      }
    } catch (err) {
      const msg = `Product ${product.id} ("${product.title}"): ${String(err)}`;
      console.error(`  ✗ ${msg}`);
      errors.push(msg);
    }
    await delay(80); // stay well within Shopify rate limits
  }

  // ── Back-in-stock notifications ────────────────────────────────────────────
  for (const product of backInStock) {
    try {
      const subscribers = await fetchSubscribers(product.id);
      if (subscribers.length === 0) continue;

      console.log(`  📧 Notifying ${subscribers.length} subscriber(s) for "${product.title}"`);

      for (const record of subscribers) {
        try {
          await sendBackInStockEmail(record.fields.Email, product.title);
          notified++;
        } catch (err) {
          errors.push(`Email to ${record.fields.Email} (product ${product.id}): ${String(err)}`);
        }
      }

      await markNotified(subscribers.map(r => r.id));
    } catch (err) {
      errors.push(`Notifications for product ${product.id}: ${String(err)}`);
    }
  }

  const report = { tagged, untagged, notified, errors };
  console.log(`tagOos: done — tagged:${tagged} untagged:${untagged} notified:${notified} errors:${errors.length}`);
  return res.status(200).json(report);
}
