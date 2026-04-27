import type { VercelRequest, VercelResponse } from '@vercel/node';

const SHOPIFY_STORE = process.env.SHOPIFY_STORE_URL!;
const SHOPIFY_TOKEN = process.env.SHOPIFY_ADMIN_TOKEN!;

interface ShopifyVariant {
  id: number;
  sku: string;
  price: string;
  inventory_quantity: number;
  inventory_management: string | null;
}

interface ShopifyImage {
  src: string;
  variant_ids: number[];
}

interface ShopifyProduct {
  id: number;
  title: string;
  body_html: string;
  handle: string;
  status: string;
  vendor: string;
  product_type: string;
  tags: string;
  variants: ShopifyVariant[];
  images: ShopifyImage[];
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim();
}

function getTireCategory(tags: string, productType: string): string {
  const t = (tags + ' ' + productType).toLowerCase();
  if (t.includes('winter') || t.includes('snow')) return 'Tires > Winter / Snow';
  if (t.includes('all-weather') || t.includes('all weather')) return 'Tires > All-Weather';
  if (t.includes('all-season') || t.includes('all season')) return 'Tires > All-Season';
  if (t.includes('summer') || t.includes('performance')) return 'Tires > Summer / Performance';
  return 'Tires';
}

function getVehicleType(tags: string): string {
  const t = tags.toLowerCase();
  if (t.includes('light-truck') || t.includes('truck') || t.includes('suv')) return 'SUV/Truck';
  if (t.includes('passenger')) return 'Passenger Car';
  return 'Passenger Car';
}

function buildDescription(product: ShopifyProduct, variant: ShopifyVariant): string {
  const base = stripHtml(product.body_html);
  if (base && base.length > 60) return base.substring(0, 5000);
  // Fallback description
  const category = getTireCategory(product.tags, product.product_type);
  const vehicle = getVehicleType(product.tags);
  return `Shop the ${product.title} at GCI Tires. ${vehicle} fitment. Free shipping across Canada. Available online with fast delivery to Quebec and all Canadian provinces.`;
}

async function fetchAllProducts(): Promise<ShopifyProduct[]> {
  const products: ShopifyProduct[] = [];
  let url = `${SHOPIFY_STORE}/admin/api/2024-01/products.json?status=active&limit=250&fields=id,title,body_html,handle,status,vendor,product_type,tags,variants,images`;

  while (url) {
    const res = await fetch(url, {
      headers: {
        'X-Shopify-Access-Token': SHOPIFY_TOKEN,
        'Content-Type': 'application/json',
      },
    });

    if (!res.ok) throw new Error(`Shopify API error: ${res.status}`);

    const data = await res.json();
    products.push(...data.products);

    const linkHeader = res.headers.get('Link') || '';
    const nextMatch = linkHeader.match(/<([^>]+)>;\s*rel="next"/);
    url = nextMatch ? nextMatch[1] : '';
  }

  return products;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const products = await fetchAllProducts();

    const AUTHORIZED_VENDORS = ['Cooper', 'Nexen', 'Vredestein'];

    // TSV headers — Microsoft Shopping spec
    const headers = [
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
      'product_category',
      'product_type',
      'custom_label_0',
      'custom_label_1',
      'custom_label_2',
      'quantity',
    ];

    const rows: string[] = [headers.join('\t')];

    for (const product of products) {
      // Skip unauthorized brands
      if (!AUTHORIZED_VENDORS.includes(product.vendor)) continue;

      // Get product-level image (fallback)
      const productImage = product.images?.[0]?.src || '';

      for (const variant of product.variants) {
        // Skip zero/negative inventory
        if (variant.inventory_management && variant.inventory_quantity <= 0) continue;

        // Availability — Microsoft uses spaces not underscores
        const availability = variant.inventory_quantity > 0 ? 'in stock' : 'out of stock';

        // Images: find variant-specific image, fallback to product image
        const variantImage = product.images?.find(img =>
          img.variant_ids?.includes(variant.id)
        );
        const primaryImage = variantImage?.src || productImage;

        // Additional image: first product image that isn't the primary
        const additionalImage = product.images
          ?.filter(img => img.src !== primaryImage)?.[0]?.src || '';

        // Price format: Microsoft accepts "318.00 CAD"
        const price = `${parseFloat(variant.price).toFixed(2)} CAD`;

        // Category
        const tireCategory = getTireCategory(product.tags, product.product_type);
        const vehicleType = getVehicleType(product.tags);

        // Microsoft product_category — use same human-readable string as GMC
        const productCategory = 'Vehicles & Parts > Vehicle Parts & Accessories > Vehicle Tires';

        // Product type — more specific for Microsoft
        const productType = `${tireCategory} > ${vehicleType}`;

        // Season label for custom labels
        const tags = product.tags.toLowerCase();
        const season = tags.includes('winter') ? 'Winter' :
          tags.includes('all-weather') ? 'All-Weather' :
          tags.includes('all-season') ? 'All-Season' :
          tags.includes('summer') ? 'Summer' : 'All-Season';

        const row = [
          `gci-${variant.id}`,                          // id
          `gci-${product.id}`,                          // item_group_id
          product.title,                                 // title
          buildDescription(product, variant),            // description
          `https://gcitires.com/products/${product.handle}`, // link
          primaryImage,                                  // image_link
          additionalImage,                               // additional_image_link
          'new',                                         // condition
          availability,                                  // availability (Microsoft format)
          price,                                         // price
          product.vendor,                                // brand
          variant.sku || '',                             // mpn
          productCategory,                               // product_category
          productType,                                   // product_type
          season,                                        // custom_label_0
          vehicleType,                                   // custom_label_1
          product.vendor,                                // custom_label_2
          String(Math.max(0, variant.inventory_quantity)), // quantity
        ].map(val => String(val).replace(/\t/g, ' ').replace(/\n/g, ' '));

        rows.push(row.join('\t'));
      }
    }

    res.setHeader('Content-Type', 'text/tab-separated-values; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=3600'); // 1hr cache
    res.status(200).send(rows.join('\n'));

  } catch (err) {
    console.error('Microsoft feed error:', err);
    res.status(500).json({ error: 'Feed generation failed', details: String(err) });
  }
}
