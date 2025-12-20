import { fetchShopifyProducts, ShopifyProduct } from './shopifyService';
import { TireProduct } from '../types';

export async function matchTiresWithInventory(
  geminiResults: any[],
  userRequest: string
): Promise<TireProduct[]> {
  try {
    // Fetch REAL products from Shopify
    const shopifyProducts = await fetchShopifyProducts();
    
    console.log('🔍 Matching Gemini results with Shopify inventory...');
    console.log(`   Gemini results: ${geminiResults.length}`);
    console.log(`   Shopify products: ${shopifyProducts.length}`);

    const matches: TireProduct[] = [];

    for (const geminiTire of geminiResults) {
      // Match by brand and model
      const shopifyMatch = shopifyProducts.find(sp => 
        sp.vendor.toLowerCase() === geminiTire.brand?.toLowerCase() &&
        sp.title.toLowerCase().includes(geminiTire.model?.toLowerCase())
      );

      if (shopifyMatch && shopifyMatch.availableForSale) {
        const tireProduct: TireProduct = {
          id: shopifyMatch.id,
          variantId: shopifyMatch.variantId, // REAL variant ID from Shopify
          brand: shopifyMatch.vendor,
          model: shopifyMatch.title,
          type: geminiTire.size || 'Standard',
          pricePerUnit: shopifyMatch.price,
          installationFeePerUnit: 25.0,
          imageUrl: shopifyMatch.imageUrl,
          matchScore: geminiTire.matchScore || 0.85,
          reason: geminiTire.reason || 'Available in inventory',
          features: shopifyMatch.tags || [],
          inStock: shopifyMatch.quantityAvailable > 0,
          quantityAvailable: shopifyMatch.quantityAvailable,
        };

        console.log(`✅ Matched: ${tireProduct.brand} ${tireProduct.model}`);
        console.log(`   Using variant ID: ${tireProduct.variantId}`);

        matches.push(tireProduct);
      } else {
        console.warn(`⚠️ No Shopify match for: ${geminiTire.brand} ${geminiTire.model}`);
      }
    }

    console.log(`✅ Found ${matches.length} matches with real variant IDs`);
    return matches;

  } catch (error) {
    console.error('❌ Error in matchTiresWithInventory:', error);
    return [];
  }
}
