// Proxy all Airtable calls through /api/airtable serverless function
const INSTALLERS_TABLE = 'Installers';

// Mock data fallback to prevent 500 errors if Airtable is unreachable
const MOCK_DATA = [
  {
    id: 'mock-1',
    name: 'GCI Partner - Rouyn (Mock)',
    address: '1014 Chemin des Coniferes',
    city: 'Rouyn-Noranda',
    province: 'QC',
    phone: '819-555-0123',
    calendlyLink: 'https://calendly.com/gci-tires',
    distance: 1.2,
    lat: 48.2368,
    lng: -79.0228
  }
];

/**
 * Proxy call to /api/airtable (server-to-server auth only as of 2026-07 --
 * see that file. Still used by createInstallationJob below, which is
 * itself currently dead/unused from the app, and getInstallerCouponCode,
 * also dead. Neither is wired to anything today; left as-is rather than
 * removed, since deleting working-but-unused code wasn't asked for here.
 */

async function airtableRequest(
  method: string,
  table: string,
  body?: any,
  filter?: string,
  recordId?: string
): Promise<any> {
  const response = await fetch('/api/airtable', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ table, method, body, filter, recordId }),
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(`Airtable proxy error: ${response.status} ${JSON.stringify(error)}`);
  }
  return response.json();
}

/**
 * Submit installer application to Airtable
 */
export async function submitInstallerApplication(formData: {
  businessName: string;
  contactName: string;
  email: string;
  phone: string;
  address: string;
  city: string;
  province: string;
  postalCode: string;
  serviceRadius?: number;
  licenseNumber?: string;
  insuranceExpiry?: string;
  calendarLink?: string;
  paymentMethod?: string;
  bankInfo?: string;
  hourlyRate?: number;
  notes?: string;
}): Promise<{ success: boolean; recordId?: string; error?: string }> {
  // FIXED 2026-07: previously posted to APPLICATIONS_TABLE ('Installer
  // Applications'), a table that does not exist in this Airtable base and
  // wasn't even in the proxy's allowed-table list -- every real
  // application failed outright. Now calls a purpose-built endpoint that
  // writes to the real Installers table with the real field names.
  try {
    const res = await fetch('/api/submit-installer-application', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(formData),
    });
    const data = await res.json();
    if (!res.ok) {
      return { success: false, error: data.error || 'Failed to submit application. Please try again.' };
    }
    return { success: true, recordId: data.recordId };
  } catch (error) {
    console.error('Failed to submit installer application:', error);
    return { success: false, error: 'Erreur de connexion. Veuillez réessayer.' };
  }
}

export const airtableService = {
  // FIXED 2026-07: previously fetched the FULL Installers table record set
  // (via the generic /api/airtable proxy) directly into the browser, then
  // filtered client-side. Every field on the table -- including Bank Info,
  // License Number, Insurance Expiry, Payment Method, Hourly Rate, and
  // internal Notes -- was visible in the raw network response to any real
  // customer's browser during a normal AI Match booking flow, regardless
  // of which fields the UI actually displayed. Now calls a purpose-built
  // endpoint that does the filtering server-side and returns only the
  // fields this component actually uses.
  async findNearbyInstallers(userLat: number, userLng: number, radiusKm: number = 100) {
    try {
      const res = await fetch(`/api/nearby-installers?lat=${userLat}&lng=${userLng}&radiusKm=${radiusKm}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to fetch installers');
      return data.installers;
    } catch (error) {
      console.error("Airtable Fetch Failed:", error);
      // Critical fallback: Return Mock Data so the SuccessView UI never breaks
      return MOCK_DATA;
    }
  },

  async createInstallationJob(data: {
    CustomerName: string;
    CustomerEmail: string;
    CustomerPhone: string;
    InstallerId: string;
    TireProduct: string;
    Quantity: number;
    InstallationPrice: number;
    Status: string;
    ShopifyOrderId: string;
    Notes?: string;
    CouponIssued?: string;
  }) {
    try {
      return await airtableRequest('POST', 'Installation Jobs', data);
    } catch (error) {
      console.error('createInstallationJob failed:', error);
      // Non-blocking — log but don't throw so checkout still completes
      return null;
    }
  },

  /**
   * Fetch the loyalty CouponCode stored on an Installers record.
   * Non-throwing — returns null on any error so checkout is never blocked.
   */
  async getInstallerCouponCode(recordId: string): Promise<string | null> {
    try {
      const data = await airtableRequest('GET', INSTALLERS_TABLE, undefined, undefined, recordId);
      return data?.fields?.CouponCode || null;
    } catch (error) {
      console.error('getInstallerCouponCode failed:', error);
      return null;
    }
  }
};
