import { GoogleGenerativeAI } from '@google/generative-ai';
import axios from 'axios';

// Initialize API clients
const geminiClient = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');
const PERPLEXITY_API_KEY = process.env.PERPLEXITY_API_KEY || '';
const WHEEL_SIZE_API_KEY = process.env.WHEEL_SIZE_API_KEY || '';

interface VehicleData {
  year: number;
  make: string;
  model: string;
  trim?: string;
}

interface TireRecommendation {
  size: string;
  season: 'All-Season' | 'Winter' | 'Summer';
  brands: string[];
  priceRange: { min: number; max: number };
  confidence: number;
  reasoning: string;
}

interface MarketInsight {
  averagePrice: number;
  popularBrands: string[];
  recentReviews: string[];
  trends: string[];
}

interface FitmentData {
  oemSize: string;
  alternativeSizes: string[];
  rimDiameter: string;
  width: string;
  aspectRatio: string;
  speedRating?: string;
  loadIndex?: string;
}

class IntegrationService {
  /**
   * Get comprehensive tire recommendations using multiple AI sources
   */
  async getComprehensiveTireRecommendations(
    query: string,
    vehicle: VehicleData
  ): Promise<{
    recommendations: TireRecommendation[];
    marketInsights: MarketInsight;
    fitmentData: FitmentData;
  }> {
    try {
      // Execute all API calls in parallel for speed
      const [geminiResult, perplexityResult, fitmentResult] = await Promise.all([
        this.getGeminiRecommendations(query, vehicle),
        this.getMarketInsights(query, vehicle),
        this.getFitmentData(vehicle),
      ]);

      // Merge and validate results
      const mergedRecommendations = this.mergeRecommendations(
        geminiResult,
        perplexityResult,
        fitmentResult
      );

      return {
        recommendations: mergedRecommendations,
        marketInsights: perplexityResult,
        fitmentData: fitmentResult,
      };
    } catch (error) {
      console.error('Error in comprehensive recommendations:', error);
      throw error;
    }
  }

  /**
   * Get AI-powered recommendations from Gemini
   */
  private async getGeminiRecommendations(
    query: string,
    vehicle: VehicleData
  ): Promise<TireRecommendation[]> {
    try {
      const model = geminiClient.getGenerativeModel({ model: 'gemini-pro' });

      const prompt = `
You are a tire expert helping a customer find the perfect tires.

Customer Query: "${query}"

Vehicle Information:
- Year: ${vehicle.year}
- Make: ${vehicle.make}
- Model: ${vehicle.model}
${vehicle.trim ? `- Trim: ${vehicle.trim}` : ''}

Please provide 3-5 tire recommendations in JSON format with the following structure:
{
  "recommendations": [
    {
      "size": "P215/55R17",
      "season": "All-Season",
      "brands": ["Michelin", "Bridgestone", "Goodyear"],
      "priceRange": { "min": 150, "max": 250 },
      "confidence": 0.95,
      "reasoning": "Brief explanation of why this is recommended"
    }
  ]
}

Consider:
1. The vehicle's typical use case and driving conditions in Canada
2. Safety and performance balance
3. Value for money
4. Canadian winter requirements if applicable

Respond ONLY with valid JSON, no additional text.
      `;

      const result = await model.generateContent(prompt);
      const response = await result.response;
      const text = response.text();

      // Parse JSON response
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        return parsed.recommendations || [];
      }

      throw new Error('Invalid response format from Gemini');
    } catch (error) {
      console.error('Gemini API error:', error);
      // Return fallback recommendations
      return this.getFallbackRecommendations(vehicle);
    }
  }

  /**
   * Get real-time market insights from Perplexity
   */
  private async getMarketInsights(
    query: string,
    vehicle: VehicleData
  ): Promise<MarketInsight> {
    try {
      const response = await axios.post(
        'https://api.perplexity.ai/chat/completions',
        {
          model: 'llama-3.1-sonar-small-128k-online',
          messages: [
            {
              role: 'system',
              content: 'You are a tire market analyst providing current pricing and trends in Canada.',
            },
            {
              role: 'user',
              content: `What are the current tire prices and popular brands for a ${vehicle.year} ${vehicle.make} ${vehicle.model} in Canada? Include average prices and recent customer reviews. Format as JSON with fields: averagePrice, popularBrands (array), recentReviews (array), trends (array).`,
            },
          ],
          temperature: 0.2,
          max_tokens: 1000,
        },
        {
          headers: {
            Authorization: `Bearer ${PERPLEXITY_API_KEY}`,
            'Content-Type': 'application/json',
          },
        }
      );

      const content = response.data.choices[0].message.content;
      
      // Try to parse JSON from response
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }

      // Fallback parsing
      return {
        averagePrice: 180,
        popularBrands: ['Michelin', 'Bridgestone', 'Goodyear', 'Continental'],
        recentReviews: ['Good traction in winter', 'Quiet ride', 'Long tread life'],
        trends: ['Increasing demand for all-season tires', 'Preference for Canadian-made tires'],
      };
    } catch (error) {
      console.error('Perplexity API error:', error);
      return {
        averagePrice: 180,
        popularBrands: ['Michelin', 'Bridgestone', 'Goodyear'],
        recentReviews: [],
        trends: [],
      };
    }
  }

  /**
   * Get OEM fitment data from Wheel-Size API
   */
  private async getFitmentData(vehicle: VehicleData): Promise<FitmentData> {
    try {
      const response = await axios.get(
        `https://api.wheel-size.com/v2/search/`,
        {
          params: {
            user_key: WHEEL_SIZE_API_KEY,
            make: vehicle.make,
            model: vehicle.model,
            year: vehicle.year,
          },
        }
      );

      if (response.data && response.data.data && response.data.data.length > 0) {
        const fitment = response.data.data[0];
        const tire = fitment.wheels?.front?.tire || fitment.wheels?.rear?.tire;

        if (tire) {
          return {
            oemSize: `${tire.width}/${tire.aspect_ratio}R${tire.rim}`,
            alternativeSizes: this.generateAlternativeSizes(tire),
            rimDiameter: tire.rim,
            width: tire.width,
            aspectRatio: tire.aspect_ratio,
            speedRating: tire.speed_rating,
            loadIndex: tire.load_index,
          };
        }
      }

      // Fallback if API fails
      return this.getFallbackFitmentData(vehicle);
    } catch (error) {
      console.error('Wheel-Size API error:', error);
      return this.getFallbackFitmentData(vehicle);
    }
  }

  /**
   * Merge recommendations from multiple sources
   */
  private mergeRecommendations(
    geminiRecs: TireRecommendation[],
    marketInsights: MarketInsight,
    fitmentData: FitmentData
  ): TireRecommendation[] {
    // Validate all recommendations against OEM fitment data
    const validatedRecs = geminiRecs.map((rec) => ({
      ...rec,
      size: this.validateTireSize(rec.size, fitmentData) ? rec.size : fitmentData.oemSize,
      // Adjust price based on market insights
      priceRange: this.adjustPriceRange(rec.priceRange, marketInsights.averagePrice),
    }));

    // Sort by confidence
    return validatedRecs.sort((a, b) => b.confidence - a.confidence);
  }

  /**
   * Validate tire size against fitment data
   */
  private validateTireSize(size: string, fitmentData: FitmentData): boolean {
    const sizes = [fitmentData.oemSize, ...fitmentData.alternativeSizes];
    return sizes.some((validSize) => validSize === size);
  }

  /**
   * Adjust price range based on market data
   */
  private adjustPriceRange(
    range: { min: number; max: number },
    marketAverage: number
  ): { min: number; max: number } {
    const deviation = marketAverage * 0.2; // 20% deviation
    return {
      min: Math.max(range.min, marketAverage - deviation),
      max: Math.min(range.max, marketAverage + deviation),
    };
  }

  /**
   * Generate alternative tire sizes
   */
  private generateAlternativeSizes(tire: any): string[] {
    const alternatives: string[] = [];
    const width = parseInt(tire.width);
    const aspectRatio = parseInt(tire.aspect_ratio);
    const rim = parseInt(tire.rim);

    // Plus-sizing options (wider, lower profile)
    if (aspectRatio > 45) {
      alternatives.push(`${width + 10}/${aspectRatio - 5}R${rim}`);
    }

    // Minus-sizing options (narrower, higher profile)
    if (width > 185 && aspectRatio < 70) {
      alternatives.push(`${width - 10}/${aspectRatio + 5}R${rim}`);
    }

    return alternatives;
  }

  /**
   * Fallback recommendations when APIs fail
   */
  private getFallbackRecommendations(vehicle: VehicleData): TireRecommendation[] {
    return [
      {
        size: 'P215/55R17',
        season: 'All-Season',
        brands: ['Michelin', 'Bridgestone', 'Goodyear'],
        priceRange: { min: 150, max: 220 },
        confidence: 0.75,
        reasoning: 'Common size for this vehicle class with reliable all-season performance',
      },
      {
        size: 'P215/55R17',
        season: 'Winter',
        brands: ['Michelin X-Ice', 'Bridgestone Blizzak', 'Nokian Hakkapeliitta'],
        priceRange: { min: 180, max: 280 },
        confidence: 0.80,
        reasoning: 'Essential for Canadian winters - superior snow and ice traction',
      },
    ];
  }

  /**
   * Fallback fitment data
   */
  private getFallbackFitmentData(vehicle: VehicleData): FitmentData {
    // Generic fitment based on vehicle year (newer cars tend to have larger wheels)
    const baseRim = vehicle.year >= 2018 ? '17' : vehicle.year >= 2010 ? '16' : '15';
    
    return {
      oemSize: `215/55R${baseRim}`,
      alternativeSizes: [`215/60R${baseRim}`, `205/55R${baseRim}`],
      rimDiameter: baseRim,
      width: '215',
      aspectRatio: '55',
    };
  }

  /**
   * Quick search for natural language queries
   */
  async quickSearch(query: string): Promise<TireRecommendation[]> {
    try {
      const model = geminiClient.getGenerativeModel({ model: 'gemini-pro' });

      const prompt = `
Extract vehicle information from this query: "${query}"

Return JSON with: { "year": number, "make": string, "model": string, "needs": string }

If unclear, make best guess based on common Canadian vehicles.
Example: "tires for my 2020 honda civic" -> {"year": 2020, "make": "Honda", "model": "Civic", "needs": "all-season"}
      `;

      const result = await model.generateContent(prompt);
      const response = await result.response;
      const text = response.text();

      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const vehicle = JSON.parse(jsonMatch[0]);
        return this.getGeminiRecommendations(query, vehicle);
      }
    } catch (error) {
      console.error('Quick search error:', error);
    }

    return this.getFallbackRecommendations({ year: 2020, make: 'Toyota', model: 'Corolla' });
  }
}

export const integrationService = new IntegrationService();
export type { VehicleData, TireRecommendation, MarketInsight, FitmentData };
