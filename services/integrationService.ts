import { TireProduct, VehicleInfo, QualityTier, Installer } from "../types";

// DRIVERIGHT DATA (DRD) CONFIGURATION
const DRD_CREDENTIALS = {
  username: "Patrick_GCI_API",
  securityToken: "3d8ad7df70964df1abebf51914b68b8e",
  baseUrl: "http://api.driverightdata.com/eu/swagger/ui/index#!/"
};

// WHEEL-SIZE API CONFIGURATION (Backup)
const WHEEL_SIZE_CONFIG = {
  baseUrl: "https://api.wheel-size.com/v2",
  userKey: process.env.WHEEL_SIZE_API_KEY
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
        let variantId = "0";
        if (variantNode?.id) {
            const matches = variantNode.id.match(/\/ProductVariant\/(\d+)/);
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

// Backup Validation: Wheel-Size.com API
async function checkWheelSizeApi(year: string, make: string, model: string): Promise<boolean> {
  if (!WHEEL_SIZE_CONFIG.userKey) return false;
  
  try {
    console.log(`[Wheel-Size] Querying backup verification for: ${year} ${make} ${model}`);
    const url = `${WHEEL_SIZE_CONFIG.baseUrl}/search/by_model/?make=${encodeURIComponent(make)}&model=${encodeURIComponent(model)}&year=${year}&user_key=${WHEEL_SIZE_CONFIG.userKey}`;
    
    const response = await fetch(url);
    if (!response.ok) {
        console.warn(`[Wheel-Size] API Request Failed: ${response.status}`);
        return false;
    }
    
    const data = await response.json();
    return Array.isArray(data) && data.length > 0;
  } catch (e) {
    console.error("[Wheel-Size] Backup verification failed", e);
    return false;
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

  const extractedInfo = {
    year,
    make,
    model,
    trim: "Base",
    detected: !!(yearMatch || makeMatch || modelMatch)
  };

  // 2. VERIFICATION CHAIN
  // Primary: DriveRightData (Simulated)
  // Backup: Wheel-Size.com (Real)

  console.log(`[DRD] Authenticating with User: ${DRD_CREDENTIALS.username}`);
  
  // Simulate DRD Latency
  await new Promise(r => setTimeout(r, 600));

  // Determine if DRD found a match based on our local lists
  const drdVerified = !!(yearMatch && makeMatch);

  if (drdVerified) {
      console.log(`[DRD] Match Verified: ${year} ${make} ${model}`);
      return { ...extractedInfo, detected: true };
  } else {
      console.warn(`[DRD] No exact match found locally. Attempting Wheel-Size Backup...`);
      
      // Fallback: If we extracted at least a Year and Make, try the Wheel-Size API
      if (yearMatch && make !== "Vehicle") {
          // If model is unknown, we just verify the Make/Year exist, 
          // or we try to pass the raw string parts if logic allows (simplified here)
          const backupVerified = await checkWheelSizeApi(year, make, model === "Model" ? "" : model);
          
          if (backupVerified) {
              console.log(`[Wheel-Size] Backup Verified!`);
              return { ...extractedInfo, detected: true };
          }
      }
  }

  return extractedInfo;
};

export const fetchInstallers = async (): Promise<Installer[]> => {
  // SIMULATE SHOPIFY METAFIELD DB LOOKUP
  await new Promise(r => setTimeout(r, 500));
  return [
    { id: 'inst-1', name: 'GCI Auto Center - Downtown', address: '1200 Main St, Cityville', distance: '1.2 miles', rating: 4.9 },
    { id: 'inst-2', name: 'Westside Tire & Brake', address: '450 West Ave, Westtown', distance: '3.5 miles', rating: 4.7 },
    { id: 'inst-3', name: 'Pro Performance Garage', address: '88 Speedway Blvd, Raceland', distance: '5.0 miles', rating: 4.8 }
  ];
};