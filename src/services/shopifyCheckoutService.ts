// services/shopifyCheckoutService.ts
// UPDATED VERSION - Uses new Shopify Cart API (2024+)

const SHOPIFY_DOMAIN = import.meta.env.VITE_SHOPIFY_STORE_DOMAIN;
const STOREFRONT_TOKEN = import.meta.env.VITE_SHOPIFY_STOREFRONT_ACCESS_TOKEN;
const API_VERSION = import.meta.env.VITE_SHOPIFY_API_VERSION || '2024-01';

const STOREFRONT_API_URL = `https://${SHOPIFY_DOMAIN}/api/${API_VERSION}/graphql.json`;

interface LineItem {
  variantId: string;
  quantity: number;
}

interface CheckoutMetadata {
  withInstallation?: boolean;
  tireBrand?: string;
  tireModel?: string;
  tireSize?: string;
  quantity?: number;
}

function normalizeVariantId(variantId: string): string {
  if (variantId.startsWith('gid://shopify/ProductVariant/')) {
    return variantId;
  }
  const numericId = variantId.replace(/\D/g, '');
  if (numericId) {
    return `gid://shopify/ProductVariant/${numericId}`;
  }
  throw new Error(`Invalid variant ID format: ${variantId}`);
}

/**
 * Create a checkout using Shopify Cart API (2024+ compatible)
 */
export async function createCheckout(
  lineItems: LineItem[],
  metadata?: CheckoutMetadata
): Promise<string> {
  if (!SHOPIFY_DOMAIN || !STOREFRONT_TOKEN) {
    console.error('❌ Shopify credentials missing');
    throw new Error('Shopify checkout is not configured. Please contact support.');
  }

  const normalizedLineItems = lineItems.map(item => ({
    variantId: normalizeVariantId(item.variantId),
    quantity: item.quantity
  }));

  console.log('🛒 Creating cart with items:', normalizedLineItems);

  // Use NEW Cart API mutation (replaces deprecated checkoutCreate)
  const mutation = `
    mutation cartCreate($input: CartInput!) {
      cartCreate(input: $input) {
        cart {
          id
          checkoutUrl
        }
        userErrors {
          field
          message
        }
      }
    }
  `;

  const variables = {
    input: {
      lines: normalizedLineItems.map(item => ({
        merchandiseId: item.variantId,
        quantity: item.quantity
      })),
      attributes: [
        { key: '_source', value: 'ai_match_v2' },
        ...(metadata?.withInstallation ? [{ key: '_installation', value: 'true' }] : []),
        ...(metadata?.tireBrand ? [{ key: '_tire_brand', value: metadata.tireBrand }] : []),
        ...(metadata?.tireModel ? [{ key: '_tire_model', value: metadata.tireModel }] : []),
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
      body: JSON.stringify({
        query: mutation,
        variables: variables
      }),
    });

    if (!response.ok) {
      console.error('❌ HTTP error:', response.status);
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const result = await response.json();

    // Check for GraphQL errors
    if (result.errors) {
      console.error('❌ GraphQL errors:', result.errors);
      
      // Fallback to cart permalink if API fails
      console.warn('⚠️ Falling back to cart permalink...');
      return buildCartPermalink(lineItems);
    }

    // Check for user errors
    const userErrors = result.data?.cartCreate?.userErrors || [];
    if (userErrors.length > 0) {
      console.error('❌ Cart user errors:', userErrors);
      
      // Fallback to cart permalink
      console.warn('⚠️ Falling back to cart permalink...');
      return buildCartPermalink(lineItems);
    }

    const checkoutUrl = result.data?.cartCreate?.cart?.checkoutUrl;
    
    if (!checkoutUrl) {
      console.warn('⚠️ No checkout URL, using fallback');
      return buildCartPermalink(lineItems);
    }

    console.log('✅ Cart created successfully');
    return checkoutUrl;

  } catch (error) {
    console.error('❌ Shopify cart error:', error);
    
    // Always fallback to cart permalink as last resort
    console.warn('⚠️ Using cart permalink fallback');
    return buildCartPermalink(lineItems);
  }
}

/**
 * Fallback: Build cart permalink (always works)
 */
export function buildCartPermalink(lineItems: LineItem[]): string {
  const cartItems = lineItems.map(item => {
    let id = item.variantId;
    if (id.includes('gid://shopify/ProductVariant/')) {
      id = id.split('/').pop() || id;
    }
    id = id.replace(/\D/g, '');
    
    return `${id}:${item.quantity}`;
  }).join(',');
  
  const url = `https://${SHOPIFY_DOMAIN}/cart/${cartItems}`;
  const params = new URLSearchParams({
    ref: 'ai_match_v2'
  });
  
  return `${url}?${params.toString()}`;
}
