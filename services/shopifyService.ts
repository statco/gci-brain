import axios from 'axios';

const SHOPIFY_DOMAIN = import.meta.env.VITE_SHOPIFY_STORE_DOMAIN;
const STOREFRONT_TOKEN = import.meta.env.VITE_SHOPIFY_STOREFRONT_ACCESS_TOKEN;
const API_VERSION = import.meta.env.VITE_SHOPIFY_API_VERSION || '2024-01';

const shopifyClient = axios.create({
  baseURL: `https://${SHOPIFY_DOMAIN}/api/${API_VERSION}/graphql.json`,
  headers: {
    'Content-Type': 'application/json',
    'X-Shopify-Storefront-Access-Token': STOREFRONT_TOKEN,
  },
});

// GraphQL query to fetch products with CORRECT variant IDs
const PRODUCTS_QUERY = `
  query getProducts($first: Int!) {
    products(first: $first, query: "product_type:Tire") {
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
  variantId: string; // CRITICAL: This must be the numeric ID
  price: number;
  compareAtPrice?: number;
  imageUrl: string;
  availableForSale: boolean;
  quantityAvailable: number;
}

// Extract numeric ID from Shopify GID
function extractNumericId(gid: string): string {
  // Shopify GIDs look like: gid://shopify/ProductVariant/42593751203888
  // We need just the number at the end: 42593751203888
  const parts = gid.split('/');
  const numericId = parts[parts.length - 1];
  
  console.log('🔍 Extracting ID from GID:', gid, '→', numericId);
  
  return numericId;
}

export async function fetchShopifyProducts(): Promise<ShopifyProduct[]> {
  try {
    console.log('🛒 Fetching products from Shopify...');
    console.log('   Domain:', SHOPIFY_DOMAIN);
    console.log('   Has Token:', !!STOREFRONT_TOKEN);

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

    for (const edge of edges) {
      const product = edge.node;
      
      // Skip if no variants
      if (!product.variants?.edges || product.variants.edges.length === 0) {
        console.warn(`⚠️ Product "${product.title}" has no variants, skipping`);
        continue;
      }

      // Get first variant (most products have only one variant)
      const variant = product.variants.edges[0].node;
      
      // CRITICAL: Extract numeric ID from GID
      const variantId = extractNumericId(variant.id);
      
      // Get first image
      const imageUrl = variant.image?.url || product.images?.edges?.[0]?.node?.url || '';

      const shopifyProduct: ShopifyProduct = {
        id: extractNumericId(product.id),
        title: product.title,
        description: product.description || '',
        vendor: product.vendor || 'Unknown',
        productType: product.productType || 'Tire',
        tags: product.tags || [],
        variantId: variantId, // THIS is the critical field
        price: parseFloat(variant.price.amount),
        compareAtPrice: variant.compareAtPrice ? parseFloat(variant.compareAtPrice.amount) : undefined,
        imageUrl: imageUrl,
        availableForSale: variant.availableForSale,
        quantityAvailable: variant.quantityAvailable || 0,
      };

      console.log(`✅ Product: ${shopifyProduct.vendor} ${shopifyProduct.title}`);
      console.log(`   Variant ID: ${shopifyProduct.variantId}`);
      console.log(`   Price: $${shopifyProduct.price}`);
      console.log(`   Available: ${shopifyProduct.availableForSale} (${shopifyProduct.quantityAvailable} in stock)`);

      products.push(shopifyProduct);
    }

    console.log(`✅ Successfully fetched ${products.length} products from Shopify`);
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

// Get installation service variant ID
export function getInstallationVariantId(): string | undefined {
  const variantId = import.meta.env.VITE_SHOPIFY_INSTALLATION_PRODUCT_ID;
  
  if (!variantId || variantId === 'your_installation_variant_id_here') {
    console.warn('⚠️ Installation variant ID not configured');
    return undefined;
  }
  
  return variantId;
}
