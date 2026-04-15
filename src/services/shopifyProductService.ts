// src/services/shopifyProductService.ts
// FULLY DYNAMIC VERSION - Fetches all products from Shopify automatically

import { getTireImageUrl } from './addTireImages';

const SHOPIFY_DOMAIN = import.meta.env.VITE_SHOPIFY_STORE_DOMAIN;
const STOREFRONT_TOKEN = import.meta.env.VITE_SHOPIFY_STOREFRONT_ACCESS_TOKEN;
const API_VERSION = import.meta.env.VITE_SHOPIFY_API_VERSION || '2024-01';

const STOREFRONT_API_URL = `https://${SHOPIFY_DOMAIN}/api/${API_VERSION}/graphql.json`;

// Cache products to avoid repeated API calls
let cachedProducts: any[] | null = null;
let cacheTimestamp = 0;
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

/**
 * ✅ OPTION 1: Fetch products by collection handle
 * This is the RECOMMENDED approach
 */
export async function fetchProductsByCollection(collectionHandle: string = 'ai-match-tires') {
  console.log(`🔍 Fetching products from collection: ${collectionHandle}`);

  // Check cache
  if (cachedProducts && Date.now() - cacheTimestamp < CACHE_DURATION) {
    console.log('✅ Using cached products');
    return cachedProducts;
  }

  const query = `
    query getCollection($handle: String!) {
      collection(handle: $handle) {
        products(first: 50) {
          edges {
            node {
              id
              title
              handle
              description
              productType
              tags
              images(first: 1) {
                edges {
                  node {
                    url
                    altText
                  }
                }
              }
              variants(first: 1) {
                edges {
                  node {
                    id
                    title
                    priceV2 {
                      amount
                      currencyCode
                    }
                    availableForSale
                  }
                }
              }
              metafields(identifiers: [
                {namespace: "custom", key: "tire_size"}
                {namespace: "custom", key: "tire_season"}
                {namespace: "custom", key: "tire_brand"}
                {namespace: "custom", key: "tire_model"}
                {namespace: "custom", key: "tire_rating"}
                {namespace: "custom", key: "tire_reviews"}
                {namespace: "custom", key: "speed_rating"}
                {namespace: "custom", key: "load_index"}
              ]) {
                key
                value
              }
            }
          }
        }
      }
    }
  `;

  try {
    const response = await fetch(STOREFRONT_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Storefront-Access-Token': STOREFRONT_TOKEN,
      },
      body: JSON.stringify({
        query,
        variables: { handle: collectionHandle }
      }),
    });

    const result = await response.json();
    
    if (result.errors) {
      console.error('❌ GraphQL errors:', result.errors);
      return [];
    }

    const products = result.data?.collection?.products?.edges || [];
    
    const transformedProducts = products.map((edge: any) => {
      const product = edge.node;
      const variant = product.variants.edges[0]?.node;
      const shopifyImage = product.images.edges[0]?.node.url || '';
      const imageUrl = shopifyImage || getTireImageUrl(product.title) || '';

      // Extract metafield values
      const metafields = product.metafields || [];
      const getMetafield = (key: string) => {
        const field = metafields.find((m: any) => m.key === key);
        return field?.value || '';
      };

      return {
        id: product.id.split('/').pop(), // Extract numeric ID
        title: product.title,
        brand: getMetafield('tire_brand') || extractBrandFromTitle(product.title),
        model: getMetafield('tire_model') || product.title,
        size: getMetafield('tire_size') || extractSizeFromTitle(product.title),
        season: getMetafield('tire_season') || extractSeasonFromTags(product.tags),
        pricePerUnit: parseFloat(variant?.priceV2.amount || '0'),
        rating: parseFloat(getMetafield('tire_rating') || '4.5'),
        reviews: parseInt(getMetafield('tire_reviews') || '0'),
        imageUrl,
        description: product.description || '',
        features: extractFeaturesFromDescription(product.description),
        inStock: variant?.availableForSale || false,
        warranty: '6-year limited', // Default, can be metafield
        speedRating: getMetafield('speed_rating') || 'H',
        loadIndex: getMetafield('load_index') || '94',
        shopifyVariantId: variant?.id || '',
        shopifyHandle: product.handle,
        shopifyProductId: product.id
      };
    });

    console.log(`✅ Fetched ${transformedProducts.length} products from Shopify`);
    
    // Cache the results
    cachedProducts = transformedProducts;
    cacheTimestamp = Date.now();
    
    return transformedProducts;

  } catch (error) {
    console.error('❌ Error fetching products:', error);
    return [];
  }
}

/**
 * ✅ OPTION 2: Fetch products by tag (paginated, up to Shopify's 250/page max)
 */
export async function fetchProductsByTag(tag: string = 'ai-match') {
  console.log(`🔍 Fetching products with tag: ${tag}`);

  const query = `
    query getProducts($query: String!, $after: String) {
      products(first: 250, query: $query, after: $after) {
        pageInfo {
          hasNextPage
          endCursor
        }
        edges {
          node {
            id
            title
            handle
            description
            tags
            images(first: 1) {
              edges {
                node {
                  url
                }
              }
            }
            description
            variants(first: 1) {
              edges {
                node {
                  id
                  priceV2 {
                    amount
                  }
                  availableForSale
                }
              }
            }
            metafields(identifiers: [
              {namespace: "canada_tire", key: "load_index"}
              {namespace: "canada_tire", key: "speed_rating"}
            ]) {
              key
              value
            }
          }
        }
      }
    }
  `;

  try {
    let allEdges: any[] = [];
    let hasNextPage = true;
    let cursor: string | null = null;
    let page = 0;

    while (hasNextPage) {
      page++;
      const response = await fetch(STOREFRONT_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Shopify-Storefront-Access-Token': STOREFRONT_TOKEN,
        },
        body: JSON.stringify({
          query,
          variables: { query: `tag:${tag}`, after: cursor }
        }),
      });

      const result = await response.json();

      if (result.errors) {
        console.error(`❌ GraphQL errors on page ${page}:`, result.errors);
        break;
      }

      const pageData = result.data?.products;
      const edges = pageData?.edges || [];
      allEdges = allEdges.concat(edges);

      hasNextPage = pageData?.pageInfo?.hasNextPage ?? false;
      cursor = pageData?.pageInfo?.endCursor ?? null;
      console.log(`🔍 [fetchProductsByTag] page ${page}: ${edges.length} products (hasNextPage=${hasNextPage})`);
    }

    console.warn(`[catalog] total ai-match products fetched: ${allEdges.length} (across ${page} page(s))`);
    return transformShopifyProducts(allEdges);

  } catch (error) {
    console.error('❌ Error fetching products by tag:', error);
    return [];
  }
}

/**
 * ✅ OPTION 3: Fetch products by product type
 */
export async function fetchProductsByType(productType: string = 'Tires') {
  console.log(`🔍 Fetching products with type: ${productType}`);

  const query = `
    query getProducts($query: String!) {
      products(first: 50, query: $query) {
        edges {
          node {
            id
            title
            handle
            description
            images(first: 1) {
              edges {
                node {
                  url
                }
              }
            }
            variants(first: 1) {
              edges {
                node {
                  id
                  priceV2 {
                    amount
                  }
                  availableForSale
                }
              }
            }
          }
        }
      }
    }
  `;

  try {
    const response = await fetch(STOREFRONT_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Storefront-Access-Token': STOREFRONT_TOKEN,
      },
      body: JSON.stringify({
        query,
        variables: { query: `product_type:${productType}` }
      }),
    });

    const result = await response.json();
    const products = result.data?.products?.edges || [];
    
    return transformShopifyProducts(products);

  } catch (error) {
    console.error('❌ Error fetching products by type:', error);
    return [];
  }
}

/**
 * Transform Shopify products to TireProduct format
 */
// Parse load index and speed rating from Shopify tags (e.g. "loadindex:110", "speedrating:T")
// Tags are always available via Storefront API — no metafield permissions needed.
function extractLoadIndexFromTags(tags: string[]): { loadIndex: string; speedRating: string } {
  let loadIndex = '';
  let speedRating = '';
  for (const tag of tags) {
    const li = tag.match(/^loadindex:(\d{2,3})$/i);
    if (li) loadIndex = li[1];
    const sr = tag.match(/^speedrating:([A-Z])$/i);
    if (sr) speedRating = sr[1].toUpperCase();
  }
  return { loadIndex, speedRating };
}

// Parse load index from Shopify product description HTML.
// The sync writes "Load Index: 110" and "Speed Rating: T" as list items.
function extractLoadIndexFromDescription(description: string): { loadIndex: string; speedRating: string } {
  const li = description.match(/Load Index:\s*(\d{2,3})/i);
  const sr = description.match(/Speed Rating:\s*([A-Z])/i);
  return {
    loadIndex:   li ? li[1] : '',
    speedRating: sr ? sr[1] : '',
  };
}

// Parse load index and speed rating from a tire title/name string.
// e.g. "265/60R18 110T" → { loadIndex: '110', speedRating: 'T' }
function extractLoadIndexFromTitle(title: string): { loadIndex: string; speedRating: string } {
  const match = title.match(/\d{3}\/\d{2}R\d{2}\s+(\d{2,3})([A-Z])/);
  if (match) return { loadIndex: match[1], speedRating: match[2] };
  return { loadIndex: '', speedRating: '' };
}

function transformShopifyProducts(edges: any[]) {
  return edges.map((edge: any) => {
    const product = edge.node;
    const variant = product.variants.edges[0]?.node;
    const shopifyImage = product.images.edges[0]?.node.url || '';
    const imageUrl = shopifyImage || getTireImageUrl(product.title) || '';

    // 1. Parse from description (written by sync into body_html — always available)
    const { loadIndex: descLI, speedRating: descSR } = extractLoadIndexFromDescription(product.description || '');
    // 2. Try tags (written by earlier sync runs)
    const { loadIndex: tagLI, speedRating: tagSR } = extractLoadIndexFromTags(product.tags || []);
    // 3. Try metafields (requires storefront access to be enabled in Shopify Admin)
    const metafields = product.metafields || [];
    const getMeta = (key: string) => metafields.find((m: any) => m?.key === key)?.value || '';
    const metaLI = getMeta('load_index');
    const metaSR = getMeta('speed_rating');
    // 4. Last resort: parse from title
    const { loadIndex: titleLI, speedRating: titleSR } = extractLoadIndexFromTitle(product.title);
    const resolvedLI = descLI || tagLI || metaLI || titleLI || '94';
    const resolvedSR = descSR || tagSR || metaSR || titleSR || 'H';

    return {
      id: product.id.split('/').pop(),
      title: product.title,
      brand: extractBrandFromTitle(product.title),
      model: product.title,
      size: extractSizeFromTitle(product.title),
      season: extractSeasonFromTags(product.tags || []),
      pricePerUnit: parseFloat(variant?.priceV2.amount || '0'),
      rating: 4.5,
      reviews: 0,
      imageUrl,
      description: product.description || '',
      features: extractFeaturesFromDescription(product.description),
      inStock: variant?.availableForSale || false,
      warranty: '6-year limited',
      speedRating: resolvedSR,
      loadIndex: resolvedLI,
      shopifyVariantId: variant?.id || '',
      shopifyHandle: product.handle,
      shopifyProductId: product.id
    };
  });
}

/**
 * Helper: Extract brand from title
 */
function extractBrandFromTitle(title: string): string {
  const brands = ['Michelin', 'Goodyear', 'Bridgestone', 'Continental', 'Pirelli', 'Yokohama', 'Hankook', 'Dunlop'];
  const titleUpper = title.toUpperCase();
  
  for (const brand of brands) {
    if (titleUpper.includes(brand.toUpperCase())) {
      return brand;
    }
  }
  
  return title.split(' ')[0]; // First word as fallback
}

/**
 * Helper: Extract tire size from title (e.g., "245/40R18")
 */
function extractSizeFromTitle(title: string): string {
  const slashMatch   = title.match(/(\d{3})\/(\d{2})R?(\d{2})/i);
  const compactMatch = title.match(/(\d{3})(\d{2})R?(\d{2})/i);
  const m = slashMatch ?? compactMatch;
  return m ? `${m[1]}/${m[2]}R${m[3]}` : '225/65R17';
}

/**
 * Helper: Extract season from tags
 */
function extractSeasonFromTags(tags: string[]): string {
  const tagString = tags.join(' ').toLowerCase();
  
  if (tagString.includes('winter') || tagString.includes('snow')) return 'Winter';
  if (tagString.includes('summer') || tagString.includes('performance')) return 'Summer';
  if (tagString.includes('all-season') || tagString.includes('all season')) return 'All-Season';
  
  return 'All-Season'; // Default
}

/**
 * Helper: Extract features from description
 */
function extractFeaturesFromDescription(description: string): string[] {
  if (!description) return [];
  
  // Look for bullet points or line breaks
  const lines = description.split('\n').filter(line => line.trim());
  
  // Take first 3 non-empty lines as features
  return lines.slice(0, 3).map(line => 
    line.replace(/^[-•*]\s*/, '').trim()
  ).filter(Boolean);
}

/**
 * Clear product cache (useful for debugging or forcing refresh)
 */
export function clearProductCache() {
  cachedProducts = null;
  cacheTimestamp = 0;
  console.log('🗑️ Product cache cleared');
}

/**
 * Get cache status
 */
export function getCacheStatus() {
  const isCached = cachedProducts !== null;
  const cacheAge = Date.now() - cacheTimestamp;
  const cacheValid = cacheAge < CACHE_DURATION;
  
  return {
    isCached,
    cacheAge,
    cacheValid,
    productCount: cachedProducts?.length || 0
  };
}

/**
 * Enrich tire products with images — checks static map first (O(1)),
 * falls back to Shopify Storefront API if not found.
 * Backward-compatible with geminiService.ts consumers.
 */
export async function enrichTiresWithImages<T extends {
  shopifyHandle?: string;
  imageUrl?: string;
  title?: string;
  brand?: string;
  model?: string;
}>(tires: T[]): Promise<T[]> {
  return tires.map((tire) => {
    // Already has an image — skip
    if (tire.imageUrl) return tire;

    // Try static map via title or brand+model
    const lookupKey =
      tire.title ||
      (tire.brand && tire.model ? `${tire.brand} ${tire.model}` : null);

    if (lookupKey) {
      const staticUrl = getTireImageUrl(lookupKey);
      if (staticUrl) {
        console.log(`✅ [static map] ${lookupKey}`);
        return { ...tire, imageUrl: staticUrl };
      }
    }

    return tire;
  });
}
