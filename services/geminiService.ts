import { GoogleGenerativeAI } from '@google/generative-ai';

// Access environment variables properly
const GEMINI_API_KEY = import.meta.env.VITE_GEMINI_API_KEY as string;
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);

export interface TireRecommendation {
  brand: string;
  model: string;
  size: string;
  season: string;
  priceRange: string;
  matchScore: number;
  reason: string;
  features: string[];
}

/**
 * Extract JSON from Gemini response (handles markdown code blocks)
 */
function extractJSON(text: string): string {
  let cleaned = text.trim();
  
  // Remove markdown code blocks
  cleaned = cleaned.replace(/```json\s*/g, '');
  cleaned = cleaned.replace(/```\s*/g, '');
  
  // Find JSON array or object
  const jsonMatch = cleaned.match(/\[[\s\S]*\]|\{[\s\S]*\}/);
  if (jsonMatch) {
    return jsonMatch[0];
  }
  
  return cleaned;
}

/**
 * Robust JSON parser with fallback
 */
function parseGeminiJSON(text: string): any[] {
  try {
    const json = JSON.parse(text);
    return Array.isArray(json) ? json : [json];
  } catch (e) {
    console.warn('⚠️ Direct JSON parse failed, trying extraction...');
    
    try {
      const extracted = extractJSON(text);
      const json = JSON.parse(extracted);
      return Array.isArray(json) ? json : [json];
    } catch (e2) {
      console.error('❌ JSON extraction failed:', e2);
      console.error('Raw text:', text);
      
      // Try to fix common JSON errors
      try {
        let fixed = text
          .replace(/```json/g, '')
          .replace(/```/g, '')
          .replace(/,(\s*[}\]])/g, '$1')
          .replace(/(['"])?([a-zA-Z0-9_]+)(['"])?:/g, '"$2":')
          .trim();
        
        const json = JSON.parse(fixed);
        console.log('✅ Fixed JSON successfully');
        return Array.isArray(json) ? json : [json];
      } catch (e3) {
        console.error('❌ All JSON parsing attempts failed');
        throw new Error('Failed to parse Gemini response as JSON.');
      }
    }
  }
}

export async function getTireRecommendations(
  userRequest: string,
  availableProducts: any[]
): Promise<TireRecommendation[]> {
  try {
    console.log('🤖 Requesting Gemini AI recommendations...');
    console.log('   User request:', userRequest);
    console.log('   Available products:', availableProducts.length);

    const model = genAI.getGenerativeModel({ model: 'gemini-pro' });

    const inventoryContext = availableProducts.map(p => 
      `${p.vendor} ${p.title} - ${p.tags.join(', ')}`
    ).join('\n');

    const prompt = `You are a tire expert. Based on this customer request and available inventory, recommend the best tires.

Customer Request: "${userRequest}"

Available Inventory:
${inventoryContext}

Instructions:
1. Analyze the customer's needs (vehicle type, season, driving conditions)
2. Match with available products in inventory
3. Recommend 2-4 best options
4. Provide match scores (0-100)
5. Explain why each tire is recommended

Respond with VALID JSON ONLY (no markdown, no explanations):
[
  {
    "brand": "Michelin",
    "model": "X-Ice Snow",
    "size": "235/65R17",
    "season": "winter",
    "priceRange": "$$",
    "matchScore": 95,
    "reason": "Excellent winter traction with 3PMSF certification",
    "features": ["3PMSF", "Studless", "Quiet ride"]
  }
]

Return ONLY the JSON array, nothing else.`;

    const result = await model.generateContent(prompt);
    const response = await result.response;
    const text = response.text();

    console.log('📥 Gemini response received');
    console.log('   Length:', text.length, 'characters');
    console.log('   Preview:', text.substring(0, 100) + '...');

    const recommendations = parseGeminiJSON(text);

    console.log(`✅ Parsed ${recommendations.length} recommendations`);
    
    const validRecommendations = recommendations
      .filter(rec => rec.brand && rec.model)
      .map(rec => ({
        brand: rec.brand || 'Unknown',
        model: rec.model || 'Unknown',
        size: rec.size || 'Standard',
        season: rec.season || 'all-season',
        priceRange: rec.priceRange || '$$',
        matchScore: rec.matchScore || 0.75,
        reason: rec.reason || 'Recommended based on your needs',
        features: Array.isArray(rec.features) ? rec.features : []
      }));

    if (validRecommendations.length === 0) {
      console.warn('⚠️ No valid recommendations parsed, using fallback');
      return getFallbackRecommendations(availableProducts);
    }

    console.log('✅ Returning', validRecommendations.length, 'valid recommendations');
    return validRecommendations;

  } catch (error) {
    console.error('❌ Error getting Gemini recommendations:', error);
    console.log('⚠️ Using fallback recommendations');
    return getFallbackRecommendations(availableProducts);
  }
}

function getFallbackRecommendations(products: any[]): TireRecommendation[] {
  console.log('🔄 Generating fallback recommendations...');
  
  if (products.length === 0) {
    return [];
  }

  const winterTires = products.filter(p => 
    p.tags.some((t: string) => t.toLowerCase().includes('winter'))
  );
  
  const allSeasonTires = products.filter(p => 
    p.tags.some((t: string) => t.toLowerCase().includes('all-season'))
  );

  const recommendedProducts = [
    ...winterTires.slice(0, 2),
    ...allSeasonTires.slice(0, 2)
  ].slice(0, 4);

  return recommendedProducts.map((p, index) => ({
    brand: p.vendor || 'Unknown',
    model: p.title || 'Unknown',
    size: 'Standard',
    season: p.tags.some((t: string) => t.toLowerCase().includes('winter')) ? 'winter' : 'all-season',
    priceRange: p.price > 200 ? '$$$' : '$$',
    matchScore: 75 - (index * 10),
    reason: 'Available in inventory and matches your needs',
    features: p.tags || []
  }));
}

export function generateRecommendationSummary(
  recommendations: TireRecommendation[],
  userRequest: string
): string {
  if (recommendations.length === 0) {
    return 'No suitable tires found in inventory.';
  }

  const topMatch = recommendations[0];
  return `Based on your request, we recommend ${topMatch.brand} ${topMatch.model} as the best match. ${topMatch.reason}`;
}
