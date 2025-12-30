// services/airtableService.ts - RETURNS DISTANCE
const API_KEY = import.meta.env.VITE_AIRTABLE_API_KEY;
const BASE_ID = import.meta.env.VITE_AIRTABLE_BASE_ID;
const INSTALLERS_TABLE = import.meta.env.VITE_AIRTABLE_INSTALLERS_TABLE || 'Installers';

console.log('🔧 Airtable Service Initialized');

export interface InstallerRecord {
  id: string;
  fields: {
    Name: string;
    Email?: string;
    Phone?: string;
    Address: string;
    City: string;
    Province: string;
    PostalCode?: string;
    Latitude?: number;
    Longitude?: number;
    CalendlyLink?: string;
    ServiceRadius?: number;
    PricePerTire?: number;
    Status: string;
    Rating?: number;
    TotalInstallations?: number;
  };
  distance?: number; // ✅ ADD distance to the record
}

export const airtableService = {
  async findNearbyInstallers(
    userLat: number,
    userLng: number,
    radiusKm: number = 100
  ): Promise<InstallerRecord[]> {
    console.log('🎯 Finding installers:', { userLat, userLng, radiusKm });

    if (!API_KEY || !BASE_ID) {
      throw new Error('Airtable API key or Base ID not configured');
    }

    try {
      const url = `https://api.airtable.com/v0/${BASE_ID}/${INSTALLERS_TABLE}`;
      const response = await fetch(url, {
        headers: {
          'Authorization': `Bearer ${API_KEY}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Airtable API error: ${response.status}`);
      }

      const data = await response.json();
      const allInstallers: InstallerRecord[] = data.records || [];

      console.log(`✅ Found ${allInstallers.length} total installers`);

      // Filter by Active status
      const activeInstallers = allInstallers.filter(inst => inst.fields.Status === 'Active');
      console.log(`✅ ${activeInstallers.length} active installers`);

      // Filter by distance AND calculate distance for each
      const nearby = activeInstallers
        .map(installer => {
          const lat = installer.fields.Latitude;
          const lng = installer.fields.Longitude;

          if (!lat || !lng) {
            console.log(`⚠️ ${installer.fields.Name}: No coordinates`);
            return { ...installer, distance: 0 };
          }

          const distance = calculateDistance(userLat, userLng, lat, lng);
          console.log(`📏 ${installer.fields.Name}: ${distance.toFixed(1)}km away`);
          
          return { ...installer, distance }; // ✅ ADD distance to each installer
        })
        .filter(installer => (installer.distance || 0) <= radiusKm);

      console.log(`✅ ${nearby.length} installers within ${radiusKm}km`);

      // Sort by distance
      nearby.sort((a, b) => (a.distance || 999) - (b.distance || 999));

      return nearby;
    } catch (error) {
      console.error('Error fetching installers:', error);
      throw error;
    }
  },

  async getActiveInstallers(): Promise<InstallerRecord[]> {
    if (!API_KEY || !BASE_ID) {
      throw new Error('Airtable API key or Base ID not configured');
    }

    try {
      const url = `https://api.airtable.com/v0/${BASE_ID}/${INSTALLERS_TABLE}?filterByFormula={Status}='Active'`;
      
      const response = await fetch(url, {
        headers: {
          'Authorization': `Bearer ${API_KEY}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Airtable API error: ${response.status} - ${errorText}`);
      }

      const data = await response.json();
      return data.records || [];
    } catch (error) {
      console.error('Error fetching active installers:', error);
      throw error;
    }
  },

  async createInstallationJob(jobData: {
    CustomerName: string;
    CustomerEmail: string;
    CustomerPhone: string;
    InstallerId: string;
    TireProduct: string;
    Quantity: number;
    InstallationPrice: number;
    Status: string;
    ShopifyOrderId?: string;
    Notes?: string;
  }): Promise<any> {
    if (!API_KEY || !BASE_ID) {
      throw new Error('Airtable API key or Base ID not configured');
    }

    try {
      const url = `https://api.airtable.com/v0/${BASE_ID}/Jobs`;
      
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          fields: jobData,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to create job: ${response.status} - ${errorText}`);
      }

      const data = await response.json();
      console.log('✅ Installation job created:', data.id);
      return data;
    } catch (error) {
      console.error('Error creating installation job:', error);
      throw error;
    }
  },
};

export async function submitInstallerApplication(formData: {
  name: string;
  email: string;
  phone: string;
  businessName: string;
  address: string;
  city: string;
  province: string;
  postalCode: string;
  yearsExperience: number;
  certifications: string;
  serviceRadius: number;
  pricePerTire: number;
}): Promise<any> {
  if (!API_KEY || !BASE_ID) {
    throw new Error('Airtable API key or Base ID not configured');
  }

  try {
    const url = `https://api.airtable.com/v0/${BASE_ID}/${INSTALLERS_TABLE}`;
    
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        fields: {
          Name: formData.businessName || formData.name,
          Email: formData.email,
          Phone: formData.phone,
          Address: formData.address,
          City: formData.city,
          Province: formData.province,
          PostalCode: formData.postalCode,
          ServiceRadius: formData.serviceRadius,
          PricePerTire: formData.pricePerTire,
          Status: 'Pending',
        },
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to submit application: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    console.log('✅ Installer application submitted:', data.id);
    return data;
  } catch (error) {
    console.error('Error submitting installer application:', error);
    throw error;
  }
}

function calculateDistance(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function toRad(degrees: number): number {
  return degrees * (Math.PI / 180);
}
