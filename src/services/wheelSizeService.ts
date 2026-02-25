// src/services/wheelSizeService.ts
// Fitment verification via Wheel-Size API

import type { TireProduct, VehicleInput } from '../types';

const WHEEL_SIZE_API_KEY = import.meta.env.VITE_WHEEL_SIZE_API_KEY || '';
const WHEEL_SIZE_BASE_URL = 'https://api.wheel-size.com/v2';

interface WheelSizeSearchResult {
  data?: Array<{
    tire_sizing?: Array<{
      tire_pressure?: string;
      aspect_ratio?: number;
      rim_diameter?: number;
      section_width?: number;
    }>;
    stud_holes?: number;
    pcd?: number;
  }>;
}

/**
 * Normalize a tire size string by stripping P/LT/ST prefix.
 * e.g. "P225/45R17" -> "225/45R17", "LT245/75R16" -> "245/75R16"
 */
function normalizeTireSize(size: string): string {
  return size.trim().replace(/^(?:P|LT|ST)/i, '').trim();
}

/**
 * Extract tire sizes from Wheel-Size API response data.
 */
function extractSizesFromApiResponse(data: WheelSizeSearchResult): string[] {
  const sizes: string[] = [];
  if (!data?.data) return sizes;

  for (const entry of data.data) {
    if (entry.tire_sizing) {
      for (const ts of entry.tire_sizing) {
        if (ts.section_width && ts.aspect_ratio !== undefined && ts.rim_diameter) {
          const size = `${ts.section_width}/${ts.aspect_ratio}R${ts.rim_diameter}`;
          sizes.push(size);
        }
      }
    }
  }
  return sizes;
}

/**
 * Use Gemini NLP to extract OEM tire sizes from a free-text vehicle description.
 * Returns an array of normalized tire size strings, or empty array on failure.
 */
async function extractSizesViaGemini(vehicleDescription: string): Promise<string[]> {
  try {
    const geminiApiKey = import.meta.env.VITE_GEMINI_API_KEY || '';
    if (!geminiApiKey) return [];

    const { GoogleGenerativeAI } = await import('@google/generative-ai');
    const genAI = new GoogleGenerativeAI(geminiApiKey);
    const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

    const prompt = `Given this vehicle: "${vehicleDescription}", list the OEM tire sizes as a JSON array of strings (e.g. ["225/45R17","235/45R17"]). Only output the JSON array, nothing else. If unknown, output [].`;
    const result = await model.generateContent(prompt);
    const text = result.response.text().trim();

    const match = text.match(/\[.*\]/s);
    if (!match) return [];

    const parsed = JSON.parse(match[0]);
    if (!Array.isArray(parsed)) return [];

    return parsed.filter((s: unknown) => typeof s === 'string').map(normalizeTireSize);
  } catch {
    return [];
  }
}

/**
 * Fetch OEM tire sizes for a vehicle from Wheel-Size API.
 * Falls back to Gemini NLP extraction if API returns no structured data.
 */
async function getOemSizesForVehicle(vehicle: VehicleInput): Promise<string[]> {
  if (!WHEEL_SIZE_API_KEY) return [];

  try {
    const url = `${WHEEL_SIZE_BASE_URL}/search/?make=${encodeURIComponent(vehicle.make)}&model=${encodeURIComponent(vehicle.model)}&year=${encodeURIComponent(vehicle.year)}&user_key=${encodeURIComponent(WHEEL_SIZE_API_KEY)}`;
    const response = await fetch(url);
    if (!response.ok) return [];

    const data: WheelSizeSearchResult = await response.json();
    const sizes = extractSizesFromApiResponse(data);

    if (sizes.length > 0) {
      return sizes.map(normalizeTireSize);
    }

    // Fallback: use Gemini NLP to extract sizes from vehicle description
    const vehicleDescription = `${vehicle.year} ${vehicle.make} ${vehicle.model}${vehicle.trim ? ' ' + vehicle.trim : ''}`;
    return await extractSizesViaGemini(vehicleDescription);
  } catch {
    return [];
  }
}

/**
 * Verify fitment for a list of tire products against a vehicle.
 * Sets fitmentVerified: true on each product whose normalized size matches an OEM size.
 * Silently returns products with fitmentVerified: false on any failure.
 */
export async function verifyFitmentForProducts(
  vehicle: VehicleInput | undefined,
  products: TireProduct[],
  _request: string
): Promise<TireProduct[]> {
  if (!vehicle || !vehicle.year || !vehicle.make || !vehicle.model) {
    return products.map(p => ({ ...p, fitmentVerified: false }));
  }

  try {
    const oemSizes = await getOemSizesForVehicle(vehicle);

    if (oemSizes.length === 0) {
      return products.map(p => ({ ...p, fitmentVerified: false }));
    }

    return products.map(p => {
      const normalizedProductSize = normalizeTireSize(p.size || '');
      const isMatch = oemSizes.some(oem => oem === normalizedProductSize);
      return { ...p, fitmentVerified: isMatch };
    });
  } catch {
    return products.map(p => ({ ...p, fitmentVerified: false }));
  }
}
