// api/fitmentCheck.ts
// Server-side proxy for the Wheel-Size API v2.
// Keeps the API key out of the browser bundle and avoids CORS issues.
//
// GET /api/fitmentCheck?make=buick&model=encore-gx&year=2021
// Returns: { sizes: ["225/60R18", "235/55R18", ...] }

import type { VercelRequest, VercelResponse } from '@vercel/node';

const WHEEL_SIZE_API_KEY = process.env.WHEEL_SIZE_API_KEY || '';
const WHEEL_SIZE_BASE = 'https://api.wheel-size.com/v2';

/** Convert a free-text name to the slug format the API expects (lowercase, hyphens). */
function toSlug(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, '-');
}

/** Extract every unique tire size string from a /search/by_model/ response body. */
function extractTireSizes(data: unknown): string[] {
  const sizes = new Set<string>();

  if (!Array.isArray(data)) return [];

  for (const item of data as Record<string, unknown>[]) {
    const wheels = item['wheels'];
    if (!Array.isArray(wheels)) continue;

    for (const pair of wheels as Record<string, unknown>[]) {
      for (const side of ['front', 'rear'] as const) {
        const wheel = pair[side] as Record<string, unknown> | undefined;
        if (!wheel) continue;
        const tire = wheel['tire'];
        if (typeof tire === 'string' && tire.trim()) {
          sizes.add(tire.trim());
        }
      }
    }
  }

  return [...sizes];
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Allow browser clients from the same origin (and Vercel preview URLs)
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { make, model, year } = req.query as Record<string, string>;

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
