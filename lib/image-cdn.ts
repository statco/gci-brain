/**
 * lib/image-cdn.ts
 *
 * Multi-source CDN image resolver for tire products.
 * Tries each CDN in priority order, returns the first URL that responds 200.
 *
 * Priority:
 *   1. Tire Rack  — confirmed working for Vredestein, Ovation, Cooper, Nexen, etc.
 *   2. SimpleTire — fallback for broader catalog coverage
 *   3. Les Schwab — secondary fallback
 */

export interface ImageCandidate {
  url: string;
  source: "tirerack" | "simpletire" | "lesschwab";
}

export function normalizeModelSlug(model: string): string {
  return model
    .trim()
    .split(" ")
    .map((word) => {
      if (/^[a-zA-Z]{1,3}$/.test(word)) return word.toUpperCase();
      return word.charAt(0).toUpperCase() + word.slice(1);
    })
    .join("_");
}

function tireRackUrl(brand: string, modelSlug: string): string {
  return `https://www.tirerack.com/images/tires/${brand}/${modelSlug}/large/${brand}_${modelSlug}_angle_large.jpg`;
}

function simpleTireUrl(brand: string, modelSlug: string): string {
  const slug = `${brand}-${modelSlug}`.toLowerCase().replace(/_/g, "-");
  return `https://cdn.simpletire.com/images/tireImages/${slug}.jpg`;
}

function lesSchwabUrl(brand: string, modelSlug: string): string {
  const slug = `${brand}-${modelSlug}`.toLowerCase().replace(/_/g, "-");
  return `https://images.lesschwab.com/images/tires/${slug}.jpg`;
}

const PROBE_TIMEOUT_MS = 4_000;

async function probeUrl(url: string): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
    const res = await fetch(url, { method: "HEAD", signal: controller.signal });
    clearTimeout(timer);
    return res.status === 200;
  } catch {
    return false;
  }
}

export async function resolveProductImage(
  brand: string,
  model: string,
  verify = true
): Promise<string | null> {
  const slug = normalizeModelSlug(model);
  const candidates: ImageCandidate[] = [
    { url: tireRackUrl(brand, slug), source: "tirerack" },
    { url: simpleTireUrl(brand, slug), source: "simpletire" },
    { url: lesSchwabUrl(brand, slug), source: "lesschwab" },
  ];
  if (!verify) return candidates[0].url;
  for (const candidate of candidates) {
    if (await probeUrl(candidate.url)) return candidate.url;
  }
  return null;
}

export async function resolveProductImagesBatch(
  items: { brand: string; model: string }[],
  concurrency = 5
): Promise<Map<string, string | null>> {
  const results = new Map<string, string | null>();
  const queue = [...items];
  async function worker() {
    while (queue.length > 0) {
      const item = queue.shift();
      if (!item) break;
      const key = `${item.brand}::${item.model}`;
      if (!results.has(key)) {
        results.set(key, await resolveProductImage(item.brand, item.model));
      }
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));
  return results;
}

// ---------------------------------------------------------------------------
// GMC feed helper — use this inside api/feed/gmc.ts
// ---------------------------------------------------------------------------

const _imageCache = new Map<string, string>();

export async function cachedResolveImageLink(product: {
  images?: { src: string }[];
  title: string;
}): Promise<string> {
  const shopifyImage = product.images?.[0]?.src ?? "";
  if (shopifyImage) return shopifyImage;

  const match = product.title.match(/^(.+?)\s+\d{2,4}[\/R\-].+$/i);
  if (!match) return "";

  const tokens = match[1].trim().split(/\s+/);
  if (tokens.length < 2) return "";

  const brand = tokens[0];
  const model = tokens.slice(1).join(" ");
  const cacheKey = `${brand}::${model}`;

  if (_imageCache.has(cacheKey)) return _imageCache.get(cacheKey)!;

  const url = (await resolveProductImage(brand, model)) ?? "";
  _imageCache.set(cacheKey, url);
  return url;
}
