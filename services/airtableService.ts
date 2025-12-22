import axios from 'axios';

const AIRTABLE_API_KEY = process.env.AIRTABLE_API_KEY || '';
const AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID || '';
const INSTALLERS_TABLE = process.env.AIRTABLE_INSTALLERS_TABLE || 'Installers';

interface InstallerRecord {
  id: string;
  fields: {
    Name: string;
    Email: string;
    Phone?: string;
    Address: string;
    City: string;
    Province: string;
    PostalCode: string;
    Latitude?: number;
    Longitude?: number;
    CalendlyLink?: string;
    ServiceRadius?: number; // in km
    PricePerTire?: number;
    Status: 'Active' | 'Inactive' | 'Pending';
    CertificationDate?: string;
    Rating?: number;
    TotalInstallations?: number;
  };
}

interface JobRecord {
  fields: {
    CustomerName: string;
    CustomerEmail: string;
    CustomerPhone: string;
    InstallerId: string;
    TireProduct: string;
    Quantity: number;
    InstallationPrice: number;
    ScheduledDate?: string;
    Status: 'Pending' | 'Confirmed' | 'Completed' | 'Cancelled';
    ShopifyOrderId?: string;
    Notes?: string;
    CreatedAt: string;
  };
}

class AirtableService {
  private baseUrl: string;

  constructor() {
    this.baseUrl = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}`;
  }

  private getHeaders() {
    return {
      Authorization: `Bearer ${AIRTABLE_API_KEY}`,
      'Content-Type': 'application/json',
    };
  }

  /**
   * Fetch all active installers
   */
  async getActiveInstallers(): Promise<InstallerRecord[]> {
    try {
      const response = await axios.get(`${this.baseUrl}/${INSTALLERS_TABLE}`, {
        headers: this.getHeaders(),
        params: {
          filterByFormula: "{Status} = 'Active'",
          sort: [{ field: 'Rating', direction: 'desc' }],
        },
      });

      return response.data.records;
    } catch (error) {
      console.error('Error fetching installers:', error);
      throw error;
    }
  }

  /**
   * Find installers near a location
   */
  async findNearbyInstallers(
    latitude: number,
    longitude: number,
    radiusKm: number = 50
  ): Promise<InstallerRecord[]> {
    try {
      const allInstallers = await this.getActiveInstallers();

      // Filter by distance using Haversine formula
      const nearbyInstallers = allInstallers.filter((installer) => {
        const lat = installer.fields.Latitude;
        const lon = installer.fields.Longitude;

        if (!lat || !lon) return false;

        const distance = this.calculateDistance(latitude, longitude, lat, lon);
        return distance <= radiusKm;
      });

      return nearbyInstallers;
    } catch (error) {
      console.error('Error finding nearby installers:', error);
      throw error;
    }
  }

  /**
   * Get a specific installer by ID
   */
  async getInstaller(installerId: string): Promise<InstallerRecord> {
    try {
      const response = await axios.get(
        `${this.baseUrl}/${INSTALLERS_TABLE}/${installerId}`,
        {
          headers: this.getHeaders(),
        }
      );

      return response.data;
    } catch (error) {
      console.error('Error fetching installer:', error);
      throw error;
    }
  }

  /**
   * Create a new installation job
   */
  async createInstallationJob(jobData: JobRecord['fields']): Promise<any> {
    try {
      const response = await axios.post(
        `${this.baseUrl}/Jobs`,
        {
          fields: {
            ...jobData,
            CreatedAt: new Date().toISOString(),
            Status: 'Pending',
          },
        },
        {
          headers: this.getHeaders(),
        }
      );

      return response.data;
    } catch (error) {
      console.error('Error creating job:', error);
      throw error;
    }
  }

  /**
   * Update job status
   */
  async updateJobStatus(
    jobId: string,
    status: JobRecord['fields']['Status'],
    notes?: string
  ): Promise<any> {
    try {
      const response = await axios.patch(
        `${this.baseUrl}/Jobs/${jobId}`,
        {
          fields: {
            Status: status,
            ...(notes && { Notes: notes }),
          },
        },
        {
          headers: this.getHeaders(),
        }
      );

      return response.data;
    } catch (error) {
      console.error('Error updating job status:', error);
      throw error;
    }
  }

  /**
   * Calculate distance between two coordinates using Haversine formula
   */
  private calculateDistance(
    lat1: number,
    lon1: number,
    lat2: number,
    lon2: number
  ): number {
    const R = 6371; // Earth's radius in km
    const dLat = this.toRad(lat2 - lat1);
    const dLon = this.toRad(lon2 - lon1);

    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(this.toRad(lat1)) *
        Math.cos(this.toRad(lat2)) *
        Math.sin(dLon / 2) *
        Math.sin(dLon / 2);

    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  private toRad(degrees: number): number {
    return degrees * (Math.PI / 180);
  }

  /**
   * Get installer's upcoming jobs
   */
  async getInstallerJobs(installerId: string): Promise<any[]> {
    try {
      const response = await axios.get(`${this.baseUrl}/Jobs`, {
        headers: this.getHeaders(),
        params: {
          filterByFormula: `{InstallerId} = '${installerId}'`,
          sort: [{ field: 'ScheduledDate', direction: 'asc' }],
        },
      });

      return response.data.records;
    } catch (error) {
      console.error('Error fetching installer jobs:', error);
      throw error;
    }
  }
}

export const airtableService = new AirtableService();
export type { InstallerRecord, JobRecord };
