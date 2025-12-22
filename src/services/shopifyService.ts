// src/services/shopifyService.ts
import { TireProduct } from '../types';

const SHOPIFY_DOMAIN = import.meta.env.VITE_SHOPIFY_STORE_DOMAIN;
const STOREFRONT_TOKEN = import.meta.env.VITE_SHOPIFY_STOREFRONT_ACCESS_TOKEN;
const API_VERSION = import.meta.env.VITE_SHOPIFY_API_VERSION || '2024-01';
const INSTALLATION_PRODUCT_ID = import.meta.env.VITE_SHOPIFY_INSTALLATION_PRODUCT_ID;

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

interface CheckoutCreateResponse {
  checkoutCreate: {
    checkout: {
      id: string;
      webUrl: string;
    };
    checkoutUserErrors: Array<{
      message: string;
      field: string[];
    }>;
  };
}

/**
 * Fetch all tire products from Shopify
 */
export async function fetchShopifyTireProducts(): Promise<Partial<TireProduct>[]> {
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
      throw new Error('Failed to fetch products from Shopify');
    }

    const products: ShopifyProduct[] = json.data.products.edges.map((e: any) => e.node);

    return products.map(product => {
      const firstVariant = product.variants.edges[0]?.node;
      const parsedTitle = parseProductTitle(product.title);

      return {
        id: product.id,
        variantId: firstVariant?.id || '',
        brand: parsedTitle.brand,
        model: parsedTitle.model,
        type: parsedTitle.type || 'All-Season',
        pricePerUnit: parseFloat(firstVariant?.price.amount || '0'),
        imageUrl: product.images.edges[0]?.node.url || '',
        description: product.description || '',
        tier: 'Good',
        availableForSale: firstVariant?.availableForSale || false,
      };
    });
  } catch (error) {
    console.error('Error fetching Shopify products:', error);
    throw error;
  }
}

/**
 * Parse product title to extract brand, model, and tire size
 * Example: "Toyo Open Country A/T III 265/70R17" -> { brand: "Toyo", model: "Open Country A/T III", size: "265/70R17" }
 */
function parseProductTitle(title: string): { brand: string; model: string; type?: string; size?: string } {
  const parts = title.split(' ');
  const brand = parts[0] || 'Unknown';
  
  // Look for tire size pattern (e.g., 265/70R17)
  const sizeMatch = title.match(/\d{3}\/\d{2}R\d{2}/);
  const size = sizeMatch ? sizeMatch[0] : undefined;
  
  // Extract model (everything between brand and size)
  let model = title.replace(brand, '').trim();
  if (size) {
    model = model.replace(size, '').trim();
  }

  return { brand, model, size };
}

/**
 * Create a Shopify checkout with tire and optional installation
 */
export async function createShopifyCheckout(
  tireVariantId: string,
  quantity: number,
  withInstallation: boolean,
  installationFeePerUnit: number
): Promise<string> {
  const lineItems = [
    {
      variantId: tireVariantId,
      quantity: quantity,
    }
  ];

  // Add installation as separate line item if requested
  if (withInstallation && INSTALLATION_PRODUCT_ID) {
    lineItems.push({
      variantId: INSTALLATION_PRODUCT_ID,
      quantity: quantity, // One installation per tire
    });
  }

  const mutation = `
    mutation checkoutCreate($input: CheckoutCreateInput!) {
      checkoutCreate(input: $input) {
        checkout {
          id
          webUrl
        }
        checkoutUserErrors {
          message
          field
        }
      }
    }
  `;

  const variables = {
    input: {
      lineItems: lineItems,
      customAttributes: [
        {
          key: "source",
          value: "AI Match 2.0"
        },
        {
          key: "installation_requested",
          value: withInstallation ? "yes" : "no"
        }
      ]
    }
  };

  try {
    const response = await fetch(STOREFRONT_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Storefront-Access-Token': STOREFRONT_TOKEN,
      },
      body: JSON.stringify({ query: mutation, variables }),
    });

    const json = await response.json();

    if (json.errors) {
      console.error('Shopify checkout creation errors:', json.errors);
      throw new Error('Failed to create checkout');
    }

    const result: CheckoutCreateResponse = json.data;

    if (result.checkoutCreate.checkoutUserErrors.length > 0) {
      const errorMsg = result.checkoutCreate.checkoutUserErrors
        .map(e => e.message)
        .join(', ');
      throw new Error(`Checkout errors: ${errorMsg}`);
    }

    return result.checkoutCreate.checkout.webUrl;
  } catch (error) {
    console.error('Error creating Shopify checkout:', error);
    throw error;
  }
}

/**
 * Find matching Shopify product by brand and model
 */
export async function findMatchingShopifyProduct(
  brand: string,
  model: string,
  allProducts: Partial<TireProduct>[]
): Promise<Partial<TireProduct> | null> {
  const normalizedBrand = brand.toLowerCase().trim();
  const normalizedModel = model.toLowerCase().trim();

  return allProducts.find(product => {
    const productBrand = (product.brand || '').toLowerCase().trim();
    const productModel = (product.model || '').toLowerCase().trim();

    return productBrand === normalizedBrand && 
           productModel.includes(normalizedModel);
  }) || null;
}
