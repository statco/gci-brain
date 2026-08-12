// lib/seoDrift.ts
// ============================================================
// SEO Drift Protection
//
// Problem: updateSeo.ts and fixTireSize.ts regenerate title_tag,
// description_tag, and body_html from templates on every run —
// with no way to tell a human-edited value (from Pat or the SEO
// agency, made directly in Shopify admin) from one the automation
// itself last wrote. That silently destroys manual SEO work.
//
// Fix: before writing a field, compare its CURRENT live value to
// the BASELINE we stored the last time *we* wrote it (namespace
// "seo_sync", key "<field>_hash" — same pattern as the existing
// canada_tire.cost_synced_at freshness stamp).
//
//   - No baseline exists yet    → unknown provenance. Do NOT write.
//                                  Seed the baseline from the current
//                                  value so future runs can detect
//                                  drift from this point forward.
//   - Baseline matches current  → nobody has touched it since our
//                                  last write. Safe to regenerate.
//   - Baseline differs          → a human changed it since our last
//                                  write. Do NOT write. Adopt their
//                                  value as the new baseline so we
//                                  don't keep re-flagging it forever.
//
// This requires zero process change from Pat or the agency — it
// self-heals from whatever state the field is actually in.
// ============================================================

import crypto from 'crypto';

const SHOPIFY = {
  domain: process.env.SHOPIFY_STORE_DOMAIN || '',
  token:  process.env.SHOPIFY_ADMIN_ACCESS_TOKEN || process.env.SHOPIFY_ADMIN_API_TOKEN || '',
  apiVersion: '2024-01',
  get baseUrl() { return `https://${this.domain}/admin/api/${this.apiVersion}`; },
};

const NAMESPACE = 'seo_sync';

interface ShopifyMetafield {
  id: number;
  namespace: string;
  key: string;
  value: string;
}

async function shopifyFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`${SHOPIFY.baseUrl}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': SHOPIFY.token,
      ...(options.headers ?? {}),
    },
  });
  if (!res.ok) throw new Error(`Shopify ${res.status} — ${path}: ${(await res.text()).slice(0, 200)}`);
  if (res.status === 204) return {} as T;
  return res.json() as Promise<T>;
}

function hash(value: string): string {
  return crypto.createHash('sha256').update(value ?? '').digest('hex').slice(0, 16);
}

export type DriftCheck =
  | { safe: true;  reason: 'unchanged_since_last_write' }
  | { safe: false; reason: 'no_baseline_yet' | 'edited_by_human' };

// Fetch all seo_sync metafields for a product in one call — callers checking
// multiple fields (title_tag + description_tag + body_html) should call this
// once and reuse the result rather than re-fetching per field.
export async function getSeoSyncMetafields(productId: number): Promise<ShopifyMetafield[]> {
  const data: any = await shopifyFetch(`/products/${productId}/metafields.json?namespace=${NAMESPACE}`);
  return (data.metafields ?? []) as ShopifyMetafield[];
}

async function upsertBaseline(productId: number, fieldKey: string, currentValue: string, existing: ShopifyMetafield[]): Promise<void> {
  const key = `${fieldKey}_hash`;
  const newHash = hash(currentValue);
  const found = existing.find(m => m.key === key);
  if (found) {
    if (found.value === newHash) return; // already correct
    await shopifyFetch(`/metafields/${found.id}.json`, {
      method: 'PUT',
      body: JSON.stringify({ metafield: { id: found.id, value: newHash } }),
    });
  } else {
    await shopifyFetch(`/products/${productId}/metafields.json`, {
      method: 'POST',
      body: JSON.stringify({
        metafield: { namespace: NAMESPACE, key, value: newHash, type: 'single_line_text_field' },
      }),
    });
  }
}

// Call BEFORE writing a generated value. Pass the field's CURRENT live value
// (fetched fresh, e.g. product.body_html or the title_tag/description_tag
// metafield value) — not the value you're about to write.
//
// If safe === false, do not write — this function has already taken care of
// seeding/adopting the new baseline, so the caller only needs to skip.
// If safe === true, proceed with the write, THEN call recordBaseline() with
// the NEW value once the write succeeds.
export async function checkDrift(
  productId: number,
  fieldKey: 'title_tag' | 'description_tag' | 'body_html',
  currentValue: string,
  existingSeoSyncMetafields: ShopifyMetafield[],
  options: { preview?: boolean } = {},
): Promise<DriftCheck> {
  const baselineKey = `${fieldKey}_hash`;
  const baseline = existingSeoSyncMetafields.find(m => m.key === baselineKey);

  if (!baseline) {
    // Unknown provenance — protect by default. In preview mode, report the
    // decision without writing anything (no baseline seeded yet).
    if (!options.preview) {
      await upsertBaseline(productId, fieldKey, currentValue, existingSeoSyncMetafields);
    }
    return { safe: false, reason: 'no_baseline_yet' };
  }

  if (baseline.value === hash(currentValue)) {
    return { safe: true, reason: 'unchanged_since_last_write' };
  }

  // Value differs from what we last wrote — a human changed it since. In
  // preview mode, just report it; a real run would adopt their value here.
  if (!options.preview) {
    await upsertBaseline(productId, fieldKey, currentValue, existingSeoSyncMetafields);
  }
  return { safe: false, reason: 'edited_by_human' };
}

// Call AFTER successfully writing a generated value, so the baseline reflects
// what the automation itself just wrote (used for the next run's comparison).
export async function recordBaseline(
  productId: number,
  fieldKey: 'title_tag' | 'description_tag' | 'body_html',
  newValue: string,
  existingSeoSyncMetafields: ShopifyMetafield[],
): Promise<void> {
  await upsertBaseline(productId, fieldKey, newValue, existingSeoSyncMetafields);
}
