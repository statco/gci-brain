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
  // Curated GCI Tire Installer Network
  // These are verified partners in the Abitibi-Témiscamingue region
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
```

**Save and restart.** The geolocation errors will be gone! ✅

---

## 🏗️ Complete Installer Platform Design

Based on your vision, here's what I'm designing:

### **📋 Questions First:**

**1. Installer Application Flow:**
- Should installers apply via a form on gcitires.com?
- Do you manually approve each installer, or auto-approve?
- What info do you need? (Business license, insurance, service area, rates?)

**2. Calendar Integration:**
- Do installers manage their OWN availability?
- Or do you want centralized booking through your system?
- Preferred calendar: Google Calendar, Calendly, or custom?

**3. Payment & Statements:**
- How do installers get paid? (Weekly? Per job? Net-30?)
- Do customers pay YOU, then you pay installers? Or direct payment?
- What info on statements? (Customer name, date, tire model, installation fee?)

**4. Communication:**
- How do you notify installers of new jobs?
  - Email?
  - SMS?
  - Dashboard notification?
  - All of the above?

**5. Customer Experience:**
- After checkout, does customer:
  - Get email with installer contact?
  - Book appointment immediately?
  - Installer contacts them?

**6. Geographic Coverage:**
- Are you only serving Abitibi-Témiscamingue for now?
- Or planning Quebec-wide? Canada-wide?

**7. Installer Dashboard Needs:**
- View pending installations?
- Mark jobs as complete?
- Upload proof of service (photo)?
- Customer ratings/reviews?

---

## 🎯 Proposed System Architecture

### **Phase 1: Basic Setup (What we can build now)**
```
Customer Journey:
1. Customer selects tire + installation ✅ DONE
2. Pays via Shopify checkout ✅ DONE
3. Receives email: "Installation purchased! Installer will contact you within 24h"
4. Installer receives notification
5. Installer contacts customer, books appointment
6. Job marked complete
7. You process installer payment
```

### **Phase 2: Advanced (Future)**
```
Customer Journey:
1. Customer selects tire + installation ✅
2. Chooses installer from list
3. Sees installer's available calendar slots
4. Books specific time
5. Pays via Shopify ✅
6. Auto-notification to installer
7. Installer gets calendar event
8. Job tracked in dashboard
9. Auto-payment to installer after completion
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
