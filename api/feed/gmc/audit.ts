// api/feed/gmc/audit.ts
// GCI Tires — GMC Feed Audit Endpoint
// Returns a JSON report of feed quality issues per product/variant.
// Run manually or wire up to a dashboard.
//
// GET /api/feed/gmc/audit?secret=xxx
// GET /api/feed/gmc/audit?secret=xxx&fix=1   (future: auto-fix mode)
import type { VercelRequest, VercelResponse } from '@vercel/node';
const SHOPIFY_DOMAIN = process.env.SHOPIFY_STORE_DOMAIN!;
const SHOPIFY_TOKEN  = process.env.SHOPIFY_ADMIN_API_TOKEN!;
const STOREFRONT_URL = 'https://gcitires.com';
// ─── Types ───────────────────────────────────────────────────────────────────
type Severity = 'error' | 'warning' | 'info';
interface Issue {
  code: string;
  severity: Severity;
  message: string;
  field?: string;
}
interface VariantReport {
  variant_id: number;
  sku: string;
  title: string;
  price: string;
  availability: string;
  issues: Issue[];
}
interface ProductReport {
  product_id: number;
  product_title: string;
  handle: string;
  url: string;
  vendor: string;
  tags: string[];
  variant_count: number;
  variants: VariantReport[];
  product_issues: Issue[];
}
interface AuditSummary {
  generated_at: string;
  total_products: number;
  total_variants: number;
  products_with_errors: number;
  products_with_warnings: number;
  clean_products: number;
  error_breakdown: Record<string, number>;
  products: ProductReport[];
}
// ─── Shopify fetch (same as feed endpoint) ───────────────────────────────────
interface ShopifyVariant {
  id: number;
  title: string;
  price: string;
  sku: string;
  barcode: string | null;
  inventory_quantity: number;
  inventory_management: string | null;
  inventory_policy: 'deny' | 'continue';
  image_id: number | null;
}
interface ShopifyImage {
  id: number;
  src: string;
}
interface ShopifyProduct {
  id: number;
  title: string;
  handle: string;
  body_html: string;
  vendor: string;
  tags: string;
  status: string;
  images: ShopifyImage[];
  variants: ShopifyVariant[];
}
async function fetchAllProducts(): Promise<ShopifyProduct[]> {
  const products: ShopifyProduct[] = [];
  let url: string | null =
    `https://${SHOPIFY_DOMAIN}/admin/api/2024-01/products.json?limit=250&status=active&fields=id,title,handle,body_html,vendor,tags,images,variants`;
  while (url) {
    const res = await fetch(url, {
      headers: { 'X-Shopify-Access-Token': SHOPIFY_TOKEN },
    });
    if (!res.ok) throw new Error(`Shopify ${res.status}: ${await res.text()}`);
    const data = await res.json() as { products?: ShopifyProduct[] };
    products.push(...(data.products ?? []));
    const link = res.headers.get('Link') ?? '';
    url = link.match(/<([^>]+)>;\s*rel="next"/)?.[1] ?? null;
  }
  return products;
}
// ─── Rules ───────────────────────────────────────────────────────────────────
function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}
function tagValue(tags: string[], prefix: string): string {
  const normalized = prefix.toLowerCase();
  const match = tags.find(t => t.toLowerCase().startsWith(normalized + ':'));
  return match ? match.slice(prefix.length + 1).trim() : '';
}
function auditProduct(product: ShopifyProduct): { productIssues: Issue[]; variantReports: VariantReport[] } {
  const productIssues: Issue[] = [];
  const tags = product.tags.split(',').map(t => t.trim()).filter(Boolean);
  const description = stripHtml(product.body_html || '');
  // ── Product-level rules ──────────────────────────────────────
  if (!product.vendor || product.vendor.trim() === '') {
    productIssues.push({ code: 'MISSING_BRAND', severity: 'error', field: 'vendor', message: 'No brand/vendor set — GMC requires a brand.' });
  }
  if (!product.images || product.images.length === 0) {
    productIssues.push({ code: 'NO_IMAGE', severity: 'error', field: 'image_link', message: 'No product images — GMC will reject this product.' });
  } else if (product.images.length === 1) {
    productIssues.push({ code: 'SINGLE_IMAGE', severity: 'warning', field: 'additional_image_link', message: 'Only one image. Additional images improve CTR.' });
  }
  if (!description || description.length < 50) {
    productIssues.push({ code: 'SHORT_DESCRIPTION', severity: 'warning', field: 'description', message: `Description too short (${description.length} chars). Aim for 150–500 chars.` });
  } else if (description.length > 5000) {
    productIssues.push({ code: 'LONG_DESCRIPTION', severity: 'info', field: 'description', message: `Description will be truncated at 5000 chars (currently ${description.length}).` });
  }
  const season = tagValue(tags, 'season') || tagValue(tags, 'saison');
  if (!season) {
    productIssues.push({ code: 'MISSING_SEASON_TAG', severity: 'warning', field: 'custom_label_0', message: 'No season: tag found. custom_label_0 will be empty.' });
  }
  const vehicleType = tagValue(tags, 'vehicle_type') || tagValue(tags, 'type_vehicule');
  if (!vehicleType) {
    productIssues.push({ code: 'MISSING_VEHICLE_TYPE_TAG', severity: 'warning', field: 'custom_label_1', message: 'No vehicle_type: tag found. custom_label_1 will be empty.' });
  }
  if (product.title.length > 150) {
    productIssues.push({ code: 'LONG_TITLE', severity: 'info', field: 'title', message: `Product title is ${product.title.length} chars. GMC truncates at 150.` });
  }
  // ── Variant-level rules ──────────────────────────────────────
  const variantReports: VariantReport[] = product.variants.map(variant => {
    const issues: Issue[] = [];
    const price = parseFloat(variant.price);
    if (!variant.price || price <= 0) {
      issues.push({ code: 'ZERO_PRICE', severity: 'error', field: 'price', message: 'Price is $0 or missing — variant will be skipped from feed.' });
    } else if (price < 20) {
      issues.push({ code: 'SUSPICIOUSLY_LOW_PRICE', severity: 'warning', field: 'price', message: `Price $${price} is very low for a tire — verify this is correct.` });
    }
    if (!variant.sku || variant.sku.trim() === '') {
      issues.push({ code: 'MISSING_SKU', severity: 'warning', field: 'mpn', message: 'No SKU set. MPN/SKU helps GMC match your product.' });
    }
    const avail = variant.inventory_management === null
      ? 'in stock'
      : variant.inventory_quantity > 0
        ? 'in stock'
        : variant.inventory_policy === 'continue'
          ? 'in stock'
          : 'out of stock';
    if (avail === 'out of stock') {
      issues.push({ code: 'OUT_OF_STOCK', severity: 'info', field: 'availability', message: 'Variant is out of stock and will still appear in feed (reduces impressions).' });
    }
    if (variant.inventory_quantity < 0) {
      issues.push({ code: 'NEGATIVE_INVENTORY', severity: 'warning', field: 'availability', message: `Inventory is ${variant.inventory_quantity}. Verify inventory tracking is set correctly.` });
    }
    const variantImage = product.images.find(img => img.id === variant.image_id);
    if (!variantImage && product.images.length === 0) {
      issues.push({ code: 'NO_VARIANT_IMAGE', severity: 'error', field: 'image_link', message: 'No image for this variant and no product images either.' });
    }
    return {
      variant_id:   variant.id,
      sku:          variant.sku || '',
      title:        variant.title,
      price:        `$${price.toFixed(2)} CAD`,
      availability: avail,
      issues,
    };
  });
  return { productIssues, variantReports };
}
// ─── Handler ─────────────────────────────────────────────────────────────────
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const feedSecret = process.env.FEED_SECRET;
  if (feedSecret && req.query.secret !== feedSecret) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  try {
    const products = await fetchAllProducts();
    const errorBreakdown: Record<string, number> = {};
    const productReports: ProductReport[] = [];
    let productsWithErrors   = 0;
    let productsWithWarnings = 0;
    let totalVariants        = 0;
    for (const product of products) {
      const { productIssues, variantReports } = auditProduct(product);
      const tags = product.tags.split(',').map(t => t.trim()).filter(Boolean);
      const allIssues = [
        ...productIssues,
        ...variantReports.flatMap(v => v.issues),
      ];
      const hasErrors   = allIssues.some(i => i.severity === 'error');
      const hasWarnings = allIssues.some(i => i.severity === 'warning');
      if (hasErrors)   productsWithErrors++;
      if (hasWarnings && !hasErrors) productsWithWarnings++;
      for (const issue of allIssues) {
        errorBreakdown[issue.code] = (errorBreakdown[issue.code] ?? 0) + 1;
      }
      totalVariants += variantReports.length;
      productReports.push({
        product_id:     product.id,
        product_title:  product.title,
        handle:         product.handle,
        url:            `${STOREFRONT_URL}/products/${product.handle}`,
        vendor:         product.vendor,
        tags,
        variant_count:  product.variants.length,
        variants:       variantReports,
        product_issues: productIssues,
      });
    }
    const summary: AuditSummary = {
      generated_at:           new Date().toISOString(),
      total_products:          products.length,
      total_variants:          totalVariants,
      products_with_errors:    productsWithErrors,
      products_with_warnings:  productsWithWarnings,
      clean_products:          products.length - productsWithErrors - productsWithWarnings,
      error_breakdown:         errorBreakdown,
      // Sort: errors first, then warnings, then clean
      products: productReports.sort((a, b) => {
        const score = (p: ProductReport) => {
          const issues = [...p.product_issues, ...p.variants.flatMap(v => v.issues)];
          if (issues.some(i => i.severity === 'error'))   return 2;
          if (issues.some(i => i.severity === 'warning')) return 1;
          return 0;
        };
        return score(b) - score(a);
      }),
    };
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json(summary);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[feed/gmc/audit] Error:', message);
    return res.status(500).json({ error: message });
  }
}
