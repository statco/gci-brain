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

const NORTHERN_QC_LOCATIONS = [
  'saguenay','chicoutimi','jonquière','alma','roberval','dolbeau',
  'mistassini','baie-comeau','sept-îles','sept-iles','rimouski',
  'rivière-du-loup','riviere-du-loup','matane','gaspé','gaspe',
  'new richmond','bonaventure','chandler','percé','perce',
  'rouyn-noranda','rouyn','noranda',"val-d'or",'amos','malartic',
  'la sarre','senneterre','lebel-sur-quévillon','chibougamau',
  'chapais','matagami','radisson','kuujjuaq','chisasibi',
  'wemindji','eastmain','waskaganish','mistissini','oujé-bougoumou',
  'lac-saint-jean','lac saint-jean','abitibi',
  'témiscamingue','temiscamingue','côte-nord','cote-nord',
  'nord-du-québec','nord-du-quebec','gaspésie','gaspesie',
  'bas-saint-laurent','bas saint-laurent',
];

interface ShopifyVariant {
  id: number; price: string; inventory_quantity: number;
}
interface ShopifyProduct {
  id: number; title: string; tags: string; variants: ShopifyVariant[];
}
interface TireOption {
  id: number; brand: string; model: string; size: string;
  loadIndex: number; price: number; tags: string[];
}

async function fetchInStockTires(seasonTag: string): Promise<TireOption[]> {
  const url = `https://${SHOPIFY_DOMAIN}/admin/api/2024-01/products.json` +
    `?limit=30&tag=${encodeURIComponent(seasonTag)}&fields=id,title,tags,variants`;

  const resp = await fetch(url, {
    headers: { 'X-Shopify-Access-Token': SHOPIFY_TOKEN },
  });
  if (!resp.ok) throw new Error(`Shopify ${resp.status}`);

  const { products } = await resp.json() as { products: ShopifyProduct[] };

  return products
    .filter(p => p.variants.some(v => v.inventory_quantity > 0))
    .map(p => {
      const parts = p.title.split(' ');
      const liMatch = p.tags.match(/loadindex:(\d+)/i);
      const loadIndex = liMatch ? parseInt(liMatch[1], 10) : 0;
      const inStock = p.variants.find(v => v.inventory_quantity > 0)!;
      return {
        id: p.id,
        brand: parts[0] || '',
        model: parts.slice(1, -1).join(' '),
        size: parts[parts.length - 1] || '',
        loadIndex,
        price: parseFloat(inStock.price),
        tags: p.tags.split(',').map(t => t.trim()),
      };
    });
}

function isHeavyVehicle(v: string) {
  const lc = v.toLowerCase();
  return SUV_TRUCK_KEYWORDS.some(k => lc.includes(k));
}
function isNorthernQuebec(l: string) {
  const lc = l.toLowerCase();
  return NORTHERN_QC_LOCATIONS.some(n => lc.includes(n));
}

function buildSystemPrompt(
  vehicle: string, location: string, lang: string,
  northern: boolean, heavy: boolean,
): string {
  const en = lang !== 'fr';
  if (en) return [
    `You are an expert tire consultant for GCI Tires (Canada).`,
    `Recommend the best 2–3 tires from the inventory below for the customer's vehicle and location.`,
    northern ? `IMPORTANT: Customer is in northern Quebec — extreme winters. Strongly favour winter tires.` : '',
    heavy ? `IMPORTANT: Vehicle is a truck/SUV — only recommend tires with load index ≥ 108.` : '',
    `Be concise, professional, and always prioritise safety. Mention price and key features.`,
  ].filter(Boolean).join('\n');

  return [
    `Vous êtes un expert en pneus pour GCI Tires (Canada).`,
    `Recommandez les 2–3 meilleurs pneus de l'inventaire ci-dessous pour le véhicule et la région du client.`,
    northern ? `IMPORTANT: Le client est dans le nord du Québec — hivers extrêmes. Favorisez les pneus d'hiver.` : '',
    heavy ? `IMPORTANT: Véhicule camion/VUS — recommandez uniquement des pneus avec indice de charge ≥ 108.` : '',
    `Soyez concis, professionnel et priorisez la sécurité. Mentionnez le prix et les caractéristiques.`,
  ].filter(Boolean).join('\n');
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { vehicle, location, tireType, language, conversationHistory } = req.body ?? {};
  if (!vehicle || !location || !tireType)
    return res.status(400).json({ error: 'Missing vehicle, location, or tireType' });

  const tagMap: Record<string, string> = {
    'Winter': 'season:Winter',
    'All-Season': 'season:All-Season',
    'Summer': 'season:Summer',
  };

  try {
    let tires = await fetchInStockTires(tagMap[tireType] ?? 'season:All-Season');
    const heavy = isHeavyVehicle(vehicle);
    if (heavy) tires = tires.filter(t => t.loadIndex === 0 || t.loadIndex >= 108);

    const northern = isNorthernQuebec(location);
    const lang = language === 'fr' ? 'fr' : 'en';
    const isEn = lang === 'en';
    const systemPrompt = buildSystemPrompt(vehicle, location, lang, northern, heavy);

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

    // SSE headers — must be set and flushed before any write
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    (res as any).flushHeaders();

    const openai = new OpenAI({
      baseURL: 'https://openrouter.ai/api/v1',
      apiKey: AI_API_KEY,
    });

    const stream = await openai.chat.completions.create({
      model: 'zhipu-ai/glm-4-flash',
      messages,
      stream: true,
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