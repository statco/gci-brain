// src/services/geminiService.ts
// FULLY DYNAMIC VERSION - Fetches products from Canada Tire API with Shopify fallback

import { GoogleGenerativeAI } from '@google/generative-ai';
import type { TireProduct, Language } from '../types';
import { fetchProductsByTag } from './shopifyProductService';

const API_KEY = import.meta.env.VITE_GEMINI_API_KEY || '';

if (!API_KEY) {
  console.warn('VITE_GEMINI_API_KEY not set. Using fallback recommendations.');
}

const genAI = API_KEY ? new GoogleGenerativeAI(API_KEY) : null;

// ─── EXTRACT SEARCH HINTS FROM USER REQUEST ──────────────────────────────────

interface SearchHints {
  brand?: string;
  isWinter?: boolean;
  width?: number;
  aspectRatio?: number;
  rimSize?: number;
}

function extractSearchHints(request: string): SearchHints {
  const lower = request.toLowerCase();
  const hints: SearchHints = {};

  // Brand detection
  const brandMap: Record<string, string> = {
    'michelin': 'MICHELIN', 'bridgestone': 'BRIDGESTONE', 'goodyear': 'GOODYEAR',
    'continental': 'CONTINENTAL', 'pirelli': 'PIRELLI', 'yokohama': 'YOKOHAMA',
    'hankook': 'HANKOOK', 'dunlop': 'DUNLOP', 'vredestein': 'VREDESTEIN',
    'nokian': 'NOKIAN', 'toyo': 'TOYO', 'firestone': 'FIRESTONE',
    'bfgoodrich': 'BFGOODRICH', 'cooper': 'COOPER', 'kumho': 'KUMHO',
    'nexen': 'NEXEN', 'general': 'GENERAL', 'falken': 'FALKEN',
    'nitto': 'NITTO', 'maxxis': 'MAXXIS', 'gislaved': 'GISLAVED',
    'uniroyal': 'UNIROYAL', 'gt radial': 'GT RADIAL', 'sailun': 'SAILUN',
    'hercules': 'HERCULES', 'motomaster': 'MOTOMASTER', 'nordic': 'NORDIC',
    'zeetex': 'ZEETEX', 'ironman': 'IRONMAN', 'starfire': 'STARFIRE',
  };
  for (const [key, value] of Object.entries(brandMap)) {
    if (lower.includes(key)) {
      hints.brand = value;
      break;
    }
  }

  // Season detection
  if (lower.includes('winter') || lower.includes('snow') || lower.includes('ice') || lower.includes('hiver') || lower.includes('neige')) {
    hints.isWinter = true;
  } else if (lower.includes('all-season') || lower.includes('all season') || lower.includes('toutes saisons') || lower.includes('summer') || lower.includes('ete')) {
    hints.isWinter = false;
  }

  // Size detection: patterns like 265/60R18, 265/60/18, 265 60 18
  const sizeMatch = lower.match(/(\d{3})\s*[\/\\]\s*(\d{2})\s*[rR\/\\]?\s*(\d{2})/);
  if (sizeMatch) {
    hints.width = parseInt(sizeMatch[1]);
    hints.aspectRatio = parseInt(sizeMatch[2]);
    hints.rimSize = parseInt(sizeMatch[3]);
  }

  return hints;
}

// ─── FETCH PRODUCTS FROM CANADA TIRE API ──────────────────────────────────────

async function fetchFromCanadaTireAPI(hints: SearchHints): Promise<TireProduct[]> {
  const body: Record<string, unknown> = {
    filters: {
      brand: hints.brand || '',
      isWinter: hints.isWinter !== undefined ? hints.isWinter : '',
      width: hints.width || '',
      aspectRatio: hints.aspectRatio || '',
      rimSize: hints.rimSize || '',
      isTire: true,
      isWheel: false,
      page: 1,
    },
  };

  const res = await fetch('/api/canadaTire?action=ai-match-products', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    throw new Error(`CT API returned HTTP ${res.status}`);
  }

  const data = await res.json();
  if (!data.success) {
    throw new Error(data.error?.errorMsg || 'CT API error');
  }

  return (data.data || []) as TireProduct[];
}

// ─── GET AVAILABLE PRODUCTS (CT primary, Shopify fallback) ────────────────────

async function getAvailableProducts(userRequest?: string): Promise<TireProduct[]> {
  const hints = userRequest ? extractSearchHints(userRequest) : {};

  try {
    console.log('Fetching products from Canada Tire API...', hints);
    const ctProducts = await fetchFromCanadaTireAPI(hints);

    if (ctProducts.length > 0) {
      console.log(`Got ${ctProducts.length} products from Canada Tire API`);
      // Prioritize: in-stock first, brand match first, limit to 50 for Gemini token budget
      const sorted = ctProducts.sort((a, b) => {
        const aInStock = a.inStock ? 1 : 0;
        const bInStock = b.inStock ? 1 : 0;
        if (aInStock !== bInStock) return bInStock - aInStock;
        // Brand match gets priority
        if (hints.brand) {
          const aMatch = a.brand?.toUpperCase() === hints.brand ? 1 : 0;
          const bMatch = b.brand?.toUpperCase() === hints.brand ? 1 : 0;
          if (aMatch !== bMatch) return bMatch - aMatch;
        }
        return 0;
      });
      return sorted.slice(0, 50);
    }
  } catch (err) {
    console.warn('Canada Tire API fetch failed, falling back to Shopify:', err);
  }

  // Fallback to Shopify (which now has synced CT products)
  console.log('Falling back to Shopify product fetch...');
  return await fetchProductsByTag('ai-match');
}

/**
 * Get tire recommendations using Gemini AI
 * ✅ Now uses dynamic Shopify products
 */
export async function getTireRecommendations(
  userRequest: string,
  language: Language = 'en'
): Promise<TireProduct[]> {
  console.log('Requesting Gemini AI recommendations...');
  console.log('   User request:', userRequest);

  // Fetch products from Canada Tire API (with Shopify fallback)
  const availableProducts = await getAvailableProducts(userRequest);
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
      model: "gemini-2.0-flash",
      systemInstruction: "You are a professional tire expert for a Canadian retailer. Use professional, clear language.",
    });

   const prompt = `You are a tire expert at GCI Tire in Canada. A customer needs tire recommendations.

Customer Request: "${userRequest}"
Language: ${language === 'fr' ? 'French' : 'English'}

Available Tire Products:
${availableProducts.map((p, i) => `ID: ${p.id} - ${p.brand} ${p.model} - ${p.size} (${p.season}) - $${p.pricePerUnit}`).join('\n')}

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
  const brandMatch = requestLower.match(/michelin|bridgestone|goodyear|continental|pirelli|yokohama|hankook|dunlop|vredestein|nokian|toyo|firestone|bfgoodrich|cooper|kumho|nexen|general|falken|nitto|maxxis|gislaved|uniroyal|gt radial|sailun|hercules|motomaster|nordic|zeetex|ironman|starfire/);
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
 * Get available tire sizes from inventory
 */
export async function getAvailableSizes(): Promise<string[]> {
  const products = await getAvailableProducts();
  return [...new Set(products.map(p => p.size))];
}

/**
 * Get available brands from inventory
 */
export async function getAvailableBrands(): Promise<string[]> {
  const products = await getAvailableProducts();
  return [...new Set(products.map(p => p.brand))];
}

/**
 * Search tires by specific criteria
 * Searches Canada Tire API with Shopify fallback
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
