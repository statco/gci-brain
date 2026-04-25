// api/blog-publisher.ts
// ─────────────────────────────────────────────────────────────────────────────
// GCI Tires — Automated Bilingual Blog Publisher
//
// Runs every Monday at 7am ET via Vercel cron.
// Generates 2 EN + 2 FR SEO blog posts using Claude API and publishes
// them directly to Shopify Blog. Zero manual work after setup.
//
// GET  /api/blog-publisher?action=preview   — show next posts without publishing
// GET  /api/blog-publisher?action=run       — generate + publish (cron trigger)
// GET  /api/blog-publisher?action=keywords  — list remaining keyword queue
// ─────────────────────────────────────────────────────────────────────────────

import type { VercelRequest, VercelResponse } from '@vercel/node';

export const config = { maxDuration: 300 };

const SHOPIFY_DOMAIN = process.env.SHOPIFY_STORE_DOMAIN!;
const SHOPIFY_TOKEN  = process.env.SHOPIFY_ADMIN_ACCESS_TOKEN!;
const CLAUDE_API_KEY = process.env.ANTHROPIC_API_KEY!;
const SHOPIFY_BASE   = `https://${SHOPIFY_DOMAIN}/admin/api/2024-01`;
const CLAUDE_MODEL   = 'claude-sonnet-4-20250514';

// ─── Keyword queues ───────────────────────────────────────────────────────────
// Rotated weekly — each run picks the next 2 EN + 2 FR topics.
// Add more as needed; the index advances and wraps around.

const EN_KEYWORDS = [
  'best winter tires Canada 2026',
  'winter tires vs all-weather tires Canada',
  'how to choose tires for your SUV Ontario',
  'Cooper vs Nexen tires comparison Canada',
  'online tire delivery Toronto',
  'all-weather tires Quebec winter law compliant',
  'best tires for Canadian winters',
  'how to read tire size numbers',
  'when to change winter tires Ontario',
  'tire installation cost Canada',
  'all-season vs all-weather tires difference',
  'Vredestein tires review Canada',
  'buy tires online Canada free shipping',
  'winter tire guide for SUV drivers Canada',
  'best all-terrain tires for Ontario trucks',
];

const FR_KEYWORDS = [
  'meilleurs pneus hiver Québec 2026',
  'pneus hiver obligatoires Québec loi',
  'pneus d\'hiver vs pneus quatre saisons Québec',
  'acheter pneus en ligne Québec livraison gratuite',
  'meilleurs pneus pour VUS hiver Montréal',
  'Nexen pneus avis Québec',
  'pneus hiver homologués Québec date limite décembre',
  'comment lire la taille des pneus',
  'pneus Minerva avis Québec',
  'coût installation pneus Montréal',
  'pneus quatre saisons homologués flocon Québec',
  'Cooper pneus hiver Québec comparaison',
  'meilleurs pneus toutes saisons Montréal',
  'quand changer pneus hiver Québec',
  'pneus livraison domicile Montréal',
];

// ─── Shopify helpers ──────────────────────────────────────────────────────────

async function shopifyGet<T>(path: string): Promise<T> {
  const res = await fetch(`${SHOPIFY_BASE}${path}`, {
    headers: { 'X-Shopify-Access-Token': SHOPIFY_TOKEN, 'Content-Type': 'application/json' },
  });
  if (!res.ok) throw new Error(`Shopify GET ${path} → ${res.status}: ${await res.text()}`);
  return res.json() as Promise<T>;
}

async function shopifyPost<T>(path: string, body: object): Promise<T> {
  const res = await fetch(`${SHOPIFY_BASE}${path}`, {
    method: 'POST',
    headers: { 'X-Shopify-Access-Token': SHOPIFY_TOKEN, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Shopify POST ${path} → ${res.status}: ${await res.text()}`);
  return res.json() as Promise<T>;
}

// Get or create the main blog (first blog found, or create "GCI Blog")
async function getBlogId(): Promise<number> {
  const data: any = await shopifyGet('/blogs.json?limit=5');
  const blogs = data.blogs || [];
  if (blogs.length > 0) return blogs[0].id;
  const created: any = await shopifyPost('/blogs.json', { blog: { title: 'GCI Tires Blog' } });
  return created.blog.id;
}

// ─── Claude content generation ────────────────────────────────────────────────

interface GeneratedPost {
  title:           string;
  metaTitle:       string;
  metaDescription: string;
  bodyHtml:        string;
  tags:            string;
  lang:            'en' | 'fr';
  keyword:         string;
}

async function generatePost(keyword: string, lang: 'en' | 'fr'): Promise<GeneratedPost> {
  const systemPrompt = lang === 'en'
    ? `You are a Canadian automotive content writer for GCI Tires (gcitires.com), an AI-powered online tire retailer serving Ontario and Quebec. Write SEO-optimized blog posts in clear Canadian English. Always mention free shipping, the GCI AI Match 2.0 tire advisor, and Canada Tire Inc. as our trusted distributor (est. 1928). Brands carried: Cooper, Nexen, Vredestein, Minerva (Canada Tire exclusive), Ovation, Maxtrek. Tone: knowledgeable, trustworthy, practical, Canadian. Never use American spellings (use "tyre" never, use "tire"; "centre" not "center" for Canadian English context is fine either way). Always include an internal link to the AI Match tool.`
    : `Tu es un rédacteur de contenu automobile canadien pour GCI Tires (gcitires.com), un détaillant de pneus en ligne propulsé par l'IA qui dessert l'Ontario et le Québec. Écris des articles de blogue optimisés pour le référencement en français québécois clair. Mentionne toujours la livraison gratuite, l'outil GCI AI Match 2.0, et Canada Tire Inc. comme distributeur de confiance (est. 1928). Marques offertes : Cooper, Nexen, Vredestein, Minerva (exclusivité Canada Tire), Ovation, Maxtrek. Ton : expert, fiable, pratique, québécois. Inclus toujours la loi québécoise sur les pneus d'hiver obligatoires (1er décembre au 15 mars) lorsque pertinent. Ajoute un lien interne vers l'outil AI Match.`;

  const userPrompt = lang === 'en'
    ? `Write a complete SEO blog post for the keyword: "${keyword}"

Return ONLY valid JSON with exactly these fields (no markdown, no explanation):
{
  "title": "H1 blog post title (60 chars max, includes keyword)",
  "metaTitle": "SEO meta title (55 chars max)",
  "metaDescription": "SEO meta description (155 chars max, compelling, includes keyword)",
  "bodyHtml": "Complete HTML body — include: intro paragraph, 3-4 H2 sections with 2-3 paragraphs each, one FAQ section (3 questions), closing CTA linking to https://gcitires.com/en-ca/pages/gci-ai-match-2-0. Use <h2>, <p>, <ul>, <strong> tags. 750-900 words. No <html>/<body> wrapper.",
  "tags": "comma-separated tags: tire type, season, brand(s) mentioned, province if relevant"
}`
    : `Rédige un article de blogue SEO complet pour le mot-clé : "${keyword}"

Retourne UNIQUEMENT du JSON valide avec exactement ces champs (sans markdown, sans explication) :
{
  "title": "Titre H1 de l'article (60 caractères max, inclut le mot-clé)",
  "metaTitle": "Balise meta title SEO (55 caractères max)",
  "metaDescription": "Meta description SEO (155 caractères max, convaincante, inclut le mot-clé)",
  "bodyHtml": "Corps HTML complet — inclus : paragraphe d'intro, 3-4 sections H2 avec 2-3 paragraphes chacune, une section FAQ (3 questions), CTA final avec lien vers https://gcitires.com/fr-ca/pages/gci-ai-match-2-0. Utilise les balises <h2>, <p>, <ul>, <strong>. 750-900 mots. Pas de balise <html>/<body>.",
  "tags": "tags séparés par des virgules : type de pneu, saison, marque(s) mentionnée(s), province si pertinent"
}`;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key':         CLAUDE_API_KEY,
      'anthropic-version': '2023-06-01',
      'Content-Type':      'application/json',
    },
    body: JSON.stringify({
      model:      CLAUDE_MODEL,
      max_tokens: 2000,
      system:     systemPrompt,
      messages:   [{ role: 'user', content: userPrompt }],
    }),
  });

  if (!res.ok) throw new Error(`Claude API → ${res.status}: ${await res.text()}`);
  const data: any = await res.json();
  const raw = data.content?.[0]?.text || '';

  // Strip any markdown fences if Claude wrapped output
  const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
  const parsed  = JSON.parse(cleaned);

  return {
    title:           parsed.title,
    metaTitle:       parsed.metaTitle,
    metaDescription: parsed.metaDescription,
    bodyHtml:        parsed.bodyHtml,
    tags:            parsed.tags,
    lang,
    keyword,
  };
}

// ─── Shopify article creation ─────────────────────────────────────────────────

async function publishPost(blogId: number, post: GeneratedPost): Promise<{ id: number; handle: string; url: string }> {
  const authorName = post.lang === 'fr' ? 'Équipe GCI Tires' : 'GCI Tires Team';

  const articleBody = {
    article: {
      title:            post.title,
      body_html:        post.bodyHtml,
      author:           authorName,
      tags:             `${post.tags}, blog-auto, lang-${post.lang}`,
      published:        true,
      metafields: [
        { namespace: 'seo', key: 'title',       value: post.metaTitle,       type: 'single_line_text_field' },
        { namespace: 'seo', key: 'description', value: post.metaDescription, type: 'single_line_text_field' },
      ],
    },
  };

  const data: any = await shopifyPost(`/blogs/${blogId}/articles.json`, articleBody);
  const article = data.article;
  return {
    id:     article.id,
    handle: article.handle,
    url:    `https://gcitires.com/blogs/${article.blog_id}/${article.handle}`,
  };
}

// ─── Keyword rotation ─────────────────────────────────────────────────────────
// Uses a simple week-number-based index so the cron always picks different topics.

function getThisWeeksKeywords(): { en: string[]; fr: string[] } {
  const weekNum  = Math.floor(Date.now() / (7 * 24 * 60 * 60 * 1000));
  const enStart  = (weekNum * 2) % EN_KEYWORDS.length;
  const frStart  = (weekNum * 2) % FR_KEYWORDS.length;
  return {
    en: [EN_KEYWORDS[enStart], EN_KEYWORDS[(enStart + 1) % EN_KEYWORDS.length]],
    fr: [FR_KEYWORDS[frStart], FR_KEYWORDS[(frStart + 1) % FR_KEYWORDS.length]],
  };
}

// ─── Handler ──────────────────────────────────────────────────────────────────

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  const action = (req.query.action as string) || 'run';

  if (action === 'keywords') {
    const thisWeek = getThisWeeksKeywords();
    return res.status(200).json({
      success: true,
      thisWeek,
      allEn: EN_KEYWORDS,
      allFr: FR_KEYWORDS,
    });
  }

  const keywords = getThisWeeksKeywords();
  const allKeywords = [
    ...keywords.en.map(k => ({ keyword: k, lang: 'en' as const })),
    ...keywords.fr.map(k => ({ keyword: k, lang: 'fr' as const })),
  ];

  if (action === 'preview') {
    return res.status(200).json({
      success:  true,
      mode:     'preview',
      postsToGenerate: allKeywords,
      note: 'Call ?action=run to generate and publish these posts.',
    });
  }

  // action === 'run' — generate + publish
  try {
    const blogId  = await getBlogId();
    const results = [];
    const errors  = [];

    for (const { keyword, lang } of allKeywords) {
      try {
        console.log(`📝 Generating [${lang.toUpperCase()}]: "${keyword}"`);
        const post      = await generatePost(keyword, lang);
        const published = await publishPost(blogId, post);
        console.log(`✅ Published: ${published.url}`);
        results.push({ keyword, lang, ...published, title: post.title });
      } catch (err: any) {
        console.error(`❌ Failed [${lang}] "${keyword}":`, err.message);
        errors.push({ keyword, lang, error: err.message });
      }
    }

    return res.status(200).json({
      success:   errors.length < allKeywords.length,
      published: results.length,
      failed:    errors.length,
      results,
      errors,
      nextRun:   'Next Monday 7am ET (via Vercel cron)',
    });
  } catch (err: any) {
    console.error('❌ blog-publisher fatal:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
}
