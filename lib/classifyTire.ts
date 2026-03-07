// lib/classifyTire.ts
// Shared tire classification logic used by api/tagProducts.ts and api/shopifySync.ts.
// Derives season, vehicleType, and brand tags from a product title.

const SEASON_MAP: Record<string, string> = {
  // Winter
  'winguard': 'winter',
  'evolution winter': 'winter',
  'discoverer true north': 'winter',
  'blizzak': 'winter',
  'ice': 'winter',         // catches Winguard Ice SUV
  // All-Weather (3PMSF — legally winter in Quebec)
  'nblue 4s': 'all-weather',
  'roadian gtx': 'all-weather',
  'endeavor plus': 'all-weather',
  // All-Season
  'npriz ah': 'all-season',
  'npriz s': 'all-season',
  'npriz rh': 'all-season',
  'nfera ru1': 'all-season',
  'nfera au7': 'all-season',
  'roadian hp': 'all-season',
  'cp671': 'all-season',
  'discoverer srx': 'all-season',
  'endeavor': 'all-season',   // base Endeavor (not Plus)
  // All-Terrain (no season — works year-round)
  'roadian mtx': 'all-terrain',
  'discoverer stt': 'all-terrain',
  'discoverer st maxx': 'all-terrain',
  'discoverer at3': 'all-terrain',
  // Summer / Performance
  'nfera su1': 'summer',
  'nfera sport': 'summer',
  'zeon rs3': 'summer',
  'zeon rs4': 'summer',
  'cp672': 'summer',
};

const VEHICLE_MAP: Record<string, string> = {
  'suv': 'suv',
  'roadian': 'suv',          // Nexen Roadian = SUV line
  'discoverer': 'suv',       // Cooper Discoverer = SUV/truck
  'lt': 'light-truck',
  'mtx': 'light-truck',
  'stt': 'light-truck',
  'st maxx': 'light-truck',
  'at3 4s': 'light-truck',
  'winguard sport': 'passenger',
  'npriz': 'passenger',
  'nfera': 'passenger',
  'nblue': 'passenger',
  'cp6': 'passenger',
  'zeon': 'passenger',
  'evolution winter': 'passenger',
  'endeavor plus': 'suv',
};

const BRAND_MAP: Record<string, string> = {
  'cooper': 'brand-cooper',
  'nexen': 'brand-nexen',
  'vredestein': 'brand-vredestein',
  'minerva': 'brand-minerva',
  'ovation': 'brand-ovation',
  'kenda': 'brand-kenda',
  'mastertrack': 'brand-mastertrack',
  'starfire': 'brand-starfire',
};

export interface TireClassification {
  season: string | null;
  vehicleType: string | null;
  brand: string | null;
}

export function classifyTire(title: string): TireClassification {
  const lower = title.toLowerCase();

  let season: string | null = null;
  for (const key of Object.keys(SEASON_MAP)) {
    if (lower.includes(key)) { season = SEASON_MAP[key]; break; }
  }

  let vehicleType: string | null = null;
  for (const key of Object.keys(VEHICLE_MAP)) {
    if (lower.includes(key)) { vehicleType = VEHICLE_MAP[key]; break; }
  }

  let brand: string | null = null;
  for (const key of Object.keys(BRAND_MAP)) {
    if (lower.includes(key)) { brand = BRAND_MAP[key]; break; }
  }

  return { season, vehicleType, brand };
}
