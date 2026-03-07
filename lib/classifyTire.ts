export interface TireClassification {
  season: string | null;
  vehicleType: string | null;
  brand: string | null;
}

// ORDER MATTERS: more specific keys must come before general ones
const SEASON_MAP: [string, string][] = [
  // ── Winter ────────────────────────────────────────────────
  ['winguard winspike', 'winter'],
  ['winguard ice', 'winter'],
  ['winguard wt1', 'winter'],
  ['winguard sport', 'winter'],   // base + Sport 2
  ['euro-win', 'winter'],
  ['evolution winter', 'winter'],
  ['discoverer true north', 'winter'],
  ['discoverer snow claw', 'winter'],
  ['wintrac', 'winter'],
  // ── All-Weather (3PMSF — legally winter in Quebec) ────────
  ['nblue 4season', 'all-weather'],
  ['nblue 4s', 'all-weather'],     // catches "4S" and "4S Van"
  ['quatrac', 'all-weather'],      // Quatrac + Quatrac Pro Plus
  ['roadian gtx', 'all-weather'],
  ['discoverer road trail', 'all-weather'],
  ['discoverer rugged trek aw', 'all-weather'],
  ['discoverer at3 xlt all-weather', 'all-weather'],
  ['discoverer at3 lt all-weather', 'all-weather'],
  ['discoverer at3 xlt', 'all-terrain'],
  ['discoverer at3 4s', 'all-weather'],
  ['endeavor plus', 'all-weather'],
  // ── All-Terrain (no dedicated season) ────────────────────
  ['roadian mtx', 'all-terrain'],
  ['roadian atx', 'all-terrain'],
  ['discoverer stt', 'all-terrain'],
  ['discoverer st maxx', 'all-terrain'],
  ['discoverer rugged trek lt', 'all-terrain'],
  ['discoverer rugged trek', 'all-terrain'],
  ['evolution mt', 'all-terrain'],
  // ── All-Season ────────────────────────────────────────────
  ['aria ah7', 'all-season'],
  ['npriz ah', 'all-season'],
  ['npriz s', 'all-season'],
  ['npriz rh', 'all-season'],
  ['nfera ru1', 'all-season'],
  ['nfera au7', 'all-season'],
  ['nfera supreme', 'all-season'],
  ['roadian hp', 'all-season'],
  ['roadian htx', 'all-season'],
  ['roadian ct8', 'all-season'],
  ['cp671', 'all-season'],
  ['cp672', 'all-season'],
  ['cs5 grand touring', 'all-season'],
  ['cs5 ultra touring', 'all-season'],
  ['discoverer srx', 'all-season'],    // SRX and SRX-LE
  ['discoverer enduramax', 'all-season'],
  ['discoverer ht3', 'all-season'],
  ['endeavor', 'all-season'],          // base Endeavor (after Endeavor Plus)
  ['procontrol', 'all-season'],
  // ── Summer / Performance ──────────────────────────────────
  ['nfera su1', 'summer'],
  ['nfera sport', 'summer'],
  ['cobra instinct', 'summer'],
  ['cobra radial gt', 'summer'],
  ['zeon rs3', 'summer'],
  ['zeon rs4', 'summer'],
];

const VEHICLE_MAP: [string, string][] = [
  // Light Truck (must come before suv/discoverer generics)
  ['roadian mtx', 'light-truck'],
  ['roadian atx', 'light-truck'],
  ['roadian ct8', 'light-truck'],
  ['roadian htx', 'light-truck'],
  ['discoverer stt', 'light-truck'],
  ['discoverer st maxx', 'light-truck'],
  ['discoverer snow claw lt', 'light-truck'],
  ['discoverer rugged trek lt', 'light-truck'],
  ['discoverer ht3', 'light-truck'],
  ['discoverer at3 lt', 'light-truck'],
  ['discoverer at3 xlt', 'light-truck'],
  ['winguard wt1', 'light-truck'],
  ['nblue 4s van', 'light-truck'],
  ['evolution mt', 'light-truck'],
  [' lt ', 'light-truck'],               // space-padded to avoid false matches
  // SUV / Crossover
  ['roadian', 'suv'],                    // all Roadian lines (HP, GTX, ATX, etc.)
  ['discoverer', 'suv'],                 // all Discoverer lines
  ['endeavor plus', 'suv'],
  ['winguard ice', 'suv'],
  ['suv', 'suv'],
  // Passenger
  ['winguard sport', 'passenger'],       // Winguard Sport 2 + base
  ['winguard winspike', 'passenger'],
  ['winguard wt1', 'passenger'],
  ['euro-win', 'passenger'],
  ['npriz', 'passenger'],
  ['nfera', 'passenger'],
  ['nblue', 'passenger'],
  ['aria', 'passenger'],
  ['cp67', 'passenger'],
  ['zeon', 'passenger'],
  ['cobra', 'passenger'],
  ['cs5', 'passenger'],
  ['endeavor', 'passenger'],             // base Endeavor = passenger/CUV
  ['evolution winter', 'passenger'],
  ['procontrol', 'passenger'],
  ['discoverer true north', 'suv'],
  ['wintrac', 'passenger'],
  ['quatrac', 'passenger'],
];

const BRAND_MAP: [string, string][] = [
  ['cooper', 'brand-cooper'],
  ['nexen', 'brand-nexen'],
  ['vredestein', 'brand-vredestein'],
  ['minerva', 'brand-minerva'],
  ['ovation', 'brand-ovation'],
  ['kenda', 'brand-kenda'],
  ['mastertrack', 'brand-mastertrack'],
  ['starfire', 'brand-starfire'],
  ['bridgestone', 'brand-bridgestone'],
  ['michelin', 'brand-michelin'],
  ['nokian', 'brand-nokian'],
  ['pirelli', 'brand-pirelli'],
  ['nitto', 'brand-nitto'],
  ['toyo', 'brand-toyo'],
  ['continental', 'brand-continental'],
  ['goodyear', 'brand-goodyear'],
  ['bfgoodrich', 'brand-bfgoodrich'],
];

export function classifyTire(title: string): TireClassification {
  const t = title.toLowerCase();

  let season: string | null = null;
  for (const [key, val] of SEASON_MAP) {
    if (t.includes(key)) { season = val; break; }
  }

  let vehicleType: string | null = null;
  for (const [key, val] of VEHICLE_MAP) {
    if (t.includes(key)) { vehicleType = val; break; }
  }

  let brand: string | null = null;
  for (const [key, val] of BRAND_MAP) {
    if (t.includes(key)) { brand = val; break; }
  }

  return { season, vehicleType, brand };
}
