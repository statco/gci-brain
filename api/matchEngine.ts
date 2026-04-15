import type { VercelRequest, VercelResponse } from '@vercel/node';
import OpenAI from 'openai';

export const config = { maxDuration: 60 };

const SHOPIFY_TOKEN =
  process.env.SHOPIFY_ADMIN_API_TOKEN ||
  process.env.SHOPIFY_ADMIN_ACCESS_TOKEN || '';
const SHOPIFY_DOMAIN = process.env.SHOPIFY_STORE_DOMAIN || '';
const AI_API_KEY = process.env.AI_API_KEY || '';

// ── Fitment helpers ──────────────────────────────────────────────────────────
const BASE_URL = process.env.VERCEL_URL
  ? `https://${process.env.VERCEL_URL}`
  : 'http://localhost:3000';

function normalizeTireSize(s: string): string {
  return s.replace(/^(P|LT|ST)/i, '').trim();
}

// Common chassis/trim suffixes that Wheel Size API doesn't recognise
const CHASSIS_SUFFIXES = /\b(WK2?|KL|XJ|WJ|ZJ|MK|KK|KA|JK|JL|JT|P38|L322|L405|W204|W205|W212|W213|X3[0-9]|F[0-9]{2}|E[0-9]{2}|G[0-9]{2})\b/gi;

function parseVehicle(vehicle: string): { year: string; make: string; model: string } | null {
  const yearMatch = vehicle.match(/\b(\d{4})\b/);
  if (!yearMatch) return null;
  const year = yearMatch[1];
  const rest  = vehicle.replace(year, '').replace(CHASSIS_SUFFIXES, '').trim().split(/\s+/).filter(Boolean);
  const make  = rest[0] || '';
  const model = rest.slice(1).join(' ') || '';
  return { year, make, model };
}

async function getOemSizes(vehicle: string | { year?: string; make?: string; model?: string }): Promise<string[]> {
  try {
    let year: string, make: string, model: string;
    if (typeof vehicle === 'object' && vehicle.year && vehicle.make && vehicle.model) {
      ({ year, make, model } = vehicle as { year: string; make: string; model: string });
    } else {
      const parsed = parseVehicle(vehicle as string);
      if (!parsed) {
        console.log('[fitment] parseVehicle returned null for:', vehicle);
        return [];
      }
      ({ year, make, model } = parsed);
    }
    console.log(`[fitment] calling fitmentCheck — make:${make} model:${model} year:${year} BASE_URL:${BASE_URL}`);
    const res = await fetch(`${BASE_URL}/api/fitmentCheck`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ make, model, year }),
    });
    console.log(`[fitment] fitmentCheck status: ${res.status}`);
    if (!res.ok) {
      console.log('[fitment] fitmentCheck non-ok, body:', await res.text().catch(() => '(unreadable)'));
      return [];
    }
    const json = await res.json();
    console.log('[fitment] fitmentCheck sizes:', json.sizes);
    return Array.isArray(json.sizes) ? json.sizes : [];
  } catch (err) {
    console.error('[matchEngine] fitmentCheck failed (graceful degradation):', err);
    return [];
  }
}
// ────────────────────────────────────────────────────────────────────────────

const SUV_TRUCK_KEYWORDS = [
  'truck','pickup','f-150','f150','silverado','ram','sierra','tundra',
  'tacoma','ranger','colorado','canyon','frontier','ridgeline','titan',
  'suv','4runner','pathfinder','explorer','expedition','yukon','tahoe',
  'suburban','traverse','pilot','passport','highlander','sequoia',
  'armada','navigator','escalade','mdx','rdx','qx60','qx80','gx','lx',
  'gls','gle','gla','glb','glc','x5','x6','x7','x3','x1','q7','q8',
  'q5','q3','cayenne','macan','urus','defender','discovery',
  'wrangler','gladiator','grand cherokee','durango','blazer',
  'equinox','terrain','trailblazer','bronco','4xe','crosstrek','forester',
  'outback','ascent','cx-9','cx-5','cx-50','cx-90','rogue','murano',
  'xterra','sorento','telluride','palisade','tucson',
  'santa fe','santa cruz','sportage','veracruz',
];

const SEASON_KEYWORDS: Record<string, string[]> = {
  winter:    ['winter', 'hiver', 'hivernal', 'snow', 'neige', 'studded', 'studless', 'pneu hiver'],
  allseason: ['all-season', 'all season', 'toutes saisons', 'all-weather', 'quatre saisons', '4 saisons'],
  summer:    ['summer', 'ete', 'performance', 'sport'],
};

type Province = 'QC'|'ON'|'BC'|'AB'|'MB'|'SK'|'NS'|'NB'|'NL'|'PE'|'NT'|'YT'|'NU'|'unknown';
type Climate  = 'subarctic'|'continental'|'maritime'|'semi-arid'|'temperate';
type Terrain  = 'mountain'|'rural'|'highway'|'city'|'suburban';

interface RegionProfile {
  province: Province; climate: Climate;
  winterSeverity: 1|2|3|4|5; terrain: Terrain; specialConditions: string[];
}

const CITY_PROVINCE: Record<string, Province> = {
  'montreal':'QC','montreal-nord':'QC','quebec city':'QC','laval':'QC',
  'gatineau':'QC','longueuil':'QC','sherbrooke':'QC','saguenay':'QC',
  'chicoutimi':'QC','jonquiere':'QC','alma':'QC','roberval':'QC',
  'dolbeau':'QC','mistassini':'QC','baie-comeau':'QC','sept-iles':'QC',
  'rimouski':'QC','riviere-du-loup':'QC','matane':'QC','gaspe':'QC',
  'rouyn-noranda':'QC','rouyn':'QC','noranda':'QC','val-dor':'QC',
  'amos':'QC','malartic':'QC','la sarre':'QC','senneterre':'QC',
  'chibougamau':'QC','chapais':'QC','matagami':'QC','kuujjuaq':'QC',
  'chisasibi':'QC','abitibi':'QC','trois-rivieres':'QC',
  'drummondville':'QC','saint-jean-sur-richelieu':'QC',
  'toronto':'ON','ottawa':'ON','mississauga':'ON','brampton':'ON',
  'hamilton':'ON','london':'ON','kitchener':'ON','windsor':'ON',
  'sudbury':'ON','thunder bay':'ON','sault ste marie':'ON',
  'north bay':'ON','timmins':'ON','barrie':'ON','kingston':'ON',
  'vancouver':'BC','surrey':'BC','burnaby':'BC','richmond':'BC',
  'kelowna':'BC','abbotsford':'BC','victoria':'BC','nanaimo':'BC',
  'kamloops':'BC','prince george':'BC','whistler':'BC','revelstoke':'BC','fernie':'BC',
  'calgary':'AB','edmonton':'AB','red deer':'AB','lethbridge':'AB',
  'medicine hat':'AB','grande prairie':'AB','fort mcmurray':'AB','banff':'AB','canmore':'AB',
  'winnipeg':'MB','brandon':'MB','thompson':'MB',
  'saskatoon':'SK','regina':'SK','prince albert':'SK','moose jaw':'SK',
  'halifax':'NS','dartmouth':'NS','sydney':'NS','truro':'NS',
  'moncton':'NB','fredericton':'NB','saint john':'NB',
  'st. johns':'NL','corner brook':'NL','labrador city':'NL',
};

const NORTHERN_QC = new Set([
  'saguenay','chicoutimi','jonquiere','alma','roberval','dolbeau','mistassini',
  'baie-comeau','sept-iles','rimouski','riviere-du-loup','matane','gaspe',
  'rouyn-noranda','rouyn','noranda','val-dor','amos','malartic',
  'la sarre','senneterre','chibougamau','chapais','matagami','kuujjuaq','chisasibi','abitibi',
]);

const MOUNTAIN_CITIES = new Set([
  'whistler','banff','canmore','revelstoke','fernie','jasper','lake louise',
  'golden','kimberley','rossland','nelson','trail','castlegar',
]);

const PROVINCE_ABBREV: Record<string, Province> = {
  'qc':'QC','on':'ON','bc':'BC','ab':'AB','mb':'MB','sk':'SK',
  'ns':'NS','nb':'NB','nl':'NL','pe':'PE','nt':'NT','yt':'YT','nu':'NU',
};

const PROVINCE_FULL: Record<string, Province> = {
  'quebec':'QC','ontario':'ON','british columbia':'BC','alberta':'AB',
  'manitoba':'MB','saskatchewan':'SK','nova scotia':'NS','new brunswick':'NB',
  'newfoundland':'NL','labrador':'NL','prince edward island':'PE',
  'northwest territories':'NT','yukon':'YT','nunavut':'NU',
};

function detectProvince(lc: string): Province {
  for (const [name, prov] of Object.entries(PROVINCE_FULL)) { if (lc.includes(name)) return prov; }
  for (const [abbr, prov] of Object.entries(PROVINCE_ABBREV)) {
    if (new RegExp('(^|[,\\s])' + abbr + '($|[,\\s])').test(lc)) return prov;
  }
  for (const [city, prov] of Object.entries(CITY_PROVINCE)) { if (lc.includes(city)) return prov; }
  return 'unknown';
}

function detectTerrain(lc: string): Terrain {
  for (const mc of MOUNTAIN_CITIES) { if (lc.includes(mc)) return 'mountain'; }
  if (['mountain','alpine','hill','pass','peak','ridge'].some(w => lc.includes(w))) return 'mountain';
  if (['downtown','city centre','city center','urban','metro'].some(w => lc.includes(w))) return 'city';
  if (['highway','autoroute','hwy','trans-canada'].some(w => lc.includes(w))) return 'highway';
  if (['rural','farm','county','township','rang'].some(w => lc.includes(w))) return 'rural';
  return 'suburban';
}

function getProvinceClimate(province: Province): Climate {
  switch (province) {
    case 'BC': return 'maritime';
    case 'AB': return 'semi-arid';
    case 'QC': case 'ON': case 'MB': case 'SK': return 'continental';
    case 'NS': case 'NB': case 'NL': case 'PE': return 'maritime';
    case 'NT': case 'YT': case 'NU': return 'subarctic';
    default: return 'continental';
  }
}

function getWinterSeverity(province: Province, lc: string, terrain: Terrain): 1|2|3|4|5 {
  const inNorthernQC = province === 'QC' && [...NORTHERN_QC].some(n => lc.includes(n));
  if (inNorthernQC) return 5;
  if (['NT','YT','NU'].includes(province)) return 5;
  if (province === 'MB') return 5;
  if (province === 'SK') return 4;
  if (province === 'AB') {
    if (terrain === 'mountain') return 5;
    if (['lethbridge','medicine hat'].some(c => lc.includes(c))) return 3;
    return 4;
  }
  if (province === 'ON') {
    if (['sudbury','thunder bay','sault','timmins','north bay','kapuskasing'].some(c => lc.includes(c))) return 4;
    if (['toronto','mississauga','brampton','oakville','burlington','hamilton','london','windsor'].some(c => lc.includes(c))) return 2;
    return 3;
  }
  if (province === 'QC') {
    if (['montreal','laval','longueuil','gatineau'].some(c => lc.includes(c))) return 3;
    return 4;
  }
  if (province === 'BC') {
    if (terrain === 'mountain') return 4;
    if (['vancouver','surrey','burnaby','richmond','victoria','nanaimo','abbotsford'].some(c => lc.includes(c))) return 1;
    return 3;
  }
  if (['NS','NB','NL','PE'].includes(province)) return 3;
  return 3;
}

function getSpecialConditions(province: Province, lc: string, terrain: Terrain, severity: number): string[] {
  const c: string[] = [];
  if (terrain === 'mountain') c.push('mountain passes & steep grades');
  if (terrain === 'rural')    c.push('unplowed rural roads');
  if (terrain === 'highway')  c.push('long highway distances');
  if (province === 'QC') {
    if ([...NORTHERN_QC].some(n => lc.includes(n))) c.push('extreme cold (-30C or below)');
    c.push('Quebec winter tire law (Dec 1-Mar 15)');
    if (['abitibi','rouyn','noranda'].some(k => lc.includes(k))) c.push('remote mining region roads');
  }
  if (province === 'MB') c.push('extreme wind chill & blowing snow');
  if (province === 'SK') c.push('ice fog & black ice prone');
  if (province === 'AB' && terrain === 'mountain') c.push('avalanche zone access roads');
  if (['NT','YT','NU'].includes(province)) { c.push('permafrost roads & extreme cold'); c.push('limited tire service infrastructure'); }
  if (['NS','NB','NL'].includes(province)) c.push('coastal salt air & freezing rain');
  if (province === 'BC' && terrain !== 'mountain' && ['vancouver','victoria','nanaimo'].some(x => lc.includes(x)))
    c.push('rare but dangerous freezing rain events');
  if (severity >= 4 && !c.some(x => x.includes('cold'))) c.push('prolonged sub-zero temperatures');
  return c;
}

function getRegionProfile(location: string): RegionProfile {
  const lc = location.toLowerCase();
  const province       = detectProvince(lc);
  const terrain        = detectTerrain(lc);
  const climate        = getProvinceClimate(province);
  const winterSeverity = getWinterSeverity(province, lc, terrain) as 1|2|3|4|5;
  return { province, climate, winterSeverity, terrain, specialConditions: getSpecialConditions(province, lc, terrain, winterSeverity) };
}

function buildRegionAppend(profile: RegionProfile, lang: string): string {
  const isEn = lang !== 'fr';
  const urgencyEN = ['','Mild winter climate - all-season tires may suffice.','Moderate winters - winter tires recommended for safety.','Harsh winters - winter tires strongly recommended.','Severe winters - dedicated winter tires are essential.','Extreme winters - premium winter tires are critical for safety.'];
  const urgencyFR = ['','Climat hivernal doux - les pneus toutes-saisons peuvent suffire.','Hivers moderes - pneus d\'hiver recommandes pour la securite.','Hivers rigoureux - pneus d\'hiver fortement recommandes.','Hivers severes - des pneus d\'hiver dedies sont essentiels.','Hivers extremes - des pneus d\'hiver premium sont critiques pour la securite.'];
  const parts = [isEn ? urgencyEN[profile.winterSeverity] : urgencyFR[profile.winterSeverity]];
  const top = profile.specialConditions.slice(0, 2);
  if (top.length) parts.push(isEn ? 'Regional factors: ' + top.join('; ') + '.' : 'Facteurs regionaux: ' + top.join('; ') + '.');
  if (profile.terrain === 'mountain') parts.push(isEn ? 'Mountain terrain: prioritise tires with excellent grip on slopes and icy conditions.' : 'Terrain montagneux: priorisez les pneus avec excellente adherence.');
  return parts.join(' ');
}

interface ShopifyVariant { id: number; price: string; inventory_quantity: number; }
interface ShopifyImage  { src: string; }
interface ShopifyProduct { id: number; title: string; tags: string; product_type: string; handle: string; images: ShopifyImage[]; variants: ShopifyVariant[]; }
interface TireOption { id: number; brand: string; model: string; size: string; productType: string; handle: string; loadIndex: number; price: number; image: string; tags: string[]; fitmentVerified?: boolean; }

async function fetchInStockTires(tireType: string): Promise<{ tires: TireOption[]; seasonFallback: boolean }> {
  const url = 'https://' + SHOPIFY_DOMAIN + '/admin/api/2024-01/products.json?limit=50&status=active&fields=id,title,tags,product_type,handle,images,variants';
  const resp = await fetch(url, { headers: { 'X-Shopify-Access-Token': SHOPIFY_TOKEN } });
  if (!resp.ok) throw new Error('Shopify ' + resp.status);
  const { products } = await resp.json() as { products: ShopifyProduct[] };
  const inStock = products.filter(p => p.variants.some(v => v.inventory_quantity > 0));
  const key = tireType.toLowerCase().replace(/-/g, '').replace(/\s/g, '');
  const keywords = SEASON_KEYWORDS[key] || SEASON_KEYWORDS['allseason'];
  const matched = inStock.filter(p =>
    keywords.some(k => (p.title + ' ' + p.tags + ' ' + p.product_type).toLowerCase().includes(k))
  );
  const seasonFallback = matched.length === 0;
  const final = seasonFallback ? inStock : matched;
  return { seasonFallback, tires: final.map(p => {
    const parts = p.title.split(' ');
    const liMatch = p.tags.match(/loadindex:(\d+)/i);
    const inStockV = p.variants.find(v => v.inventory_quantity > 0)!;
    return {
      id: p.id,
      brand: parts[0] || '',
      model: parts.slice(1, -1).join(' '),
      size: parts[parts.length - 1] || '',
      productType: p.product_type || '',
      handle: p.handle || '',
      loadIndex: liMatch ? parseInt(liMatch[1], 10) : 0,
      price: parseFloat(inStockV.price),
      image: (p.images && p.images[0]) ? p.images[0].src : '',
      tags: p.tags.split(',').map(t => t.trim()),
    };
  }) };
}

function isHeavyVehicle(v: string): boolean {
  const lc = v.toLowerCase();
  return SUV_TRUCK_KEYWORDS.some(k => lc.includes(k));
}

function buildSystemPrompt(
  vehicle: string,
  location: string,
  lang: string,
  regionProfile: RegionProfile,
  heavy: boolean,
  oemSizes: string[],
): string {
  const isEn = lang !== 'fr';
  const ra = buildRegionAppend(regionProfile, lang);
  const fitmentLine = oemSizes.length > 0
    ? `OEM tire sizes for this vehicle: ${oemSizes.join(', ')}. Only recommend tires that match these exact sizes. Never recommend a tire with a different size.`
    : '';
  if (isEn) return [
    'You are an expert tire consultant for GCI Tires (Canada).',
    'Recommend the best tires from the inventory for the customer vehicle and location. Each tire includes a productType field indicating its season category (e.g. "Winter Tires", "All-Season Tires").',
    ra,
    fitmentLine,
    heavy ? 'IMPORTANT: Vehicle is a truck/SUV - only recommend tires with load index >= 108.' : '',
    'Be concise and professional. Mention price and key features.',
  ].filter(Boolean).join('\n');
  return [
    'Vous etes un expert en pneus pour GCI Tires (Canada).',
    `Recommandez les meilleurs pneus de l'inventaire pour le vehicule et la region du client. Chaque pneu inclut un champ productType indiquant sa categorie de saison (ex. "Winter Tires", "All-Season Tires").`,
    ra,
    fitmentLine,
    heavy ? 'IMPORTANT: Vehicule camion/VUS - recommandez uniquement des pneus avec indice de charge >= 108.' : '',
    'Soyez concis et professionnel. Mentionnez le prix et les caracteristiques.',
  ].filter(Boolean).join('\n');
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST')    return res.status(405).json({ error: 'Method not allowed' });

  const MODEL_ID = process.env.AI_MODEL || 'openai/gpt-4o-mini';
  const { vehicle, location, tireType, language, conversationHistory } = req.body ?? {};
  if (!vehicle || !location || !tireType)
    return res.status(400).json({ error: 'Missing vehicle, location, or tireType' });

  try {
    let { tires, seasonFallback } = await fetchInStockTires(tireType as string);
    console.log('[matchEngine] tires fetched:', tires.length);

    // ── Steps 2–5: Fitment verification ────────────────────────────────────
    const oemSizes = await getOemSizes(vehicle);
    let fitmentFiltered = false;

    if (oemSizes.length > 0) {
      const filtered = tires.filter(t =>
        oemSizes.some(s => normalizeTireSize(s) === normalizeTireSize(t.size))
      );
      if (filtered.length > 0) {
        tires = filtered;
        fitmentFiltered = true;
        console.log('[matchEngine] fitment-filtered tires:', tires.length, '| OEM sizes:', oemSizes);
      } else {
        // OEM sizes known but none in stock — fall back to full inventory
        console.log('[matchEngine] fitment filter yielded 0 results, falling back to all tires | OEM sizes:', oemSizes);
      }
    }
    // ───────────────────────────────────────────────────────────────────────

    if (tires.length === 0) {
      return res.status(200).json({
        reply: language === 'fr'
          ? "Aucun pneu en stock pour le moment. Veuillez appeler le magasin pour obtenir de l'aide."
          : 'No tires currently in stock for your search. Please call the store for personalized assistance.',
        tires: [],
      });
    }

    // ── Season short-circuit: requested type not in stock ───────────────────
    // Skip AI entirely to prevent hallucination — return a deterministic message.
    if (seasonFallback && !Array.isArray(conversationHistory)) {
      const reply = language === 'fr'
        ? `Nous n'avons pas de pneus de type "${tireType}" en stock pour le moment. Voici les pneus disponibles dans notre inventaire — veuillez choisir parmi ceux-ci ou appeler le magasin pour plus d'options.`
        : `We currently don't have "${tireType}" tires in stock. Here are the tires available in our inventory — please choose from these or call the store for more options.`;
      const tiresOut = tires.map(t => ({ ...t, fitmentVerified: false }));
      return res.status(200).json({ reply, tires: tiresOut, seasonFallback: true });
    }
    // ────────────────────────────────────────────────────────────────────────

    const heavy = isHeavyVehicle(vehicle as string);
    if (heavy) tires = tires.filter(t => t.loadIndex === 0 || t.loadIndex >= 108);

    const regionProfile = getRegionProfile(location as string);
    const lang = language === 'fr' ? 'fr' : 'en';
    const systemPrompt = buildSystemPrompt(vehicle as string, location as string, lang, regionProfile, heavy, oemSizes);

    // Slim payload for AI — exclude image URL to save tokens
    const tireListForAI = tires.map(({ id, brand, model, size, productType, loadIndex, price, tags }) =>
      ({ id, brand, model, size, productType, loadIndex, price, tags })
    );
    const tireList = tireListForAI.length > 0
      ? JSON.stringify(tireListForAI, null, 2)
      : 'No specific tires found in inventory.';

    const isFollowUp = Array.isArray(conversationHistory) && conversationHistory.length > 0;
    const userMessage = lang === 'fr'
      ? 'Vehicule: ' + vehicle + '. Lieu: ' + location +
        '. Type de pneu recherche: ' + tireType +
        (seasonFallback ? ' NOTE: Aucun pneu ' + tireType + ' n\'est en stock actuellement. Informez clairement le client que les pneus ' + tireType + ' ne sont pas disponibles. Ne presentez PAS d\'autres types de pneus comme des pneus ' + tireType + '.' : '') +
        '. Voici ce que nous avons en stock: ' + tireList +
        '. Meme si le choix est limite, donnez votre meilleure recommandation basee sur ce qui est disponible.'
      : 'Vehicle: ' + vehicle + '. Location: ' + location +
        '. Looking for: ' + tireType + ' tires.' +
        (seasonFallback ? ' NOTE: No ' + tireType + ' tires are currently in stock. Clearly inform the customer that ' + tireType + ' tires are unavailable. Do NOT present other tire types as ' + tireType + ' tires. Show what is available as alternatives only.' : '') +
        ' Here is what we have in stock: ' + tireList +
        ' Even if selection is limited, give your best recommendation based on what is available.';

    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
      { role: 'system', content: systemPrompt },
      ...(isFollowUp ? conversationHistory as OpenAI.Chat.ChatCompletionMessageParam[] : []),
      { role: 'user', content: userMessage },
    ];

    const openai = new OpenAI({ baseURL: 'https://openrouter.ai/api/v1', apiKey: AI_API_KEY });

    try {
      const completion = await openai.chat.completions.create({
        model: MODEL_ID, messages, stream: false, max_tokens: 800,
      });

      const reply = completion.choices[0]?.message?.content ?? '';

      if (!reply) {
        return res.status(200).json({ reply: 'AI returned empty \u2014 tires found: ' + tires.length, tires });
      }

      // Step 5 — mark fitmentVerified on each tire
      const tiresWithFitment = tires.map(t => ({
        ...t,
        fitmentVerified: fitmentFiltered
          ? oemSizes.some(s => normalizeTireSize(s) === normalizeTireSize(t.size))
          : false,
      }));

      return res.status(200).json({ reply, tires: tiresWithFitment });
    } catch (aiError: any) {
      console.error('[matchEngine] AI call failed:', aiError?.message, aiError?.status);
      return res.status(200).json({ reply: 'AI error: ' + (aiError?.message || 'unknown') + ' | tires: ' + tires.length, tires: [] });
    }

  } catch (err: any) {
    console.error('[matchEngine] handler error:', err);
    return res.status(500).json({ error: err.message });
  }
}
