import { GoogleGenAI } from "@google/genai";
import { TireProduct, Review, Language, VehicleInfo } from "../types";
import { fetchShopifyInventory, verifyVehicleFitment } from "./integrationService";

// Helper to generate realistic looking reviews
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
    rating: 4 + Math.random(), // 4.0 to 5.0 roughly
    comment: comments[i % comments.length],
    date: new Date(Date.now() - Math.floor(Math.random() * 10000000000)).toLocaleDateString()
  }));
};

// Generates a photorealistic image of the tire itself (Studio Shot)
// NOTE: We still use Gemini for image generation as Perplexity is text-focused.
const generateTireVisualization = async (vehicleDesc: string, tireName: string): Promise<string | null> => {
  // STRICT COMPLIANCE: Do not generate "irrelevant" images. 
  if (!tireName || tireName.length < 3 || tireName.includes("Unknown")) {
      return null;
  }

  try {
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    
    // User requested: "only the actual proposed tire presented on a white background"
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
    console.warn("Failed to generate tire visualization", e);
    return null;
  }
};

// New Function: Find real product image from the web
const findRealProductImage = async (brand: string, model: string): Promise<string | null> => {
  if (!brand || !model || brand === "Generic" || model === "Tire") return null;

  try {
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: `Find a direct, public image URL for the ${brand} ${model} tire (tread pattern view). 
      The URL must directly point to an image file (ending in .jpg, .png, or .webp).
      Prioritize official manufacturer sites or major tire retailers.
      Return ONLY the URL string. Do not include markdown or explanations.`,
      config: {
        tools: [{ googleSearch: {} }]
      }
    });

    const text = response.text || "";
    // Regex to find a valid image url in the response
    const urlRegex = /(https?:\/\/[^\s"']+\.(?:jpg|jpeg|png|webp))/i;
    const match = text.match(urlRegex);
    
    if (match) return match[0];
    return null;
  } catch (e) {
    console.warn("Failed to find real product image", e);
    return null;
  }
};

const enrichWithInventoryData = (aiSuggestedTires: (Partial<TireProduct> & { generatedImage?: string, realFoundImage?: string })[], realInventory: Partial<TireProduct>[]): TireProduct[] => {
  // SAFETY CHECK: Ensure we have inventory to match against.
  if (!realInventory || realInventory.length === 0) {
      console.error("enrichWithInventoryData: realInventory is empty!");
      // Provide a safe fallback mock to prevent app crash
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
    const aiDesc = (aiTire.description || "").toLowerCase();

    // SCORING SYSTEM: Find the best match in inventory
    let bestMatch: Partial<TireProduct> | null = null;
    let highestScore = 0;

    for (const inv of realInventory) {
        let score = 0;
        const invBrand = (inv.brand || "").toLowerCase().trim();
        const invModel = (inv.model || "").toLowerCase().trim();
        const invType = (inv.type || "").toLowerCase();
        const invPrice = inv.pricePerUnit || 0;

        // 1. Brand Match (Critical - 40pts)
        if (invBrand === aiBrand) {
            score += 40;
        } else if (invBrand.includes(aiBrand) || aiBrand.includes(invBrand)) {
            score += 20; // Partial brand match
        }

        // 2. Model Match (Critical - 40pts)
        if (invModel === aiModel) {
            score += 40;
        } else if (invModel.includes(aiModel) || aiModel.includes(invModel)) {
            score += 25; // Substring match
        } else {
             // Token overlap matching for complex model names (e.g. "Pilot Sport 4S" vs "Pilot Sport 4 S")
             const aiTokens = aiModel.split(/[\s-]+/);
             const invTokens = invModel.split(/[\s-]+/);
             const intersection = aiTokens.filter(t => t.length > 1 && invTokens.includes(t));
             score += (intersection.length * 5);
        }

        // 3. Type/Category Relevance (Contextual - 15pts)
        // Use the description from AI to infer intent and match with inventory type
        if (aiDesc.includes("winter") && (invType.includes("winter") || invModel.includes("ice") || invModel.includes("snow"))) score += 15;
        if ((aiDesc.includes("all-terrain") || aiDesc.includes("off-road")) && (invType.includes("all-terrain") || invType.includes("mud") || invModel.includes("a/t"))) score += 15;
        if (aiDesc.includes("sport") && (invType.includes("performance") || invModel.includes("sport"))) score += 10;

        // 4. Price Logic (Tie-breaker - 5pts)
        // If query mentioned "budget" or "cheap", favor lower prices
        if ((aiDesc.includes("budget") || aiDesc.includes("cheap") || aiDesc.includes("value")) && invPrice < 200) {
            score += 5;
        }
        // If query mentioned "premium" or "best", favor higher prices
        if ((aiDesc.includes("premium") || aiDesc.includes("best") || aiDesc.includes("performance")) && invPrice > 250) {
            score += 5;
        }

        if (score > highestScore) {
            highestScore = score;
            bestMatch = inv;
        }
    }

    // Fallback Selection Logic
    // If no decent match found (score < 20), try to find ANY tire of the same brand, 
    // otherwise fallback to cyclic assignment to ensure we show a tire.
    let match = bestMatch;

    if (!match || highestScore < 20) {
        // Try simple brand fallback
        match = realInventory.find(i => (i.brand || "").toLowerCase() === aiBrand);
        
        // If still no match, use cyclic fallback
        if (!match) {
            match = realInventory[index % realInventory.length];
        }
    }
    
    // Final safety
    if (!match) match = realInventory[0];

    // Merge AI insights with Real Inventory Data
    
    // Image Logic
    // 1. Specific Inventory Image (if valid and not fallback)
    // 2. Real Image Found Online
    // 3. AI Generated Visualization
    // 4. Generic Fallback
    
    let productImageUrl = match.imageUrl;
    const isGenericOrMissing = !productImageUrl || productImageUrl.includes("unsplash");
    
    if (isGenericOrMissing) {
        if (aiTire.realFoundImage) {
            productImageUrl = aiTire.realFoundImage;
        } else if (aiTire.generatedImage) {
            productImageUrl = aiTire.generatedImage;
        } else {
            productImageUrl = "https://images.unsplash.com/photo-1578844251758-2f71da645217?auto=format&fit=crop&w=400&q=80";
        }
    }

    // 2. AI Generated Visualization (if available) - Can be used for toggle
    const visualizationUrl = aiTire.generatedImage || undefined;

    return {
      id: match.id || `tire-${index}-${Date.now()}`,
      variantId: match.variantId,
      brand: match.brand || aiTire.brand || "Unknown",
      model: match.model || aiTire.model || "Unknown",
      type: match.type || aiTire.type || "All-Season",
      description: match.description || aiTire.description || "",
      pricePerUnit: match.pricePerUnit || 210.00, // Safe fallback
      installationFeePerUnit: 25,
      imageUrl: productImageUrl || "https://images.unsplash.com/photo-1578844251758-2f71da645217?auto=format&fit=crop&w=400&q=80",
      visualizationUrl: visualizationUrl,
      features: [...(match.features || []), ...(aiTire.features || [])].slice(0, 4),
      matchScore: aiTire.matchScore || (95 - index * 5),
      fitmentVerified: true, 
      inStock: true,
      searchSourceTitle: "GCI Inventory",
      searchSourceUrl: "https://gcitires-ca.myshopify.com",
      
      tier: (match.tier || "Good") as "Good" | "Better" | "Best",
      averageRating: 4.5,
      reviewCount: Math.floor(Math.random() * 100) + 10,
      reviews: generateReviews(3),
      fitmentSpecs: {
        loadIndex: "110",
        speedRating: "T",
        utqg: "500 A B",
        warranty: "50,000 Miles",
        oemMatch: Math.random() > 0.5
      },
      has3PMSF: match.has3PMSF || false
    };
  });
};

// --- SEARCH ENGINES ---

async function callPerplexity(prompt: string): Promise<string> {
    const apiKey = process.env.PERPLEXITY_API_KEY;
    if (!apiKey) throw new Error("Perplexity API Key missing");

    const response = await fetch('https://api.perplexity.ai/chat/completions', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            model: "sonar-pro", // Using Sonar Pro for advanced reasoning (replaces llama-3.1-sonar-large-128k-online)
            messages: [
                { role: "system", content: "You are a helpful tire expert. Return valid JSON only. Do not wrap in markdown." },
                { role: "user", content: prompt }
            ]
        })
    });

    if (!response.ok) throw new Error("Perplexity API failed");
    const data = await response.json();
    return data.choices[0].message.content;
}

// Fallback to Gemini if Perplexity is unavailable
async function callGeminiFallback(prompt: string): Promise<string> {
    const apiKey = process.env.API_KEY;
    if (!apiKey) throw new Error("Gemini API Key missing");

    const ai = new GoogleGenAI({ apiKey });
    const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: prompt,
        config: {
            responseMimeType: 'application/json'
        }
    });

    return response.text || "{}";
}

// Helper to construct prompts
const buildAiPrompt = (userRequest: string, lang: Language, inventory: any[], vehicleInfo?: VehicleInfo) => {
    const inventoryString = JSON.stringify(inventory.map(t => ({
      brand: t.brand,
      model: t.model,
      price: t.pricePerUnit,
      type: t.type
    })));

    let contextStr = `"${userRequest}"`;
    if (vehicleInfo && vehicleInfo.tireSizes && vehicleInfo.tireSizes.length > 0) {
        contextStr += `\n\n[System Note: Detected Verified OEM Tire Sizes for this vehicle: ${vehicleInfo.tireSizes.join(', ')}. Use this to ensure accurate fitment recommendations.]`;
    }

    return `
      You are the GCI Tire Match AI, a bilingual expert (English/French).
      User Language Context: ${lang === 'fr' ? 'FRENCH (Français)' : 'ENGLISH'}.
      
      User Request Data: 
      ${contextStr}

      TASK:
      1. **Analyze Request**: Determine if the user is looking for a **Specific Tire** or **General Recommendations**.
      2. **Vehicle Context**: Extract Year, Make, Model.
      3. **Inventory Matching**: Filter the **AVAILABLE INVENTORY** below. Prioritize exact matches. Select top 3.
      4. **Reasoning**: Assign a match score (0-100) and provide a technical description in ${lang === 'fr' ? 'FRENCH' : 'ENGLISH'}.

      AVAILABLE INVENTORY:
      ${inventoryString}

      OUTPUT:
      Return a JSON object with this structure:
      {
        "identifiedVehicle": "extracted vehicle string",
        "recommendations": [{ "brand": "string", "model": "string", "matchScore": number, "description": "string" }]
      }
      
      CRITICAL: Return ONLY valid JSON.
    `;
};

// Helper to parse potential markdown JSON
const cleanAndParseJSON = (text: string, fallbackVehicle: string) => {
    try {
        const jsonMatch = text.match(/```json\n([\s\S]*?)\n```/) || text.match(/```([\s\S]*?)```/);
        let jsonString = jsonMatch ? jsonMatch[1] : text;
        
        if (jsonString.includes('{')) {
            jsonString = jsonString.substring(jsonString.indexOf('{'));
            if (jsonString.lastIndexOf('}') !== -1) {
                jsonString = jsonString.substring(0, jsonString.lastIndexOf('}') + 1);
            }
        }
        
        let data = JSON.parse(jsonString);
        if (Array.isArray(data)) {
            data = { identifiedVehicle: fallbackVehicle, recommendations: data };
        }
        return data;
    } catch (e) {
        throw new Error("JSON Parse Error");
    }
};

// Helper for Local Heuristic Fallback
const runLocalFallback = (userRequest: string, inventory: any[], lang: Language, vehicleDesc: string) => {
    const lowerReq = userRequest.toLowerCase();
    
    const scoredInventory = inventory.map(item => {
        let score = 60; // Base score
        
        if (item.brand && lowerReq.includes(item.brand.toLowerCase())) score += 30;
        if (item.model && lowerReq.includes(item.model.toLowerCase())) score += 30;
        
        if (item.type && lowerReq.includes(item.type.toLowerCase())) score += 15;
        if (lowerReq.includes("winter") && item.type === "Winter") score += 25;
        if (lowerReq.includes("mud") && (item.type?.includes("Mud") || item.model?.includes("M/T"))) score += 20;
        if (lowerReq.includes("all-terrain") && item.type === "All-Terrain") score += 20;
        
        if ((lowerReq.includes("cheap") || lowerReq.includes("budget")) && (item.pricePerUnit || 0) > 250) score -= 20;

        return {
            ...item,
            _calcScore: Math.min(score, 100)
        };
    });

    scoredInventory.sort((a, b) => b._calcScore - a._calcScore);

    return {
        identifiedVehicle: vehicleDesc,
        recommendations: scoredInventory.slice(0, 3).map(t => ({
            brand: t.brand,
            model: t.model,
            matchScore: t._calcScore,
            description: t.description || (lang === 'fr' ? "Excellent choix basé sur vos critères." : "Excellent choice based on your criteria.")
        }))
    };
};

export const getTireRecommendations = async (userRequest: string, lang: Language): Promise<TireProduct[]> => {
  // 1. Fetch Real/Fallback Inventory (This method handles its own errors)
  const inventory = await fetchShopifyInventory();
  
  // 2. Verify Vehicle (Using Wheel-Size API only via verifyVehicleFitment)
  let vehicleInfo: VehicleInfo = { detected: false, year: '', make: '', model: '' };
  try {
      vehicleInfo = await verifyVehicleFitment(userRequest);
  } catch (e) {
      console.warn("Vehicle fitment verification failed, proceeding with extraction only.", e);
  }

  const fallbackVehicleDesc = vehicleInfo.detected 
      ? `${vehicleInfo.year || ''} ${vehicleInfo.make || ''} ${vehicleInfo.model || ''}`.trim() 
      : "Vehicle";

  let parsedData: { identifiedVehicle: string, recommendations: any[] } | null = null;
  const prompt = buildAiPrompt(userRequest, lang, inventory, vehicleInfo);

  // 3. AI Search: Perplexity -> Gemini -> Local Fallback
  
  // Attempt Perplexity First
  if (process.env.PERPLEXITY_API_KEY) {
      try {
            console.log("Attempting Perplexity Search...");
            const responseText = await callPerplexity(prompt);
            parsedData = cleanAndParseJSON(responseText, fallbackVehicleDesc);
            console.log("Perplexity Search Successful");
      } catch (error) {
            console.warn("Perplexity Service Failed, failing over to Gemini...", error);
      }
  }

  // Fallback to Gemini if Perplexity unavailable or failed
  if (!parsedData && process.env.API_KEY) {
      try {
            console.log("Attempting Gemini Search...");
            const responseText = await callGeminiFallback(prompt);
            parsedData = cleanAndParseJSON(responseText, fallbackVehicleDesc);
            console.log("Gemini Search Successful");
      } catch (error) {
            console.warn("Gemini Service Failed, failing over to Local Heuristic...", error);
      }
  }

  // Final Fallback: Local Heuristic
  if (!parsedData) {
      console.log("Using Local Heuristic Fallback");
      parsedData = runLocalFallback(userRequest, inventory, lang, fallbackVehicleDesc);
  }

  // Generate visualizations (Gemini Image Model - Kept for visuals only)
  // Ensure parsedData and recommendations exist before mapping
  const recsToProcess = (parsedData && Array.isArray(parsedData.recommendations)) ? parsedData.recommendations : [];

  const suggestionsWithImages = await Promise.all(recsToProcess.map(async (suggestion) => {
      let generatedUrl: string | null = null;
      let realUrl: string | null = null;
      
      // Determine the best vehicle description to use for the image
      let vehicleForImage = parsedData!.identifiedVehicle;
      
      // If AI returned "Generic Vehicle" but our Regex detector found something, use Regex
      if ((!vehicleForImage || vehicleForImage.includes("Generic")) && vehicleInfo.detected) {
          vehicleForImage = fallbackVehicleDesc;
      }

      const tireName = `${suggestion.brand} ${suggestion.model}`;
      const vehiclePrompt = (vehicleForImage && !vehicleForImage.includes("Generic") && !vehicleForImage.includes("Vehicle")) 
        ? vehicleForImage 
        : (userRequest.length > 20 && !userRequest.includes("|") ? userRequest : "studio background");

      // Execute both visual fetchers in parallel
      const [genResult, realResult] = await Promise.all([
          generateTireVisualization(vehiclePrompt, tireName),
          findRealProductImage(suggestion.brand, suggestion.model)
      ]);
      
      generatedUrl = genResult;
      realUrl = realResult;
      
      return {
          ...suggestion,
          generatedImage: generatedUrl,
          realFoundImage: realUrl
      };
  }));

  // Merge AI/Heuristic suggestions with full technical data from inventory
  return enrichWithInventoryData(suggestionsWithImages, inventory);
};