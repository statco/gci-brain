import type { VercelRequest, VercelResponse } from '@vercel/node';

// ─── auto-request-cron.ts ───────────────────────────────────────────────────
// Automates what /api/reviews/request always needed a human to trigger
// manually: finds orders fulfilled REVIEW_REQUEST_DELAY_DAYS ago, skips any
// order that already has a Review_Requests record (dedup via Airtable, same
// table request.ts itself writes to), and calls request.ts's own logic for
// each qualifying order — no duplicated email/token logic, this only finds
// orders and reuses the existing endpoint.
//
// WHY 5 DAYS: gives the tire delivery + at least one drive on it time to
// happen before asking for a review. Adjust REVIEW_REQUEST_DELAY_DAYS below
// if that's not the right window — not a value with any deeper significance.
//
// Runs as a Vercel cron (see vercel.json) — GET, no auth required for the
// cron trigger itself (Vercel's cron secret handles that at the platform
// level, same pattern as this repo's other cron endpoints), but the
// downstream call to /api/reviews/request still requires ADMIN_SECRET,
// which this file already has direct env access to.
//
// GET ?dryRun=true — finds and logs what WOULD be sent, sends nothing.
// GET (no dryRun, or dryRun=false) — actually triggers the emails.

const REVIEW_REQUEST_DELAY_DAYS = 5;
const SHOPIFY_DOMAIN = process.env.SHOPIFY_STORE_DOMAIN!;
const SHOPIFY_TOKEN = process.env.SHOPIFY_ADMIN_ACCESS_TOKEN!;
const ADMIN_SECRET = process.env.ADMIN_SECRET!;
const AIRTABLE_BASE = `https://api.airtable.com/v0/${process.env.AIRTABLE_BASE_ID}`;

function atHeaders() {
  return {
    Authorization: `Bearer ${process.env.AIRTABLE_API_KEY}`,
    'Content-Type': 'application/json',
  };
}

interface OrderNode {
  id: string;
  name: string;
  email: string | null;
  fulfillments: { createdAt: string }[];
  lineItems: { edges: { node: { product: { id: string; title: string; handle: string } | null } }[] };
}

async function shopifyGraphQL<T>(query: string): Promise<T> {
  const r = await fetch(`https://${SHOPIFY_DOMAIN}/admin/api/2024-01/graphql.json`, {
    method: 'POST',
    headers: { 'X-Shopify-Access-Token': SHOPIFY_TOKEN, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  const data = await r.json();
  if (data.errors) throw new Error(`Shopify GraphQL error: ${JSON.stringify(data.errors)}`);
  return data.data as T;
}

async function alreadyRequested(orderId: string): Promise<boolean> {
  const formula = encodeURIComponent(`{OrderId}="${orderId}"`);
  const r = await fetch(`${AIRTABLE_BASE}/Review_Requests?filterByFormula=${formula}&maxRecords=1`, {
    headers: atHeaders(),
  });
  if (!r.ok) {
    // Fail safe: if we can't confirm dedup status, don't send — better to
    // miss a review request than double-email a customer.
    console.error(`[auto-request-cron] dedup check failed for order ${orderId}: ${r.status}`);
    return true;
  }
  const data = await r.json() as { records: unknown[] };
  return data.records.length > 0;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const dryRun = req.query.dryRun !== 'false'; // default TRUE — must explicitly pass dryRun=false to send live

  const targetDate = new Date();
  targetDate.setDate(targetDate.getDate() - REVIEW_REQUEST_DELAY_DAYS);
  const windowStart = new Date(targetDate); windowStart.setHours(0, 0, 0, 0);
  const windowEnd = new Date(targetDate); windowEnd.setHours(23, 59, 59, 999);

  // Cast a slightly wider net on updated_at (proxy for fulfillment date via
  // REST/GraphQL order search) than the exact target day, then filter
  // precisely using each order's real fulfillment.createdAt below —
  // updated_at alone isn't precise enough since other order edits also
  // bump it.
  const searchStart = new Date(windowStart); searchStart.setDate(searchStart.getDate() - 1);
  const searchEnd = new Date(windowEnd); searchEnd.setDate(searchEnd.getDate() + 1);

  const query = `{
    orders(first: 100, query: "fulfillment_status:fulfilled AND updated_at:>=${searchStart.toISOString()} AND updated_at:<=${searchEnd.toISOString()}") {
      edges {
        node {
          id
          name
          email
          fulfillments(first: 5) { createdAt }
          lineItems(first: 20) {
            edges { node { product { id title handle } } }
          }
        }
      }
    }
  }`;

  let orders: OrderNode[];
  try {
    const data = await shopifyGraphQL<{ orders: { edges: { node: OrderNode }[] } }>(query);
    orders = data.orders.edges.map(e => e.node);
  } catch (e) {
    return res.status(500).json({ success: false, error: e instanceof Error ? e.message : String(e) });
  }

  const results: any[] = [];
  let sent = 0, skippedAlreadyRequested = 0, skippedNoEmail = 0, skippedOutOfWindow = 0, errors = 0;

  for (const order of orders) {
    // Match on the FIRST fulfillment's actual date, precisely within the
    // target day — updated_at above was just a coarse pre-filter.
    const fulfilledAt = order.fulfillments[0]?.createdAt ? new Date(order.fulfillments[0].createdAt) : null;
    if (!fulfilledAt || fulfilledAt < windowStart || fulfilledAt > windowEnd) {
      skippedOutOfWindow++;
      continue;
    }
    if (!order.email) {
      skippedNoEmail++;
      continue;
    }

    const orderId = order.id.split('/').pop()!;
    if (await alreadyRequested(orderId)) {
      skippedAlreadyRequested++;
      continue;
    }

    const lineItems = order.lineItems.edges
      .map(e => e.node.product)
      .filter((p): p is { id: string; title: string; handle: string } => p !== null)
      .map(p => ({
        productId: p.id.split('/').pop()!,
        productTitle: p.title,
        productHandle: p.handle,
      }));

    if (lineItems.length === 0) { skippedNoEmail++; continue; } // no linked products (e.g. all custom/deleted items)

    if (dryRun) {
      results.push({ orderId, orderName: order.name, email: order.email, lineItems, fulfilledAt: fulfilledAt.toISOString(), wouldSend: true });
      sent++; // counts as "would send" in dry-run
      continue;
    }

    try {
      const r = await fetch(`https://${req.headers.host}/api/reviews/request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ADMIN_SECRET}` },
        body: JSON.stringify({ orderId, email: order.email, lineItems }),
      });
      const d = await r.json();
      if (r.ok && d.sent > 0) {
        sent++;
        results.push({ orderId, orderName: order.name, email: order.email, sent: d.sent });
      } else {
        errors++;
        results.push({ orderId, orderName: order.name, error: d.errors || 'unknown error' });
      }
    } catch (e) {
      errors++;
      results.push({ orderId, orderName: order.name, error: e instanceof Error ? e.message : String(e) });
    }
  }

  return res.status(200).json({
    success: true,
    dryRun,
    targetFulfillmentDate: windowStart.toISOString().split('T')[0],
    totalOrdersScanned: orders.length,
    sent, skippedAlreadyRequested, skippedNoEmail, skippedOutOfWindow, errors,
    results,
  });
}
