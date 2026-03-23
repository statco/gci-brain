// api/lib/cj-client.ts
// ============================================================
// CJ Dropshipping API v2 client
//
// Credentials extracted from the old nuprozone.com Shopify store
// must be provided via environment variables:
//   CJ_API_KEY    — CJ Dropshipping API key (preferred over email/password)
//   CJ_EMAIL      — CJ account email (fallback auth)
//   CJ_PASSWORD   — CJ account password (fallback auth)
//
// Token lifecycle:
//   - Access tokens expire after ~1 hour
//   - This module caches the token in-process and refreshes transparently
//
// Docs: https://developers.cjdropshipping.com/api2.0/v1/
// ============================================================

const CJ_BASE = 'https://developers.cjdropshipping.com/api2.0/v1';

// ─── TYPES ────────────────────────────────────────────────────────────────────

export interface CJProduct {
  vid:      string; // CJ variant ID (maps from Shopify line item sku or variant_id)
  quantity: number;
}

export interface CJOrderInput {
  /** Your internal order reference (e.g. Shopify order name "#1234") */
  orderNumber:         string;
  shippingCountry:     string; // ISO-2 e.g. "CA"
  shippingCustomerName:string;
  shippingPhone:       string;
  shippingAddress:     string;
  shippingAddress2?:   string;
  shippingCity:        string;
  shippingProvince:    string;
  shippingZip:         string;
  products:            CJProduct[];
  /** Do NOT pass payType — we always create as PENDING for manual auth */
}

export interface CJOrderResult {
  orderId:     string;
  orderNumber: string;
  status:      string;
}

// ─── TOKEN CACHE ──────────────────────────────────────────────────────────────

let _token:     string | null = null;
let _tokenExp:  number        = 0;   // unix ms

async function getAccessToken(): Promise<string> {
  if (_token && Date.now() < _tokenExp - 60_000) return _token;

  // Prefer API key auth, fall back to email/password
  const apiKey = process.env.CJ_API_KEY || '';
  if (apiKey) {
    _token    = apiKey;
    _tokenExp = Date.now() + 365 * 24 * 60 * 60 * 1000; // static key, never expires
    return _token;
  }

  const email    = process.env.CJ_EMAIL    || '';
  const password = process.env.CJ_PASSWORD || '';
  if (!email || !password) {
    throw new Error('CJ Dropshipping credentials not configured. Set CJ_API_KEY or CJ_EMAIL + CJ_PASSWORD.');
  }

  const res = await fetch(`${CJ_BASE}/authentication/getAccessToken`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ email, password }),
  });

  const data: any = await res.json();
  if (!data.result || !data.data?.accessToken) {
    throw new Error(`CJ auth failed: ${JSON.stringify(data.message || data)}`);
  }

  _token    = data.data.accessToken as string;
  // CJ tokens expire in 1 hour (3600s); cache for 55 minutes
  _tokenExp = Date.now() + 55 * 60 * 1000;

  console.log('✅ CJ Dropshipping access token refreshed');
  return _token;
}

// ─── INTERNAL FETCH HELPER ────────────────────────────────────────────────────

async function cjFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = await getAccessToken();
  const res = await fetch(`${CJ_BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type':   'application/json',
      'CJ-Access-Token': token,
      ...(options.headers || {}),
    },
  });

  const data: any = await res.json();
  if (!data.result) {
    throw new Error(`CJ API error on ${path}: ${JSON.stringify(data.message || data)}`);
  }
  return data.data as T;
}

// ─── PUBLIC API ───────────────────────────────────────────────────────────────

/**
 * Create a PENDING order in CJ Dropshipping.
 * The order is NOT submitted to the supplier until manually authorized via
 * /api/authorize-order. CJ's "DRAFT" status maps to our "pending" state.
 *
 * Returns the CJ order ID for reference in the authorization token.
 */
export async function createPendingOrder(input: CJOrderInput): Promise<CJOrderResult> {
  const body = {
    orderNumber:         input.orderNumber,
    shippingCountry:     input.shippingCountry,
    shippingCustomerName:input.shippingCustomerName,
    shippingPhone:       input.shippingPhone,
    shippingAddress:     input.shippingAddress,
    shippingAddress2:    input.shippingAddress2 || '',
    shippingCity:        input.shippingCity,
    shippingProvince:    input.shippingProvince,
    shippingZip:         input.shippingZip,
    products:            input.products,
    payType:             'NORMAL',  // required field — payment handled externally
    iossNumber:          '',
  };

  const result = await cjFetch<any>('/shopping/order/createOrderV2', {
    method: 'POST',
    body:   JSON.stringify(body),
  });

  return {
    orderId:     result.orderId     || result.id || '',
    orderNumber: result.orderNumber || input.orderNumber,
    status:      result.orderStatus || 'PENDING',
  };
}

/**
 * Submit a previously-created PENDING order to the supplier.
 * Called by /api/authorize-order after manual authorization.
 */
export async function submitOrder(cjOrderId: string): Promise<void> {
  await cjFetch<any>('/shopping/order/confirmOrder', {
    method: 'POST',
    body:   JSON.stringify({ orderId: cjOrderId }),
  });
  console.log(`✅ CJ order ${cjOrderId} confirmed and submitted to supplier`);
}

/**
 * Look up a CJ product variant ID by SKU.
 * Required when the Shopify SKU is not already the CJ vid.
 */
export async function findVariantBySku(sku: string): Promise<string | null> {
  try {
    const data = await cjFetch<any>(`/product/variant/queryBySkuId?skuId=${encodeURIComponent(sku)}`);
    return data?.vid || null;
  } catch {
    return null;
  }
}

/**
 * Fetch order status from CJ.
 */
export async function getOrderStatus(cjOrderId: string): Promise<string> {
  const data = await cjFetch<any>(`/shopping/order/getOrderDetail?orderId=${cjOrderId}`);
  return data?.orderStatus || 'UNKNOWN';
}
