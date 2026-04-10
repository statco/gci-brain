import type { VercelRequest, VercelResponse } from '@vercel/node';

export default function handler(_req: VercelRequest, res: VercelResponse) {
  res.json({
    domain: process.env.SHOPIFY_STORE_DOMAIN,
    tokenPrefix: process.env.SHOPIFY_ADMIN_ACCESS_TOKEN?.slice(0, 10),
    tokenLength: process.env.SHOPIFY_ADMIN_ACCESS_TOKEN?.length,
  });
}
