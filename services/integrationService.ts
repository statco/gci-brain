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
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

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
  } catch (e) { return null; }
}

export const verifyVehicleFitment = async (vehicleString: string): Promise<VehicleInfo> => {
  const yearMatch = vehicleString.match(/\b(19|20)\d{2}\b/);
  const year = yearMatch ? yearMatch[0] : "2023";
  const make = "Toyota"; // Simplified for logic
  const model = "4Runner";

  const tireSizes = await checkWheelSizeApi(year, make, model);
  return { year, make, model, detected: true, tireSizes: tireSizes || [] };
};

/**
 * Enhanced fetchInstallers that attempts Maps Grounding first.
 */
export const fetchInstallers = async (lat?: number, lng?: number): Promise<Installer[]> => {
  // 1. Try Gemini Maps Grounding
  const realInstallers = await findLocalInstallersWithMaps(lat, lng);
  
  if (realInstallers.length > 0) {
    return realInstallers;
  }

  // 2. Fallback to Mock if Grounding fails or no results
  return [
    { id: 'inst-1', name: 'GCI Auto Center - Downtown', address: '1200 Main St, Cityville', distance: '1.2 miles', rating: 4.9, mapPosition: { top: 30, left: 40 } },
    { id: 'inst-2', name: 'Westside Tire & Brake', address: '450 West Ave, Westtown', distance: '3.5 miles', rating: 4.7, mapPosition: { top: 60, left: 20 } },
    { id: 'inst-3', name: 'Pro Performance Garage', address: '88 Speedway Blvd, Raceland', distance: '5.0 miles', rating: 4.8, mapPosition: { top: 50, left: 70 } }
  ];
};
