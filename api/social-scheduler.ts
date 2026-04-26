// api/social-scheduler.ts
// ─────────────────────────────────────────────────────────────────────────────
// GCI Tires — Weekly Social Media Auto-Scheduler
//
// Every Sunday 6pm ET: generates a full week of social content via Claude API
// and sends it to Make.com via webhook for auto-publishing.
//
// Architecture:
//   gci-brain → Claude API (content) → Make.com webhook → Instagram/Facebook/Pinterest
//
// Make.com setup (free tier — 1,000 ops/month, ~40 posts/month needed):
//   1. Create a new scenario at make.com
//   2. Add trigger: Webhooks > Custom Webhook → copy URL
//   3. Add modules: Instagram for Business, Facebook Pages, Pinterest
//   4. Route by {{platform}} field in payload
//   5. Paste webhook URL into MAKE_WEBHOOK_URL env var in Vercel
//
// Env vars required:
//   ANTHROPIC_API_KEY   — already set
//   MAKE_WEBHOOK_URL    — from Make.com Custom Webhook trigger
//
// Schedule (10 posts/week, stays within Make.com free 1,000 ops/month):
//   Instagram (@gcitires)      — Mon / Wed / Fri  10am ET
//   Facebook  (gcitirescanada) — Tue / Thu        12pm ET
//   Pinterest (gci_tires)      — Mon–Fri           2pm ET
//
// GET /api/social-scheduler?action=preview  — show schedule + theme, no sending
// GET /api/social-scheduler?action=run      — generate + send to Make.com
// GET /api/social-scheduler?action=tiktok   — TikTok + YouTube scripts only
// ─────────────────────────────────────────────────────────────────────────────

import type { VercelRequest, VercelResponse } from '@vercel/node';

export const config = { maxDuration: 300 };

const CLAUDE_KEY   = process.env.ANTHROPIC_API_KEY!;
const MAKE_WEBHOOK = process.env.MAKE_WEBHOOK_URL!;
const CLAUDE_MODEL = 'claude-sonnet-4-20250514';

// ─── Weekly content themes ────────────────────────────────────────────────────

const WEEKLY_THEMES = [
  { en: 'winter tire safety tips',           fr: 'conseils sécurité pneus hiver' },
  { en: 'all-weather tires vs winter tires', fr: 'pneus quatre saisons vs hiver' },
  { en: 'how to buy tires online Canada',    fr: 'acheter pneus en ligne Québec' },
  { en: 'Quebec mandatory winter tire law',  fr: 'loi pneus hiver obligatoires Québec' },
  { en: 'best tires for SUVs Canada',        fr: 'meilleurs pneus VUS Canada' },
  { en: 'tire installation made easy',       fr: 'installation pneus sans stress' },
  { en: 'Cooper Tire highlights Canada',     fr: 'pneus Cooper avis Canada' },
  { en: 'Nexen winter performance review',   fr: 'Nexen performance hiver Québec' },
  { en: 'Minerva exclusive Canada Tire',     fr: 'Minerva exclusivité Canada Tire' },
  { en: 'spring tire changeover guide',      fr: 'guide changement pneus printemps' },
  { en: 'how to read tire size numbers',     fr: 'comprendre les tailles de pneus' },
  { en: 'free tire delivery across Canada',  fr: 'livraison pneus gratuite Canada' },
];

function getThisWeeksTheme() {
  const week = Math.floor(Date.now() / (7 * 24 * 60 * 60 * 1000));
  return WEEKLY_THEMES[week % WEEKLY_THEMES.length];
}

// ─── Post schedule ────────────────────────────────────────────────────────────

function getSchedule() {
  const now = new Date();
  const dayOfWeek = now.getUTCDay();
  const daysToMon = dayOfWeek === 1 ? 0 : (8 - dayOfWeek) % 7 || 7;
  const mon = new Date(now);
  mon.setUTCDate(now.getUTCDate() + daysToMon);

  const slot = (daysFromMon: number, utcHour: number) => {
    const d = new Date(mon);
    d.setUTCDate(mon.getUTCDate() + daysFromMon);
    d.setUTCHours(utcHour, 0, 0, 0);
    return d.toISOString();
  };

  return {
    instagram: [slot(0, 14), slot(2, 14), slot(4, 14)],
    facebook:  [slot(1, 16), slot(3, 16)],
    pinterest: [slot(0, 18), slot(1, 18), slot(2, 18), slot(3, 18), slot(4, 18)],
  };
}

// ─── Claude API ───────────────────────────────────────────────────────────────

async function callClaude(prompt: string): Promise<string> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method:  'POST',
    headers: { 'x-api-key': CLAUDE_KEY, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: CLAUDE_MODEL, max_tokens: 800, messages: [{ role: 'user', content: prompt }] }),
  });
  if (!res.ok) throw new Error(`Claude ${res.status}: ${await res.text()}`);
  const d: any = await res.json();
  return d.content?.[0]?.text?.trim() || '';
}

const CTX = (theme: string) =>
  `GCI Tires (gcitires.com) — Canadian online tire retailer. Brands: Cooper, Nexen, Vredestein, Minerva (Canada Tire exclusive with Road Hazard warranty + 30-day trial). Free shipping. AI Match 2.0 tire advisor. Markets: Ontario + Quebec. Always end with a CTA to gcitires.com. This week's theme: "${theme}".`;

// ─── Content generation ───────────────────────────────────────────────────────

interface Post {
  platform:    'instagram' | 'facebook' | 'pinterest';
  lang:        'en' | 'fr';
  caption:     string;
  hashtags:    string;
  scheduledAt: string;
  board?:      string;
}

async function generatePosts(theme: { en: string; fr: string }): Promise<Post[]> {
  const sched = getSchedule();
  const posts: Post[] = [];

  // Instagram: Mon (EN) · Wed (FR) · Fri (bilingual)
  const igPrompts = [
    { lang: 'en' as const, prompt: `${CTX(theme.en)}\n\nWrite an Instagram caption in English. Strong hook, 3–4 sentences. Blank line then 12 hashtags.\nFormat:\nCAPTION\n\n#tag1 #tag2 ...` },
    { lang: 'fr' as const, prompt: `${CTX(theme.fr)}\n\nÉcris une légende Instagram en français québécois. Accroche forte, 3–4 phrases. Ligne vide puis 12 hashtags.\nFormat:\nLÉGENDE\n\n#tag1 #tag2 ...` },
    { lang: 'en' as const, prompt: `${CTX(theme.en)}\n\nWrite a bilingual Instagram caption: 2 sentences English then 2 French (same message). Blank line then 12 mixed EN/FR hashtags.\nFormat:\nCAPTION\n\n#tag1 #tag2 ...` },
  ];
  for (let i = 0; i < 3; i++) {
    const raw = await callClaude(igPrompts[i].prompt);
    const [caption, hashtags = ''] = raw.split(/\n{2,}/);
    posts.push({ platform: 'instagram', lang: igPrompts[i].lang, caption: caption.trim(), hashtags: hashtags.trim(), scheduledAt: sched.instagram[i] });
  }

  // Facebook: Tue (EN) · Thu (FR)
  const fbPrompts = [
    { lang: 'en' as const, prompt: `${CTX(theme.en)}\n\nWrite a Facebook post in English. Friendly, 4–6 sentences, ends with a question. Blank line then 6 hashtags.\nFormat:\nPOST\n\n#tag1 #tag2 ...` },
    { lang: 'fr' as const, prompt: `${CTX(theme.fr)}\n\nÉcris une publication Facebook en français. Amical, 4–6 phrases, termine par une question. Ligne vide puis 6 hashtags.\nFormat:\nPUBLICATION\n\n#tag1 #tag2 ...` },
  ];
  for (let i = 0; i < 2; i++) {
    const raw = await callClaude(fbPrompts[i].prompt);
    const [caption, hashtags = ''] = raw.split(/\n{2,}/);
    posts.push({ platform: 'facebook', lang: fbPrompts[i].lang, caption: caption.trim(), hashtags: hashtags.trim(), scheduledAt: sched.facebook[i] });
  }

  // Pinterest: Mon–Fri alternating EN/FR
  const pinBoards = {
    en: ['Winter Tires Canada', 'Tire Tips & Guides', 'Cooper Tires', 'Nexen Tires', 'Online Tire Shopping'],
    fr: ['Pneus Hiver Québec',  'Conseils Pneus',     'Pneus Cooper', 'Pneus Nexen', 'Acheter Pneus En Ligne'],
  };
  for (let i = 0; i < 5; i++) {
    const lang  = i % 2 === 1 ? 'fr' as const : 'en' as const;
    const board = pinBoards[lang][i];
    const t     = lang === 'fr' ? theme.fr : theme.en;
    const raw   = await callClaude(
      lang === 'fr'
        ? `${CTX(t)}\nDescription Pinterest SEO en français, 2–3 phrases riches en mots-clés. Ligne vide puis 8 hashtags. Board: "${board}".\nDESCRIPTION\n\n#tag1 ...`
        : `${CTX(t)}\nPinterest pin description for SEO in English, 2–3 keyword-rich sentences. Blank line then 8 hashtags. Board: "${board}".\nDESCRIPTION\n\n#tag1 ...`
    );
    const [caption, hashtags = ''] = raw.split(/\n{2,}/);
    posts.push({ platform: 'pinterest', lang, caption: caption.trim(), hashtags: hashtags.trim(), scheduledAt: sched.pinterest[i], board });
  }

  return posts;
}

// ─── Make.com webhook delivery ────────────────────────────────────────────────

async function sendToMake(post: Post): Promise<boolean> {
  const res = await fetch(MAKE_WEBHOOK, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      platform:    post.platform,
      lang:        post.lang,
      text:        post.hashtags ? `${post.caption}\n\n${post.hashtags}` : post.caption,
      caption:     post.caption,
      hashtags:    post.hashtags,
      scheduledAt: post.scheduledAt,
      board:       post.board || null,
      account:     ({ instagram: '@gcitires', facebook: 'gcitirescanada', pinterest: 'gci_tires' })[post.platform],
      source:      'gci-brain',
    }),
  });
  return res.ok;
}

// ─── TikTok + YouTube scripts ─────────────────────────────────────────────────

async function generateVideoScripts(theme: { en: string; fr: string }) {
  const [tiktokEn, tiktokFr, ytEn] = await Promise.all([
    callClaude(`${CTX(theme.en)}\n\nWrite a 30-second TikTok script. Sections:\n[HOOK 3s]\n[PROBLEM 5s]\n[SOLUTION 15s]\n[CTA 7s → gcitires.com]\nCasual, punchy, Canadian. Label each section clearly.`),
    callClaude(`${CTX(theme.fr)}\n\nÉcris un script TikTok de 30 secondes. Sections:\n[ACCROCHE 3s]\n[PROBLÈME 5s]\n[SOLUTION 15s]\n[CTA 7s → gcitires.com]\nDécontracté, percutant, québécois. Étiquette chaque section.`),
    callClaude(`${CTX(theme.en)}\n\nWrite a 60-second YouTube Shorts script. Include on-screen text overlays in [BRACKETS]. Structure: hook → 3 tips → CTA gcitires.com. Professional but approachable.`),
  ]);
  return { tiktokEn, tiktokFr, ytEn };
}

// ─── Handler ──────────────────────────────────────────────────────────────────

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  const action = (req.query.action as string) || 'preview';
  const theme  = getThisWeeksTheme();

  if (action === 'preview') {
    return res.status(200).json({
      success: true, mode: 'preview', theme,
      postsThisWeek: 10,
      schedule: getSchedule(),
      delivery: 'Make.com webhook → Instagram · Facebook · Pinterest',
      note: '?action=run to generate + send  ·  ?action=tiktok for video scripts',
    });
  }

  if (action === 'tiktok') {
    const scripts = await generateVideoScripts(theme);
    return res.status(200).json({ success: true, theme, scripts });
  }

  if (!MAKE_WEBHOOK) {
    return res.status(500).json({
      success: false,
      error: 'MAKE_WEBHOOK_URL not set in Vercel env vars.',
      setup: [
        '1. go to make.com → create free account',
        '2. New scenario → Webhooks → Custom Webhook → copy URL',
        '3. Add modules: Instagram for Business · Facebook Pages · Pinterest',
        '4. Route by {{platform}} field',
        '5. Add MAKE_WEBHOOK_URL to Vercel env vars',
      ],
    });
  }

  try {
    const posts   = await generatePosts(theme);
    const results = [];
    const errors  = [];

    for (const post of posts) {
      try {
        const ok = await sendToMake(post);
        if (!ok) throw new Error('Make.com non-OK response');
        results.push({ platform: post.platform, lang: post.lang, scheduledAt: post.scheduledAt, preview: post.caption.slice(0, 80) + '…' });
        console.log(`✅ [${post.platform}/${post.lang}] → Make.com`);
      } catch (err: any) {
        errors.push({ platform: post.platform, lang: post.lang, error: err.message });
        console.error(`❌ [${post.platform}/${post.lang}]`, err.message);
      }
    }

    return res.status(200).json({
      success: errors.length < posts.length,
      theme, sent: results.length, failed: errors.length,
      results, errors,
      nextRun: 'Next Sunday 6pm ET (Vercel cron)',
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
}
