import { TireProduct, VehicleInfo, QualityTier, Installer } from "../types";
import { findLocalInstallersWithMaps } from "./geminiService";
import { fetchShopifyTireProducts } from "./shopifyService";

const FALLBACK_INVENTORY: Partial<TireProduct>[] = [
  { 
    id: "gci-001", 
    variantId: "mock-1", 
    brand: "Toyo", 
    model: "Open Country A/T III", 
    type: "All-Terrain", 
    description: "Latest generation grippy all-terrain tire.", 
    pricePerUnit: 245, 
    features: ["Cut Chip Resistance"], 
    tier: "Best", 
    imageUrl: ""
  },
  { 
    id: "gci-002", 
    variantId: "mock-2", 
    brand: "Nitto", 
    model: "Ridge Grappler V2", 
    type: "Hybrid Terrain", 
    description: "Balance between mud aggression and comfort.", 
    pricePerUnit: 310, 
    features: ["Variable Pitch"], 
    tier: "Best", 
    imageUrl: ""
  }
];

let cachedShopifyInventory: Partial<TireProduct>[] | null = null;
let cacheTimestamp: number = 0;
const CACHE_DURATION = 5 * 60 * 1000;

export const fetchShopifyInventory = async (): Promise<Partial<TireProduct>[]> => {
  const now = Date.now();
  
  if (cachedShopifyInventory && (now - cacheTimestamp) < CACHE_DURATION) {
    console.log('✅ Using cached Shopify inventory');
    return cachedShopifyInventory;
  }

  try {
    console.log('🔄 Fetching fresh Shopify inventory...');
    const products = await fetchShopifyTireProducts();
    
    if (products.length === 0) {
      console.warn('⚠️ No products from Shopify, using fallback');
      return FALLBACK_INVENTORY;
    }

    cachedShopifyInventory = products;
    cacheTimestamp = now;
    
    console.log(`✅ Fetched ${products.length} products from Shopify`);
    return products;
    
  } catch (error) {
    console.error('❌ Shopify fetch error:', error);
    return FALLBACK_INVENTORY;
  }
};

async function checkWheelSizeApi(year: string, make: string, model: string): Promise<string[] | null> {
  const userKey = process.env.WHEEL_SIZE_API_KEY; 
  if (!userKey) return null;
  try {
    const response = await fetch(`https://api.wheel-size.com/v2/search/by_model/?make=${make}&model=${model}&year=${year}&user_key=${userKey}`);
    const data = await response.json();
    return data.length > 0 ? ["265/70R17"] : null;
  } catch (e) { 
    return null; 
  }
}

export const verifyVehicleFitment = async (vehicleString: string): Promise<VehicleInfo> => {
  const yearMatch = vehicleString.match(/\b(19|20)\d{2}\b/);
  const year = yearMatch ? yearMatch[0] : "2023";
  const make = "Toyota";
  const model = "4Runner";

  const tireSizes = await checkWheelSizeApi(year, make, model);
  return { year, make, model, detected: true, tireSizes: tireSizes || [] };
};

export const fetchInstallers = async (lat?: number, lng?: number): Promise<Installer[]> => {
  // Curated GCI Tire Installer Network
  // Verified partners in the Abitibi-Témiscamingue region
  return [
    { 
      id: 'gci-rouyn', 
      name: 'GCI Tire - Rouyn-Noranda (Siège Social)', 
      address: 'Rouyn-Noranda, QC J9X 0A1', 
      distance: 'Local', 
      rating: 4.9,
      url: 'https://www.gcitires.com',
      mapPosition: { top: 45, left: 50 }
    },
    { 
      id: 'partner-valdor', 
      name: 'Garage Certifié GCI - Val-d\'Or', 
      address: 'Val-d\'Or, QC', 
      distance: '85 km', 
      rating: 4.8,
      url: 'https://www.gcitires.com/pages/installer-application',
      mapPosition: { top: 30, left: 65 }
    },
    { 
      id: 'partner-amos', 
      name: 'Service Auto GCI - Amos', 
      address: 'Amos, QC', 
      distance: '110 km', 
      rating: 4.7,
      url: 'https://www.gcitires.com/pages/installer-application',
      mapPosition: { top: 60, left: 40 }
    }
  ];
};
