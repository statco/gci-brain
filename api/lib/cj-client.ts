// api/lib/cj-client.ts
// ============================================================
// CJ Dropshipping API v2 client
//
// Required env vars:
//   CJ_EMAIL   — CJ account email
//   CJ_API_KEY — CJ API key (used as the password in the auth request)
//
// Token lifecycle:
//   - Access tokens expire per accessTokenExpiryDate returned by CJ
//   - Refresh tokens are used to obtain a new access token transparently
//   - Both are cached in-process
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

let _token:        string | null = null;
let _tokenExp:     number        = 0;   // unix ms
let _refreshToken: string | null = null;

async function getAccessToken(): Promise<string> {
  if (_token && Date.now() < _tokenExp - 60_000) return _token;

  // Try refresh first if we have a refresh token
  if (_refreshToken) {
    try {
      return await refreshAccessToken();
    } catch {
      // Fall through to full re-auth
      _refreshToken = null;
    }
  }

  const email  = process.env.CJ_EMAIL   || '';
  const apiKey = process.env.CJ_API_KEY || '';

  if (!email || !apiKey) {
    throw new Error('CJ Dropshipping credentials not configured. Set CJ_EMAIL and CJ_API_KEY.');
  }

  const res = await fetch(`${CJ_BASE}/authentication/getAccessToken`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ email, password: apiKey }),
  });

  const data: any = await res.json();
  if (!data.result || !data.data?.accessToken) {
    throw new Error(`CJ auth failed: ${JSON.stringify(data.message || data)}`);
  }

  _token        = data.data.accessToken  as string;
  _refreshToken = data.data.refreshToken as string | null;
  _tokenExp     = data.data.accessTokenExpiryDate
    ? new Date(data.data.accessTokenExpiryDate).getTime()
    : Date.now() + 55 * 60 * 1000; // fallback: 55 minutes

  console.log('✅ CJ Dropshipping access token refreshed');
  return _token;
}

async function refreshAccessToken(): Promise<string> {
  const res = await fetch(`${CJ_BASE}/authentication/refreshAccessToken`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ refreshToken: _refreshToken }),
  });

  const data: any = await res.json();
  if (!data.result || !data.data?.accessToken) {
    throw new Error(`CJ token refresh failed: ${JSON.stringify(data.message || data)}`);
  }

  _token        = data.data.accessToken  as string;
  _refreshToken = data.data.refreshToken as string | null ?? _refreshToken;
  _tokenExp     = data.data.accessTokenExpiryDate
    ? new Date(data.data.accessTokenExpiryDate).getTime()
    : Date.now() + 55 * 60 * 1000;

  console.log('✅ CJ Dropshipping access token refreshed via refresh token');
  return _token!;
}

// ─── INTERNAL FETCH HELPER ────────────────────────────────────────────────────

async function cjFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = await getAccessToken();
  const res = await fetch(`${CJ_BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type':    'application/json',
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
