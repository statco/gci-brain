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

// ── RegionProfile ─────────────────────────────────────────────────────────────

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
  // QC
  'montreal':'QC',’montréal’:'QC','quebec city':'QC','québec':'QC','laval':'QC',
  'gatineau':'QC','longueuil':'QC','sherbrooke':'QC','saguenay':'QC',
  'chicoutimi':'QC','jonquière':'QC','jonquiere':'QC','alma':'QC',
  'roberval':'QC','dolbeau':'QC','mistassini':'QC','baie-comeau':'QC',
  'sept-îles':'QC','sept-iles':'QC','rimouski':'QC','rivière-du-loup':'QC',
  'riviere-du-loup':'QC','matane':'QC','gaspé':'QC','gaspe':'QC',
  'rouyn-noranda':'QC','rouyn':'QC','noranda':'QC',"val-d'or":'QC',
  'amos':'QC','malartic':'QC','la sarre':'QC','senneterre':'QC',
  'chibougamau':'QC','chapais':'QC','matagami':'QC','kuujjuaq':'QC',
  'chisasibi':'QC','abitibi':'QC','trois-rivières':'QC','trois-rivieres':'QC',
  'drummondville':'QC','saint-jean-sur-richelieu':'QC',
  // ON
  'toronto':'ON','ottawa':'ON','mississauga':'ON','brampton':'ON',
  'hamilton':'ON','london':'ON','kitchener':'ON','windsor':'ON',
  'sudbury':'ON','thunder bay':'ON','sault ste. marie':'ON','sault ste marie':'ON',
  'north bay':'ON','timmins':'ON','barrie':'ON','kingston':'ON',
  // BC
  'vancouver':'BC','surrey':'BC','burnaby':'BC','richmond':'BC',
  'kelowna':'BC','abbotsford':'BC','victoria':'BC','nanaimo':'BC',
  'kamloops':'BC','prince george':'BC','whistler':'BC',
  'revelstoke':'BC','fernie':'BC',
  // AB
  'calgary':'AB','edmonton':'AB','red deer':'AB','lethbridge':'AB',
  'medicine hat':'AB','grande prairie':'AB','fort mcmurray':'AB',
  'banff':'AB','canmore':'AB',
  // MB
  'winnipeg':'MB','brandon':'MB','thompson':'MB',
  // SK
  'saskatoon':'SK','regina':'SK','prince albert':'SK','moose jaw':'SK',
  // NS
  'halifax':'NS','dartmouth':'NS','sydney':'NS','truro':'NS',
  // NB
  'moncton':'NB','fredericton':'NB','saint john':'NB',
  // NL
  "st. john's":'NL','st. johns':'NL','corner brook':'NL','labrador city':'NL',
};

const NORTHERN_QC = new Set([
  'saguenay','chicoutimi','jonquière','jonquiere','alma','roberval','dolbeau',
  'mistassini','baie-comeau','sept-îles','sept-iles','rimouski',
  'rivière-du-loup','riviere-du-loup','matane','gaspé','gaspe',
  'rouyn-noranda','rouyn','noranda',"val-d'or",'amos','malartic',
  'la sarre','senneterre','chibougamau','chapais','matagami',
  'kuujjuaq','chisasibi','abitibi',
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
  'quebec':'QC','québec':'QC','ontario':'ON','british columbia':'BC',
  'alberta':'AB','manitoba':'MB','saskatchewan':'SK','nova scotia':'NS',
  'new brunswick':'NB','newfoundland':'NL','labrador':'NL',
  'prince edward island':'PE','northwest territories':'NT',
  'yukon':'YT','nunavut':'NU',
};

function detectProvince(lc: string): Province {
  for (const [name, prov] of Object.entries(PROVINCE_FULL)) {
    if (lc.includes(name)) return prov;
  }
  for (const [abbr, prov] of Object.entries(PROVINCE_ABBREV)) {
    if (new RegExp(`(^|[,\\s])${abbr}($|[,\\s])`).test(lc)) return prov;
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
    if (['montreal','montréal','laval','longueuil','gatineau'].some(c => lc.includes(c))) return 3;
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
    if (inNorthernQC) conditions.push('extreme cold (-30°C or below)');
    conditions.push('Quebec winter tire law (Dec 1–Mar 15)');
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
  const province  = detectProvince(lc);
  const terrain   = detectTerrain(lc);
  const climate   = getProvinceClimate(province);
  const winterSeverity = getWinterSeverity(province, lc, terrain) as 1|2|3|4|5;
  const specialConditions = getSpecialConditions(province, lc, terrain, winterSeverity);
  return { province, climate, winterSeverity, terrain, specialConditions };
}

function buildRegionAppend(profile: RegionProfile, lang: string): string {
  const isEn = lang !== 'fr';
  const { winterSeverity, specialConditions, terrain } = profile;

  const urgencyEN = [
    '',
    'Mild winter climate — all-season tires may suffice.',
    'Moderate winters — winter tires recommended for safety.',
    'Harsh winters — winter tires strongly recommended.',
    'Severe winters — dedicated winter tires are essential.',
    'Extreme winters — premium winter tires are critical for safety.',
  ];
  const urgencyFR = [
    '',
    'Climat hivernal doux — les pneus toutes-saisons peuvent suffire.',
    "Hivers modérés — pneus d'hiver recommandés pour la sécurité.",
    "Hivers rigoureux — pneus d'hiver fortement recommandés.",
    "Hivers sévères — des pneus d'hiver dédiés sont essentiels.",
    "Hivers extrêmes — des pneus d'hiver premium sont critiques pour la sécurité.",
  ];

  const urgency = isEn ? urgencyEN[winterSeverity] : urgencyFR[winterSeverity];
  const topConditions = specialConditions.slice(0, 2);
  const parts: string[] = [urgency];

  if (topConditions.length) {
    parts.push(isEn
      ? `Regional factors: ${topConditions.join('; ')}.`
      : `Facteurs régionaux: ${topConditions.join('; ')}.`);
  }
  if (terrain === 'mountain') {
    parts.push(isEn
      ? 'Mountain terrain: prioritise tires with excellent grip on slopes and icy conditions.'
      : 'Terrain montagneux: priorisez les pneus avec excellente adhérence en pente et sur verglas.');
  }
  return parts.join(' ');
}

// ── Shopify ───────────────────────────────────────────────────────────────────

interface ShopifyVariant  { id: number; price: string; inventory_quantity: number; }
interface ShopifyProduct  { id: number; title: string; tags: string; variants: ShopifyVariant[]; }
interface TireOption {
  id: number; brand: string; model: string; size: string;
  loadIndex: number; price: number; tags: string[];
}

async function fetchInStockTires(seasonTag: string): Promise<TireOption[]> {
  const url = `https://${SHOPIFY_DOMAIN}/admin/api/2024-01/products.json` +
    `?limit=30&tag=${encodeURIComponent(seasonTag)}&fields=id,title,tags,variants`;

  const resp = await fetch(url, { headers: { 'X-Shopify-Access-Token': SHOPIFY_TOKEN } });
  if (!resp.ok) throw new Error(`Shopify ${resp.status}`);

  const { products } = await resp.json() as { products: ShopifyProduct[] };

  return products
    .filter(p => p.variants.some(v => v.inventory_quantity > 0))
    .map(p => {
      const parts    = p.title.split(' ');
      const liMatch  = p.tags.match(/loadindex:(\d+)/i);
      const loadIndex = liMatch ? parseInt(liMatch[1], 10) : 0;
      const inStock  = p.variants.find(v => v.inventory_quantity > 0)!;
      return {
        id: p.id,
        brand: parts[0] || '',
        model: parts.slice(1, -1).join(' '),
        size:  parts[parts.length - 1] || '',
        loadIndex,
        price: parseFloat(inStock.price),
        tags:  p.tags.split(',').map(t => t.trim()),
      };
    });
}

function isHeavyVehicle(v: string) {
  const lc = v.toLowerCase();
  return SUV_TRUCK_KEYWORDS.some(k => lc.includes(k));
}

function buildSystemPrompt(
  vehicle: string, location: string, lang: string,
  regionProfile: RegionProfile, heavy: boolean,
): string {
  const isEn = lang !== 'fr';
  const regionAppend = buildRegionAppend(regionProfile, lang);

  if (isEn) return [
    'You are an expert tire consultant for GCI Tires (Canada).',
    'Recommend the best 2–3 tires from the inventory below for the customer\'s vehicle and location.',
    regionAppend,
    heavy ? 'IMPORTANT: Vehicle is a truck/SUV — only recommend tires with load index ≥ 108.' : '',
    'Be concise, professional, and always prioritise safety. Mention price and key features.',
  ].filter(Boolean).join('\n');

  return [
    'Vous êtes un expert en pneus pour GCI Tires (Canada).',
    "Recommandez les 2–3 meilleurs pneus de l'inventaire ci-dessous pour le véhicule et la région du client.",
    regionAppend,
    heavy ? 'IMPORTANT: Véhicule camion/VUS — recommandez uniquement des pneus avec indice de charge ≥ 108.' : '',
    'Soyez concis, professionnel et priorisez la sécurité. Mentionnez le prix et les caractéristiques.',
  ].filter(Boolean).join('\n');
}

// ── Handler ───────────────────────────────────────────────────────────────────

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST')    return res.status(405).json({ error: 'Method not allowed' });

  // ─── AI MODEL CONFIG ──────────────────────────────────────────────────────────────────────────
  // Model is controlled by the AI_MODEL environment variable in Vercel.
  // Current value: z-ai/glm-4.7-flash (set in Vercel project settings)
  // DO NOT hardcode the model string below — always use this const.
  const AI_MODEL = process.env.AI_MODEL || 'z-ai/glm-4.7-flash';

  const { vehicle, location, tireType, language, conversationHistory } = req.body ?? {};
  if (!vehicle || !location || !tireType)
    return res.status(400).json({ error: 'Missing vehicle, location, or tireType' });

  const tagMap: Record<string, string> = {
    'Winter':     'season:Winter',
    'All-Season': 'season:All-Season',
    'Summer':     'season:Summer',
  };

  try {
    let tires = await fetchInStockTires(tagMap[tireType] ?? 'season:All-Season');
    const heavy = isHeavyVehicle(vehicle);
    if (heavy) tires = tires.filter(t => t.loadIndex === 0 || t.loadIndex >= 108);

    const regionProfile = getRegionProfile(location);
    const lang  = language === 'fr' ? 'fr' : 'en';
    const isEn  = lang === 'en';
    const systemPrompt = buildSystemPrompt(vehicle, location, lang, regionProfile, heavy);

    const inventoryText = tires.length
      ? tires.map(t =>
          `- ${t.brand} ${t.model} | Size: ${t.size}` +
          `${t.loadIndex ? ` | LI: ${t.loadIndex}` : ''} | $${t.price.toFixed(2)} CAD`
        ).join('\n')
      : (isEn ? 'No tires in stock for this season.' : 'Aucun pneu en stock pour cette saison.');

    const isFollowUp = Array.isArray(conversationHistory) && conversationHistory.length > 0;
    const userMessage = isFollowUp
      ? (isEn
          ? `In-stock ${tireType} tires for reference:\n${inventoryText}\n\nPlease answer the follow-up question above.`
          : `Pneus ${tireType} en stock pour référence:\n${inventoryText}\n\nVeuillez répondre à la question de suivi ci-dessus.`)
      : (isEn
          ? `Recommend the best ${tireType} tires for a ${vehicle} in ${location}.\n\nInventory:\n${inventoryText}`
          : `Recommandez les meilleurs pneus ${tireType} pour un ${vehicle} à ${location}.\n\nInventaire:\n${inventoryText}`);

    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
      { role: 'system', content: systemPrompt },
      ...(isFollowUp ? conversationHistory as OpenAI.Chat.ChatCompletionMessageParam[] : []),
      { role: 'user', content: userMessage },
    ];

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    (res as any).flushHeaders();

    const openai = new OpenAI({
      baseURL: 'https://openrouter.ai/api/v1',
      apiKey:  AI_API_KEY,
    });

    const stream = await openai.chat.completions.create({
      model:      AI_MODEL,
      messages,
      stream:     true,
      max_tokens: 1024,
    });

    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content ?? '';
      if (content) {
        res.write(`data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`);
      }
    }

    res.write('data: [DONE]\n\n');
    res.end();

  } catch (err: any) {
    console.error('matchEngine error:', err);
    if (!res.headersSent) {
      return res.status(500).json({ error: err.message });
    }
    res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: `[Error: ${err.message}]` } }] })}\n\n`);
    res.write('data: [DONE]\n\n');
    res.end();
  }
}
