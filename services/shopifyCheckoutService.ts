// services/shopifyCheckoutService.ts
// Proper Shopify Checkout integration using Storefront API

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

/**
 * Normalize Shopify variant ID to proper GID format
 */
function normalizeVariantId(variantId: string): string {
  // If already in GID format, return as is
  if (variantId.startsWith('gid://shopify/ProductVariant/')) {
    return variantId;
  }
  
  // If numeric, convert to GID format
  const numericId = variantId.replace(/\D/g, '');
  if (numericId) {
    return `gid://shopify/ProductVariant/${numericId}`;
  }
  
  throw new Error(`Invalid variant ID format: ${variantId}`);
}

/**
 * Create a checkout session using Shopify Storefront API
 */
export async function createCheckout(
  lineItems: LineItem[],
  metadata?: CheckoutMetadata
): Promise<string> {
  if (!SHOPIFY_DOMAIN || !STOREFRONT_TOKEN) {
    console.error('❌ Shopify credentials missing');
    console.error('Domain:', SHOPIFY_DOMAIN);
    console.error('Token exists:', !!STOREFRONT_TOKEN);
    throw new Error('Shopify checkout is not configured. Please contact support.');
  }

  // Normalize all variant IDs
  const normalizedLineItems = lineItems.map(item => ({
    variantId: normalizeVariantId(item.variantId),
    quantity: item.quantity
  }));

  console.log('🛒 Creating checkout with items:', normalizedLineItems);

  // Build checkout mutation
  const mutation = `
    mutation checkoutCreate($input: CheckoutCreateInput!) {
      checkoutCreate(input: $input) {
        checkout {
          id
          webUrl
        }
        checkoutUserErrors {
          code
          field
          message
        }
      }
    }
  `;

  const variables = {
    input: {
      lineItems: normalizedLineItems.map(item => ({
        variantId: item.variantId,
        quantity: item.quantity
      })),
      // Add custom attributes for tracking
      customAttributes: [
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
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const result = await response.json();

    // Check for API errors
    if (result.errors) {
      console.error('❌ GraphQL errors:', result.errors);
      throw new Error(result.errors[0]?.message || 'Failed to create checkout');
    }

    // Check for user errors
    const userErrors = result.data?.checkoutCreate?.checkoutUserErrors || [];
    if (userErrors.length > 0) {
      console.error('❌ Checkout user errors:', userErrors);
      throw new Error(userErrors[0]?.message || 'Failed to create checkout');
    }

    const checkoutUrl = result.data?.checkoutCreate?.checkout?.webUrl;
    
    if (!checkoutUrl) {
      throw new Error('No checkout URL returned from Shopify');
    }

    console.log('✅ Checkout created successfully');
    return checkoutUrl;

  } catch (error) {
    console.error('❌ Shopify checkout error:', error);
    
    if (error instanceof Error) {
      throw error;
    }
    
    throw new Error('An unexpected error occurred during checkout. Please try again.');
  }
}

/**
 * Fallback: Build cart permalink (if Storefront API fails)
 * This is less reliable but works as a backup
 */
export function buildCartPermalink(lineItems: LineItem[]): string {
  const cartItems = lineItems.map(item => {
    // Extract numeric ID
    let id = item.variantId;
    if (id.includes('gid://shopify/ProductVariant/')) {
      id = id.split('/').pop() || id;
    }
    id = id.replace(/\D/g, ''); // Remove non-digits
    
    return `${id}:${item.quantity}`;
  }).join(',');
  
  const url = `https://${SHOPIFY_DOMAIN}/cart/${cartItems}`;
  const params = new URLSearchParams({
    ref: 'ai_match_v2'
  });
  
  return `${url}?${params.toString()}`;
}

/**
 * Alternative: Use if you want to use cart permalink as primary method
 */
export async function createCheckoutWithFallback(
  lineItems: LineItem[],
  metadata?: CheckoutMetadata
): Promise<string> {
  try {
    // Try Storefront API first
    return await createCheckout(lineItems, metadata);
  } catch (error) {
    console.warn('⚠️ Storefront API failed, falling back to cart permalink');
    console.error(error);
    
    // Fallback to cart permalink
    return buildCartPermalink(lineItems);
  }
}
