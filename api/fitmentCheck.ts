// api/fitmentCheck.ts
// Server-side proxy for the Wheel-Size API v2.
// Keeps the API key out of the browser bundle and avoids CORS issues.
//
// POST /api/fitmentCheck  body: { make, model, year }
// Returns: { sizes: ["225/60R18", "235/55R18", ...] }

import type { VercelRequest, VercelResponse } from '@vercel/node';

const WHEEL_SIZE_API_KEY = process.env.WHEEL_SIZE_API_KEY || '';
const WHEEL_SIZE_BASE = 'https://api.wheel-size.com/v2';

/** Convert a free-text name to the slug format the API expects (lowercase, hyphens). */
function toSlug(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, '-');
}

/** Coerce a tire value to a size string, handling both string and object forms. */
function tireToString(tire: unknown): string {
  if (typeof tire === 'string') return tire.trim();
  // v2 may return tire as an object; try known field names
  if (tire && typeof tire === 'object') {
    const t = tire as Record<string, unknown>;
    for (const key of ['designation', 'name', 'size', 'tire']) {
      if (typeof t[key] === 'string' && (t[key] as string).trim()) {
        return (t[key] as string).trim();
      }
    }
  }
  return '';
}

/** Extract every unique tire size string from a /search/by_model/ response body. */
function extractTireSizes(data: unknown): string[] {
  const sizes = new Set<string>();

  if (!Array.isArray(data)) {
    console.log('[fitmentCheck] extractTireSizes: data is not an array, type:', typeof data);
    return [];
  }

  console.log(`[fitmentCheck] extractTireSizes: ${data.length} item(s) in data`);

  for (let i = 0; i < data.length; i++) {
    const item = data[i] as Record<string, unknown>;
    const wheels = item['wheels'];

    if (!Array.isArray(wheels)) {
      console.log(`[fitmentCheck] item[${i}] has no wheels array; keys:`, Object.keys(item));
      continue;
    }

    for (const pair of wheels as Record<string, unknown>[]) {
      for (const side of ['front', 'rear'] as const) {
        const wheel = pair[side] as Record<string, unknown> | undefined;
        if (!wheel) continue;
        const sizeStr = tireToString(wheel['tire']);
        if (sizeStr) sizes.add(sizeStr);
      }
    }
  }

  return [...sizes];
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Allow browser clients from the same origin (and Vercel preview URLs)
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { make, model, year } = (req.body ?? {}) as Record<string, string>;

  if (!make || !model || !year) {
    return res.status(400).json({ error: 'make, model, and year are required' });
  }

  if (!WHEEL_SIZE_API_KEY) {
    console.warn('WHEEL_SIZE_API_KEY is not set — returning empty sizes');
    return res.status(200).json({ sizes: [] });
  }

  try {
    const params = new URLSearchParams({
      make: toSlug(make),
      model: toSlug(model),
      year: String(parseInt(year, 10)), // ensure integer, no extra whitespace
      user_key: WHEEL_SIZE_API_KEY,
    });

    const apiUrl = `${WHEEL_SIZE_BASE}/search/by_model/?${params.toString()}`;
    console.log(`[fitmentCheck] fetching: ${apiUrl.replace(WHEEL_SIZE_API_KEY, '***')}`);

    const upstream = await fetch(apiUrl, {
      headers: { Accept: 'application/json' },
    });

    if (!upstream.ok) {
      const body = await upstream.text();
      console.error(`[fitmentCheck] upstream error ${upstream.status}: ${body}`);
      // Return empty sizes rather than surfacing the error to the client
      return res.status(200).json({ sizes: [] });
    }

    const json = await upstream.json() as { data?: unknown };

    // Log truncated raw response so we can inspect the real shape
    const rawSnippet = JSON.stringify(json).slice(0, 2000);
    console.log('[fitmentCheck] raw response (first 2000 chars):', rawSnippet);

    // The v2 API wraps results in a "data" array
    const data = Array.isArray(json) ? json : (Array.isArray(json.data) ? json.data : []);
    const sizes = extractTireSizes(data);

    console.log(`[fitmentCheck] found ${sizes.length} tire size(s):`, sizes);
    return res.status(200).json({ sizes });
  } catch (err) {
    console.error('[fitmentCheck] unexpected error:', err);
    return res.status(200).json({ sizes: [] });
  }
}
