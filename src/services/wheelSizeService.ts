// src/services/wheelSizeService.ts
// Fitment verification using the Wheel-Size API v2

import { GoogleGenerativeAI } from '@google/generative-ai';
import type { TireProduct, VehicleInput } from '../types';

const WHEEL_SIZE_API_KEY = import.meta.env.VITE_WHEEL_SIZE_API_KEY || '';
const GEMINI_API_KEY = import.meta.env.VITE_GEMINI_API_KEY || '';

/** Strip P / LT / ST prefix so sizes like "P225/50R17" match "225/50R17" */
function normalizeTireSize(size: string): string {
  return size.replace(/^(P|LT|ST)/i, '').trim();
}

/** Use Gemini to pull year/make/model out of a free-text request */
async function extractVehicleFromRequest(request: string): Promise<VehicleInput | null> {
  if (!GEMINI_API_KEY) return null;

  try {
    const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

    const prompt = `Extract vehicle information from this customer request.
Return ONLY a JSON object with fields year, make, model (and optionally trim), all as strings.
If the text contains no vehicle info, return null.

Text: "${request}"

Example output: {"year": "2020", "make": "Toyota", "model": "Camry"}`;

    const result = await model.generateContent(prompt);
    const text = result.response.text();

    const jsonMatch = text.match(/\{[\s\S]*?\}/);
    if (!jsonMatch) return null;

    const parsed = JSON.parse(jsonMatch[0]);
    if (parsed && parsed.year && parsed.make && parsed.model) {
      return parsed as VehicleInput;
    }
    return null;
  } catch {
    return null;
  }
}

/** Fetch OEM / approved tire sizes from the Wheel-Size API for a given vehicle */
async function getVehicleFitmentSizes(vehicle: VehicleInput): Promise<string[]> {
  if (!WHEEL_SIZE_API_KEY) return [];

  try {
    const url =
      `https://api.wheel-size.com/v2/search/` +
      `?make=${encodeURIComponent(vehicle.make)}` +
      `&model=${encodeURIComponent(vehicle.model)}` +
      `&year=${encodeURIComponent(vehicle.year)}` +
      `&user_key=${WHEEL_SIZE_API_KEY}`;

    const response = await fetch(url);
    if (!response.ok) return [];

    const data = await response.json();
    const sizes: string[] = [];

    // The API returns an array of trim/configuration objects
    if (Array.isArray(data)) {
      for (const item of data) {
        // Common path: item.technical[] -> tire_size
        if (Array.isArray(item.technical)) {
          for (const tech of item.technical) {
            if (tech.tire_size) sizes.push(String(tech.tire_size));
          }
        }
        // Alternative path: item.tires[] -> tire
        if (Array.isArray(item.tires)) {
          for (const t of item.tires) {
            if (t.tire) sizes.push(String(t.tire));
          }
        }
        // Alternative path: item.staggered[] -> front / rear tire_size
        if (Array.isArray(item.staggered)) {
          for (const s of item.staggered) {
            if (s.front?.tire_size) sizes.push(String(s.front.tire_size));
            if (s.rear?.tire_size) sizes.push(String(s.rear.tire_size));
          }
        }
      }
    }

    return [...new Set(sizes.map(normalizeTireSize))];
  } catch {
    return [];
  }
}

/**
 * Verify fitment for a list of tire products.
 *
 * - Uses structured vehicle from the form if provided.
 * - Falls back to Gemini NLP extraction from the raw request string.
 * - Silently sets fitmentVerified: false on any failure.
 */
export async function verifyFitmentForProducts(
  vehicle: VehicleInput | undefined,
  products: TireProduct[],
  request: string
): Promise<TireProduct[]> {
  try {
    let resolvedVehicle = vehicle;

    // Fall back to NLP extraction when no structured vehicle was provided
    if (!resolvedVehicle) {
      resolvedVehicle = (await extractVehicleFromRequest(request)) ?? undefined;
    }

    if (!resolvedVehicle) {
      return products.map(p => ({ ...p, fitmentVerified: false }));
    }

    const fitmentSizes = await getVehicleFitmentSizes(resolvedVehicle);

    if (fitmentSizes.length === 0) {
      return products.map(p => ({ ...p, fitmentVerified: false }));
    }

    return products.map(p => ({
      ...p,
      fitmentVerified: fitmentSizes.some(
        s => normalizeTireSize(s) === normalizeTireSize(p.size)
      ),
    }));
  } catch {
    return products.map(p => ({ ...p, fitmentVerified: false }));
  }
}
