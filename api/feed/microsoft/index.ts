// api/feed/microsoft/index.ts
// GCI Tires — Microsoft Merchant Center TSV Feed
// Mirrors GMC feed logic exactly. Microsoft-specific output only.
import type { VercelRequest, VercelResponse } from '@vercel/node';

const SHOPIFY_DOMAIN = process.env.SHOPIFY_STORE_DOMAIN!;
const SHOPIFY_TOKEN  = process.env.SHOPIFY_ADMIN_ACCESS_TOKEN!;
const STOREFRONT_URL = 'https://gcitires.com';
const MS_CATEGORY    = 'Vehicles & Parts > Vehicle Parts & Accessories > Vehicle Tires';

const COLUMNS = [
  'id', 'item_group_id', 'title', 'description', 'link',
  'image_link', 'additional_image_link', 'condition', 'availability',
  'price', 'brand', 'mpn', 'product_category', 'product_type',
  'custom_label_0', 'custom_label_1', 'custom_label_2', 'quantity',
] as const;
type Row = Record<typeof COLUMNS[number], string>;

interface ShopifyVariant {
  id: number; title: string; price: string; sku: string;
  barcode: string | null; inventory_quantity: number;
  inventory_management: string | null;
  inventory_policy: 'deny' | 'continue'; image_id: number | null;
}
interface ShopifyImage { id: number; src: string; }
interface ShopifyProduct {
  id: number; title: string; handle: string; body_html: string;
  vendor: string; tags: string; status: string; product_type: string;
  images: ShopifyImage[]; variants: ShopifyVariant[];
}

async function fetchAllProducts(): Promise<ShopifyProduct[]> {
  const products: ShopifyProduct[] = [];
  let url: string | null =
    `https://${SHOPIFY_DOMAIN}/admin/api/2024-01/products.json?limit=250&status=active` +
    `&fields=id,title,handle,body_html,vendor,tags,product_type,images,variants`;
  while (url) {
    const res = await fetch(url, { headers: { 'X-Shopify-Access-Token': SHOPIFY_TOKEN } });
    if (!res.ok) throw new Error(`Shopify API error: ${res.status}`);
    const data = await res.json() as { products?: ShopifyProduct[] };
    products.push(...(data.products ?? []));
    const link = res.headers.get('Link') ?? '';
    url = link.match(/<([^>]+)>;\s*rel="next"/)?.[1] ?? null;
  }
  return products;
}

const SEASON_MAP: Record<string, string> = {
  'winter': 'Winter', 'summer': 'Summer',
  'all-season': 'All-Season', 'all-weather': 'All-Weather', 'all-terrain': 'All-Terrain',
};
function detectSeason(tags: string[]): string {
  const lower = tags.map(t => t.toLowerCase());
  for (const [key, label] of Object.entries(SEASON_MAP)) {
    if (lower.includes(key)) return label;
  }
  const prefixed = tags.find(t => t.toLowerCase().startsWith('season:'));
  return prefixed ? prefixed.slice(7).trim() : '';
}

const VEHICLE_MAP: Record<string, string> = {
  'passenger': 'Passenger car', 'suv': 'SUV/crossover',
  'light_truck': 'Light truck', 'light-truck': 'Light truck',
};
function detectVehicle(tags: string[]): { label: string; raw: string } {
  const lower = tags.map(t => t.toLowerCase());
  for (const [key, label] of Object.entries(VEHICLE_MAP)) {
    if (lower.includes(key)) return { label, raw: key };
  }
  const prefixed = tags.find(t => t.toLowerCase().startsWith('vehicle_type:'));
  if (prefixed) {
    const val = prefixed.slice(13).trim().toLowerCase();
    if (val === 'suv') return { label: 'SUV/crossover', raw: val };
    if (val === 'light truck') return { label: 'Light truck', raw: val };
    return { label: 'Passenger car', raw: val };
  }
  return { label: '', raw: '' };
}

const MODEL_CORRECTIONS: Record<string, string> = {
  'procontrol': 'ProControl', 'cs5 ultra touring': 'CS5 Ultra Touring',
  'cs5 grand touring': 'CS5 Grand Touring', 'ht3': 'HT3', 'at3 4s': 'AT3 4S',
  'at3 lt': 'AT3 LT', 'at3 xlt': 'AT3 XLT', 'stt pro': 'STT Pro',
  'st maxx': 'ST Maxx', 'snow claw lt': 'Snow Claw LT',
  'evolution winter': 'Evolution Winter', 'evolution mt': 'Evolution MT',
  'cobra radial g/t': 'Cobra Radial G/T', 'cobra instinct': 'Cobra Instinct',
  'rugged trek lt': 'Rugged Trek LT', 'rugged trek aw': 'Rugged Trek AW',
  'discoverer aw': 'Discoverer AW', 'nfera su1': 'NFera SU1',
  'roadian atx': 'Roadian ATX', 'roadian hp': 'Roadian HP',
  'winguard winspike': 'WinGuard WinSpike', 'winguard ice plus': 'WinGuard Ice Plus',
  'winguard sport 2': 'WinGuard Sport 2', "n'fera su4": "N'Fera SU4",
};
function normalizeTitle(title: string): string {
  let t = title.replace(/\s+\d{7}\/R\s*$/i, '').trim();
  t = t.replace(/(\d{3}\/\d{2}R\d{2})\s+\1/i, '$1').trim();
  const lower = t.toLowerCase();
  for (const [from, to] of Object.entries(MODEL_CORRECTIONS)) {
    if (lower.includes(from)) { t = t.replace(new RegExp(from, 'i'), to); break; }
  }
  return t;
}

function buildDescription(product: ShopifyProduct, season: string, vehicle: { label: string; raw: string }, cleanTitle: string): string {
  const raw = (product.body_html || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  const FRENCH_INDICATORS = ['pneu', 'québécois', 'adhérence', 'voiture', ' est un ', 'pour les ',
    'conçu pour', 'idéal pour', 'roulement', 'traction', 'saison', 'livraison', 'Achetez'];
  const isFrench = FRENCH_INDICATORS.some(w => raw.toLowerCase().includes(w));
  const isRawSync = isFrench ||
    raw.startsWith('COOPER') || raw.startsWith('NEXEN') || raw.startsWith('VREDESTEIN') ||
    raw.includes('Stock:') || raw.includes('Part #:') || raw.includes('nearest:');
  if (!isRawSync && raw.length > 50) return raw.slice(0, 4999);
  const vehicleStr = vehicle.label || 'Passenger car';
  return `Shop the ${cleanTitle} at GCI Tires. ${season ? season.toLowerCase() + ' ' : ''}${vehicleStr} fitment. Free shipping across Canada. Available online with fast delivery to Quebec and all Canadian provinces.`.slice(0, 4999);
}

const EXCLUDE_VENDORS        = new Set(['nuprozone']);
const EXCLUDE_TITLE_KEYWORDS = ['bottle', 'vacuum', 'cleaner', 'massager', 'cervical', 'neck relaxer', 'shoulder'];
const TIRE_PRODUCT_TYPE_RE   = /tire|tyre|pneu/i;
const TIRE_TITLE_RE          = /R1[5-9]|R2[0-2]|\bLT\b|tire|tyre/i;
function isTireProduct(product: ShopifyProduct): boolean {
  const titleLower = product.title.toLowerCase();
  if (EXCLUDE_VENDORS.has(product.vendor.toLowerCase())) return false;
  if (EXCLUDE_TITLE_KEYWORDS.some(kw => titleLower.includes(kw))) return false;
  if (TIRE_PRODUCT_TYPE_RE.test(product.product_type ?? '')) return true;
  const tags = product.tags.split(',').map(t => t.trim().toLowerCase());
  if (tags.some(t => t === 'ct-sync' || t === 'ai-match')) return true;
  if (TIRE_TITLE_RE.test(product.title)) return true;
  return false;
}

function buildRows(product: ShopifyProduct): string[] {
  const tags        = product.tags.split(',').map(t => t.trim()).filter(Boolean);
  const season      = detectSeason(tags);
  const vehicle     = detectVehicle(tags);
  const brand       = product.vendor || '';
  const cleanTitle  = normalizeTitle(product.title);
  const description = buildDescription(product, season, vehicle, cleanTitle);
  const mainImage   = product.images[0]?.src ?? '';
  const extraImages = product.images.slice(1, 11).map(i => i.src).join(',');
  const productTypeParts: string[] = ['Tires'];
  if (season) productTypeParts.push(season);
  if (vehicle.raw) productTypeParts.push(vehicle.label);
  const productType = productTypeParts.join(' > ');
  function tsv(v: string) { return (v ?? '').replace(/[\t\r\n]+/g, ' ').trim(); }
  function fmtPrice(p: string) { return `${parseFloat(p).toFixed(2)} CAD`; }
  return product.variants.map((variant): string => {
    const variantImage = product.images.find(img => img.id === variant.image_id)?.src ?? mainImage;
    const avail = variant.inventory_quantity > 0 ? 'in stock' : 'out of stock';
    const row: Row = {
      id:                    `gci-${variant.id}`,
      item_group_id:         `gci-${product.id}`,
      title:                 tsv(cleanTitle),
      description:           tsv(description),
      link:                  `${STOREFRONT_URL}/products/${product.handle}`,
      image_link:            variantImage,
      additional_image_link: extraImages,
      condition:             'new',
      availability:          avail,
      price:                 fmtPrice(variant.price),
      brand,
      mpn:                   tsv(variant.sku || variant.barcode || ''),
      product_category:      MS_CATEGORY,
      product_type:          tsv(productType),
      custom_label_0:        tsv(season),
      custom_label_1:        tsv(vehicle.label),
      custom_label_2:        tsv(brand),
      quantity:              String(Math.max(0, variant.inventory_quantity)),
    };
    return COLUMNS.map(col => row[col]).join('\t');
  });
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const feedSecret = process.env.FEED_SECRET;
  if (feedSecret && req.query.secret !== feedSecret) {
    return res.status(401).send('Unauthorized');
  }
  try {
    const products = await fetchAllProducts();
    const rows: string[] = [COLUMNS.join('\t')];
    let skipped = 0;
    for (const product of products) {
      if (!isTireProduct(product)) { skipped++; continue; }
      const validVariants = product.variants.filter(v => parseFloat(v.price) > 0);
      if (validVariants.length === 0) { skipped++; continue; }
      rows.push(...buildRows({ ...product, variants: validVariants }));
    }
    console.log(`[feed/microsoft] Generated: ${rows.length - 1} rows | Skipped: ${skipped}`);
    res.setHeader('Content-Type', 'text/tab-separated-values; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="microsoft-feed.tsv"');
    res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=21600');
    return res.status(200).send(rows.join('\n'));
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[feed/microsoft] Error:', message);
    return res.status(500).json({ error: 'Feed generation failed', details: message });
  }
}
