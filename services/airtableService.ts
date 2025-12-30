// services/airtableService.ts - COMPREHENSIVE DEBUG VERSION
const API_KEY = import.meta.env.VITE_AIRTABLE_API_KEY;
const BASE_ID = import.meta.env.VITE_AIRTABLE_BASE_ID;
const INSTALLERS_TABLE = import.meta.env.VITE_AIRTABLE_INSTALLERS_TABLE || 'Installers';

// Debug: Log configuration on load
console.log('🔧 Airtable Service Loaded');
console.log('📋 Configuration:', {
  hasApiKey: !!API_KEY,
  apiKeyStart: API_KEY ? API_KEY.substring(0, 15) + '...' : 'MISSING',
  baseId: BASE_ID || 'MISSING',
  tableName: INSTALLERS_TABLE,
});

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
}

export const airtableService = {
  /**
   * Find nearby installers within a given radius
   */
  async findNearbyInstallers(
    userLat: number,
    userLng: number,
    radiusKm: number = 100
  ): Promise<InstallerRecord[]> {
    console.log('🎯 === STARTING INSTALLER SEARCH ===');
    console.log('📍 Search parameters:', { userLat, userLng, radiusKm });

    if (!API_KEY || !BASE_ID) {
      console.error('❌ CRITICAL: Missing Airtable credentials');
      console.error('API_KEY exists:', !!API_KEY);
      console.error('BASE_ID exists:', !!BASE_ID);
      throw new Error('Airtable API key or Base ID not configured');
    }

    try {
      // Try WITHOUT filter first to see all records
      const urlNoFilter = `https://api.airtable.com/v0/${BASE_ID}/${INSTALLERS_TABLE}`;
      
      console.log('🌐 Step 1: Fetching ALL records (no filter)');
      console.log('📡 URL:', urlNoFilter);

      const responseAll = await fetch(urlNoFilter, {
        headers: {
          'Authorization': `Bearer ${API_KEY}`,
          'Content-Type': 'application/json',
        },
      });

      console.log('📥 Response Status:', responseAll.status, responseAll.statusText);

      if (!responseAll.ok) {
        const errorText = await responseAll.text();
        console.error('❌ API Error Response:', errorText);
        throw new Error(`Airtable API error: ${responseAll.status} - ${errorText}`);
      }

      const dataAll = await responseAll.json();
      console.log('✅ Raw Airtable Response:', JSON.stringify(dataAll, null, 2));
      console.log('📊 Total records in table:', dataAll.records?.length || 0);

      if (dataAll.records && dataAll.records.length > 0) {
        console.log('👤 First record details:', JSON.stringify(dataAll.records[0], null, 2));
        console.log('🔍 Status field value:', dataAll.records[0].fields.Status);
        console.log('🔍 Status field type:', typeof dataAll.records[0].fields.Status);
        
        // Log all Status values
        dataAll.records.forEach((record: any, index: number) => {
          console.log(`Record ${index + 1} Status: "${record.fields.Status}"`);
        });
      }

      const allInstallers: InstallerRecord[] = dataAll.records || [];

      if (allInstallers.length === 0) {
        console.warn('⚠️ No records found in Airtable table');
        return [];
      }

      // Now filter by Status = 'Active'
      console.log('🔍 Step 2: Filtering by Status = "Active"');
      const activeInstallers = allInstallers.filter(installer => {
        const status = installer.fields.Status;
        const isActive = status === 'Active';
        console.log(`- ${installer.fields.Name}: Status="${status}", isActive=${isActive}`);
        return isActive;
      });

      console.log(`✅ Active installers: ${activeInstallers.length} out of ${allInstallers.length}`);

      if (activeInstallers.length === 0) {
        console.warn('⚠️ No Active installers found!');
        return [];
      }

      // Filter by distance
      console.log('🔍 Step 3: Filtering by distance');
      const nearby = activeInstallers.filter(installer => {
        const lat = installer.fields.Latitude;
        const lng = installer.fields.Longitude;

        if (!lat || !lng) {
          console.log(`  ⚠️ ${installer.fields.Name}: Missing coordinates, including anyway`);
          return true;
        }

        const distance = calculateDistance(userLat, userLng, lat, lng);
        const withinRadius = distance <= radiusKm;
        console.log(`  📏 ${installer.fields.Name}: ${distance.toFixed(1)}km away, withinRadius=${withinRadius}`);
        
        return withinRadius;
      });

      console.log(`✅ Final result: ${nearby.length} installers within ${radiusKm}km`);

      // Sort by distance
      nearby.sort((a, b) => {
        const distA = a.fields.Latitude && a.fields.Longitude 
          ? calculateDistance(userLat, userLng, a.fields.Latitude, a.fields.Longitude)
          : 999;
        const distB = b.fields.Latitude && b.fields.Longitude
          ? calculateDistance(userLat, userLng, b.fields.Latitude, b.fields.Longitude)
          : 999;
        return distA - distB;
      });

      console.log('🎉 === SEARCH COMPLETE ===');
      return nearby;

    } catch (error) {
      console.error('💥 FATAL ERROR in findNearbyInstallers:', error);
      if (error instanceof Error) {
        console.error('Error message:', error.message);
        console.error('Error stack:', error.stack);
      }
      throw error;
    }
  },

  /**
   * Get all active installers
   */
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

  /**
   * Create a new installation job
   */
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

/**
 * Calculate distance between two points using Haversine formula
 */
function calculateDistance(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371; // Earth's radius in kilometers
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
