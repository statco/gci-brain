// api/lib/walmart-client.ts
// ============================================================
// Walmart Marketplace API client (Canada only)
//
// Required env vars:
//   WALMART_CLIENT_ID      — Marketplace seller client ID
//   WALMART_CLIENT_SECRET  — Marketplace seller client secret
//   WALMART_BASE_URL       — Base URL (default: https://marketplace.walmartapis.com)
//                            Canada is identified via WM_MARKET header, not the URL.
//   WALMART_MARKET         — Market identifier (default: CA)
//
// Auth: OAuth 2.0 client credentials (token valid ~15 min, cached here)
//
// Docs: https://developer.walmart.com/doc/ca/mp/
// ============================================================

const WALMART_BASE = (process.env.WALMART_BASE_URL || 'https://marketplace.walmartapis.com').replace(/\/$/, '');

// ─── TOKEN CACHE ──────────────────────────────────────────────────────────────

let _walmartToken:    string | null = null;
let _walmartTokenExp: number        = 0;

async function getWalmartToken(): Promise<string> {
  if (_walmartToken && Date.now() < _walmartTokenExp - 60_000) return _walmartToken;

  const clientId     = process.env.WALMART_CLIENT_ID     || '';
  const clientSecret = process.env.WALMART_CLIENT_SECRET || '';

  if (!clientId || !clientSecret) {
    throw new Error('Walmart credentials not configured. Set WALMART_CLIENT_ID and WALMART_CLIENT_SECRET.');
  }

  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

  const res = await fetch(`${WALMART_BASE}/v3/token`, {
    method: 'POST',
    headers: {
      'Authorization':              `Basic ${credentials}`,
      'Content-Type':               'application/x-www-form-urlencoded',
      'WM_SVC.NAME':                'Walmart Marketplace',
      'WM_QOS.CORRELATION_ID':      `gci-${Date.now()}`,
      'WM_MARKET':                  process.env.WALMART_MARKET || 'CA',
      'WM_CONSUMER.CHANNEL.TYPE':   'WALMART_CA',
    },
    body: 'grant_type=client_credentials',
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Walmart auth failed: HTTP ${res.status} — ${body.slice(0, 200)}`);
  }

  const data: any = await res.json();
  _walmartToken    = data.access_token as string;
  const expiresIn  = (data.expires_in as number) || 900; // seconds, default 15 min
  _walmartTokenExp = Date.now() + expiresIn * 1000;

  console.log(`✅ Walmart token refreshed, expires in ${expiresIn}s`);
  return _walmartToken!;
}

// ─── INTERNAL FETCH HELPER ────────────────────────────────────────────────────

async function walmartFetch<T>(
  path:    string,
  options: RequestInit = {},
  accept:  string = 'application/json',
): Promise<T> {
  const token = await getWalmartToken();
  const res   = await fetch(`${WALMART_BASE}${path}`, {
    ...options,
    headers: {
      'Authorization':              `Bearer ${token}`,
      'Content-Type':               'application/json',
      'Accept':                     accept,
      'WM_SVC.NAME':                'Walmart Marketplace',
      'WM_QOS.CORRELATION_ID':      `gci-${Date.now()}`,
      'WM_MARKET':                  process.env.WALMART_MARKET || 'CA',
      'WM_CONSUMER.CHANNEL.TYPE':   'WALMART_CA',
      ...(options.headers || {}),
    },
  });

  if (res.status === 429) {
    // Walmart rate limit — back off 2s and retry once
    await new Promise(r => setTimeout(r, 2000));
    return walmartFetch<T>(path, options, accept);
  }

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Walmart API ${res.status} on ${path}: ${body.slice(0, 300)}`);
  }

  // Some endpoints return 204 No Content
  if (res.status === 204) return {} as T;
  return res.json() as Promise<T>;
}

// ─── TYPES ────────────────────────────────────────────────────────────────────

export interface WalmartPriceItem {
  sku:   string;
  price: number; // CAD, two decimal places
}

export interface WalmartInventoryItem {
  sku:      string;
  quantity: number; // 0 to disable listing
}

export interface WalmartSyncResult {
  pricesUpdated:    number;
  inventoryUpdated: number;
  errors:           string[];
}

// ─── PRICE FEED ───────────────────────────────────────────────────────────────

/**
 * Push price updates to Walmart in a single bulk feed.
 * Walmart accepts up to 1000 items per feed call.
 */
export async function pushPrices(items: WalmartPriceItem[]): Promise<string> {
  const feedItems = items.map(i => ({
    sku:       i.sku,
    pricing: {
      currentPrice: {
        currency: 'CAD',
        amount:   parseFloat(i.price.toFixed(2)),
      },
    },
  }));

  const body = {
    PriceFeed: {
      '@xmlns': 'http://walmart.com/',
      PriceHeader: { version: '1.7' },
      Price: feedItems,
    },
  };

  const data: any = await walmartFetch<any>('/v3/price', {
    method: 'PUT',
    body:   JSON.stringify(body),
  });

  const feedId = data?.feedId || data?.FeedId || 'unknown';
  console.log(`✅ Walmart price feed submitted: feedId=${feedId}, items=${items.length}`);
  return feedId;
}

// ─── INVENTORY FEED ───────────────────────────────────────────────────────────

/**
 * Push inventory quantity updates to Walmart.
 * Walmart accepts up to 1000 items per feed call.
 *
 * SAFETY: Callers must apply the qty < 4 → 0 rule BEFORE calling this.
 */
export async function pushInventory(items: WalmartInventoryItem[]): Promise<string> {
  const feedItems = items.map(i => ({
    sku:       i.sku,
    quantity: {
      unit:   'EACH',
      amount: Math.max(0, i.quantity),
    },
  }));

  const body = {
    InventoryFeed: {
      '@xmlns': 'http://walmart.com/',
      InventoryHeader: { version: '1.4' },
      item: feedItems,
    },
  };

  const data: any = await walmartFetch<any>('/v3/inventory', {
    method: 'PUT',
    body:   JSON.stringify({ InventoryHeader: { version: '1.4' }, item: feedItems }),
  });

  const feedId = data?.feedId || data?.FeedId || 'unknown';
  console.log(`✅ Walmart inventory feed submitted: feedId=${feedId}, items=${items.length}`);
  return feedId;
}

/**
 * Chunk an array into subarrays of maxSize.
 * Walmart's bulk feed endpoints cap at 1000 items.
 */
export function chunkArray<T>(arr: T[], maxSize = 1000): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += maxSize) {
    chunks.push(arr.slice(i, i + maxSize));
  }
  return chunks;
}

/**
 * Check the status of a previously submitted feed.
 */
export async function getFeedStatus(feedId: string): Promise<any> {
  return walmartFetch<any>(`/v3/feeds/${feedId}?includeDetails=true`);
}
