/**
 * classify-coverage-check.mjs
 * ===========================
 * Locally replicates classifyTire() and tests a representative sample of
 * product titles. Brands added to BRAND_MAP in the most recent PR but that
 * have no matching keys in SEASON_MAP or VEHICLE_MAP will always return null.
 *
 * This script identifies which brand families lack season/vehicleType coverage.
 */

// ── Replicate classifyTire logic ──────────────────────────────────────────

const SEASON_MAP = [
  ['winguard winspike', 'winter'],
  ['winguard ice', 'winter'],
  ['winguard wt1', 'winter'],
  ['winguard sport', 'winter'],
  ['euro-win', 'winter'],
  ['evolution winter', 'winter'],
  ['discoverer true north', 'winter'],
  ['discoverer snow claw', 'winter'],
  ['wintrac', 'winter'],
  ['nblue 4season', 'all-weather'],
  ['nblue 4s', 'all-weather'],
  ['quatrac', 'all-weather'],
  ['roadian gtx', 'all-weather'],
  ['discoverer road trail', 'all-weather'],
  ['discoverer rugged trek aw', 'all-weather'],
  ['discoverer at3 xlt all-weather', 'all-weather'],
  ['discoverer at3 lt all-weather', 'all-weather'],
  ['discoverer at3 4s', 'all-weather'],
  ['endeavor plus', 'all-weather'],
  ['roadian mtx', 'all-terrain'],
  ['roadian atx', 'all-terrain'],
  ['discoverer stt', 'all-terrain'],
  ['discoverer st maxx', 'all-terrain'],
  ['discoverer rugged trek lt', 'all-terrain'],
  ['discoverer rugged trek', 'all-terrain'],
  ['evolution mt', 'all-terrain'],
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
  ['discoverer srx', 'all-season'],
  ['discoverer enduramax', 'all-season'],
  ['discoverer ht3', 'all-season'],
  ['endeavor', 'all-season'],
  ['procontrol', 'all-season'],
  ['nfera su1', 'summer'],
  ['nfera sport', 'summer'],
  ['cobra instinct', 'summer'],
  ['cobra radial gt', 'summer'],
  ['zeon rs3', 'summer'],
  ['zeon rs4', 'summer'],
];

const VEHICLE_MAP = [
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
  [' lt ', 'light-truck'],
  ['roadian', 'suv'],
  ['discoverer', 'suv'],
  ['endeavor plus', 'suv'],
  ['winguard ice', 'suv'],
  ['suv', 'suv'],
  ['winguard sport', 'passenger'],
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
  ['endeavor', 'passenger'],
  ['evolution winter', 'passenger'],
  ['procontrol', 'passenger'],
  ['discoverer true north', 'passenger'],
  ['wintrac', 'passenger'],
  ['quatrac', 'passenger'],
];

const BRAND_MAP = [
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

function classifyTire(title) {
  const t = title.toLowerCase();
  let season = null;
  for (const [key, val] of SEASON_MAP) { if (t.includes(key)) { season = val; break; } }
  let vehicleType = null;
  for (const [key, val] of VEHICLE_MAP) { if (t.includes(key)) { vehicleType = val; break; } }
  let brand = null;
  for (const [key, val] of BRAND_MAP) { if (t.includes(key)) { brand = val; break; } }
  return { season, vehicleType, brand };
}

// ── Sample titles: brands added in the recent PR with no season/vehicle keys ──

const SAMPLE_TITLES = [
  // ── Bridgestone ───────────────────────────────────────────────────────
  'Bridgestone Blizzak WS90 225/65R17 102T',
  'Bridgestone Blizzak DM-V3 235/65R17 108S',
  'Bridgestone Dueler H/P Sport 255/55R18 109H',
  'Bridgestone Turanza QuietTrack 235/55R18 100V',
  'Bridgestone Ecopia EP422 Plus 215/55R17 94V',
  'Bridgestone Potenza Sport 245/40R18 97Y',
  // ── Michelin ──────────────────────────────────────────────────────────
  'Michelin X-Ice Snow 225/55R17 101H XL',
  'Michelin Pilot Alpin 5 SUV 255/50R19 107V',
  'Michelin CrossClimate2 225/50R17 98V',
  'Michelin Defender2 215/60R16 95T',
  'Michelin Primacy Tour A/S 245/45R20 103V',
  'Michelin LTX A/T2 LT265/70R17 121S',
  // ── Nokian ────────────────────────────────────────────────────────────
  'Nokian Seasonproof 205/55R16 94V XL',
  'Nokian WR SUV 4 255/60R18 112H',
  'Nokian Hakkapeliitta 10 EV 235/45R18 98T',
  'Nokian One HT LT275/65R18 123S',
  // ── Pirelli ───────────────────────────────────────────────────────────
  'Pirelli Scorpion Winter 265/50R19 110H',
  'Pirelli P Zero 245/40R20 99Y',
  'Pirelli Cinturato All Season SF2 215/55R17 98W',
  'Pirelli Scorpion Verde All Season Plus II 235/65R17 108V',
  // ── Nitto ─────────────────────────────────────────────────────────────
  'Nitto NT555 G2 245/45R19 102Y',
  'Nitto Terra Grappler G2 LT265/70R18 124S',
  'Nitto Ridge Grappler LT285/70R17 121Q',
  // ── Toyo ──────────────────────────────────────────────────────────────
  'Toyo Open Country A/T III 265/70R17 121S',
  'Toyo Celsius CUV 235/55R19 105H',
  'Toyo Proxes Sport A/S 245/45R19 102Y',
  // ── Continental ───────────────────────────────────────────────────────
  'Continental VikingContact 7 215/60R16 99T XL',
  'Continental PureContact LS 225/50R17 98V',
  'Continental ExtremeContact DWS 06 Plus 255/45R18 103Y',
  // ── Goodyear ──────────────────────────────────────────────────────────
  'Goodyear Ultra Grip Ice WRT Gen-3 225/65R17 102S',
  'Goodyear Assurance WeatherReady 2 215/60R16 95H',
  'Goodyear Eagle Sport All-Season 235/45R18 98W',
  'Goodyear Wrangler TrailRunner AT LT275/65R18 123S',
  // ── BFGoodrich ────────────────────────────────────────────────────────
  'BFGoodrich All-Terrain T/A KO2 LT265/70R17 121S',
  'BFGoodrich g-Force COMP-2 A/S+ 245/45ZR18 100W',
  'BFGoodrich Advantage Control 215/60R16 95V',
  // ── Minerva ───────────────────────────────────────────────────────────
  'Minerva Radial F109 195/65R15 91H',
  // ── Ovation ───────────────────────────────────────────────────────────
  'Ovation VI-682 195/65R15 91V',
  // ── Kenda ─────────────────────────────────────────────────────────────
  'Kenda Klever AT2 LT265/75R16 123S',
  'Kenda Kenetica Touring A/S 225/60R16 98H',
  // ── Mastertrack ───────────────────────────────────────────────────────
  'Mastertrack M-Trac LT265/75R16 123Q',
  // ── Starfire ──────────────────────────────────────────────────────────
  'Starfire SF-340 205/55R16 91H',
  // ── Cooper (already covered) ──────────────────────────────────────────
  'Cooper Discoverer AT3 4S 265/70R17 121S',
  'Cooper Discoverer HT3 275/65R18 123S',
  'Cooper Discoverer True North 235/65R17 108T XL',
  // ── Nexen (already covered) ───────────────────────────────────────────
  'Nexen Winguard Ice Plus WH43 205/55R16 94H',
  'Nexen NPriz AH8 215/60R16 99H XL',
  'Nexen Roadian GTX 265/65R18 114H',
  // ── Vredestein (partly covered via Wintrac/Quatrac) ───────────────────
  'Vredestein Wintrac Pro 225/45R17 94V XL',
  'Vredestein Quatrac Pro EV 245/40R20 99Y',
  'Vredestein Ultrac 225/45R17 91Y',          // no model key
  'Vredestein Sportrac 5 205/55R16 91H',      // no model key
];

// ── Run ───────────────────────────────────────────────────────────────────

console.log('CLASSIFYTIRE COVERAGE AUDIT\n');
console.log('Checking representative product titles for null classifications…\n');

const nullSeasonTitles  = [];
const nullVehicleTitles = [];
const nullBothTitles    = [];
const fullyClassified   = [];

for (const title of SAMPLE_TITLES) {
  const { season, vehicleType, brand } = classifyTire(title);
  const row = { title, season, vehicleType, brand };

  if (!season && !vehicleType) nullBothTitles.push(row);
  else if (!season)            nullSeasonTitles.push(row);
  else if (!vehicleType)       nullVehicleTitles.push(row);
  else                         fullyClassified.push(row);
}

function printSection(label, rows) {
  if (!rows.length) return;
  console.log(`── ${label} (${rows.length}) ────────────────────────────`);
  for (const r of rows) {
    console.log(`  "${r.title}"`);
    console.log(`    season=${r.season ?? 'NULL'}  vehicleType=${r.vehicleType ?? 'NULL'}  brand=${r.brand ?? 'NULL'}`);
  }
  console.log('');
}

printSection('NULL season + vehicleType', nullBothTitles);
printSection('NULL season only',          nullSeasonTitles);
printSection('NULL vehicleType only',     nullVehicleTitles);
printSection('Fully classified (sample)', fullyClassified);

console.log('══════════════════════════════════════════════════════════════');
console.log(`  Tested: ${SAMPLE_TITLES.length} titles`);
console.log(`  Fully classified       : ${fullyClassified.length}`);
console.log(`  NULL season + vehicle  : ${nullBothTitles.length}`);
console.log(`  NULL season only       : ${nullSeasonTitles.length}`);
console.log(`  NULL vehicleType only  : ${nullVehicleTitles.length}`);
console.log('══════════════════════════════════════════════════════════════');

// Identify which brand families are fully uncovered
const brandsCovered   = new Set();
const brandsUncovered = new Set();
for (const r of fullyClassified)  brandsCovered.add(r.brand);
for (const r of [...nullBothTitles, ...nullSeasonTitles, ...nullVehicleTitles]) {
  if (r.brand) brandsUncovered.add(r.brand);
}

console.log('\nBrands with partial or no season/vehicleType coverage:');
for (const b of [...brandsUncovered].sort()) {
  const alsoOk = brandsCovered.has(b);
  console.log(`  ${b}${alsoOk ? ' (some models covered)' : ' ← NO coverage at all'}`);
}
