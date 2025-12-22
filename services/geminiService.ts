// services/geminiService.ts
import { GoogleGenerativeAI } from '@google/generative-ai';
import type { TireProduct, Language } from '../types';

const API_KEY = import.meta.env.VITE_GEMINI_API_KEY || '';

if (!API_KEY) {
  console.warn('⚠️ VITE_GEMINI_API_KEY not set. Using fallback recommendations.');
}

const genAI = API_KEY ? new GoogleGenerativeAI(API_KEY) : null;

// Mock Shopify products (replace with actual Shopify API integration)
const MOCK_PRODUCTS: TireProduct[] = [
  {
    id: 'tire-1',
    title: 'Michelin Pilot Sport 4S',
    brand: 'Michelin',
    model: 'Pilot Sport 4S',
    size: '245/40R18',
    season: 'Summer',
    pricePerUnit: 289.99,
    rating: 4.8,
    reviews: 1247,
    imageUrl: 'https://images.unsplash.com/photo-1606220549583-c00db6f7cd00?w=400',
    description: 'Ultimate performance summer tire for sports cars',
    features: ['Exceptional dry grip', 'Responsive handling', 'Premium comfort'],
    inStock: true,
    warranty: '6-year limited',
    speedRating: 'Y',
    loadIndex: '97',
    shopifyVariantId: 'gid://shopify/ProductVariant/12345'
  },
  {
    id: 'tire-2',
    title: 'Bridgestone Blizzak WS90',
    brand: 'Bridgestone',
    model: 'Blizzak WS90',
    size: '225/65R17',
    season: 'Winter',
    pricePerUnit: 189.99,
    rating: 4.7,
    reviews: 892,
    imageUrl: 'https://images.unsplash.com/photo-1606220549583-c00db6f7cd00?w=400',
    description: 'Superior winter traction and ice grip',
    features: ['Excellent ice performance', 'Confident snow traction', 'Long tread life'],
    inStock: true,
    warranty: '5-year limited',
    speedRating: 'T',
    loadIndex: '106',
    shopifyVariantId: 'gid://shopify/ProductVariant/12346'
  },
  {
    id: 'tire-3',
    title: 'Goodyear Eagle F1 Asymmetric 5',
    brand: 'Goodyear',
    model: 'Eagle F1 Asymmetric 5',
    size: '235/45R18',
    season: 'Summer',
    pricePerUnit: 249.99,
    rating: 4.6,
    reviews: 654,
    imageUrl: 'https://images.unsplash.com/photo-1606220549583-c00db6f7cd00?w=400',
    description: 'High-performance touring tire',
    features: ['Enhanced wet grip', 'Shorter braking distance', 'Quiet ride'],
    inStock: true,
    warranty: '6-year limited',
    speedRating: 'Y',
    loadIndex: '95',
    shopifyVariantId: 'gid://shopify/ProductVariant/12347'
  },
  {
    id: 'tire-4',
    title: 'Continental AllSeasonContact',
    brand: 'Continental',
    model: 'AllSeasonContact',
    size: '215/55R17',
    season: 'All-Season',
    pricePerUnit: 169.99,
    rating: 4.5,
    reviews: 1089,
    imageUrl: 'https://images.unsplash.com/photo-1606220549583-c00db6f7cd00?w=400',
    description: 'Versatile all-season performance',
    features: ['Year-round capability', 'Fuel efficient', 'Long-lasting'],
    inStock: true,
    warranty: '6-year limited',
    speedRating: 'V',
    loadIndex: '94',
    shopifyVariantId: 'gid://shopify/ProductVariant/12348'
  }
];

/**
 * Get tire recommendations using Gemini AI
 */
export async function getTireRecommendations(
  userRequest: string,
  language: Language = 'en'
): Promise<TireProduct[]> {
  console.log('🤖 Requesting Gemini AI recommendations...');
  console.log('   User request:', userRequest);
  console.log('   Available products:', MOCK_PRODUCTS.length);

  // If no API key, return fallback immediately
  if (!genAI) {
    console.log('⚠️ No API key, using fallback');
    return getFallbackRecommendations(userRequest);
  }

  try {
    // ✅ CORRECT MODEL NAME (as of December 2024)
    const model = genAI.getGenerativeModel({ 
      model: 'gemini-1.5-flash-latest'  // Use -latest suffix
    });

    const prompt = `You are a tire expert at GCI Tire in Canada. A customer needs tire recommendations.

Customer Request: "${userRequest}"
Language: ${language === 'fr' ? 'French' : 'English'}

Available Tire Products:
${MOCK_PRODUCTS.map((p, i) => `${i + 1}. ${p.brand} ${p.model} - ${p.size} (${p.season}) - $${p.pricePerUnit}`).join('\n')}

Based on the customer's request, recommend the 2-4 most suitable tires from the list above.

Return ONLY a valid JSON array with the tire IDs, no other text:
["tire-1", "tire-3"]

Rules:
- Return only IDs from the available products above
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
    const recommendations = MOCK_PRODUCTS.filter(p => 
      recommendedIds.includes(p.id)
    );

    console.log('✅ Gemini recommendations:', recommendations.length);

    // If no matches, return fallback
    if (recommendations.length === 0) {
      console.log('⚠️ No matching products, using fallback');
      return getFallbackRecommendations(userRequest);
    }

    return recommendations;

  } catch (error) {
    console.error('❌ Error getting Gemini recommendations:', error);
    console.log('⚠️ Using fallback recommendations');
    return getFallbackRecommendations(userRequest);
  }
}

/**
 * Fallback recommendations when AI fails
 */
function getFallbackRecommendations(userRequest: string): TireProduct[] {
  console.log('🔄 Generating fallback recommendations...');
  
  const requestLower = userRequest.toLowerCase();
  
  // Simple keyword matching
  let filtered = [...MOCK_PRODUCTS];

  // Filter by season
  if (requestLower.includes('winter') || requestLower.includes('snow') || requestLower.includes('ice') || requestLower.includes('hiver')) {
    filtered = filtered.filter(p => p.season === 'Winter');
  } else if (requestLower.includes('summer') || requestLower.includes('performance') || requestLower.includes('sport') || requestLower.includes('été')) {
    filtered = filtered.filter(p => p.season === 'Summer');
  } else if (requestLower.includes('all-season') || requestLower.includes('all season') || requestLower.includes('toutes saisons')) {
    filtered = filtered.filter(p => p.season === 'All-Season');
  }

  // Filter by brand
  if (requestLower.includes('michelin')) {
    filtered = filtered.filter(p => p.brand.toLowerCase() === 'michelin');
  } else if (requestLower.includes('bridgestone')) {
    filtered = filtered.filter(p => p.brand.toLowerCase() === 'bridgestone');
  } else if (requestLower.includes('goodyear')) {
    filtered = filtered.filter(p => p.brand.toLowerCase() === 'goodyear');
  } else if (requestLower.includes('continental')) {
    filtered = filtered.filter(p => p.brand.toLowerCase() === 'continental');
  }

  // If too many filtered out, return all
  if (filtered.length === 0) {
    console.log('⚠️ No matches found, returning all products');
    filtered = MOCK_PRODUCTS;
  }

  // Return top 3
  const result = filtered.slice(0, 3);
  console.log('✅ Fallback recommendations:', result.length);
  
  return result;
}

/**
 * Get available tire sizes from inventory
 */
export function getAvailableSizes(): string[] {
  return [...new Set(MOCK_PRODUCTS.map(p => p.size))];
}

/**
 * Get available brands from inventory
 */
export function getAvailableBrands(): string[] {
  return [...new Set(MOCK_PRODUCTS.map(p => p.brand))];
}

/**
 * Search tires by specific criteria
 */
export function searchTires(criteria: {
  size?: string;
  season?: string;
  brand?: string;
  minPrice?: number;
  maxPrice?: number;
}): TireProduct[] {
  let results = [...MOCK_PRODUCTS];

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
