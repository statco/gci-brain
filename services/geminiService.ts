import { GoogleGenAI } from "@google/genai";
import { TireProduct, Review, Language, VehicleInfo, Installer } from "../types";
import { fetchShopifyInventory, verifyVehicleFitment } from "./integrationService";

const generateReviews = (count: number): Review[] => {
  const users = ["Mike D.", "Sarah L.", "John T.", "Emily R.", "David W.", "Jessica M."];
  const comments = [
    "Great traction in the rain, highly recommend.",
    "A bit noisy on the highway but excellent grip.",
    "Best tires I've owned for winter driving.",
    "Good value for the price.",
    "Improved my fuel economy slightly.",
    "Solid performance in both dry and wet conditions."
  ];
  
  return Array.from({ length: count }, (_, i) => ({
    id: `rev-${Math.random().toString(36).substr(2, 9)}`,
    user: users[i % users.length],
    rating: 4 + Math.random(),
    comment: comments[i % comments.length],
    date: new Date(Date.now() - Math.floor(Math.random() * 10000000000)).toLocaleDateString()
  }));
};

export const findLocalInstallersWithMaps = async (lat?: number, lng?: number): Promise<Installer[]> => {
  try {
    const apiKey = import.meta.env.VITE_GEMINI_API_KEY;
    if (!apiKey) {
      console.error('❌ Missing VITE_GEMINI_API_KEY');
      return [];
    }

    const ai = new GoogleGenAI({ apiKey });
    
    const config: any = {
      tools: [{ googleMaps: {} }],
    };

    if (lat && lng) {
      config.toolConfig = {
        retrievalConfig: {
          latLng: {
            latitude: lat,
            longitude: lng
          }
        }
      };
    }

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: "Find 3 highly rated tire installation shops or garages near my current location. Return their names, addresses, and ratings.",
      config,
    });

    const installers: Installer[] = [];
    const groundingChunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks || [];

    groundingChunks.forEach((chunk: any, index: number) => {
      if (chunk.maps) {
        installers.push({
          id: `maps-inst-${index}`,
          name: chunk.maps.title || "Local Tire Shop",
          address: "Address available on Maps",
          distance: "Nearby",
          rating: 4.5,
          url: chunk.maps.uri,
          mapPosition: {
            top: 20 + (index * 20),
            left: 30 + (index * 15)
          }
        });
      }
    });

    if (installers.length === 0) {
      console.warn("⚠️ No specific grounding chunks found");
      return [];
    }

    return installers;
  } catch (e) {
    console.error("❌ Maps Grounding failed", e);
    return [];
  }
};

const generateTireVisualization = async (vehicleDesc: string, tireName: string): Promise<string | null> => {
  if (!tireName || tireName.length < 3 || tireName.includes("Unknown")) {
      return null;
  }

  try {
    const apiKey = import.meta.env.VITE_GEMINI_API_KEY;
    if (!apiKey) return null;

    const ai = new GoogleGenAI({ apiKey });
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash-image',
      contents: {
        parts: [{ 
            text: `A professional studio product photography shot of a ${tireName} tire isolated on a pure white background. The image must clearly showcase the specific rugged tread pattern and sidewall design of this model. High resolution, sharp focus, commercial advertisement style, 4k, no vehicle, no shadows, pure white background.` 
        }],
      },
    });

    for (const part of response.candidates[0].content.parts) {
      if (part.inlineData) {
        return `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`;
      }
    }
    return null;
  } catch (e) {
    console.warn("⚠️ Failed to generate tire visualization", e);
    return null;
  }
};

const findRealProductImage = async (brand: string, model: string): Promise<string | null> => {
  if (!brand || !model || brand === "Generic" || model === "Tire") return null;

  try {
    const apiKey = import.meta.env.VITE_GEMINI_API_KEY;
    if (!apiKey) return null;

    const ai = new GoogleGenAI({ apiKey });
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: `Find a direct, public image URL for the ${brand} ${model} tire (tread pattern view). 
      The URL must directly point to an image file (ending in .jpg, .png, or .webp).
      Return ONLY the URL string.`,
      config: {
        tools: [{ googleSearch: {} }]
      }
    });

    const text = response.text || "";
    const urlRegex = /(https?:\/\/[^\s"']+\.(?:jpg|jpeg|png|webp))/i;
    const match = text.match(urlRegex);
    
    if (match) return match[0];
    return null;
  } catch (e) {
    console.warn("⚠️ Failed to find real product image", e);
    return null;
  }
};

const enrichWithInventoryData = (aiSuggestedTires: (Partial<TireProduct> & { generatedImage?: string, realFoundImage?: string })[], realInventory: Partial<TireProduct>[]): TireProduct[] => {
  console.log('📦 AI Suggestions:', aiSuggestedTires.length);
  console.log('🏪 Inventory:', realInventory.length);

  if (!realInventory || realInventory.length === 0) {
    console.warn('⚠️ No inventory available, using fallback');
    realInventory = [{ 
      id: "fallback-safe", 
      brand: "Generic", 
      model: "Tire", 
      pricePerUnit: 100, 
      features: ["Standard"], 
      tier: "Good" 
    }];
  }

  return aiSuggestedTires.map((aiTire, index) => {
    const aiBrand = (aiTire.brand || "").toLowerCase().trim();
    const aiModel = (aiTire.model || "").toLowerCase().trim();

    console.log(`🔍 Matching AI tire: ${aiBrand} ${aiModel}`);

    let bestMatch: Partial<TireProduct> | null = null;
    let highestScore = 0;

    for (const inv of realInventory) {
        let score = 0;
        const invBrand = (inv.brand || "").toLowerCase().trim();
        const invModel = (inv.model || "").toLowerCase().trim();

        // Exact match
        if (invBrand === aiBrand) score += 40;
        if (invModel === aiModel) score += 40;
        
        // Partial match (contains)
        if (invBrand.includes(aiBrand) || aiBrand.includes(invBrand)) score += 20;
        if (invModel.includes(aiModel) || aiModel.includes(invModel)) score += 20;
        
        // Fuzzy match - check if words overlap
        const aiBrandWords = aiBrand.split(/\s+/);
        const invBrandWords = invBrand.split(/\s+/);
        const brandWordOverlap = aiBrandWords.filter(w => invBrandWords.includes(w)).length;
        score += brandWordOverlap * 10;
        
        console.log(`  📊 Score for ${invBrand} ${invModel}: ${score}`);
        
        if (score > highestScore) {
            highestScore = score;
            bestMatch = inv;
        }
    }

    // If no good match, just use the first available inventory item
    let match = bestMatch || realInventory[0];
    
    console.log(`✅ Best match (score ${highestScore}):`, match?.brand, match?.model);
    
    let productImageUrl = match.imageUrl;
    const isGenericOrMissing = !productImageUrl || productImageUrl.includes("unsplash");
    
    if (isGenericOrMissing) {
        if (aiTire.realFoundImage) productImageUrl = aiTire.realFoundImage;
        else if (aiTire.generatedImage) productImageUrl = aiTire.generatedImage;
    }

    return {
      id: match.id || `tire-${index}-${Date.now()}`,
      variantId: match.variantId,
      brand: match.brand || aiTire.brand || "Unknown",
      model: match.model || aiTire.model || "Unknown",
      type: match.type || "All-Season",
      description: match.description || aiTire.description || "High-performance tire for all conditions",
      pricePerUnit: match.pricePerUnit || 210.00,
      installationFeePerUnit: 25,
      imageUrl: productImageUrl || "https://images.unsplash.com/photo-1578844251758-2f71da645217?auto=format&fit=crop&w=400&q=80",
      visualizationUrl: aiTire.generatedImage || undefined,
      features: [...(match.features || []), ...(aiTire.features || [])].slice(0, 4),
      matchScore: aiTire.matchScore || (95 - index * 5),
      fitmentVerified: true, 
      inStock: true,
      tier: (match.tier || "Good") as any,
      averageRating: 4.5,
      reviewCount: 45,
      reviews: generateReviews(3),
      fitmentSpecs: {
        loadIndex: "110",
        speedRating: "T",
        warranty: "50,000 Miles",
        oemMatch: true
      },
      has3PMSF: match.has3PMSF || false
    };
  });
};

export const getTireRecommendations = async (userRequest: string, lang: Language): Promise<TireProduct[]> => {
  console.log('🚀 Starting tire recommendations for:', userRequest);

  const apiKey = import.meta.env.VITE_GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('Missing VITE_GEMINI_API_KEY environment variable');
  }

  const inventory = await fetchShopifyInventory();
  console.log('🏪 Fetched inventory:', inventory.length, 'products');
  
  // If no inventory, return empty to show "no tires found" message
  if (inventory.length === 0) {
    console.warn('⚠️ No inventory available');
    return [];
  }

  let vehicleInfo: VehicleInfo = { detected: false, year: '', make: '', model: '' };
  try {
      vehicleInfo = await verifyVehicleFitment(userRequest);
      console.log('🚗 Vehicle info:', vehicleInfo);
  } catch (e) {
      console.warn('⚠️ Vehicle fitment check failed:', e);
  }

  const fallbackVehicleDesc = vehicleInfo.detected 
    ? `${vehicleInfo.year} ${vehicleInfo.make} ${vehicleInfo.model}` 
    : "Vehicle";

  try {
    const ai = new GoogleGenAI({ apiKey });
    
    const inventorySimplified = inventory.map(i => ({
      brand: i.brand, 
      model: i.model,
      type: i.type
    }));

    console.log('🤖 Calling Gemini API...');
    
    const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: `You are a tire expert. Based on the user request: "${userRequest}", recommend tires from this inventory: ${JSON.stringify(inventorySimplified)}.
        
Return a JSON object with this exact structure:
{
  "recommendations": [
    {
      "brand": "exact brand from inventory",
      "model": "exact model from inventory", 
      "matchScore": 95,
      "description": "why this tire is good for the request"
    }
  ]
}

Rules:
- Return 1-3 tires maximum
- Use EXACT brand and model names from the inventory
- Match score should be 85-95
- Description should be concise (1-2 sentences)`,
        config: { 
          responseMimeType: 'application/json',
          temperature: 0.3
        }
    });

    console.log('✅ Gemini response received');
    const responseText = response.text || "{}";
    console.log('📄 Raw response:', responseText);

    const parsed = JSON.parse(responseText);
    const recs = parsed.recommendations || [];
    
    console.log('📋 Parsed recommendations:', recs.length);

    if (recs.length === 0) {
      console.warn('⚠️ No recommendations from AI, returning all inventory');
      // Fallback: return all inventory items
      return enrichWithInventoryData(
        inventory.slice(0, 3).map(inv => ({
          brand: inv.brand,
          model: inv.model,
          matchScore: 90,
          description: "Available in stock"
        })),
        inventory
      );
    }

    const suggestionsWithImages = await Promise.all(recs.map(async (suggestion: any) => {
        const tireName = `${suggestion.brand} ${suggestion.model}`;
        console.log('🎨 Generating images for:', tireName);
        
        const [genResult, realResult] = await Promise.all([
            generateTireVisualization(fallbackVehicleDesc, tireName),
            findRealProductImage(suggestion.brand, suggestion.model)
        ]);
        
        return { ...suggestion, generatedImage: genResult, realFoundImage: realResult };
    }));

    const finalResults = enrichWithInventoryData(suggestionsWithImages, inventory);
    console.log('✅ Final results:', finalResults.length);
    
    return finalResults;

  } catch (error) {
    console.error('❌ Gemini API error:', error);
    
    // Fallback: return inventory items if AI fails
    console.log('⚠️ Falling back to direct inventory');
    return enrichWithInventoryData(
      inventory.slice(0, 3).map(inv => ({
        brand: inv.brand,
        model: inv.model,
        matchScore: 85,
        description: "Available in stock"
      })),
      inventory
    );
  }
};
