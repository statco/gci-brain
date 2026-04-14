import type { VercelRequest, VercelResponse } from '@vercel/node';
import OpenAI from 'openai';

export const config = { maxDuration: 60 };

const SHOPIFY_TOKEN =
  process.env.SHOPIFY_ADMIN_API_TOKEN ||
  process.env.SHOPIFY_ADMIN_ACCESS_TOKEN || '';
const SHOPIFY_DOMAIN = process.env.SHOPIFY_STORE_DOMAIN || '';
const AI_API_KEY = process.env.AI_API_KEY || '';

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
  winter:    ['winter', 'hiver', 'hivernal', 'snow', 'neige'],
  allseason: ['all-season', 'all season', 'toutes saisons', 'all-weather'],
  summer:    ['summer', 'ete', 'performance'],
};

// -- RegionProfile ------------------------------------------------------------

type Province = 'QC'|'ON'|'BC'|'AB'|'MB'|'SK'|'NS'|'NB'|'NL'|'PE'|'NT'|'YT'|'NU'|'unknown';
type Climate  = 'subarctic'|'continental'|'maritime'|'semi-arid'|'temperate';
type Terrain  = 'mountain'|'rural'|'highway'|'city'|'suburban';

interface RegionProfile {
  province: Province;
  climate: Climate;
  winterSeverity: 1|2|3|4|5;
  terrain: Terrain;
  specialConditions: string[];
}

const CITY_PROVINCE: Record<string, Province> = {
  'montreal': 'QC', 'montreal-nord': 'QC', 'quebec city': 'QC', 'laval': 'QC',
  'gatineau': 'QC', 'longueuil': 'QC', 'sherbrooke': 'QC', 'saguenay': 'QC',
  'chicoutimi': 'QC', 'jonquiere': 'QC', 'alma': 'QC',
  'roberval': 'QC', 'dolbeau': 'QC', 'mistassini': 'QC', 'baie-comeau': 'QC',
  'sept-iles': 'QC', 'rimouski': 'QC', 'riviere-du-loup': 'QC',
  'matane': 'QC', 'gaspe': 'QC',
  'rouyn-noranda': 'QC', 'rouyn': 'QC', 'noranda': 'QC', 'val-dor': 'QC',
  'amos': 'QC', 'malartic': 'QC', 'la sarre': 'QC', 'senneterre': 'QC',
  'chibougamau': 'QC', 'chapais': 'QC', 'matagami': 'QC', 'kuujjuaq': 'QC',
  'chisasibi': 'QC', 'abitibi': 'QC', 'trois-rivieres': 'QC',
  'drummondville': 'QC', 'saint-jean-sur-richelieu': 'QC',
  'toronto': 'ON', 'ottawa': 'ON', 'mississauga': 'ON', 'brampton': 'ON',
  'hamilton': 'ON', 'london': 'ON', 'kitchener': 'ON', 'windsor': 'ON',
  'sudbury': 'ON', 'thunder bay': 'ON', 'sault ste marie': 'ON',
  'north bay': 'ON', 'timmins': 'ON', 'barrie': 'ON', 'kingston': 'ON',
  'vancouver': 'BC', 'surrey': 'BC', 'burnaby': 'BC', 'richmond': 'BC',
  'kelowna': 'BC', 'abbotsford': 'BC', 'victoria': 'BC', 'nanaimo': 'BC',
  'kamloops': 'BC', 'prince george': 'BC', 'whistler': 'BC',
  'revelstoke': 'BC', 'fernie': 'BC',
  'calgary': 'AB', 'edmonton': 'AB', 'red deer': 'AB', 'lethbridge': 'AB',
  'medicine hat': 'AB', 'grande prairie': 'AB', 'fort mcmurray': 'AB',
  'banff': 'AB', 'canmore': 'AB',
  'winnipeg': 'MB', 'brandon': 'MB', 'thompson': 'MB',
  'saskatoon': 'SK', 'regina': 'SK', 'prince albert': 'SK', 'moose jaw': 'SK',
  'halifax': 'NS', 'dartmouth': 'NS', 'sydney': 'NS', 'truro': 'NS',
  'moncton': 'NB', 'fredericton': 'NB', 'saint john': 'NB',
  'st. johns': 'NL', 'corner brook': 'NL', 'labrador city': 'NL',
};

const NORTHERN_QC = new Set([
  'saguenay', 'chicoutimi', 'jonquiere', 'alma', 'roberval', 'dolbeau',
  'mistassini', 'baie-comeau', 'sept-iles', 'rimouski',
  'riviere-du-loup', 'matane', 'gaspe',
  'rouyn-noranda', 'rouyn', 'noranda', 'val-dor', 'amos', 'malartic',
  'la sarre', 'senneterre', 'chibougamau', 'chapais', 'matagami',
  'kuujjuaq', 'chisasibi', 'abitibi',
]);

const MOUNTAIN_CITIES = new Set([
  'whistler', 'banff', 'canmore', 'revelstoke', 'fernie', 'jasper', 'lake louise',
  'golden', 'kimberley', 'rossland', 'nelson', 'trail', 'castlegar',
]);

const PROVINCE_ABBREV: Record<string, Province> = {
  'qc': 'QC', 'on': 'ON', 'bc': 'BC', 'ab': 'AB', 'mb': 'MB', 'sk': 'SK',
  'ns': 'NS', 'nb': 'NB', 'nl': 'NL', 'pe': 'PE', 'nt': 'NT', 'yt': 'YT', 'nu': 'NU',
};

const PROVINCE_FULL: Record<string, Province> = {
  'quebec': 'QC', 'ontario': 'ON', 'british columbia': 'BC',
  'alberta': 'AB', 'manitoba': 'MB', 'saskatchewan': 'SK', 'nova scotia': 'NS',
  'new brunswick': 'NB', 'newfoundland': 'NL', 'labrador': 'NL',
  'prince edward island': 'PE', 'northwest territories': 'NT',
  'yukon': 'YT', 'nunavut': 'NU',
};

function detectProvince(lc: string): Province {
  for (const [name, prov] of Object.entries(PROVINCE_FULL)) {
    if (lc.includes(name)) return prov;
  }
  for (const [abbr, prov] of Object.entries(PROVINCE_ABBREV)) {
    if (new RegExp('(^|[,\\s])' + abbr + '($|[,\\s])').test(lc)) return prov;
  }
  for (const [city, prov] of Object.entries(CITY_PROVINCE)) {
    if (lc.includes(city)) return prov;
  }
  return 'unknown';
}

function detectTerrain(lc: string): Terrain {
  for (const mc of MOUNTAIN_CITIES) {
    if (lc.includes(mc)) return 'mountain';
  }
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
  if (province === 'NT' || province === 'YT' || province === 'NU') return 5;
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

function getSpecialConditions(
  province: Province, lc: string, terrain: Terrain, severity: number
): string[] {
  const conditions: string[] = [];
  if (terrain === 'mountain') conditions.push('mountain passes & steep grades');
  if (terrain === 'rural')    conditions.push('unplowed rural roads');
  if (terrain === 'highway')  conditions.push('long highway distances');
  if (province === 'QC') {
    const inNorthernQC = [...NORTHERN_QC].some(n => lc.includes(n));
    if (inNorthernQC) conditions.push('extreme cold (-30C or below)');
    conditions.push('Quebec winter tire law (Dec 1-Mar 15)');
    if (['abitibi','rouyn','noranda'].some(k => lc.includes(k)))
      conditions.push('remote mining region roads');
  }
  if (province === 'MB') conditions.push('extreme wind chill & blowing snow');
  if (province === 'SK') conditions.push('ice fog & black ice prone');
  if (province === 'AB' && terrain === 'mountain') conditions.push('avalanche zone access roads');
  if (province === 'NT' || province === 'YT' || province === 'NU') {
    conditions.push('permafrost roads & extreme cold');
    conditions.push('limited tire service infrastructure');
  }
  if (['NS','NB','NL'].includes(province)) conditions.push('coastal salt air & freezing rain');
  if (province === 'BC' && terrain !== 'mountain') {
    if (['vancouver','victoria','nanaimo'].some(c => lc.includes(c)))
      conditions.push('rare but dangerous freezing rain events');
  }
  if (severity >= 4 && !conditions.some(c => c.includes('cold')))
    conditions.push('prolonged sub-zero temperatures');
  return conditions;
}

function getRegionProfile(location: string): RegionProfile {
  const lc = location.toLowerCase();
  const province       = detectProvince(lc);
  const terrain        = detectTerrain(lc);
  const climate        = getProvinceClimate(province);
  const winterSeverity = getWinterSeverity(province, lc, terrain) as 1|2|3|4|5;
  const specialConditions = getSpecialConditions(province, lc, terrain, winterSeverity);
  return { province, climate, winterSeverity, terrain, specialConditions };
}

function buildRegionAppend(profile: RegionProfile, lang: string): string {
  const isEn = lang !== 'fr';
  const { winterSeverity, specialConditions, terrain } = profile;

  const urgencyEN = [
    '',
    'Mild winter climate - all-season tires may suffice.',
    'Moderate winters - winter tires recommended for safety.',
    'Harsh winters - winter tires strongly recommended.',
    'Severe winters - dedicated winter tires are essential.',
    'Extreme winters - premium winter tires are critical for safety.',
  ];
  const urgencyFR = [
    '',
    "Climat hivernal doux - les pneus toutes-saisons peuvent suffire.",
    "Hivers moderes - pneus d'hiver recommandes pour la securite.",
    "Hivers rigoureux - pneus d'hiver fortement recommandes.",
    "Hivers severes - des pneus d'hiver dedies sont essentiels.",
    "Hivers extremes - des pneus d'hiver premium sont critiques pour la securite.",
  ];

  const urgency = isEn ? urgencyEN[winterSeverity] : urgencyFR[winterSeverity];
  const topConditions = specialConditions.slice(0, 2);
  const parts: string[] = [urgency];

  if (topConditions.length) {
    parts.push(isEn
      ? 'Regional factors: ' + topConditions.join('; ') + '.'
      : 'Facteurs regionaux: ' + topConditions.join('; ') + '.');
  }
  if (terrain === 'mountain') {
    parts.push(isEn
      ? 'Mountain terrain: prioritise tires with excellent grip on slopes and icy conditions.'
      : "Terrain montagneux: priorisez les pneus avec excellente adherence en pente et sur verglas.");
  }
  return parts.join(' ');
}

// -- Shopify ------------------------------------------------------------------

interface ShopifyVariant { id: number; price: string; inventory_quantity: number; }
interface ShopifyProduct { id: number; title: string; tags: string; variants: ShopifyVariant[]; }
interface TireOption {
  id: number; brand: string; model: string; size: string;
  loadIndex: number; price: number; tags: string[];
}

async function fetchInStockTires(tireType: string): Promise<TireOption[]> {
  // Fetch without tag filter — filter by season keyword in JS to avoid
  // strict tag-matching failures when Shopify tag format doesn't match exactly.
  const url = 'https://' + SHOPIFY_DOMAIN + '/admin/api/2024-01/products.json' +
    '?limit=50&fields=id,title,tags,variants';

  const resp = await fetch(url, { headers: { 'X-Shopify-Access-Token': SHOPIFY_TOKEN } });
  if (!resp.ok) throw new Error('Shopify ' + resp.status);

  const { products } = await resp.json() as { products: ShopifyProduct[] };

  // Filter to in-stock only
  const inStock = products.filter(p => p.variants.some(v => v.inventory_quantity > 0));

  // Filter by season keywords against title + tags
  const key = tireType.toLowerCase().replace('-', '').replace(' ', '');
  const keywords = SEASON_KEYWORDS[key] || SEASON_KEYWORDS['allseason'];
  const seasonMatched = inStock.filter(p => {
    const text = (p.title + ' ' + p.tags).toLowerCase();
    return keywords.some(k => text.includes(k));
  });

  // Fall back to all in-stock tires if season filter yields nothing
  const finalProducts = seasonMatched.length > 0 ? seasonMatched : inStock;

  return finalProducts.map(p => {
    const parts     = p.title.split(' ');
    const liMatch   = p.tags.match(/loadindex:(\d+)/i);
    const loadIndex = liMatch ? parseInt(liMatch[1], 10) : 0;
    const inStockV  = p.variants.find(v => v.inventory_quantity > 0)!;
    return {
      id:    p.id,
      brand: parts[0] || '',
      model: parts.slice(1, -1).join(' '),
      size:  parts[parts.length - 1] || '',
      loadIndex,
      price: parseFloat(inStockV.price),
      tags:  p.tags.split(',').map(t => t.trim()),
    };
  });
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
): string {
  const isEn = lang !== 'fr';
  const regionAppend = buildRegionAppend(regionProfile, lang);

  if (isEn) {
    return [
      'You are an expert tire consultant for GCI Tires (Canada).',
      'Recommend the best 2-3 tires from the inventory below for the customer vehicle and location.',
      regionAppend,
      heavy ? 'IMPORTANT: Vehicle is a truck/SUV - only recommend tires with load index >= 108.' : '',
      'Be concise, professional, and always prioritise safety. Mention price and key features.',
    ].filter(Boolean).join('\n');
  }

  return [
    'Vous etes un expert en pneus pour GCI Tires (Canada).',
    "Recommandez les 2-3 meilleurs pneus de l'inventaire ci-dessous pour le vehicule et la region du client.",
    regionAppend,
    heavy ? 'IMPORTANT: Vehicule camion/VUS - recommandez uniquement des pneus avec indice de charge >= 108.' : '',
    'Soyez concis, professionnel et priorisez la securite. Mentionnez le prix et les caracteristiques.',
  ].filter(Boolean).join('\n');
}

// -- Handler ------------------------------------------------------------------

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST')    return res.status(405).json({ error: 'Method not allowed' });

  // Model is controlled by the AI_MODEL environment variable in Vercel.
  const MODEL_ID = process.env.AI_MODEL || 'z-ai/glm-4.7-flash';

  const { vehicle, location, tireType, language, conversationHistory } = req.body ?? {};
  if (!vehicle || !location || !tireType)
    return res.status(400).json({ error: 'Missing vehicle, location, or tireType' });

  try {
    let tires = await fetchInStockTires(tireType as string);
    console.log('[matchEngine] tires fetched:', tires.length);

    if (tires.length === 0) {
      return res.status(200).json({
        reply: language === 'fr'
          ? "Aucun pneu en stock ne correspond a votre recherche pour le moment. Veuillez appeler le magasin pour obtenir de l'aide personnalisee."
          : 'No matching tires currently in stock for your search. Please call the store for personalized assistance.',
      });
    }

    const heavy = isHeavyVehicle(vehicle as string);
    if (heavy) tires = tires.filter(t => t.loadIndex === 0 || t.loadIndex >= 108);

    const regionProfile = getRegionProfile(location as string);
    const lang  = language === 'fr' ? 'fr' : 'en';
    const isEn  = lang === 'en';
    const systemPrompt = buildSystemPrompt(vehicle, location, lang, regionProfile, heavy);

    const inventoryText = tires.length
      ? tires.map(t =>
          '- ' + t.brand + ' ' + t.model + ' | Size: ' + t.size +
          (t.loadIndex ? ' | LI: ' + t.loadIndex : '') + ' | $' + t.price.toFixed(2) + ' CAD'
        ).join('\n')
      : (isEn ? 'No tires in stock for this season.' : 'Aucun pneu en stock pour cette saison.');

    const isFollowUp = Array.isArray(conversationHistory) && conversationHistory.length > 0;
    const userMessage = isFollowUp
      ? (isEn
          ? 'In-stock ' + tireType + ' tires for reference:\n' + inventoryText + '\n\nPlease answer the follow-up question above.'
          : 'Pneus ' + tireType + ' en stock pour reference:\n' + inventoryText + '\n\nVeuillez repondre a la question de suivi ci-dessus.')
      : (isEn
          ? 'Recommend the best ' + tireType + ' tires for a ' + vehicle + ' in ' + location + '.\n\nInventory:\n' + inventoryText
          : 'Recommandez les meilleurs pneus ' + tireType + ' pour un ' + vehicle + ' a ' + location + '.\n\nInventaire:\n' + inventoryText);

    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
      { role: 'system', content: systemPrompt },
      ...(isFollowUp ? conversationHistory as OpenAI.Chat.ChatCompletionMessageParam[] : []),
      { role: 'user', content: userMessage },
    ];

    const openai = new OpenAI({
      baseURL: 'https://openrouter.ai/api/v1',
      apiKey:  AI_API_KEY,
    });

    // DIAGNOSTIC: non-streaming JSON response
    const completion = await openai.chat.completions.create({
      model:      MODEL_ID,
      messages,
      stream:     false,
      max_tokens: 1024,
    });

    const reply = completion.choices[0]?.message?.content ?? '';
    return res.status(200).json({ reply });

  } catch (err: any) {
    console.error('matchEngine error:', err);
    return res.status(500).json({ error: err.message });
  }
}
