import { fetchShopifyProducts } from './shopifyService';
import { getTireRecommendations } from './geminiService';
import { TireProduct, TireRecommendation } from '../types';

export async function searchTires(userRequest: string): Promise<TireProduct[]> {
  try {
    console.log('🔄 Starting tire search...', userRequest);

    // Fetch available products from Shopify
    const shopifyProducts = await fetchShopifyProducts();
    console.log(`✅ Fetched ${shopifyProducts.length} products from Shopify`);

    // Get AI recommendations
    const geminiRecommendations = await getTireRecommendations(userRequest, shopifyProducts);
    console.log(`✅ Got ${geminiRecommendations.length} AI recommendations`);

    // Match recommendations with inventory
    const matches = matchRecommendationsWithInventory(geminiRecommendations, shopifyProducts);
    console.log(`✅ Matched ${matches.length} products`);

    return matches;
  } catch (error) {
    console.error('❌ Error in searchTires:', error);
    throw error;
  }
}

function matchRecommendationsWithInventory(
  recommendations: TireRecommendation[],
  shopifyProducts: any[]
): TireProduct[] {
  const matches: TireProduct[] = [];

  for (const rec of recommendations) {
    const shopifyMatch = shopifyProducts.find(
      (p) =>
        p.vendor.toLowerCase() === rec.brand.toLowerCase() &&
        p.title.toLowerCase().includes(rec.model.toLowerCase())
    );

    if (shopifyMatch && shopifyMatch.availableForSale) {
      const tireProduct: TireProduct = {
        id: shopifyMatch.id,
        variantId: shopifyMatch.variantId,
        brand: shopifyMatch.vendor,
        model: shopifyMatch.title,
        type: rec.size,
        description: shopifyMatch.description || rec.reason,
        pricePerUnit: shopifyMatch.price,
        installationFeePerUnit: 25.0,
        imageUrl: shopifyMatch.imageUrl,
        matchScore: rec.matchScore,
        features: rec.features,
        inStock: shopifyMatch.quantityAvailable > 0,
        quantityAvailable: shopifyMatch.quantityAvailable,
      };

      matches.push(tireProduct);
    }
  }

  return matches;
}
