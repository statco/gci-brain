// src/services/geminiService.ts
// ✅ FULLY DYNAMIC VERSION - Fetches products from Shopify automatically

import { GoogleGenerativeAI } from '@google/generative-ai';
import type { TireProduct, Language } from '../types';
import { fetchProductsByCollection, fetchProductsByTag, fetchProductsByType } from './shopifyProductService';

const API_KEY = import.meta.env.VITE_GEMINI_API_KEY || '';

if (!API_KEY) {
  console.warn('⚠️ VITE_GEMINI_API_KEY not set. Using fallback recommendations.');
}

const genAI = API_KEY ? new GoogleGenerativeAI(API_KEY) : null;

// ✅ NO MORE MOCK_PRODUCTS!
// Products are now fetched from Shopify dynamically

/**
 * ✅ Fetch available tire products from Shopify
 * Choose ONE of these methods:
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
 * Get tire recommendations using Gemini AI
 * ✅ Now uses dynamic Shopify products
 */
export async function getTireRecommendations(
  userRequest: string,
  language: Language = 'en',
  oemSizes?: string[]
): Promise<TireProduct[]> {
  console.log('🤖 Requesting Gemini AI recommendations...');
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

  // If no API key, return fallback immediately
  if (!genAI) {
    console.log('⚠️ No API key, using fallback');
    return getFallbackRecommendations(userRequest, availableProducts);
  }

  try {
    const model = genAI.getGenerativeModel({ 
      model: "gemini-2.5-flash",
      systemInstruction: "You are a professional tire expert for a Canadian retailer. Use professional, clear language.",
    });

    const oemConstraint = (oemSizes && oemSizes.length > 0)
      ? `\nIMPORTANT: This vehicle requires one of these OEM tire sizes: ${oemSizes.join(', ')}. Only recommend products from the catalog that match one of these exact sizes.\n`
      : '';

    const prompt = `You are a tire expert at GCI Tire in Canada. A customer needs tire recommendations.

Customer Request: "${userRequest}"
Language: ${language === 'fr' ? 'French' : 'English'}
${oemConstraint}
Available Tire Products:
${availableProducts.map((p) => `ID: ${p.id} - ${p.brand} ${p.model} - ${p.size} (${p.season}) - $${p.pricePerUnit}`).join('\n')}

Based on the customer's request, recommend the 2-4 most suitable tires from the list above.

Return ONLY a valid JSON array with the tire IDs from the list, no other text:
["9187654321", "9187654322"]

Rules:
- Return only IDs shown in the "ID: XXX" format above
- Match the customer's needs (size, season, performance, budget)
- Return 2-4 recommendations
- Consider Canadian climate if winter/all-season is mentioned
- NO explanations, ONLY the JSON array`;

    const result = await model.generateContent(prompt);
    const response = await result.response;
    const text = response.text();

    console.log('📥 Gemini response:', text);

    // Parse the response
    const jsonMatch = text.match(/\[[\s\S]*?\]/);
    if (!jsonMatch) {
      throw new Error('No JSON array found in response');
    }

    const recommendedIds = JSON.parse(jsonMatch[0]);
    
    // Validate it's an array
    if (!Array.isArray(recommendedIds)) {
      throw new Error('Response is not an array');
    }

    // Filter products based on recommendations
    const recommendations = availableProducts.filter(p => 
      recommendedIds.includes(p.id)
    );

    console.log('✅ Gemini recommendations:', recommendations.length);

    // If no matches, return fallback
    if (recommendations.length === 0) {
      console.log('⚠️ No matching products, using fallback');
      return getFallbackRecommendations(userRequest, availableProducts);
    }

    return recommendations;

  } catch (error) {
    console.error('❌ Error getting Gemini recommendations:', error);
    console.log('⚠️ Using fallback recommendations');
    return getFallbackRecommendations(userRequest, availableProducts);
  }
}

/**
 * Fallback recommendations when AI fails
 * ✅ Now works with dynamic product list
 */
function getFallbackRecommendations(userRequest: string, products: TireProduct[]): TireProduct[] {
  console.log('🔄 Generating fallback recommendations...');
  
  const requestLower = userRequest.toLowerCase();
  
  // Simple keyword matching
  let filtered = [...products];

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

  // If too many filtered out, return all
  if (filtered.length === 0) {
    console.log('⚠️ No matches found, returning all products');
    filtered = products;
  }

  // Return top 3
  const result = filtered.slice(0, 3);
  console.log('✅ Fallback recommendations:', result.length);
  
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
