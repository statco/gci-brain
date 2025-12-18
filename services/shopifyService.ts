import { TireProduct } from '../types';

// Vite requires import.meta.env, NOT process.env
const SHOPIFY_DOMAIN = import.meta.env.VITE_SHOPIFY_STORE_DOMAIN;
const STOREFRONT_TOKEN = import.meta.env.VITE_SHOPIFY_STOREFRONT_ACCESS_TOKEN;
const API_VERSION = import.meta.env.VITE_SHOPIFY_API_VERSION || '2024-01';

const STOREFRONT_API_URL = `https://${SHOPIFY_DOMAIN}/api/${API_VERSION}/graphql.json`;

interface ShopifyProduct {
  id: string;
  title: string;
  handle: string;
  description: string;
  priceRange: {
    minVariantPrice: {
      amount: string;
      currencyCode: string;
    };
  };
  images: {
    edges: Array<{
      node: {
        url: string;
        altText: string | null;
      };
    }>;
  };
  variants: {
    edges: Array<{
      node: {
        id: string;
        title: string;
        price: {
          amount: string;
          currencyCode: string;
        };
        availableForSale: boolean;
      };
    }>;
  };
}

const MOCK_INVENTORY: Partial<TireProduct>[] = [
  {
    id: 'mock-1',
    variantId: 'mock-1',
    brand: 'Michelin',
    model: 'Defender LTX M/S',
    type: 'All-Season',
    pricePerUnit: 245.99,
    imageUrl: 'https://images.unsplash.com/photo-1541899481282-d53bffe3c35d?auto=format&fit=crop&q=80&w=400',
    description: 'Best all-season tire for light trucks and SUVs.',
    tier: 'Best',
  },
  {
    id: 'mock-2',
    variantId: 'mock-2',
    brand: 'Bridgestone',
    model: 'Blizzak WS90',
    type: 'Winter',
    pricePerUnit: 189.50,
    imageUrl: 'https://images.unsplash.com/photo-1580273916550-e323be2ae537?auto=format&fit=crop&q=80&w=400',
    description: 'Leader in winter performance.',
    tier: 'Best',
  }
];

export async function fetchShopifyTireProducts(): Promise<Partial<TireProduct>[]> {
  if (!SHOPIFY_DOMAIN || !STOREFRONT_TOKEN) {
    console.warn('⚠️ Shopify config missing, using mock inventory');
    return MOCK_INVENTORY;
  }

  const query = `
    query GetTireProducts {
      products(first: 50, query: "product_type:Tire OR tag:tire") {
        edges {
          node {
            id
            title
            handle
            description
            priceRange {
              minVariantPrice {
                amount
                currencyCode
              }
            }
            images(first: 1) {
              edges {
                node {
                  url
                  altText
                }
              }
            }
            variants(first: 10) {
              edges {
                node {
                  id
                  title
                  price {
                    amount
                    currencyCode
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
      body: JSON.stringify({ query }),
    });

    const json = await response.json();
    
    if (json.errors) {
      console.error('Shopify API errors:', json.errors);
      return MOCK_INVENTORY;
    }

    const products: ShopifyProduct[] = json.data.products.edges.map((e: any) => e.node);

    if (products.length === 0) {
      return MOCK_INVENTORY;
    }

    return products.map(product => {
      const firstVariant = product.variants.edges[0]?.node;
      const parts = product.title.split(' ');
      const brand = parts[0] || 'Unknown';
      
      return {
        id: product.id,
        variantId: firstVariant?.id || '',
        brand: brand,
        model: product.title.replace(brand, '').trim(),
        type: 'All-Season',
        pricePerUnit: parseFloat(firstVariant?.price.amount || '0'),
        imageUrl: product.images.edges[0]?.node.url || '',
        description: product.description || '',
        tier: 'Good',
      };
    });
  } catch (error) {
    console.error('Error fetching Shopify products:', error);
    return MOCK_INVENTORY;
  }
}
