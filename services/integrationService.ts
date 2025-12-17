import { TireProduct, VehicleInfo, QualityTier, Installer } from "../types";

// WHEEL-SIZE API CONFIGURATION
const WHEEL_SIZE_CONFIG = {
  baseUrl: "https://api.wheel-size.com/v2",
  // We access process.env directly in the function to ensure it picks up the define from vite
};

// BUSINESS LOGIC CONSTANTS
const FALLBACK_OE_TIRE_PRICE = 210.00;

// FALLBACK INVENTORY (Used if live API calls are blocked or fail)
const FALLBACK_INVENTORY: Partial<TireProduct>[] = [
  { 
    id: "gci-001", variantId: "mock-1", brand: "Toyo", model: "Open Country A/T III (2025)", type: "All-Terrain", 
    description: "Latest generation grippy all-terrain tire perfect for trucks and SUVs in mixed conditions.", 
    pricePerUnit: 245, features: ["Cut Chip Resistance", "Snow Flake Rated", "50k Mile Warranty"],
    has3PMSF: true, tier: "Best",
    imageUrl: "https://images.unsplash.com/photo-1578844251758-2f71da645217?auto=format&fit=crop&w=500&q=80"
  },
  { 
    id: "gci-002", variantId: "mock-2", brand: "Nitto", model: "Ridge Grappler V2", type: "Hybrid Terrain", 
    description: "The perfect updated balance between mud-terrain aggression and all-terrain comfort.", 
    pricePerUnit: 310, features: ["Variable Pitch Tread", "Shoulder Grooves", "Dual Sidewall Design"],
    has3PMSF: false, tier: "Best",
    imageUrl: "https://images.unsplash.com/photo-1583256606001-c529e37d5598?auto=format&fit=crop&w=500&q=80"
  },
  { 
    id: "gci-003", variantId: "mock-3", brand: "Michelin", model: "Defender LTX Platinum", type: "All-Season", 
    description: "Premium long-lasting durability for heavy duty trucks and SUVs.", 
    pricePerUnit: 280, features: ["Evertread Compound", "Eco-Friendly", "70k Mile Warranty"],
    has3PMSF: false, tier: "Best",
    imageUrl: "https://images.unsplash.com/photo-1616789129486-4d0d820b7913?auto=format&fit=crop&w=500&q=80"
  },
  { 
    id: "gci-004", variantId: "mock-4", brand: "Falken", model: "Wildpeak A/T4W", type: "All-Terrain", 
    description: "Newest iteration engineered for adventure, any time and in any weather.", 
    pricePerUnit: 225, features: ["Heat Diffuser", "3D Canyon Sipes", "Rugged Sidewall"],
    has3PMSF: true, tier: "Better",
    imageUrl: "https://images.unsplash.com/photo-1543467616-0498b5329813?auto=format&fit=crop&w=500&q=80"
  },
  { 
    id: "gci-005", variantId: "mock-5", brand: "Goodyear", model: "Wrangler DuraTrac RT", type: "On/Off-Road", 
    description: "Rough terrain workhorse tire for rugged off-road terrain and snow.", 
    pricePerUnit: 265, features: ["TractiveGroove", "Rim Protector", "Self-Cleaning"],
    has3PMSF: true, tier: "Better",
    imageUrl: "https://images.unsplash.com/photo-1579309489565-d0c0c6d54d19?auto=format&fit=crop&w=500&q=80"
  },
  { 
    id: "gci-006", variantId: "mock-6", brand: "BFGoodrich", model: "All-Terrain T/A KO3", type: "All-Terrain", 
    description: "The toughest all-terrain tire just got tougher. Race tested.", 
    pricePerUnit: 305, features: ["CoreGard Technology", "Interlocking Tread", "Stone Ejectors"],
    has3PMSF: true, tier: "Best",
    imageUrl: "https://images.unsplash.com/photo-1532585614749-7c30a84b05a6?auto=format&fit=crop&w=500&q=80"
  },
  { 
    id: "gci-007", variantId: "mock-7", brand: "Kumho", model: "Road Venture AT52", type: "All-Terrain", 
    description: "Updated solid performance for budget-minded off-roaders.", 
    pricePerUnit: 185, features: ["Angled Chamfer", "Deep Grooves", "Cut Resistant"],
    has3PMSF: true, tier: "Good",
    imageUrl: "https://images.unsplash.com/photo-1601362840469-51e4d8d58785?auto=format&fit=crop&w=500&q=80"
  },
  { 
    id: "gci-008", variantId: "mock-8", brand: "Bridgestone", model: "Blizzak DM-V2", type: "Winter", 
    description: "Absolute confidence on ice and heavy snow.", 
    pricePerUnit: 230, features: ["NanoPro-Tech", "Multicell Compound", "Bite Particles"],
    has3PMSF: true, tier: "Best",
    imageUrl: "https://images.unsplash.com/photo-1549216170-c75c87a5531d?auto=format&fit=crop&w=500&q=80"
  },
  { 
    id: "gci-009", variantId: "mock-9", brand: "Continental", model: "TerrainContact A/T", type: "All-Terrain", 
    description: "Quiet all-terrain tire focused on wet traction and durability.", 
    pricePerUnit: 255, features: ["TractionPlus", "ComfortRide", "Flat Contour"],
    has3PMSF: false, tier: "Better",
    imageUrl: "https://images.unsplash.com/photo-1588631165431-7e814a595914?auto=format&fit=crop&w=500&q=80"
  },
  { 
    id: "gci-010", variantId: "mock-10", brand: "General", model: "Grabber A/TX", type: "All-Terrain", 
    description: "Aggressive styling and off-road capability with studdability.", 
    pricePerUnit: 195, features: ["Studdable", "Duragen Tech", "Comfort Balance"],
    has3PMSF: true, tier: "Good",
    imageUrl: "https://images.unsplash.com/photo-1563260846-930c6a539207?auto=format&fit=crop&w=500&q=80"
  }
];

export const fetchShopifyInventory = async (): Promise<Partial<TireProduct>[]> => {
  try {
    // Call our own Vercel API endpoint (which communicates with Shopify server-side)
    // This removes CORS issues and keeps the API Token secure.
    const response = await fetch('/api/shopify-inventory');

    // Handle static deployment case (Endpoint missing) without loud error
    if (response.status === 404) {
      console.info("API endpoint not found (Static Mode), using fallback inventory.");
      return FALLBACK_INVENTORY;
    }

    if (!response.ok) {
        throw new Error(`Integration API Error: ${response.statusText}`);
    }

    const json = await response.json();
    
    if (json.errors) {
        throw new Error("GraphQL Errors from Shopify");
    }

    // Safely handle cases where products might be missing
    if (!json.data || !json.data.products) {
        console.warn("No data returned from Shopify API");
        return FALLBACK_INVENTORY;
    }

    const products = json.data.products.edges.map((edge: any) => {
        const p = edge.node;
        // Basic heuristic to split Brand/Model from Title "Brand Model Size"
        const parts = p.title.split(' ');
        const brand = parts[0] || "Generic";
        const model = parts.slice(1).join(' ') || "Tire";
        
        const variantNode = p.variants.edges[0]?.node;
        let price = parseFloat(variantNode?.price.amount || "0");
        if (price === 0) {
          price = FALLBACK_OE_TIRE_PRICE;
        }

        // Parse numeric variant ID from GID for permalinks
        // GID format: gid://shopify/ProductVariant/123456789
        // Note: Shopify API often returns Base64 encoded IDs which need to be decoded first
        let variantId = "0";
        if (variantNode?.id) {
            let rawId = variantNode.id;
            
            // Attempt to decode if it looks like Base64 (starts with Z or similar and no slashes)
            if (!rawId.includes('/') && !rawId.startsWith('gid://')) {
                try {
                    rawId = atob(rawId);
                } catch (e) {
                    console.warn("Failed to decode Variant ID:", rawId);
                }
            }
            
            const matches = rawId.match(/\/ProductVariant\/(\d+)/);
            if (matches && matches[1]) {
                variantId = matches[1];
            }
        }

        return {
            id: p.id,
            variantId: variantId,
            brand: brand,
            model: model,
            description: p.description || "",
            pricePerUnit: price,
            imageUrl: p.images.edges[0]?.node.url || "",
            features: ["In Stock", "Fast Shipping"], 
            tier: "Good" as QualityTier,
            has3PMSF: (p.description || "").toLowerCase().includes("mountain") || (p.description || "").toLowerCase().includes("snow")
        };
    });

    if (products.length === 0) return FALLBACK_INVENTORY;
    return products;

  } catch (error) {
    console.warn("Using fallback inventory due to API connection issue.", error);
    return FALLBACK_INVENTORY;
  }
};

// Validation: Wheel-Size.com API
// Returns list of potential tire sizes if verified, otherwise null
async function checkWheelSizeApi(year: string, make: string, model: string): Promise<string[] | null> {
  const userKey = process.env.WHEEL_SIZE_API_KEY; 
  
  if (!userKey) {
      console.warn("[Wheel-Size] API Key missing. Skipping verification.");
      return null;
  }
  
  try {
    console.log(`[Wheel-Size] Querying verification for: ${year} ${make} ${model}`);
    const url = `${WHEEL_SIZE_CONFIG.baseUrl}/search/by_model/?make=${encodeURIComponent(make)}&model=${encodeURIComponent(model)}&year=${year}&user_key=${userKey}`;
    
    const response = await fetch(url);
    if (!response.ok) {
        console.warn(`[Wheel-Size] API Request Failed: ${response.status} ${response.statusText}`);
        return null;
    }
    
    const data = await response.json();
    
    if (Array.isArray(data) && data.length > 0) {
        // Extract tire sizes from all matching vehicles/trims
        const sizes = new Set<string>();
        data.forEach((item: any) => {
            // Check for standard structure (varies by API plan, covering common structures)
            if (item.technical && item.technical.tires) {
                if (item.technical.tires.front?.tire) sizes.add(item.technical.tires.front.tire);
                if (item.technical.tires.rear?.tire) sizes.add(item.technical.tires.rear.tire);
            }
            // Check for potential flat structure or wheels array
            if (item.wheels && Array.isArray(item.wheels)) {
                item.wheels.forEach((w: any) => {
                    if (w.front?.tire) sizes.add(w.front.tire);
                    if (w.rear?.tire) sizes.add(w.rear.tire);
                });
            }
        });
        return Array.from(sizes);
    }
    
    return null;
  } catch (e) {
    console.error("[Wheel-Size] Verification failed", e);
    return null;
  }
}

export const verifyVehicleFitment = async (vehicleString: string): Promise<VehicleInfo> => {
  // 1. EXTRACTION & LOCAL HEURISTIC
  // Attempt to parse vehicle details from the natural language string
  const yearMatch = vehicleString.match(/\b(19|20)\d{2}\b/);
  const year = yearMatch ? yearMatch[0] : "2023";

  // Parse Make
  const commonMakes = ["Toyota", "Ford", "Honda", "Jeep", "Subaru", "Chevrolet", "BMW", "Audi", "Ram", "GMC", "Tesla", "Mercedes", "Lexus", "Nissan", "Hyundai", "Dodge", "Kia", "Mazda", "Volkswagen"];
  const makeMatch = commonMakes.find(m => vehicleString.toLowerCase().includes(m.toLowerCase()));
  const make = makeMatch || "Vehicle";

  // Parse Model
  const commonModels = [
    "F-150", "Silverado", "Ram 1500", "1500", "Ram 2500", "2500", "Ram 3500", "3500", "Sierra", "Tundra", "Tacoma", "Ranger", "Colorado", "Canyon", "Gladiator", // Trucks
    "Wrangler", "Bronco", "4Runner", "Grand Cherokee", "Outback", "Forester", "CR-V", "RAV4", "Explorer", "Tahoe", // SUVs
    "Camry", "Accord", "Civic", "Corolla", "Model 3", "Model Y", "Mustang", "F-Series", "Civic"
  ];
  const modelMatch = commonModels.find(m => vehicleString.toLowerCase().includes(m.toLowerCase()));
  const model = modelMatch || "Model";

  const extractedInfo: VehicleInfo = {
    year,
    make,
    model,
    trim: "Base",
    detected: !!(yearMatch || makeMatch || modelMatch),
    tireSizes: []
  };

  // 2. VERIFICATION: EXCLUSIVELY WHEEL-SIZE API
  if (extractedInfo.detected && make !== "Vehicle") {
      const tireSizes = await checkWheelSizeApi(year, make, model === "Model" ? "" : model);
      
      if (tireSizes !== null) {
          console.log(`[Wheel-Size] Vehicle Verified: ${year} ${make} ${model}. Found Sizes: ${tireSizes.join(', ')}`);
          return { ...extractedInfo, detected: true, tireSizes: tireSizes };
      } else {
          console.log(`[Wheel-Size] Verification returned no results for: ${year} ${make} ${model}`);
      }
  }

  return extractedInfo;
};

export const fetchInstallers = async (): Promise<Installer[]> => {
  // SIMULATE SHOPIFY METAFIELD DB LOOKUP
  await new Promise(r => setTimeout(r, 500));
  return [
    { 
      id: 'inst-1', 
      name: 'GCI Auto Center - Downtown', 
      address: '1200 Main St, Cityville', 
      distance: '1.2 miles', 
      rating: 4.9, 
      mapPosition: { top: 30, left: 40 } 
    },
    { 
      id: 'inst-2', 
      name: 'Westside Tire & Brake', 
      address: '450 West Ave, Westtown', 
      distance: '3.5 miles', 
      rating: 4.7, 
      mapPosition: { top: 60, left: 20 }
    },
    { 
      id: 'inst-3', 
      name: 'Pro Performance Garage', 
      address: '88 Speedway Blvd, Raceland', 
      distance: '5.0 miles', 
      rating: 4.8, 
      mapPosition: { top: 50, left: 70 }
    }
  ];
};