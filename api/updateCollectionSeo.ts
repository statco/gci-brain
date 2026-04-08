import type { VercelRequest, VercelResponse } from '@vercel/node';

interface SeoEntry {
  title: string;
  description: string;
  body_html: string;
}

const SEO_MAP: Record<string, SeoEntry> = {
  'winter-tires': {
    title: 'Winter Tires Canada | Snow Tires for Canadian Drivers | GCI Tires',
    description:
      'Shop winter tires built for Canadian roads. GCI Tires carries top-rated snow tires from Nexen, Cooper and Vredestein — fast delivery across Quebec, Ontario and all provinces.',
    body_html:
      '<p>Shop winter tires engineered for Canadian winters. Our selection of snow tires handles ice, slush and heavy snowfall — with free delivery across Canada.</p>',
  },
  'all-season-tires': {
    title: 'All-Season Tires Canada | Year-Round Tires | GCI Tires',
    description:
      'Browse all-season tires for Canadian drivers. GCI Tires stocks Nexen, Cooper and Vredestein all-season tires with free shipping across Canada.',
    body_html:
      '<p>All-season tires built for Canadian conditions — reliable grip in rain, light snow and dry roads year-round. Free delivery across Canada.</p>',
  },
  'summer-tires': {
    title: 'Summer Tires Canada | Performance Tires | GCI Tires',
    description:
      'Shop summer and performance tires at GCI Tires. Top brands, competitive prices, fast delivery across Canada.',
    body_html:
      '<p>Summer tires for maximum dry and wet grip. Shop performance tires from top brands with free delivery across Canada.</p>',
  },
  'all-terrain-tires': {
    title: 'All-Terrain Tires Canada | Off-Road Tires | GCI Tires',
    description:
      'Shop all-terrain tires for trucks and SUVs at GCI Tires. Top brands, free shipping across Canada.',
    body_html:
      '<p>All-terrain tires built for on-road comfort and off-road capability. Shop AT tires for trucks and SUVs with free delivery across Canada.</p>',
  },
  'all-weather-tires': {
    title: 'All-Weather Tires Canada | 3PMSF Rated Tires | GCI Tires',
    description:
      'Shop 3PMSF-rated all-weather tires at GCI Tires. One set for every season — free delivery across Canada.',
    body_html:
      '<p>All-weather tires certified for severe snow (3PMSF rated) — one set for all four seasons. Free delivery across Canada.</p>',
  },
  'suv-crossover-tires': {
    title: 'SUV & Crossover Tires Canada | GCI Tires',
    description:
      'Shop SUV and crossover tires at GCI Tires. Nexen, Cooper and Vredestein tires for every season, free shipping Canada-wide.',
    body_html:
      '<p>Tires engineered for SUVs and crossovers — all seasons, all road conditions. Free delivery across Canada.</p>',
  },
  'passenger-car-tires': {
    title: 'Passenger Car Tires Canada | Car Tires | GCI Tires',
    description:
      'Shop passenger car tires at GCI Tires. Top brands, great prices, free delivery across Canada.',
    body_html:
      '<p>Passenger car tires for everyday driving — comfort, durability and value. Free delivery across Canada.</p>',
  },
  'light-truck-tires': {
    title: 'Light Truck Tires Canada | Truck Tires | GCI Tires',
    description:
      'Shop light truck tires at GCI Tires. Heavy-duty performance for trucks and vans, free shipping Canada-wide.',
    body_html:
      '<p>Light truck tires built for durability and load capacity. Free delivery across Canada.</p>',
  },
  'cooper-tires': {
    title: 'Cooper Tires Canada | Buy Cooper Tires Online | GCI Tires',
    description:
      'Shop Cooper tires at GCI Tires. Full lineup of Cooper all-season, winter and all-terrain tires with free delivery across Canada.',
    body_html:
      '<p>Shop the full Cooper Tires lineup at GCI Tires — all-season, winter, all-terrain and performance tires. Free delivery across Canada.</p>',
  },
  'nexen-tires': {
    title: 'Nexen Tires Canada | Buy Nexen Tires Online | GCI Tires',
    description:
      'Shop Nexen tires at GCI Tires. Advanced technology and reliability at competitive prices for Canadian drivers. Fast delivery across Canada.',
    body_html:
      '<p>Shop Nexen tires at GCI Tires — engineered for performance, comfort and value. Free delivery across Canada.</p>',
  },
  'vredestein-tires': {
    title: 'Vredestein Tires Canada | Buy Vredestein Tires | GCI Tires',
    description:
      'Shop Vredestein tires at GCI Tires. Premium European performance tires for Canadian drivers, free delivery Canada-wide.',
    body_html:
      '<p>Vredestein tires — premium European engineering for Canadian roads. Free delivery across Canada.</p>',
  },
};

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface ShopifyCollection {
  id: number;
  handle: string;
  title: string;
}

async function findCollection(
  domain: string,
  token: string,
  handle: string
): Promise<{ id: number; type: 'custom' | 'smart' } | null> {
  const headers: Record<string, string> = {
    'X-Shopify-Access-Token': token,
    'Content-Type': 'application/json',
  };

  const customRes = await fetch(
    `https://${domain}/admin/api/2024-01/custom_collections.json?handle=${encodeURIComponent(handle)}`,
    { headers }
  );
  if (customRes.ok) {
    const customData = (await customRes.json()) as { custom_collections: ShopifyCollection[] };
    if (customData.custom_collections?.length > 0) {
      return { id: customData.custom_collections[0].id, type: 'custom' };
    }
  }

  const smartRes = await fetch(
    `https://${domain}/admin/api/2024-01/smart_collections.json?handle=${encodeURIComponent(handle)}`,
    { headers }
  );
  if (smartRes.ok) {
    const smartData = (await smartRes.json()) as { smart_collections: ShopifyCollection[] };
    if (smartData.smart_collections?.length > 0) {
      return { id: smartData.smart_collections[0].id, type: 'smart' };
    }
  }

  return null;
}

async function updateCollection(
  domain: string,
  token: string,
  id: number,
  type: 'custom' | 'smart',
  seo: SeoEntry
): Promise<void> {
  const resourceKey = type === 'custom' ? 'custom_collection' : 'smart_collection';
  const path = type === 'custom' ? 'custom_collections' : 'smart_collections';
  const url = `https://${domain}/admin/api/2024-01/${path}/${id}.json`;

  const body = {
    [resourceKey]: {
      id,
      body_html: seo.body_html,
      metafields_global_title_tag: seo.title,
      metafields_global_description_tag: seo.description,
    },
  };

  const res = await fetch(url, {
    method: 'PUT',
    headers: {
      'X-Shopify-Access-Token': token,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HTTP ${res.status}: ${text}`);
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const domain = process.env.SHOPIFY_STORE_DOMAIN;
  const token = process.env.SHOPIFY_ADMIN_ACCESS_TOKEN;

  if (!domain || !token) {
    return res.status(500).json({ error: 'Missing env vars: SHOPIFY_STORE_DOMAIN or SHOPIFY_ADMIN_ACCESS_TOKEN' });
  }

  const handleParam = typeof req.query.collection === 'string' ? req.query.collection : undefined;

  if (handleParam && !(handleParam in SEO_MAP)) {
    return res.status(400).json({ error: `Unknown collection handle: ${handleParam}` });
  }

  const targets = handleParam ? [handleParam] : Object.keys(SEO_MAP);
  const log: string[] = [];
  const summary = { total: targets.length, updated: 0, failed: 0, notFound: 0 };

  for (const handle of targets) {
    const seo = SEO_MAP[handle];
    log.push(`→ Processing: ${handle}`);

    try {
      const collection = await findCollection(domain, token, handle);

      if (!collection) {
        log.push(`  ⚠ Not found in Shopify: ${handle}`);
        summary.notFound++;
      } else {
        await updateCollection(domain, token, collection.id, collection.type, seo);
        log.push(`  ✓ Updated: ${handle} (${collection.type}, id=${collection.id})`);
        summary.updated++;
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.push(`  ✗ Error updating ${handle}: ${message}`);
      summary.failed++;
    }

    await delay(500);
  }

  return res.status(200).json({ log, summary });
}
