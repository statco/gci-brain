// api/imageAudit.ts
// ============================================================
// GMC Image Audit — read-only diagnostic tool
//
// Answers three questions for every ct-sync Shopify product:
//   1. Does Shopify have an image attached? Is it on cdn.shopify.com?
//   2. Does IMAGE_MAP have a source URL for this product?
//   3. Is that source URL actually reachable by Googlebot?
//
// GET/POST ?action=audit        — full audit (fetches products + CDN probes)
// GET/POST ?action=cdn-check   — probe every IMAGE_MAP URL, no Shopify needed
// GET/POST ?action=robots-check — fetch robots.txt for each CDN domain
// ============================================================

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getTireImageUrl, IMAGE_MAP } from './addTireImages.js';

export const config = { maxDuration: 300 };

// ─── SHOPIFY ──────────────────────────────────────────────────────────────────

const SHOPIFY = {
  domain:     process.env.SHOPIFY_STORE_DOMAIN       || '',
  token:      process.env.SHOPIFY_ADMIN_ACCESS_TOKEN || '',
  apiVersion: '2024-01',
  get baseUrl() { return `https://${this.domain}/admin/api/${this.apiVersion}`; },
};

const SYNC_TAG = 'ct-sync';

function delay(ms: number) { return new Promise<void>(r => setTimeout(r, ms)); }

async function shopifyFetch<T>(path: string): Promise<T> {
  const res = await fetch(`${SHOPIFY.baseUrl}${path}`, {
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': SHOPIFY.token,
    },
  });
  if (res.status === 429) { await delay(2000); return shopifyFetch<T>(path); }
  if (!res.ok) throw new Error(`Shopify ${res.status} on ${path}: ${(await res.text()).slice(0, 200)}`);
  return res.json() as Promise<T>;
}

interface ShopifyProduct {
  id: number;
  title: string;
  images: Array<{ id: number; src: string }>;
}

async function fetchAllSyncedProducts(): Promise<ShopifyProduct[]> {
  const all: ShopifyProduct[] = [];
  let sinceId = 0;
  while (true) {
    const q = `tag=${SYNC_TAG}&limit=250&fields=id,title,images${sinceId ? `&since_id=${sinceId}` : ''}`;
    const data: any = await shopifyFetch<any>(`/products.json?${q}`);
    const batch: ShopifyProduct[] = data.products || [];
    all.push(...batch);
    if (batch.length < 250) break;
    sinceId = batch[batch.length - 1].id;
  }
  return all;
}

// ─── CDN PROBE ────────────────────────────────────────────────────────────────

interface CdnResult {
  url:           string;
  status:        number | null;
  ok:            boolean;
  redirected:    boolean;
  finalUrl:      string | null;
  contentType:   string | null;
  contentLength: string | null;
  error:         string | null;
}

// Use Googlebot-Image UA — this is what GMC sends when crawling image URLs.
// If the CDN blocks this UA, that's exactly why GMC can't see the image.
const GOOGLEBOT_UA = 'Googlebot-Image/1.0 (+http://www.google.com/bot.html)';

async function probeCdnUrl(url: string): Promise<CdnResult> {
  const result: CdnResult = {
    url, status: null, ok: false, redirected: false,
    finalUrl: null, contentType: null, contentLength: null, error: null,
  };
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    const res = await fetch(url, {
      method: 'HEAD',
      redirect: 'follow',
      signal: controller.signal,
      headers: { 'User-Agent': GOOGLEBOT_UA, 'Accept': 'image/*,*/*' },
    });
    clearTimeout(timer);
    result.status        = res.status;
    result.ok            = res.ok;
    result.redirected    = res.redirected;
    result.finalUrl      = res.url !== url ? res.url : null;
    result.contentType   = res.headers.get('content-type');
    result.contentLength = res.headers.get('content-length');
  } catch (err: any) {
    result.error = err.name === 'AbortError' ? 'Timeout (8s)' : (err.message ?? 'Unknown error').slice(0, 120);
  }
  return result;
}

// ─── ROBOTS.TXT ───────────────────────────────────────────────────────────────

interface RobotsResult {
  blocksGooglebotImage: boolean;
  blocksGooglebot:      boolean;
  blocksAll:            boolean;
  fetchError:           string | null;
  snippet:              string;   // first 1500 chars for manual review
}

async function checkRobotsTxt(domain: string): Promise<RobotsResult> {
  const result: RobotsResult = {
    blocksGooglebotImage: false, blocksGooglebot: false,
    blocksAll: false, fetchError: null, snippet: '',
  };
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(`https://${domain}/robots.txt`, {
      signal: controller.signal,
      headers: { 'User-Agent': GOOGLEBOT_UA },
    });
    clearTimeout(timer);
    if (!res.ok) { result.fetchError = `HTTP ${res.status}`; return result; }
    const raw = await res.text();
    result.snippet = raw.slice(0, 1500);

    // Walk the robots.txt line by line and find Disallow: / (full-site block)
    // under any of the three relevant User-agent blocks.
    const lines = raw.split('\n').map(l => l.split('#')[0].trim()); // strip comments
    let ua: 'googlebot-image' | 'googlebot' | 'all' | null = null;
    for (const line of lines) {
      const lower = line.toLowerCase();
      if (lower.startsWith('user-agent:')) {
        const agent = lower.replace('user-agent:', '').trim();
        if (agent === 'googlebot-image') ua = 'googlebot-image';
        else if (agent === 'googlebot')  ua = 'googlebot';
        else if (agent === '*')          ua = 'all';
        else                             ua = null;
      } else if (lower.startsWith('disallow:') && ua) {
        const path = lower.replace('disallow:', '').trim();
        if (path === '/' || path === '') {
          if (ua === 'googlebot-image') result.blocksGooglebotImage = true;
          if (ua === 'googlebot')       result.blocksGooglebot = true;
          if (ua === 'all')             result.blocksAll = true;
        }
      }
    }
  } catch (err: any) {
    result.fetchError = err.name === 'AbortError'
      ? 'Timeout (5s)'
      : (err.message ?? 'Unknown error').slice(0, 80);
  }
  return result;
}

// ─── HELPERS ─────────────────────────────────────────────────────────────────

function hostname(url: string): string {
  try { return new URL(url).hostname; } catch { return 'unknown'; }
}

// ─── HANDLER ─────────────────────────────────────────────────────────────────

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'OPTIONS') return res.status(200).end();

  const action = (req.query.action as string) || 'audit';

  try {

    // ── cdn-check: probe every URL in IMAGE_MAP ─────────────────────────────
    if (action === 'cdn-check') {
      const uniqueUrls = [...new Set(Object.values(IMAGE_MAP))];
      const results: CdnResult[] = [];
      for (let i = 0; i < uniqueUrls.length; i++) {
        results.push(await probeCdnUrl(uniqueUrls[i]));
        if (i % 5 === 4) await delay(600);  // pause every 5 requests
      }
      const ok          = results.filter(r => r.ok).length;
      const redirected  = results.filter(r => !r.ok && r.redirected).length;
      const blocked     = results.filter(r => r.status !== null && r.status >= 400).length;
      const errors      = results.filter(r => r.error).length;
      return res.status(200).json({
        success: true,
        summary: { total: results.length, ok, redirected, blocked, errors },
        results,
      });
    }

    // ── robots-check: robots.txt for all IMAGE_MAP domains ──────────────────
    if (action === 'robots-check') {
      const domains = [
        ...new Set(Object.values(IMAGE_MAP).map(hostname))
      ].filter(d => d !== 'unknown');
      const results: Record<string, RobotsResult> = {};
      for (const domain of domains) {
        results[domain] = await checkRobotsTxt(domain);
        await delay(400);
      }
      const anyBlocked = Object.entries(results)
        .filter(([, r]) => r.blocksGooglebotImage || r.blocksGooglebot || r.blocksAll)
        .map(([domain]) => domain);
      return res.status(200).json({
        success: true,
        domainsChecked: domains.length,
        domainsBlocking: anyBlocked,
        results,
      });
    }

    // ── audit: full diagnostic ───────────────────────────────────────────────

    // 1. Fetch all Shopify products (images included)
    console.log('📦 Fetching all ct-sync products from Shopify...');
    const products = await fetchAllSyncedProducts();
    console.log(`✅ ${products.length} products fetched`);

    // 2. Find unique CDN URLs we need to probe (only for products missing images)
    const urlsNeeded = new Set<string>();
    for (const p of products) {
      if (!p.images || p.images.length === 0) {
        const url = getTireImageUrl(p.title);
        if (url) urlsNeeded.add(url);
      }
    }
    console.log(`🔍 Probing ${urlsNeeded.size} unique CDN URLs...`);

    // 3. Probe CDN URLs (deduplicated — each URL probed exactly once)
    const cdnCache = new Map<string, CdnResult>();
    let probeCount = 0;
    for (const url of urlsNeeded) {
      cdnCache.set(url, await probeCdnUrl(url));
      probeCount++;
      if (probeCount % 5 === 0) await delay(600);
    }

    // 4. Check robots.txt for domains that appear in missing-image products
    const domainsNeeded = new Set<string>();
    for (const url of urlsNeeded) domainsNeeded.add(hostname(url));
    const robotsCache = new Map<string, RobotsResult>();
    for (const domain of domainsNeeded) {
      robotsCache.set(domain, await checkRobotsTxt(domain));
      await delay(400);
    }

    // 5. Assemble per-product audit records
    interface ProductAudit {
      id:                number;
      title:             string;
      shopifyImageCount: number;
      shopifyImages:     Array<{ url: string; onShopifyCdn: boolean }>;
      mapUrl:            string | null;
      cdnResult:         CdnResult | null;
      robotsIssue:       string | null;
      diagnosis:         string;
      actionNeeded:      string;
    }

    const audited: ProductAudit[] = [];

    for (const p of products) {
      const shopifyImages = (p.images || []).map(img => ({
        url: img.src,
        onShopifyCdn: img.src?.includes('cdn.shopify.com') ?? false,
      }));
      const hasShopifyImage    = shopifyImages.length > 0;
      const hasShopifyCdnImage = shopifyImages.some(i => i.onShopifyCdn);

      const mapUrl    = getTireImageUrl(p.title) ?? null;
      const cdnResult = mapUrl ? (cdnCache.get(mapUrl) ?? null) : null;

      // robots.txt issue relevant to this product's CDN URL
      let robotsIssue: string | null = null;
      if (mapUrl) {
        const domain = hostname(mapUrl);
        const robots = robotsCache.get(domain);
        if (robots?.blocksGooglebotImage) robotsIssue = `${domain} blocks Googlebot-Image in robots.txt`;
        else if (robots?.blocksGooglebot) robotsIssue = `${domain} blocks Googlebot in robots.txt`;
        else if (robots?.blocksAll)       robotsIssue = `${domain} blocks all crawlers in robots.txt`;
      }

      let diagnosis:    string;
      let actionNeeded: string;

      if (hasShopifyCdnImage) {
        diagnosis    = '✅ OK';
        actionNeeded = 'none';
      } else if (hasShopifyImage && !hasShopifyCdnImage) {
        diagnosis    = '⚠️ EXTERNAL_URL_IN_SHOPIFY';
        actionNeeded = 'Re-attach image so Shopify re-hosts it on cdn.shopify.com';
      } else if (!hasShopifyImage && !mapUrl) {
        diagnosis    = '❌ NO_IMAGE_ANYWHERE';
        actionNeeded = 'Add IMAGE_MAP entry manually, then run backfill-images';
      } else if (!hasShopifyImage && mapUrl && cdnResult?.ok && !cdnResult.redirected && !robotsIssue) {
        diagnosis    = '⚠️ MISSING_IN_SHOPIFY — CDN reachable';
        actionNeeded = 'Run ?action=backfill-images in shopifySync — Shopify can download this URL';
      } else if (!hasShopifyImage && mapUrl && cdnResult?.redirected) {
        diagnosis    = '❌ MISSING_IN_SHOPIFY — CDN redirects';
        actionNeeded = 'Update IMAGE_MAP to the final redirect URL, then run backfill-images';
      } else if (!hasShopifyImage && mapUrl && cdnResult?.status && cdnResult.status >= 400) {
        diagnosis    = `❌ MISSING_IN_SHOPIFY — CDN blocked (HTTP ${cdnResult.status})`;
        actionNeeded = 'CDN rejects Googlebot-Image UA. Host images on Shopify Files or a public CDN instead';
      } else if (!hasShopifyImage && mapUrl && cdnResult?.error) {
        diagnosis    = `❌ MISSING_IN_SHOPIFY — CDN error: ${cdnResult.error}`;
        actionNeeded = 'CDN unreachable. Host images on Shopify Files or a public CDN instead';
      } else if (!hasShopifyImage && mapUrl && robotsIssue) {
        diagnosis    = `❌ MISSING_IN_SHOPIFY — robots.txt blocks Googlebot`;
        actionNeeded = 'CDN disallows Googlebot in robots.txt. Host images on Shopify Files instead';
      } else {
        diagnosis    = '❓ UNKNOWN';
        actionNeeded = 'Manual investigation needed';
      }

      audited.push({
        id: p.id, title: p.title,
        shopifyImageCount: shopifyImages.length,
        shopifyImages, mapUrl, cdnResult, robotsIssue,
        diagnosis, actionNeeded,
      });
    }

    // 6. Build summary buckets
    const byDiagnosis = {
      ok:                   audited.filter(a => a.diagnosis.startsWith('✅')),
      missing_cdn_reachable: audited.filter(a => a.diagnosis.includes('CDN reachable')),
      missing_cdn_redirects: audited.filter(a => a.diagnosis.includes('CDN redirects')),
      missing_cdn_blocked:   audited.filter(a => a.diagnosis.includes('CDN blocked')),
      missing_cdn_error:     audited.filter(a => a.diagnosis.includes('CDN error')),
      no_image_anywhere:     audited.filter(a => a.diagnosis.includes('NO_IMAGE_ANYWHERE')),
      external_url_in_shopify: audited.filter(a => a.diagnosis.includes('EXTERNAL_URL_IN_SHOPIFY')),
      unknown:               audited.filter(a => a.diagnosis.startsWith('❓')),
    };

    // Domain-level CDN breakdown
    const domainStats: Record<string, { ok: number; redirected: number; blocked: number; errored: number }> = {};
    for (const [url, r] of cdnCache.entries()) {
      const d = hostname(url);
      if (!domainStats[d]) domainStats[d] = { ok: 0, redirected: 0, blocked: 0, errored: 0 };
      if (r.ok && !r.redirected)             domainStats[d].ok++;
      else if (r.redirected)                 domainStats[d].redirected++;
      else if (r.status && r.status >= 400)  domainStats[d].blocked++;
      else if (r.error)                      domainStats[d].errored++;
    }

    return res.status(200).json({
      success: true,

      summary: {
        totalProducts:             products.length,
        ok:                        byDiagnosis.ok.length,
        missingInShopify:          products.length - byDiagnosis.ok.length - byDiagnosis.external_url_in_shopify.length,
        externalUrlInShopify:      byDiagnosis.external_url_in_shopify.length,
        noImageAnywhere:           byDiagnosis.no_image_anywhere.length,
        // Of the missing ones — what can we do about them?
        canFixWithBackfill:        byDiagnosis.missing_cdn_reachable.length,
        needsUrlUpdate:            byDiagnosis.missing_cdn_redirects.length,
        needsNewImageSource:       byDiagnosis.missing_cdn_blocked.length + byDiagnosis.missing_cdn_error.length,
      },

      // What to do next, grouped by action
      actionPlan: {
        run_backfill_now: byDiagnosis.missing_cdn_reachable.map(a => ({
          title: a.title, shopifyId: a.id, mapUrl: a.mapUrl,
        })),
        update_image_map_url: byDiagnosis.missing_cdn_redirects.map(a => ({
          title: a.title, shopifyId: a.id,
          currentUrl: a.mapUrl, finalUrl: a.cdnResult?.finalUrl,
        })),
        needs_new_image_source: [
          ...byDiagnosis.missing_cdn_blocked,
          ...byDiagnosis.missing_cdn_error,
        ].map(a => ({
          title: a.title, shopifyId: a.id,
          mapUrl: a.mapUrl, reason: a.diagnosis,
        })),
        add_to_image_map: byDiagnosis.no_image_anywhere.map(a => ({
          title: a.title, shopifyId: a.id,
        })),
        re_attach_external: byDiagnosis.external_url_in_shopify.map(a => ({
          title: a.title, shopifyId: a.id,
          currentImages: a.shopifyImages,
        })),
      },

      // Per-CDN-domain health breakdown
      domainStats,

      // robots.txt per domain (only domains relevant to missing products)
      robotsTxt: Object.fromEntries(robotsCache.entries()),

      // Full per-product detail
      products: audited,
    });

  } catch (err: any) {
    console.error('❌ imageAudit error:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
}
