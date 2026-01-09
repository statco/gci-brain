// Environment variables for Vercel/Vite
const API_KEY = import.meta.env.VITE_AIRTABLE_API_KEY;
const BASE_ID = import.meta.env.VITE_AIRTABLE_BASE_ID;
const INSTALLERS_TABLE = import.meta.env.VITE_AIRTABLE_INSTALLERS_TABLE || 'Installers';
const APPLICATIONS_TABLE = import.meta.env.VITE_AIRTABLE_APPLICATIONS_TABLE || 'Installer Applications';

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
    coordinates: { lat: 48.2368, lng: -79.0228 }
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
  if (!API_KEY || !BASE_ID) {
    console.warn("Airtable Configuration Missing. Cannot submit application.");
    throw new Error("Service temporarily unavailable. Please try again later.");
  }

  try {
    const url = `https://api.airtable.com/v0/${BASE_ID}/${APPLICATIONS_TABLE}`;
    
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
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
      }),
      signal: AbortSignal.timeout(8000)
    });

    if (!response.ok) {
      throw new Error(`Airtable error: ${response.status}`);
    }

    const data = await response.json();
    return { success: true, recordId: data.id };
    
  } catch (error) {
    console.error("Failed to submit installer application:", error);
    throw new Error("Failed to submit application. Please try again.");
  }
}

export const airtableService = {
  async findNearbyInstallers(userLat: number, userLng: number, radiusKm: number = 100) {
    // 1. Check if config exists. If not, return Mock Data immediately to avoid serverless crash.
    if (!API_KEY || !BASE_ID) {
      console.warn("Airtable Configuration Missing. Falling back to Mock Data.");
      return MOCK_DATA;
    }

    try {
      // 2. Build the request URL with a filter for 'Active' status
      const url = `https://api.airtable.com/v0/${BASE_ID}/${INSTALLERS_TABLE}?filterByFormula={Status}='Active'`;
      
      const response = await fetch(url, {
        headers: { 'Authorization': `Bearer ${API_KEY}` },
        // 3. Set a strict timeout to stay within Vercel's serverless limits
        signal: AbortSignal.timeout(6000)
      });

      if (!response.ok) {
        throw new Error(`Airtable error: ${response.status}`);
      }

      const data = await response.json();

      // 4. Transform and map Airtable records to the flattened structure SuccessView expects
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
          distance: dist,
          coordinates: hasValidCoords ? { lat, lng } : null
        };
      });

      // 5. Filter by radius and sort by distance
      const filtered = records
        .filter((r: any) => r.coordinates !== null && r.distance <= radiusKm)
        .sort((a: any, b: any) => a.distance - b.distance);

      // 6. Final safety: if no real records found, return Mock data to show something on the map
      return filtered.length > 0 ? filtered : MOCK_DATA;
      
    } catch (error) {
      console.error("Airtable Fetch Failed:", error);
      // 7. Critical fallback: Return Mock Data so the SuccessView UI never breaks
      return MOCK_DATA;
    }
  }
};
