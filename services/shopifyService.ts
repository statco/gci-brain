import axios from 'axios';

// Type-safe environment variable access
const SHOPIFY_DOMAIN = import.meta.env.VITE_SHOPIFY_STORE_DOMAIN as string;
const STOREFRONT_TOKEN = import.meta.env.VITE_SHOPIFY_STOREFRONT_ACCESS_TOKEN as string;
const API_VERSION = (import.meta.env.VITE_SHOPIFY_API_VERSION as string) || '2024-01';

const shopifyClient = axios.create({
  baseURL: `https://${SHOPIFY_DOMAIN}/api/${API_VERSION}/graphql.json`,
  headers: {
    'Content-Type': 'application/json',
    'X-Shopify-Storefront-Access-Token': STOREFRONT_TOKEN,
  },
});

const PRODUCTS_QUERY = `
  query getProducts($first: Int!) {
    products(first: $first) {
      edges {
        node {
          id
          title
          description
          vendor
          productType
          tags
          variants(first: 10) {
            edges {
              node {
                id
                title
                price {
                  amount
                }
                compareAtPrice {
                  amount
                }
                availableForSale
                quantityAvailable
                image {
                  url
                }
              }
            }
          }
          images(first: 1) {
            edges {
              node {
                url
              }
            }
          }
        }
      }
    }
  }
`;

export interface ShopifyProduct {
  id: string;
  title: string;
  description: string;
  vendor: string;
  productType: string;
  tags: string[];
  variantId: string;
  price: number;
  compareAtPrice?: number;
  imageUrl: string;
  availableForSale: boolean;
  quantityAvailable: number;
}

/**
 * Extract numeric ID from Shopify GID
 * Input: "gid://shopify/ProductVariant/42593751203888"
 * Output: "42593751203888"
 */
function extractNumericId(gid: string): string {
  if (!gid) {
    console.error('❌ Empty GID provided');
    return '';
  }

  // GID format: gid://shopify/ProductVariant/42593751203888
  const parts = gid.split('/');
  const numericId = parts[parts.length - 1];
  
  // Verify it's numeric
  if (!/^\d+$/.test(numericId)) {
    console.error('❌ Extracted ID is not numeric:', numericId);
    return numericId;
  }
  
  return numericId;
}

export async function fetchShopifyProducts(): Promise<ShopifyProduct[]> {
  try {
    console.log('🛒 Fetching products from Shopify...');
    console.log('   Domain:', SHOPIFY_DOMAIN);
    console.log('   API Version:', API_VERSION);

    if (!SHOPIFY_DOMAIN || !STOREFRONT_TOKEN) {
      throw new Error('Shopify credentials missing. Check .env.local file.');
    }

    const response = await shopifyClient.post('', {
      query: PRODUCTS_QUERY,
      variables: { first: 50 },
    });

    if (response.data.errors) {
      console.error('❌ GraphQL errors:', response.data.errors);
      throw new Error(`Shopify API error: ${JSON.stringify(response.data.errors)}`);
    }

    const products: ShopifyProduct[] = [];
    const edges = response.data.data?.products?.edges || [];

    console.log(`📦 Processing ${edges.length} products from Shopify...`);
    console.log('=== YOUR REAL VARIANT IDs ===');

    for (const edge of edges) {
      const product = edge.node;
      
      if (!product.variants?.edges || product.variants.edges.length === 0) {
        console.warn(`⚠️ Product "${product.title}" has no variants, skipping`);
        continue;
      }

      const variant = product.variants.edges[0].node;
      
      // Extract numeric ID from GID
      const variantGid = variant.id;
      const variantId = extractNumericId(variantGid);
      
      // Log for verification
      console.log(`${product.title}: ${variantId}`);
      
      const imageUrl = variant.image?.url || product.images?.edges?.[0]?.node?.url || '';

      const shopifyProduct: ShopifyProduct = {
        id: extractNumericId(product.id),
        title: product.title,
        description: product.description || '',
        vendor: product.vendor || 'Unknown',
        productType: product.productType || 'Tire',
        tags: product.tags || [],
        variantId: variantId,
        price: parseFloat(variant.price.amount),
        compareAtPrice: variant.compareAtPrice ? parseFloat(variant.compareAtPrice.amount) : undefined,
        imageUrl: imageUrl,
        availableForSale: variant.availableForSale,
        quantityAvailable: variant.quantityAvailable || 0,
      };

      products.push(shopifyProduct);
    }

    console.log(`✅ Successfully fetched ${products.length} products with REAL variant IDs`);
    return products;

  } catch (error) {
    console.error('❌ Error fetching Shopify products:', error);
    
    if (axios.isAxiosError(error)) {
      console.error('   Response:', error.response?.data);
      console.error('   Status:', error.response?.status);
    }
    
    throw new Error('Failed to fetch products from Shopify. Check console for details.');
  }
}

export function getInstallationVariantId(): string | undefined {
  const variantId = import.meta.env.VITE_SHOPIFY_INSTALLATION_PRODUCT_ID as string;
  
  if (!variantId || variantId === 'your_installation_variant_id_here') {
    console.warn('⚠️ Installation variant ID not configured in .env.local');
    console.warn('⚠️ Add: VITE_SHOPIFY_INSTALLATION_PRODUCT_ID=42593767915568');
    return undefined;
  }
  
  console.log('✅ Installation variant ID:', variantId);
  return variantId;
}
