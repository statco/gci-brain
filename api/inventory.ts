import type { VercelRequest, VercelResponse } from '@vercel/node';

export const config = { maxDuration: 30 };

const SHOPIFY_TOKEN =
  process.env.SHOPIFY_ADMIN_API_TOKEN ||
  process.env.SHOPIFY_ADMIN_ACCESS_TOKEN || '';
const SHOPIFY_DOMAIN = process.env.SHOPIFY_STORE_DOMAIN || '';

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

interface ShopifyVariant {
  id: number;
  price: string;
  inventory_quantity: number;
}
interface ShopifyProduct {
  id: number;
  title: string;
  tags: string;
  variants: ShopifyVariant[];
}
export interface TireOption {
  id: number;
  brand: string;
  model: string;
  size: string;
  loadIndex: number;
  price: number;
  inStockQty: number;
  tags: string[];
}

async function fetchInStockTires(seasonTag: string): Promise<TireOption[]> {
  const url =
    `https://${SHOPIFY_DOMAIN}/admin/api/2024-01/products.json` +
    `?limit=30&status=active&tag=${encodeURIComponent(seasonTag)}&fields=id,title,tags,variants`;

  const resp = await fetch(url, {
    headers: { 'X-Shopify-Access-Token': SHOPIFY_TOKEN },
  });
  if (!resp.ok) throw new Error(`Shopify ${resp.status}`);

  const { products } = (await resp.json()) as { products: ShopifyProduct[] };

  return products
    .filter(p => p.variants.some(v => v.inventory_quantity > 0))
    .map(p => {
      const parts = p.title.split(' ');
      const liMatch = p.tags.match(/loadindex:(\d+)/i);
      const loadIndex = liMatch ? parseInt(liMatch[1], 10) : 0;
      const inStock = p.variants.find(v => v.inventory_quantity > 0)!;
      const inStockQty = p.variants.reduce(
        (sum, v) => sum + Math.max(0, v.inventory_quantity),
        0
      );
      return {
        id: p.id,
        brand: parts[0] || '',
        model: parts.slice(1, -1).join(' '),
        size: parts[parts.length - 1] || '',
        loadIndex,
        price: parseFloat(inStock.price),
        inStockQty,
        tags: p.tags.split(',').map(t => t.trim()),
      };
    });
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET' && req.method !== 'POST')
    return res.status(405).json({ error: 'Method not allowed' });

  const body    = req.method === 'POST' ? (req.body ?? {}) : {};
  const vehicle  = ((body.vehicle  || req.query.vehicle  || '') as string).trim();
  const tireType = ((body.tireType || req.query.tireType || 'All-Season') as string).trim();

  const tagMap: Record<string, string> = {
    'Winter':     'season:Winter',
    'All-Season': 'season:All-Season',
    'Summer':     'season:Summer',
  };

  try {
    let tires = await fetchInStockTires(tagMap[tireType] ?? 'season:All-Season');

    if (vehicle) {
      const lc = vehicle.toLowerCase();
      const isHeavy = SUV_TRUCK_KEYWORDS.some(k => lc.includes(k));
      if (isHeavy) tires = tires.filter(t => t.loadIndex === 0 || t.loadIndex >= 108);
    }

    return res.status(200).json({
      tires,
      count:   tires.length,
      season:  tireType,
      vehicle: vehicle || null,
    });
  } catch (err: any) {
    console.error('inventory error:', err);
    return res.status(500).json({ error: err.message });
  }
}
