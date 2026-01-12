// src/services/shopifyProductService.ts
// FULLY DYNAMIC VERSION - Fetches all products from Shopify automatically

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
      const imageUrl = product.images.edges[0]?.node.url || '';
      
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
 * ✅ OPTION 2: Fetch products by tag
 */
export async function fetchProductsByTag(tag: string = 'ai-match') {
  console.log(`🔍 Fetching products with tag: ${tag}`);

  const query = `
    query getProducts($query: String!) {
      products(first: 50, query: $query) {
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
        variables: { query: `tag:${tag}` }
      }),
    });

    const result = await response.json();
    const products = result.data?.products?.edges || [];
    
    return transformShopifyProducts(products);

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
function transformShopifyProducts(edges: any[]) {
  return edges.map((edge: any) => {
    const product = edge.node;
    const variant = product.variants.edges[0]?.node;
    const imageUrl = product.images.edges[0]?.node.url || '';

    return {
      id: product.id.split('/').pop(),
      title: product.title,
      brand: extractBrandFromTitle(product.title),
      model: product.title,
      size: extractSizeFromTitle(product.title),
      season: extractSeasonFromTags(product.tags || []),
      pricePerUnit: parseFloat(variant?.priceV2.amount || '0'),
      rating: 4.5, // Default
      reviews: 0, // Default
      imageUrl,
      description: product.description || '',
      features: extractFeaturesFromDescription(product.description),
      inStock: variant?.availableForSale || false,
      warranty: '6-year limited',
      speedRating: 'H',
      loadIndex: '94',
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
  const sizeMatch = title.match(/\d{3}\/\d{2}R?\d{2}/i);
  return sizeMatch ? sizeMatch[0] : '225/65R17';
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
