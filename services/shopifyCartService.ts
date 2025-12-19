import Client from 'shopify-buy';

// Initialize Shopify Buy SDK
const client = Client.buildClient({
  domain: 'gcitires.myshopify.com', // Your Shopify domain
  storefrontAccessToken: import.meta.env.VITE_SHOPIFY_STOREFRONT_ACCESS_TOKEN
});

export interface CartItem {
  variantId: string;
  quantity: number;
}

/**
 * Add items to cart and get checkout URL
 */
export async function addToCartAndGetCheckoutUrl(items: CartItem[]): Promise<string> {
  try {
    // Create a new checkout
    const checkout = await client.checkout.create();
    
    // Format items for Shopify SDK
    const lineItems = items.map(item => ({
      variantId: item.variantId,
      quantity: item.quantity
    }));
    
    // Add line items to checkout
    const checkoutWithItems = await client.checkout.addLineItems(checkout.id, lineItems);
    
    // Return the checkout URL
    return checkoutWithItems.webUrl;
  } catch (error) {
    console.error('Shopify cart error:', error);
    throw new Error('Failed to create checkout');
  }
}

/**
 * Fallback: Build permalink URL (no SDK required)
 */
export function buildCartPermalink(items: CartItem[]): string {
  const cartItems = items.map(item => {
    // Extract numeric ID from GID if needed
    let id = item.variantId;
    if (id.includes('gid://shopify/ProductVariant/')) {
      id = id.split('/').pop() || id;
    }
    return `${id}:${item.quantity}`;
  }).join(',');
  
  return `https://gcitires.com/cart/${cartItems}?ref=ai_match_v2`;
}
