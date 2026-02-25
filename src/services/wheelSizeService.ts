// src/services/wheelSizeService.ts
// Fitment verification — calls the /api/fitmentCheck serverless proxy so the
// Wheel-Size API key stays server-side and CORS is never an issue.

import { GoogleGenerativeAI } from '@google/generative-ai';
import type { TireProduct, VehicleInput } from '../types';

const GEMINI_API_KEY = import.meta.env.VITE_GEMINI_API_KEY || '';

/** Strip P / LT / ST prefix so sizes like "P225/50R17" match "225/50R17". */
function normalizeTireSize(size: string): string {
  return size.replace(/^(P|LT|ST)/i, '').trim();
}

/** Use Gemini to pull year/make/model out of a free-text request. */
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

/**
 * Call the /api/fitmentCheck serverless proxy and return the list of
 * normalised OEM tire sizes for the given vehicle.
 */
async function getVehicleFitmentSizes(vehicle: VehicleInput): Promise<string[]> {
  try {
    const res = await fetch('/api/fitmentCheck', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ make: vehicle.make, model: vehicle.model, year: vehicle.year }),
    });
    if (!res.ok) return [];

    const json = await res.json() as { sizes?: string[] };
    const sizes = Array.isArray(json.sizes) ? json.sizes : [];
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

    if (!resolvedVehicle) {
      resolvedVehicle = (await extractVehicleFromRequest(request)) ?? undefined;
    }

    if (!resolvedVehicle) {
      return products.map(p => ({ ...p, fitmentVerified: false }));
    }

    const fitmentSizes = await getVehicleFitmentSizes(resolvedVehicle);

    // DEBUG: full OEM size list
    console.log('[fitment] OEM sizes from API:', fitmentSizes);
    console.log('[fitment] OEM sizes normalised:', fitmentSizes.map(normalizeTireSize));

    if (fitmentSizes.length === 0) {
      return products.map(p => ({ ...p, fitmentVerified: false }));
    }

    return products.map(p => {
      const normProduct = normalizeTireSize(p.size);
      const matched = fitmentSizes.some(s => {
        const normOem = normalizeTireSize(s);
        const hit = normOem === normProduct;
        // DEBUG: per-product comparison
        console.log(`[fitment] compare OEM "${s}" → "${normOem}"  vs  product "${p.size}" → "${normProduct}"  match=${hit}`);
        return hit;
      });
      console.log(`[fitment] product "${p.title}" size="${p.size}" normalised="${normProduct}" fitmentVerified=${matched}`);
      return { ...p, fitmentVerified: matched };
    });
  } catch {
    return products.map(p => ({ ...p, fitmentVerified: false }));
  }
}
