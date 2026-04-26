// api/social-scheduler.ts
// ─────────────────────────────────────────────────────────────────────────────
// GCI Tires — Weekly Social Media Auto-Scheduler
//
// Every Sunday 6pm ET: generates a full week of social content via Claude API
// and queues it to Buffer for auto-publishing to Instagram, Facebook, Pinterest.
//
// TikTok + YouTube: scripts generated separately (manual posting — video required)
//
// Channels (Buffer free — 3 max, 10 queued posts each):
//   Instagram (@gcitires)       — 3 posts/week  Mon/Wed/Fri
//   Facebook  (gcitirescanada)  — 2 posts/week  Tue/Thu
//   Pinterest (gci_tires)       — 5 posts/week  daily
//
// Env vars required:
//   ANTHROPIC_API_KEY       — Claude API
//   BUFFER_ACCESS_TOKEN     — Buffer API (from buffer.com/developers)
//   BUFFER_INSTAGRAM_ID     — Buffer profile ID for Instagram
//   BUFFER_FACEBOOK_ID      — Buffer profile ID for Facebook
//   BUFFER_PINTEREST_ID     — Buffer profile ID for Pinterest
//
// GET /api/social-scheduler?action=preview   — show this week's content plan
// GET /api/social-scheduler?action=run       — generate + queue to Buffer
// GET /api/social-scheduler?action=tiktok    — generate TikTok/YouTube scripts
// ─────────────────────────────────────────────────────────────────────────────

import type { VercelRequest, VercelResponse } from '@vercel/node';

export const config = { maxDuration: 300 };

const CLAUDE_KEY    = process.env.ANTHROPIC_API_KEY!;
const BUFFER_TOKEN  = process.env.BUFFER_ACCESS_TOKEN!;
const IG_ID         = process.env.BUFFER_INSTAGRAM_ID!;
const FB_ID         = process.env.BUFFER_FACEBOOK_ID!;
const PIN_ID        = process.env.BUFFER_PINTEREST_ID!;
const CLAUDE_MODEL  = 'claude-sonnet-4-20250514';

// ─── Content themes — rotated weekly ─────────────────────────────────────────

const WEEKLY_THEMES = [
  { en: 'winter tire safety',           fr: 'sécurité pneus hiver' },
  { en: 'all-weather tire benefits',    fr: 'avantages pneus toutes saisons' },
  { en: 'tire buying tips online',      fr: 'acheter pneus en ligne conseils' },
  { en: 'Quebec winter tire law',       fr: 'loi pneus hiver Québec' },
  { en: 'SUV and truck tire guide',     fr: 'guide pneus VUS et camion' },
  { en: 'tire installation made easy',  fr: 'installation pneus facile' },
  { en: 'Cooper tire highlights',       fr: 'pneus Cooper avis' },
  { en: 'Nexen winter performance',     fr: 'Nexen performance hiver' },
  { en: 'Minerva exclusive Canada',     fr: 'Minerva exclusivité Canada' },
  { en: 'spring tire changeover tips',  fr: 'conseils changement pneus printemps' },
  { en: 'tire size explained',          fr: 'comprendre la taille des pneus' },
  { en: 'free tire delivery Canada',    fr: 'livraison pneus gratuite Canada' },
];

function getThisWeeksTheme() {
  const week = Math.floor(Date.now() / (7 * 24 * 60 * 60 * 1000));
  return WEEKLY_THEMES[week % WEEKLY_THEMES.length];
}

// ─── Next posting times ───────────────────────────────────────────────────────
// Returns UTC timestamps for the coming week's schedule

function getScheduledTimes(): { ig: number[]; fb: number[]; pin: number[] } {
  const now  = new Date();
  const mon  = new Date(now);
  // Find next Monday
  const dayOfWeek = now.getUTCDay(); // 0=Sun
  const daysUntilMon = dayOfWeek === 1 ? 0 : (8 - dayOfWeek) % 7 || 7;
  mon.setUTCDate(now.getUTCDate() + daysUntilMon);
  mon.setUTCHours(14, 0, 0, 0); // 10am ET = 14:00 UTC

  const day = (offset: number, hour = 14) => {
    const d = new Date(mon);
    d.setUTCDate(mon.getUTCDate() + offset);
    d.setUTCHours(hour, 0, 0, 0);
    return Math.floor(d.getTime() / 1000);
  };

  return {
    ig:  [day(0), day(2), day(4)],        // Mon, Wed, Fri 10am ET
    fb:  [day(1, 16), day(3, 16)],        // Tue, Thu 12pm ET
    pin: [day(0,18), day(1,18), day(2,18), day(3,18), day(4,18)], // daily 2pm ET
  };
}

// ─── Claude content generation ────────────────────────────────────────────────

interface SocialPost {
  platform:  'instagram' | 'facebook' | 'pinterest';
  lang:      'en' | 'fr';
  caption:   string;
  hashtags:  string;
  boardName?: string; // Pinterest only
  scheduledAt: number;
}

async function callClaude(prompt: string): Promise<string> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': CLAUDE_KEY,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: CLAUDE_MODEL,
      max_tokens: 1000,
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  if (!res.ok) throw new Error(`Claude ${res.status}: ${await res.text()}`);
  const d: any = await res.json();
  return d.content?.[0]?.text?.trim() || '';
}

async function generateWeeklyContent(theme: { en: string; fr: string }): Promise<SocialPost[]> {
  const times = getScheduledTimes();
  const posts: SocialPost[] = [];

  // System context injected into each prompt
  const ctx = `GCI Tires (gcitires.com) — Canadian online tire retailer. Brands: Cooper, Nexen, Vredestein, Minerva (Canada Tire exclusive). Free shipping. AI Match 2.0 tire advisor. Serves Ontario + Quebec. Bilingual FR/EN. This week's theme: EN "${theme.en}" / FR "${theme.fr}". Always end with a CTA linking to gcitires.com.`;

  // ── Instagram (3 posts: Mon EN, Wed FR, Fri bilingual) ──────────────────────
  const igPrompts = [
    `${ctx}\n\nWrite an Instagram caption in English about "${theme.en}". Conversational, 3–4 sentences, engaging. Then on a new line add 12–15 relevant hashtags starting with #. Format: CAPTION\n\nHASHTAGS`,
    `${ctx}\n\nÉcris une légende Instagram en français sur "${theme.fr}". Ton conversationnel, 3–4 phrases, engageant. Puis sur une nouvelle ligne ajoute 12–15 hashtags pertinents commençant par #. Format: CAPTION\n\nHASHTAGS`,
    `${ctx}\n\nWrite a bilingual Instagram caption: first 2 sentences in English, then 2 sentences in French (same message). End with 12 hashtags (mix EN/FR). Format: CAPTION\n\nHASHTAGS`,
  ];

  for (let i = 0; i < 3; i++) {
    const raw = await callClaude(igPrompts[i]);
    const [caption, hashtags = ''] = raw.split(/\n{2,}/);
    posts.push({ platform: 'instagram', lang: i === 1 ? 'fr' : 'en', caption: caption.trim(), hashtags: hashtags.trim(), scheduledAt: times.ig[i] });
  }

  // ── Facebook (2 posts: Tue EN, Thu FR) ─────────────────────────────────────
  const fbPrompts = [
    `${ctx}\n\nWrite a Facebook post in English about "${theme.en}". Friendly and informative, 4–6 sentences. Include a question to encourage comments. Add 5–8 hashtags at end. Format: POST\n\nHASHTAGS`,
    `${ctx}\n\nÉcris une publication Facebook en français sur "${theme.fr}". Amical et informatif, 4–6 phrases. Inclus une question pour encourager les commentaires. Ajoute 5–8 hashtags à la fin. Format: POST\n\nHASHTAGS`,
  ];

  for (let i = 0; i < 2; i++) {
    const raw = await callClaude(fbPrompts[i]);
    const [caption, hashtags = ''] = raw.split(/\n{2,}/);
    posts.push({ platform: 'facebook', lang: i === 0 ? 'en' : 'fr', caption: caption.trim(), hashtags: hashtags.trim(), scheduledAt: times.fb[i] });
  }

  // ── Pinterest (5 pins: alternating EN/FR, one per day) ─────────────────────
  const pinBoards = {
    en: ['Winter Tires Canada', 'Tire Tips & Guides', 'Cooper Tires', 'Nexen Tires', 'Online Tire Shopping'],
    fr: ['Pneus Hiver Québec', 'Conseils Pneus', 'Pneus Cooper', 'Pneus Nexen', 'Acheter Pneus En Ligne'],
  };

  for (let i = 0; i < 5; i++) {
    const isFr = i % 2 === 1;
    const lang = isFr ? 'fr' : 'en';
    const board = isFr ? pinBoards.fr[i] : pinBoards.en[i];
    const raw = await callClaude(
      isFr
        ? `${ctx}\n\nÉcris une description de pin Pinterest en français sur "${theme.fr}". 2–3 phrases descriptives et riches en mots-clés SEO. Ajoute 8–10 hashtags. Board: "${board}". Format: DESCRIPTION\n\nHASHTAGS`
        : `${ctx}\n\nWrite a Pinterest pin description in English about "${theme.en}". 2–3 sentences, keyword-rich for SEO. Add 8–10 hashtags. Board: "${board}". Format: DESCRIPTION\n\nHASHTAGS`
    );
    const [caption, hashtags = ''] = raw.split(/\n{2,}/);
    posts.push({ platform: 'pinterest', lang, caption: caption.trim(), hashtags: hashtags.trim(), boardName: board, scheduledAt: times.pin[i] });
  }

  return posts;
}

// ─── TikTok + YouTube scripts ─────────────────────────────────────────────────

async function generateVideoScripts(theme: { en: string; fr: string }) {
  const [tiktokEn, tiktokFr, ytEn] = await Promise.all([
    callClaude(`Write a 30-second TikTok script for GCI Tires about "${theme.en}". Hook (3 sec) → Problem (5 sec) → Solution (15 sec) → CTA gcitires.com (7 sec). Casual, punchy. Label each section.`),
    callClaude(`Écris un script TikTok de 30 secondes pour GCI Tires sur "${theme.fr}". Accroche (3 sec) → Problème (5 sec) → Solution (15 sec) → CTA gcitires.com (7 sec). Décontracté et percutant. Étiquette chaque section.`),
    callClaude(`Write a YouTube Shorts script (60 sec) for GCI Tires about "${theme.en}". Hook → 3 quick tips → CTA. Include suggested on-screen text overlays in brackets. Professional but approachable tone.`),
  ]);

  return { tiktokEn, tiktokFr, ytEn };
}

// ─── Buffer API posting ────────────────────────────────────────────────────────

const PROFILE_MAP: Record<string, string> = {
  instagram: IG_ID,
  facebook:  FB_ID,
  pinterest: PIN_ID,
};

async function queueToBuffer(post: SocialPost): Promise<{ id: string; url: string }> {
  const profileId = PROFILE_MAP[post.platform];
  if (!profileId) throw new Error(`No Buffer profile ID for ${post.platform}`);

  const text = post.hashtags ? `${post.caption}\n\n${post.hashtags}` : post.caption;

  const body: Record<string, any> = {
    profile_ids:  [profileId],
    text,
    scheduled_at: new Date(post.scheduledAt * 1000).toISOString(),
    now:          false,
  };

  if (post.platform === 'pinterest' && post.boardName) {
    body.media = { link: 'https://gcitires.com', description: post.caption };
  }

  const res = await fetch('https://api.bufferapp.com/1/updates/create.json', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${BUFFER_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) throw new Error(`Buffer ${res.status}: ${await res.text()}`);
  const d: any = await res.json();
  return { id: d.updates?.[0]?.id || 'unknown', url: d.updates?.[0]?.url || '' };
}

// ─── Handler ──────────────────────────────────────────────────────────────────

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  const action = (req.query.action as string) || 'run';
  const theme  = getThisWeeksTheme();

  if (action === 'preview') {
    const times = getScheduledTimes();
    return res.status(200).json({
      success: true, mode: 'preview',
      theme,
      schedule: {
        instagram: times.ig.map(t => new Date(t * 1000).toUTCString()),
        facebook:  times.fb.map(t => new Date(t * 1000).toUTCString()),
        pinterest: times.pin.map(t => new Date(t * 1000).toUTCString()),
      },
      note: 'Call ?action=run to generate + queue posts. Call ?action=tiktok for video scripts.',
    });
  }

  if (action === 'tiktok') {
    const scripts = await generateVideoScripts(theme);
    return res.status(200).json({ success: true, theme, scripts });
  }

  // action === 'run'
  try {
    const posts   = await generateWeeklyContent(theme);
    const results = [];
    const errors  = [];

    for (const post of posts) {
      try {
        const queued = await queueToBuffer(post);
        results.push({ platform: post.platform, lang: post.lang, scheduledAt: new Date(post.scheduledAt * 1000).toUTCString(), bufferId: queued.id, preview: post.caption.slice(0, 80) + '...' });
        console.log(`✅ Queued [${post.platform}/${post.lang}] → Buffer ${queued.id}`);
      } catch (err: any) {
        errors.push({ platform: post.platform, lang: post.lang, error: err.message });
        console.error(`❌ [${post.platform}/${post.lang}]`, err.message);
      }
    }

    return res.status(200).json({
      success: errors.length < posts.length,
      theme, queued: results.length, failed: errors.length,
      results, errors,
      tiktokScripts: 'Call ?action=tiktok for this week\'s TikTok + YouTube scripts',
      nextRun: 'Next Sunday 6pm ET (via Vercel cron)',
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
}
