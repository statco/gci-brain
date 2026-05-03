// src/services/geminiService.ts
// ✅ FULLY DYNAMIC VERSION - Fetches products from Shopify automatically
// 🔄 UPDATED: Now uses unified AI provider (Gemini → Deepseek fallback)

import type { TireProduct, Language } from '../types';
import { fetchProductsByTag } from './shopifyProductService';
import { generateAIContent } from './aiService'; // 👈 NEW unified provider

// ── No more direct GoogleGenerativeAI import needed here ──────
// The aiService handles all provider logic and fallbacks

// ✅ NO MORE MOCK_PRODUCTS!
// Products are now fetched from Shopify dynamically

/**
 * ✅ Fetch available tire products from Shopify
 */
async function getAvailableProducts(): Promise<TireProduct[]> {
  // OPTION 1: By Collection (RECOMMENDED)
  // return await fetchProducts('ai-match');
  
  // OPTION 2: By Tag
  return await fetchProductsByTag('ai-match');
  
  // OPTION 3: By Product Type
  // return await fetchProductsByType('Tires');
}

/**
 * Get tire recommendations using AI with automatic fallback
 * ✅ Gemini (primary) → Deepseek (backup) → Keyword fallback
 */
export async function getTireRecommendations(
  userRequest: string,
  language: Language = 'en',
  oemSizes?: string[]
): Promise<TireProduct[]> {
  console.log('🤖 Requesting AI recommendations...');
  console.log('   User request:', userRequest);
  if (oemSizes && oemSizes.length > 0) {
    console.log('   OEM sizes constraint:', oemSizes);
  }

  // ✅ Fetch products from Shopify
  const availableProducts = await getAvailableProducts();
  console.log('   Available products:', availableProducts.length);

  if (availableProducts.length === 0) {
    console.warn('⚠️ No products found in Shopify');
    return [];
  }

  // Prefer in-stock products; fall back to full catalog if in-stock is empty
  const inStockProducts = availableProducts.filter(p => p.inStock);
  const catalogProducts = inStockProducts.length > 0 ? inStockProducts : availableProducts;
  console.log('[debug] catalog size:', catalogProducts.length, '(in-stock:', inStockProducts.length, ')');

  // Normalise OEM sizes — strip suffixes like XL, C, RFT, BSW, OWL before matching
  const normSize = (s: string) => s.replace(/\s*(XL|C|RFT|BSW|OWL|ORWL|SL|RF|\+)$/i, '').trim();
  const normOemSizes = (oemSizes ?? []).map(normSize).filter(Boolean);

  // Build OEM constraint text (uses normalised sizes)
  const oemConstraint = normOemSizes.length > 0
    ? `\nIMPORTANT: Prioritise products whose size matches one of these OEM sizes: ${normOemSizes.join(', ')}. If you find matching sizes, prefer them. If none are available in the catalog, recommend the closest suitable alternatives and note that exact OEM size is unavailable.\n`
    : '';

  // Build the prompt
  const prompt = `You are a tire expert at GCI Tire in Canada. A customer needs tire recommendations.

Customer Request: "${userRequest}"
Language: ${language === 'fr' ? 'French' : 'English'}
${oemConstraint}
Available Tire Products:
${catalogProducts.map((p) => `ID: ${p.id} - ${p.brand} ${p.model} - ${p.size} (${p.season}) - $${p.pricePerUnit}`).join('\n')}

Based on the customer's request, recommend the 4-6 most suitable tires from the list above.

Return ONLY a valid JSON array with the tire IDs from the list, no other text:
["9187654321", "9187654322"]

Rules:
- Return only IDs shown in the "ID: XXX" format above
- Match the customer's needs (size, season, performance, budget)
- Return 4-6 recommendations
- Consider Canadian climate if winter/all-season is mentioned
- NO explanations, ONLY the JSON array`;

  const systemInstruction =
    'You are a professional tire expert for a Canadian retailer. Use professional, clear language. Always respond with valid JSON only.';

  try {
    // 🔄 Try AI providers in order: Gemini → Deepseek
    const aiResult = await generateAIContent({ prompt, systemInstruction });
    
    console.log(`📥 AI response [${aiResult.provider}/${aiResult.model}]:`, aiResult.text);

    // Parse the response
    const jsonMatch = aiResult.text.match(/\[[\s\S]*?\]/);
    if (!jsonMatch) {
      throw new Error('No JSON array found in response');
    }

    const recommendedIds = JSON.parse(jsonMatch[0]);

    // Validate it's an array
    if (!Array.isArray(recommendedIds)) {
      throw new Error('Response is not an array');
    }

    // Filter products based on recommendations
    const recommendations = catalogProducts.filter(p =>
      recommendedIds.includes(p.id)
    );

    console.log(`✅ AI recommendations: ${recommendations.length} (via ${aiResult.provider})`);

    // If no matches, return fallback
    if (recommendations.length === 0) {
      console.log('⚠️ No matching products, using keyword fallback');
      return getFallbackRecommendations(userRequest, catalogProducts, oemSizes);
    }

    return recommendations;

  } catch (error) {
    // All AI providers failed — use keyword fallback
    console.error('❌ All AI providers failed:', error);
    console.log('⚠️ Using keyword fallback recommendations');
    return getFallbackRecommendations(userRequest, catalogProducts, oemSizes);
  }
}

/**
 * Fallback recommendations when all AI providers fail.
 * Respects oemSizes when provided: filters candidates to exact-size matches first.
 * If no size-matched products exist, returns top 3 from the full list as a last resort.
 */
function getFallbackRecommendations(
  userRequest: string,
  products: TireProduct[],
  oemSizes?: string[]
): TireProduct[] {
  console.log('🔄 Generating keyword fallback recommendations...');

  const requestLower = userRequest.toLowerCase();

  // Narrow to OEM-size-matched products first when sizes are known
  let sizePool: TireProduct[];
  if (oemSizes && oemSizes.length > 0) {
    const oemSet = new Set(oemSizes);
    sizePool = products.filter(p => oemSet.has(p.size));
    console.log('[fallback] OEM-filtered pool size:', sizePool.length);
  } else {
    sizePool = products;
  }

  const exactFitmentAvailable = sizePool.length > 0;
  let filtered = [...(exactFitmentAvailable ? sizePool : products)];

  // Filter by season
  if (requestLower.includes('winter') || requestLower.includes('snow') || requestLower.includes('ice') || requestLower.includes('hiver')) {
    filtered = filtered.filter(p => p.season === 'Winter');
  } else if (requestLower.includes('summer') || requestLower.includes('performance') || requestLower.includes('sport') || requestLower.includes('été')) {
    filtered = filtered.filter(p => p.season === 'Summer');
  } else if (requestLower.includes('all-season') || requestLower.includes('all season') || requestLower.includes('toutes saisons')) {
    filtered = filtered.filter(p => p.season === 'All-Season');
  }

  // Filter by brand
  const brandMatch = requestLower.match(/michelin|bridgestone|goodyear|continental|pirelli|yokohama/);
  if (brandMatch) {
    filtered = filtered.filter(p => p.brand.toLowerCase().includes(brandMatch[0]));
  }

  // If season/brand filters wiped out the pool, fall back to size pool (or all products)
  if (filtered.length === 0) {
    filtered = exactFitmentAvailable ? sizePool : products;
  }

  if (!exactFitmentAvailable && oemSizes && oemSizes.length > 0) {
    console.warn('⚠️ [fallback] No products matched OEM sizes — returning top 3 without exact fitment');
  }

  const result = filtered.slice(0, 6);
  console.log('✅ Keyword fallback recommendations:', result.length);
  return result;
}

/**
 * Get available tire sizes from Shopify inventory
 */
export async function getAvailableSizes(): Promise<string[]> {
  const products = await getAvailableProducts();
  return [...new Set(products.map(p => p.size))];
}

/**
 * Get available brands from Shopify inventory
 */
export async function getAvailableBrands(): Promise<string[]> {
  const products = await getAvailableProducts();
  return [...new Set(products.map(p => p.brand))];
}

/**
 * Search tires by specific criteria
 * ✅ Now searches Shopify products dynamically
 */
export async function searchTires(criteria: {
  size?: string;
  season?: string;
  brand?: string;
  minPrice?: number;
  maxPrice?: number;
}): Promise<TireProduct[]> {
  const products = await getAvailableProducts();
  let results = [...products];

  if (criteria.size) {
    results = results.filter(p => p.size === criteria.size);
  }

  if (criteria.season) {
    results = results.filter(p => p.season === criteria.season);
  }

  if (criteria.brand) {
    results = results.filter(p => p.brand.toLowerCase() === criteria.brand.toLowerCase());
  }

  if (criteria.minPrice !== undefined) {
    results = results.filter(p => p.pricePerUnit >= criteria.minPrice!);
  }

  if (criteria.maxPrice !== undefined) {
    results = results.filter(p => p.pricePerUnit <= criteria.maxPrice!);
  }

  return results;
}
