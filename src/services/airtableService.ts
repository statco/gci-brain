// Proxy all Airtable calls through /api/airtable serverless function
const INSTALLERS_TABLE = 'Installers';
const APPLICATIONS_TABLE = 'Installer Applications';

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
 * Calculates the Haversine distance between two points on Earth
 */
function calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371; // Earth radius in km
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLon = (lon2 - lon1) * (Math.PI / 180);
  const a =
    Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) * Math.sin(dLon/2) * Math.sin(dLon/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
}

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
  yearsInBusiness?: number;
  insuranceCoverage?: boolean;
  certifications?: string;
  additionalInfo?: string;
}) {
  try {
    const data = await airtableRequest('POST', APPLICATIONS_TABLE, {
      fields: {
        'Business Name': formData.businessName,
        'Contact Name': formData.contactName,
        'Email': formData.email,
        'Phone': formData.phone,
        'Address': formData.address,
        'City': formData.city,
        'Province': formData.province,
        'Postal Code': formData.postalCode,
        'Years in Business': formData.yearsInBusiness || 0,
        'Insurance Coverage': formData.insuranceCoverage || false,
        'Certifications': formData.certifications || '',
        'Additional Info': formData.additionalInfo || '',
        'Status': 'Pending Review',
        'Submitted Date': new Date().toISOString()
      }
    });
    return { success: true, recordId: data.id };
  } catch (error) {
    console.error("Failed to submit installer application:", error);
    throw new Error("Failed to submit application. Please try again.");
  }
}

export const airtableService = {
  async findNearbyInstallers(userLat: number, userLng: number, radiusKm: number = 100) {
    try {
      const data = await airtableRequest('GET', INSTALLERS_TABLE, undefined, "{Status}='Active'");

      // Transform and map Airtable records to the flattened structure SuccessView expects
      const records = (data.records || []).map((record: any) => {
        const fields = record.fields;
        const lat = Number(fields.Latitude);
        const lng = Number(fields.Longitude);

        // Validate coordinates to prevent Map crashes
        const hasValidCoords = !isNaN(lat) && !isNaN(lng);
        const dist = hasValidCoords ? calculateDistance(userLat, userLng, lat, lng) : 999;

        return {
          id: record.id,
          name: fields.Name || 'Certified Partner',
          address: fields.Address || '',
          city: fields.City || '',
          province: fields.Province || '',
          phone: fields.Phone || '',
          // Support multiple potential field names for Calendly
          calendlyLink: fields['Calendar Link'] || fields.CalendlyLink || fields.Link,
          pricePerTire: fields.PricePerTire || fields['Price Per Tire'],
          rating: fields.Rating,
          couponCode: fields.CouponCode || null,
          distance: dist,
          lat: hasValidCoords ? lat : undefined,
          lng: hasValidCoords ? lng : undefined
        };
      });

      // Filter by radius and sort by distance
      const filtered = records
        .filter((r: any) => r.lat !== undefined && r.lng !== undefined && r.distance <= radiusKm)
        .sort((a: any, b: any) => a.distance - b.distance);

      // Final safety: if no real records found, return Mock data to show something on the map
      return filtered.length > 0 ? filtered : MOCK_DATA;

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
