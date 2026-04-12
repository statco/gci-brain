import type { VercelRequest, VercelResponse } from '@vercel/node';
import OpenAI from 'openai';

export const config = { maxDuration: 60 };

const SHOPIFY_TOKEN =
  process.env.SHOPIFY_ADMIN_API_TOKEN ||
  process.env.SHOPIFY_ADMIN_ACCESS_TOKEN ||
  '';
const SHOPIFY_DOMAIN = process.env.SHOPIFY_STORE_DOMAIN || '';
const AI_API_KEY = process.env.AI_API_KEY || '';

const SUV_TRUCK_KEYWORDS = [
  'truck','pickup','f-150','f150','silverado','ram','sierra','tundra',
  'tacoma','ranger','colorado','canyon','frontier','ridgeline','titan',
  'suv','4runner','pathfinder','explorer','expedition','yukon','tahoe',
  'suburban','traverse','pilot','passport','highlander','sequoia',
  'armada','navigator','escalade','mdx','rdx','qx60','qx80','gx','lx',
  'gls','gle','gla','glb','glc','x5','x6','x7','x3','x1','q7','q8',
  'q5','q3','cayenne','macan','urus','defender','discovery','sport',
  'wrangler','gladiator','grand cherokee','durango','suburban','blazer',
  'equinox','terrain','trailblazer','bronco','4xe','crosstrek','forester',
  'outback','ascent','cx-9','cx-5','cx-50','cx-90','rogue','murano',
  'xterra','pathfinder','sorento','telluride','palisade','tucson',
  'santa fe','santa cruz','sportage','stinger','veracruz',
];

const NORTHERN_QC_LOCATIONS = [
  'saguenay','chicoutimi','jonquière','alma','roberval','dolbeau',
  'mistassini','baie-comeau','sept-îles','sept-iles','rimouski',
  'rivière-du-loup','riviere-du-loup','matane','gaspé','gaspe',
  'new richmond','bonaventure','chandler','percé','perce',
  'rouyn-noranda','rouyn','noranda','val-d\'or','amos','malartic',
  'la sarre','senneterre','lebel-sur-quévillon','chibougamau',
  'chapais','matagami','radisson','kuujjuaq','chisasibi',
  'wemindji','eastmain','waskaganish','mistissini','oujé-bougoumou',
  'whapmagoostui','kangiqsualujjuaq','inukjuak','umiujaq',
  'kuujjuarapik','tasiujaq','aupaluk','kangirsuk','quaqtaq',
  'kangiqsujuaq','salluit','ivujivik','puvirnituq','akulivik',
  'povungnituk','lac-saint-jean','lac saint-jean','abitibi',
  'témiscamingue','temiscamingue','côte-nord','cote-nord',
  'nord-du-québec','nord-du-quebec','gaspésie','gaspesie',
  'bas-saint-laurent','bas saint-laurent',
];

interface ShopifyVariant {
  id: number;
  title: string;
  price: string;
  inventory_quantity: number;
}

interface ShopifyProduct {
  id: number;
  title: string;
  tags: string;
  variants: ShopifyVariant[];
}

interface TireOption {
  id: number;
  brand: string;
  model: string;
  size: string;
  loadIndex: number;
  price: number;
  tags: string[];
}

async function fetchInStockTires(seasonTag: string): Promise<TireOption[]> {
  const url = `https://${SHOPIFY_DOMAIN}/admin/api/2024-01/products.json?limit=30&tag=${encodeURIComponent(seasonTag)}&fields=id,title,tags,variants`;

  const resp = await fetch(url, {
    headers: {
      'X-Shopify-Access-Token': SHOPIFY_TOKEN,
      'Content-Type': 'application/json',
    },
  });

  if (!resp.ok) {
    throw new Error(`Shopify API error: ${resp.status}`);
  }

  const data = await resp.json() as { products: ShopifyProduct[] };

  return data.products
    .filter(p => p.variants.some(v => v.inventory_quantity > 0))
    .map(p => {
      const parts = p.title.split(' ');
      const brand = parts[0] || '';
      const model = parts.slice(1, -1).join(' ') || '';
      const size  = parts[parts.length - 1] || '';

      const liMatch = p.tags.match(/loadindex:(\d+)/i) || p.tags.match(/load.index[:\s]+(\d+)/i);
      const loadIndex = liMatch ? parseInt(liMatch[1], 10) : 0;

      const inStockVariant = p.variants.find(v => v.inventory_quantity > 0);
      const price = inStockVariant ? parseFloat(inStockVariant.price) : 0;

      return {
        id: p.id,
        brand,
        model,
        size,
        loadIndex,
        price,
        tags: p.tags.split(',').map(t => t.trim()),
      };
    });
}

function isHeavyVehicle(vehicle: string): boolean {
  const v = vehicle.toLowerCase();
  return SUV_TRUCK_KEYWORDS.some(kw => v.includes(kw));
}

function isNorthernQuebec(location: string): boolean {
  const l = location.toLowerCase();
  return NORTHERN_QC_LOCATIONS.some(loc => l.includes(loc));
}

function buildSystemPrompt(
  vehicle: string,
  location: string,
  language: string,
  isNorthern: boolean,
  isHeavy: boolean,
): string {
  const isEn = language !== 'fr';

  if (isEn) {
    return `You are an expert tire consultant for GCI Tires, a Canadian tire retailer.
Your role is to recommend the best matching tires from our current inventory based on the customer's vehicle and location.

${isNorthern ? 'IMPORTANT: This customer is in northern Quebec where winter conditions are extreme. Strongly recommend winter tires and emphasize cold-weather performance.' : ''}
${isHeavy ? 'IMPORTANT: This customer drives a truck or SUV. Only recommend tires with a load index of 108 or higher for safety.' : ''}

Guidelines:
- Recommend 2–3 best options from the inventory provided
- Highlight key features: tread pattern, wet/dry grip, noise level, warranty
- Mention price and value proposition
- Be concise and professional
- Always prioritize safety
- If the inventory is limited, be honest and explain the best available option`;
  } else {
    return `Vous êtes un expert en pneus pour GCI Tires, un détaillant canadien de pneus.
Votre rôle est de recommander les meilleurs pneus correspondants de notre inventaire actuel en fonction du véhicule et de la localisation du client.

${isNorthern ? "IMPORTANT: Ce client se trouve dans le nord du Québec où les conditions hivernales sont extrêmes. Recommandez fortement des pneus d'hiver et mettez en avant les performances par temps froid." : ''}
${isHeavy ? 'IMPORTANT: Ce client conduit un camion ou un VUS. Recommandez uniquement des pneus avec un indice de charge de 108 ou plus pour la sécurité.' : ''}

Directives:
- Recommandez 2–3 meilleures options de l\'inventaire fourni
- Mettez en avant les caractéristiques clés: sculpture de bande de roulement, adhérence, niveau sonore, garantie
- Mentionnez le prix et le rapport qualité-prix
- Soyez concis et professionnel
- Priorisez toujours la sécurité
- Si l\'inventaire est limité, soyez honnête et expliquez la meilleure option disponible`;
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { vehicle, location, tireType, language, conversationHistory } = req.body || {};

  if (!vehicle || !location || !tireType) {
    return res.status(400).json({ error: 'Missing required fields: vehicle, location, tireType' });
  }

  try {
    const seasonTagMap: Record<string, string> = {
      'Winter':     'season:Winter',
      'All-Season': 'season:All-Season',
      'Summer':     'season:Summer',
    };

    const seasonTag = seasonTagMap[tireType] || 'season:All-Season';
    let tires = await fetchInStockTires(seasonTag);

    const heavy = isHeavyVehicle(vehicle);
    if (heavy) {
      tires = tires.filter(t => t.loadIndex === 0 || t.loadIndex >= 108);
    }

    const northern = isNorthernQuebec(location);
    const systemPrompt = buildSystemPrompt(vehicle, location, language || 'en', northern, heavy);

    const isEn = (language || 'en') !== 'fr';
    const inventoryText = tires.length > 0
      ? tires.map(t =>
          `- ${t.brand} ${t.model} | Size: ${t.size} | Load Index: ${t.loadIndex || 'N/A'} | Price: $${t.price.toFixed(2)} CAD | Tags: ${t.tags.join(', ')}`
        ).join('\n')
      : (isEn ? 'No tires currently in stock for this season/type.' : 'Aucun pneu en stock pour cette saison/type.');

    const isFollowUp = Array.isArray(conversationHistory) && conversationHistory.length > 0;

    const finalUserMessage = isFollowUp
      ? (isEn
          ? `Here are the in-stock ${tireType} tires for a ${vehicle} (located in ${location}) for your reference:\n\n${inventoryText}\n\nPlease answer the customer's follow-up question in the conversation above.`
          : `Voici les pneus ${tireType} en stock pour un ${vehicle} (situé à ${location}) pour référence:\n\n${inventoryText}\n\nVeuillez répondre à la question de suivi du client dans la conversation ci-dessus.`)
      : (isEn
          ? `Please recommend the best 2–3 ${tireType} tire options from our inventory for a ${vehicle} located in ${location}.\n\nAvailable inventory:\n${inventoryText}`
          : `Veuillez recommander les 2–3 meilleures options de pneus ${tireType} de notre inventaire pour un ${vehicle} situé à ${location}.\n\nInventaire disponible:\n${inventoryText}`);

    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
      { role: 'system', content: systemPrompt },
      ...(isFollowUp ? (conversationHistory as OpenAI.Chat.ChatCompletionMessageParam[]) : []),
      { role: 'user', content: finalUserMessage },
    ];

    const openai = new OpenAI({
      baseURL: 'https://openrouter.ai/api/v1',
      apiKey: AI_API_KEY,
    });

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    (res as any).flushHeaders?.();

    const stream = await openai.chat.completions.create({
      model: 'google/gemini-flash-1.5',
      messages,
      stream: true,
      max_tokens: 1024,
    });

    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content || '';
      if (content) {
        res.write(`data: ${JSON.stringify({ content })}\n\n`);
      }
    }

    res.write('data: [DONE]\n\n');
    res.end();
  } catch (err: any) {
    console.error('matchEngine error:', err);
    if (!res.headersSent) {
      res.status(500).json({ error: err.message || 'Internal server error' });
    } else {
      res.write(`data: ${JSON.stringify({ error: err.message || 'Stream error' })}\n\n`);
      res.end();
    }
  }
}
