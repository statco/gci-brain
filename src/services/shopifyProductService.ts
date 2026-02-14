// src/services/shopifyProductService.ts
// Automatically fetch product images from Shopify

import { getTireImageUrl } from './addTireImages';

const SHOPIFY_DOMAIN = import.meta.env.VITE_SHOPIFY_STORE_DOMAIN;
const STOREFRONT_TOKEN = import.meta.env.VITE_SHOPIFY_STOREFRONT_ACCESS_TOKEN;
const API_VERSION = import.meta.env.VITE_SHOPIFY_API_VERSION || '2024-01';

const STOREFRONT_API_URL = `https://${SHOPIFY_DOMAIN}/api/${API_VERSION}/graphql.json`;

// Cache images to avoid repeated API calls
const imageCache = new Map<string, string>();

interface ShopifyProductData {
  imageUrl: string;
  price: number;
  available: boolean;
}

/**
 * Fetch product image by Shopify handle
 */
export async function fetchProductImage(handle: string): Promise<string | null> {
  // Check cache first
  if (imageCache.has(handle)) {
    console.log(`✅ Using cached image for: ${handle}`);
    return imageCache.get(handle)!;
  }

  if (!SHOPIFY_DOMAIN || !STOREFRONT_TOKEN) {
    console.warn('⚠️ Shopify credentials missing');
    return null;
  }

  const query = `
    query getProduct($handle: String!) {
      product(handle: $handle) {
        images(first: 1) {
          edges {
            node {
              url
              altText
            }
          }
        }
      }
    }
  `;

  try {
    console.log(`🖼️ Fetching image for: ${handle}`);
    
    const response = await fetch(STOREFRONT_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Storefront-Access-Token': STOREFRONT_TOKEN,
      },
      body: JSON.stringify({
        query,
        variables: { handle }
      }),
    });

    if (!response.ok) {
      console.error(`❌ HTTP error for ${handle}:`, response.status);
      return null;
    }

    const result = await response.json();
    
    if (result.errors) {
      console.error(`❌ GraphQL errors for ${handle}:`, result.errors);
      return null;
    }

    const imageUrl = result.data?.product?.images?.edges[0]?.node?.url;
    
    if (imageUrl) {
      // Cache the image URL
      imageCache.set(handle, imageUrl);
      console.log(`✅ Image fetched for: ${handle}`);
      return imageUrl;
    }

    console.warn(`⚠️ No image found for: ${handle}`);
    return null;

  } catch (error) {
    console.error(`❌ Error fetching image for ${handle}:`, error);
    return null;
  }
}

/**
 * Fetch complete product data (image + price + availability)
 */
export async function fetchProductData(handle: string): Promise<ShopifyProductData | null> {
  if (!SHOPIFY_DOMAIN || !STOREFRONT_TOKEN) {
    console.warn('⚠️ Shopify credentials missing');
    return null;
  }

  const query = `
    query getProduct($handle: String!) {
      product(handle: $handle) {
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
              priceV2 {
                amount
              }
              availableForSale
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
        variables: { handle }
      }),
    });

    const result = await response.json();
    const product = result.data?.product;

    if (!product) return null;

    const imageUrl = product.images.edges[0]?.node.url || '';
    const variant = product.variants.edges[0]?.node;
    
    return {
      imageUrl,
      price: parseFloat(variant?.priceV2.amount || '0'),
      available: variant?.availableForSale || false
    };

  } catch (error) {
    console.error(`❌ Error fetching product data for ${handle}:`, error);
    return null;
  }
}

/**
 * Enrich tire products with Shopify images
 * This is the main function you'll use
 */
export async function enrichTiresWithImages<T extends { shopifyHandle?: string; imageUrl?: string; title?: string; brand?: string; model?: string }>(
  tires: T[]
): Promise<T[]> {
  console.log(`🖼️ Enriching ${tires.length} products with images...`);

  const enrichedTires = await Promise.all(
    tires.map(async (tire) => {
      // ── 1. Static IMAGE_MAP lookup (O(1), zero network) ──────────────────
      const lookupKey =
        (tire.title) ||
        (tire.brand && tire.model ? `${tire.brand} ${tire.model}` : null);

      if (lookupKey) {
        const staticUrl = getTireImageUrl(lookupKey);
        if (staticUrl) {
          console.log(`✅ [static map] image for: ${lookupKey}`);
          return { ...tire, imageUrl: staticUrl };
        }
      }

      // ── 2. Fallback: Shopify Storefront API ───────────────────────────────
      if (!tire.shopifyHandle) {
        console.warn(`⚠️ No static image or Shopify handle for tire:`, lookupKey ?? tire);
        return tire;
      }

      const imageUrl = await fetchProductImage(tire.shopifyHandle);

      return {
        ...tire,
        imageUrl: imageUrl || tire.imageUrl || ''
      };
    })
  );

  const successCount = enrichedTires.filter(t => t.imageUrl).length;
  console.log(`✅ Successfully enriched ${successCount}/${tires.length} products with images`);

  return enrichedTires;
}

/**
 * Batch fetch images for multiple handles
 * More efficient than individual fetches
 */
export async function batchFetchImages(handles: string[]): Promise<Map<string, string>> {
  const images = new Map<string, string>();

  console.log(`🖼️ Batch fetching images for ${handles.length} products...`);

  // Fetch all images in parallel
  const results = await Promise.all(
    handles.map(handle => fetchProductImage(handle))
  );

  // Map handles to image URLs
  handles.forEach((handle, index) => {
    const imageUrl = results[index];
    if (imageUrl) {
      images.set(handle, imageUrl);
    }
  });

  console.log(`✅ Successfully fetched ${images.size}/${handles.length} images`);
  return images;
}

/**
 * Clear the image cache (useful for debugging)
 */
export function clearImageCache(): void {
  imageCache.clear();
  console.log('🗑️ Image cache cleared');
}
