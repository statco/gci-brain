// api/feed/gmc.ts
// GCI Tires — Google Merchant Center TSV Feed
// Serves variant-level product data for all active Shopify products.
// GMC should be configured to fetch this URL every 24h.
// Vercel cron pings it every 6h to keep the edge cache warm.
//
// Env vars required:
//   SHOPIFY_STORE_DOMAIN      e.g. gci-tires.myshopify.com
//   SHOPIFY_ADMIN_API_TOKEN   Admin API token
//   FEED_SECRET               (optional) query param ?secret=xxx to restrict access
//
// Feed URL: https://your-vercel-domain.vercel.app/api/feed/gmc?secret=xxx
import type { VercelRequest, VercelResponse } from '@vercel/node';
// ─── Config ─────────────────────────────────────────────────────────────────
const SHOPIFY_DOMAIN   = process.env.SHOPIFY_STORE_DOMAIN!;
const SHOPIFY_TOKEN    = process.env.SHOPIFY_ADMIN_API_TOKEN!;
const STOREFRONT_URL   = 'https://gcitires.com'; // canonical storefront
// GMC google_product_category for tires
const GOOGLE_CATEGORY  = '3578';
// TSV column order — must match GMC feed spec exactly
const COLUMNS = [
  'id',
  'item_group_id',
  'title',
  'description',
  'link',
  'image_link',
  'additional_image_link',
  'condition',
  'availability',
  'price',
  'brand',
  'mpn',
  'google_product_category',
  'product_type',
  'custom_label_0',   // season        (e.g. Hiver, Été, 4-Saisons, Tout-Terrain)
  'custom_label_1',   // vehicle_type  (e.g. Passenger, SUV, Light Truck)
  'custom_label_2',   // brand tier    (e.g. Cooper, Nexen, Vredestein)
  'identifier exists', // FALSE — tire GTINs not available in Shopify product data
  'quantity',          // variant inventory_quantity
] as const;
type Row = Record<typeof COLUMNS[number], string>;
// ─── Shopify fetch ───────────────────────────────────────────────────────────
interface ShopifyVariant {
  id: number;
  title: string;
  price: string;
  sku: string;
  barcode: string | null;
  inventory_quantity: number;
  inventory_management: string | null;
  inventory_policy: 'deny' | 'continue';
  image_id: number | null;
}
interface ShopifyImage {
  id: number;
  src: string;
}
interface ShopifyProduct {
  id: number;
  title: string;
  handle: string;
  body_html: string;
  vendor: string;
  tags: string;
  status: string;
  product_type: string;
  images: ShopifyImage[];
  variants: ShopifyVariant[];
}
async function fetchAllProducts(): Promise<ShopifyProduct[]> {
  const products: ShopifyProduct[] = [];
  let url: string | null =
    `https://${SHOPIFY_DOMAIN}/admin/api/2024-01/products.json?limit=250&status=active&fields=id,title,handle,body_html,vendor,tags,product_type,images,variants`;
  while (url) {
    console.log(`[feed/gmc] Fetching: ${url} | tokenPrefix: ${SHOPIFY_TOKEN?.slice(0, 10)}`);
    const res = await fetch(url, {
      headers: { 'X-Shopify-Access-Token': SHOPIFY_TOKEN },
    });
    if (!res.ok) {
      throw new Error(`Shopify API error: ${res.status} ${await res.text()}`);
    }
    const data = await res.json() as { products?: ShopifyProduct[] };
    products.push(...(data.products ?? []));
    // Cursor pagination via Link header
    const link = res.headers.get('Link') ?? '';
    const next = link.match(/<([^>]+)>;\s*rel="next"/)?.[1] ?? null;
    url = next;
  }
  return products;
}
// ─── Helpers ─────────────────────────────────────────────────────────────────
/** Strip HTML tags and collapse whitespace */
function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}
/** Sanitize any field value for TSV: no tabs, newlines, or leading/trailing whitespace */
function tsvSanitize(value: string): string {
  return (value ?? '').replace(/[\t\r\n]+/g, ' ').trim();
}
/** Extract a prefixed tag value: "season:Hiver" → "Hiver" */
function tagValue(tags: string[], prefix: string): string {
  const normalized = prefix.toLowerCase();
  const match = tags.find(t => t.toLowerCase().startsWith(normalized + ':'));
  return match ? match.slice(prefix.length + 1).trim() : '';
}
/** Determine GMC availability string from variant inventory_quantity */
function availability(variant: ShopifyVariant): string {
  return variant.inventory_quantity > 0 ? 'in_stock' : 'out_of_stock';
}
/** Format price for GMC: "129.99 CAD" */
function formatPrice(price: string): string {
  return `${parseFloat(price).toFixed(2)} CAD`;
}
/** Truncate description to 5000 chars (GMC limit) */
function truncate(str: string, max = 5000): string {
  return str.length > max ? str.slice(0, max - 1) + '…' : str;
}
// ─── Non-tire filter ─────────────────────────────────────────────────────────
const EXCLUDE_VENDORS         = new Set(['nuprozone']);
const EXCLUDE_TITLE_KEYWORDS  = ['bottle', 'vacuum', 'cleaner', 'massager', 'cervical', 'neck relaxer', 'shoulder'];
const TIRE_PRODUCT_TYPE_RE    = /tire|tyre|pneu/i;
const TIRE_TITLE_RE           = /R1[5-9]|R2[0-2]|\bLT\b|tire|tyre/i;

function isTireProduct(product: ShopifyProduct): boolean {
  const titleLower = product.title.toLowerCase();
  // Exclusion checks take priority
  if (EXCLUDE_VENDORS.has(product.vendor.toLowerCase())) return false;
  if (EXCLUDE_TITLE_KEYWORDS.some(kw => titleLower.includes(kw))) return false;
  // At least one positive indicator required
  if (TIRE_PRODUCT_TYPE_RE.test(product.product_type ?? '')) return true;
  if (product.tags.split(',').some(t => t.trim().toLowerCase().startsWith('season:'))) return true;
  if (TIRE_TITLE_RE.test(product.title)) return true;
  return false;
}
// ─── Row builder ─────────────────────────────────────────────────────────────
function buildRows(product: ShopifyProduct): string[] {
  const tags = product.tags.split(',').map(t => t.trim()).filter(Boolean);
  const season      = tagValue(tags, 'season')       || tagValue(tags, 'saison') || '';
  const vehicleType = tagValue(tags, 'vehicle_type') || tagValue(tags, 'type_vehicule') || '';
  const brand       = product.vendor || '';
  const mainImage   = product.images[0]?.src ?? '';
  const extraImages = product.images
    .slice(1, 11) // GMC accepts up to 10 additional images
    .map(i => i.src)
    .join(',');
  const rawDescription = stripHtml(product.body_html || product.title);
  const description     = truncate(rawDescription || product.title);
  // google_product_category → product_type path
  const productTypeParts = [season, vehicleType].filter(Boolean);
  const productType = productTypeParts.length
    ? `Tires > ${productTypeParts.join(' > ')}`
    : 'Tires';
  return product.variants.map((variant): string => {
    // Prefer variant-specific image; fall back to product main image
    const variantImage = product.images.find(img => img.id === variant.image_id)?.src ?? mainImage;
    // Title: product name + size if not default
    const sizeLabel = variant.title !== 'Default Title' ? ` ${variant.title}` : '';
    const title = tsvSanitize(`${product.title}${sizeLabel}`);
    const row: Row = {
      id:                     `gci-${variant.id}`,
      item_group_id:          `gci-${product.id}`,
      title,
      description:            tsvSanitize(description),
      link:                   `${STOREFRONT_URL}/products/${product.handle}`,
      image_link:             variantImage,
      additional_image_link:  extraImages,
      condition:              'new',
      availability:           availability(variant),
      price:                  formatPrice(variant.price),
      brand,
      mpn:                    tsvSanitize(variant.sku || variant.barcode || ''),
      google_product_category: GOOGLE_CATEGORY,
      product_type:           tsvSanitize(productType),
      custom_label_0:         tsvSanitize(season),
      custom_label_1:         tsvSanitize(vehicleType),
      custom_label_2:         tsvSanitize(brand),
      'identifier exists':    'FALSE',
      quantity:               String(variant.inventory_quantity),
    };
    return COLUMNS.map(col => row[col]).join('\t');
  });
}
// ─── Handler ─────────────────────────────────────────────────────────────────
export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Optional access restriction — set FEED_SECRET in Vercel env vars
  const feedSecret = process.env.FEED_SECRET;
  if (feedSecret && req.query.secret !== feedSecret) {
    return res.status(401).send('Unauthorized');
  }
  try {
    const products = await fetchAllProducts();
    const header = COLUMNS.join('\t');
    const rows: string[] = [header];
    let skipped = 0;
    for (const product of products) {
      // Skip non-tire accessories and excluded vendors
      if (!isTireProduct(product)) { skipped++; continue; }
      // Skip products with no variants or zero-price (data quality guard)
      const validVariants = product.variants.filter(v => parseFloat(v.price) > 0);
      if (validVariants.length === 0) { skipped++; continue; }
      const productWithValid = { ...product, variants: validVariants };
      rows.push(...buildRows(productWithValid));
    }
    const tsvBody = rows.join('\n');
    console.log(`[feed/gmc] Generated: ${rows.length - 1} rows | Skipped: ${skipped} products`);
    // Edge-cached for 1 hour; stale feed served for up to 6h while revalidating
    res.setHeader('Content-Type', 'text/tab-separated-values; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="gmc-feed.tsv"');
    res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=21600');
    return res.status(200).send(tsvBody);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[feed/gmc] Error:', message);
    return res.status(500).json({ error: message });
  }
}
