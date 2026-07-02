// api/social-scheduler.ts
// ─────────────────────────────────────────────────────────────────────────────
// GCI Tires — Social Media Auto-Scheduler (per-platform cron architecture)
//
// Each cron fires at exactly the right posting time and sends ONE post
// immediately to Make.com, which publishes it right away.
//
// Cron schedule (vercel.json):
//   Instagram : 0 14 * * 1,3,5  → Mon/Wed/Fri 10am ET  (EN / FR / bilingual)
//   Facebook  : 0 16 * * 2,4    → Tue/Thu     12pm ET  (EN / FR)
//   Pinterest : 0 18 * * 1-5    → Mon–Fri      2pm ET  (alternating EN/FR)
//
// Env vars required:
//   ANTHROPIC_API_KEY   — already set
//   MAKE_WEBHOOK_URL    — Make.com Custom Webhook URL
//
// GET /api/social-scheduler?action=preview                   — theme + week plan
// GET /api/social-scheduler?action=post&platform=instagram   — 1 IG post → Make
// GET /api/social-scheduler?action=post&platform=facebook    — 1 FB post → Make
// GET /api/social-scheduler?action=post&platform=pinterest   — 1 Pin     → Make
// GET /api/social-scheduler?action=tiktok                    — video scripts
// ─────────────────────────────────────────────────────────────────────────────

import type { VercelRequest, VercelResponse } from '@vercel/node';

export const config = { maxDuration: 120 };

const CLAUDE_KEY   = process.env.ANTHROPIC_API_KEY!;
const MAKE_WEBHOOK = process.env.MAKE_WEBHOOK_URL!;
const CLAUDE_MODEL = 'claude-sonnet-4-6';

// ─── Weekly themes — rotated by ISO week number ───────────────────────────────

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

function getTheme() {
  const week = Math.floor(Date.now() / (7 * 24 * 60 * 60 * 1000));
  return WEEKLY_THEMES[week % WEEKLY_THEMES.length];
}

// ─── Day-of-week helpers (UTC) ────────────────────────────────────────────────
// 0=Sun 1=Mon 2=Tue 3=Wed 4=Thu 5=Fri 6=Sat

function utcDay() { return new Date().getUTCDay(); }

// Which language to use based on day the cron fires
function igLang(): 'en' | 'fr' | 'bilingual' {
  const d = utcDay();
  if (d === 1) return 'en';        // Monday
  if (d === 3) return 'fr';        // Wednesday
  return 'bilingual';              // Friday
}

function fbLang(): 'en' | 'fr' {
  return utcDay() === 2 ? 'en' : 'fr'; // Tuesday=EN, Thursday=FR
}

function pinLang(): 'en' | 'fr' {
  // Alternates each day: Mon=EN, Tue=FR, Wed=EN, Thu=FR, Fri=EN
  const d = utcDay();
  return d % 2 === 1 ? 'en' : 'fr';
}

const PIN_BOARDS = {
  en: ['Winter Tires Canada', 'Tire Tips & Guides', 'Cooper Tires', 'Nexen Tires', 'Online Tire Shopping'],
  fr: ['Pneus Hiver Québec',  'Conseils Pneus',     'Pneus Cooper', 'Pneus Nexen', 'Acheter Pneus En Ligne'],
};

function pinBoard(lang: 'en' | 'fr'): string {
  // Pick board based on ISO week so it rotates through boards each week
  const week = Math.floor(Date.now() / (7 * 24 * 60 * 60 * 1000));
  return PIN_BOARDS[lang][week % 5];
}

// ─── Claude API ───────────────────────────────────────────────────────────────

async function callClaude(prompt: string): Promise<string> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': CLAUDE_KEY, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: CLAUDE_MODEL, max_tokens: 600, messages: [{ role: 'user', content: prompt }] }),
  });
  if (!res.ok) throw new Error(`Claude ${res.status}: ${await res.text()}`);
  const d: any = await res.json();
  return d.content?.[0]?.text?.trim() || '';
}

const CTX = (t: string) =>
  `GCI Tires (gcitires.com) — Canadian online tire retailer. Brands: Cooper, Nexen, Vredestein, Minerva (Canada Tire exclusive — Road Hazard warranty + 30-day trial). Free shipping. AI Match 2.0. Markets: Ontario + Quebec. Theme: "${t}". Always end with a CTA linking to gcitires.com.`;

function parsePost(raw: string): { caption: string; hashtags: string } {
  const parts = raw.split(/\n{2,}/);
  return { caption: (parts[0] || '').trim(), hashtags: (parts[1] || '').trim() };
}

// ─── Per-platform generators ──────────────────────────────────────────────────

async function makeInstagramPost(theme: typeof WEEKLY_THEMES[0]) {
  const variant = igLang();
  let prompt: string;

  if (variant === 'en') {
    prompt = `${CTX(theme.en)}\n\nWrite an Instagram caption in English. Strong hook, 3–4 punchy sentences.\nBlank line then EXACTLY 12 hashtags — single words starting with # only, no sentences.\nFormat:\nCAPTION\n\n#tag1 #tag2 ...`;
  } else if (variant === 'fr') {
    prompt = `${CTX(theme.fr)}\n\nÉcris une légende Instagram en français québécois. Accroche forte, 3–4 phrases percutantes.\nLigne vide puis EXACTEMENT 12 hashtags — mots seuls commençant par # uniquement, pas de phrases.\nFormat:\nLÉGENDE\n\n#tag1 #tag2 ...`;
  } else {
    prompt = `${CTX(theme.en)}\n\nWrite a bilingual Instagram caption: 2 sentences English then 2 sentences French (same message).\nBlank line then EXACTLY 12 hashtags — single words starting with # only, mix EN/FR.\nFormat:\nCAPTION\n\n#tag1 #tag2 ...`;
  }

  const { caption, hashtags } = parsePost(await callClaude(prompt));
  return {
    platform: 'instagram',
    lang: variant,
    caption,
    hashtags,
    text: `${caption}\n\n${hashtags}`,
    account: '@gcitires',
    source: 'gci-brain',
  };
}

async function makeFacebookPost(theme: typeof WEEKLY_THEMES[0]) {
  const lang = fbLang();
  const t = lang === 'en' ? theme.en : theme.fr;
  const prompt = lang === 'en'
    ? `${CTX(t)}\n\nWrite a Facebook post in English. Friendly and informative, 4–6 sentences. End with a question to encourage comments.\nThen a blank line then EXACTLY 6 hashtags (words starting with # only, no sentences).\nFormat:\nPOST TEXT\n\n#PneusCanada #PneusHiver #Tires`
    : `${CTX(t)}\n\nÉcris une publication Facebook en français. Amical et informatif, 4–6 phrases. Termine par une question.\nPuis une ligne vide puis EXACTEMENT 6 hashtags (mots commençant par # seulement, pas de phrases).\nFormat:\nTEXTE\n\n#PneusCanada #PneusHiver #Tires`;

  const { caption, hashtags } = parsePost(await callClaude(prompt));
  return {
    platform: 'facebook',
    lang,
    caption,
    hashtags,
    text: `${caption}\n\n${hashtags}`,
    link: 'https://gcitires.com',
    account: 'gcitirescanada',
    source: 'gci-brain',
  };
}

async function makePinterestPin(theme: typeof WEEKLY_THEMES[0]) {
  const lang  = pinLang();
  const board = pinBoard(lang);
  const t = lang === 'en' ? theme.en : theme.fr;
  const prompt = lang === 'en'
    ? `${CTX(t)}\n\nWrite a Pinterest pin description for SEO in English. 2–3 keyword-rich sentences.\nBlank line then EXACTLY 8 hashtags — single words starting with # only.\nBoard: "${board}".\nFormat:\nDESCRIPTION\n\n#tag1 ...`
    : `${CTX(t)}\n\nDescription de pin Pinterest SEO en français. 2–3 phrases riches en mots-clés.\nLigne vide puis EXACTEMENT 8 hashtags — mots seuls commençant par # uniquement.\nBoard: "${board}".\nFormat:\nDESCRIPTION\n\n#tag1 ...`;

  const { caption, hashtags } = parsePost(await callClaude(prompt));
  const pinTitle = caption.length > 97 ? caption.slice(0, 97) + '...' : caption;
  const fullText = (caption + '\n\n' + hashtags).slice(0, 797);
  return {
    platform: 'pinterest',
    lang,
    caption,
    pinTitle,
    hashtags,
    text: fullText,
    board,
    link: 'https://gcitires.com',
    account: 'gci_tires',
    source: 'gci-brain',
  };
}

// ─── Make.com webhook delivery ────────────────────────────────────────────────

async function sendToMake(payload: object): Promise<boolean> {
  const res = await fetch(MAKE_WEBHOOK, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return res.ok;
}

// ─── Video scripts (manual posting) ──────────────────────────────────────────

async function generateVideoScripts(theme: typeof WEEKLY_THEMES[0]) {
  const [tiktokEn, tiktokFr, ytEn] = await Promise.all([
    callClaude(`${CTX(theme.en)}\n\nWrite a 30-second TikTok script:\n[HOOK 3s]\n[PROBLEM 5s]\n[SOLUTION 15s]\n[CTA 7s → gcitires.com]\nCasual, punchy, Canadian.`),
    callClaude(`${CTX(theme.fr)}\n\nÉcris un script TikTok de 30 secondes:\n[ACCROCHE 3s]\n[PROBLÈME 5s]\n[SOLUTION 15s]\n[CTA 7s → gcitires.com]\nDécontracté, percutant, québécois.`),
    callClaude(`${CTX(theme.en)}\n\nWrite a 60-second YouTube Shorts script. On-screen text overlays in [BRACKETS]. Hook → 3 tips → CTA gcitires.com.`),
  ]);
  return { tiktokEn, tiktokFr, ytEn };
}

// ─── Handler ──────────────────────────────────────────────────────────────────

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  const action   = (req.query.action   as string) || 'preview';
  const platform = (req.query.platform as string) || '';
  const theme    = getTheme();

  // ── Preview ────────────────────────────────────────────────────────────────
  if (action === 'preview') {
    return res.status(200).json({
      success: true,
      theme,
      weeklySchedule: {
        monday:    'Instagram EN  10am ET  +  Pinterest EN  2pm ET',
        tuesday:   'Facebook  EN  12pm ET  +  Pinterest FR  2pm ET',
        wednesday: 'Instagram FR  10am ET  +  Pinterest EN  2pm ET',
        thursday:  'Facebook  FR  12pm ET  +  Pinterest FR  2pm ET',
        friday:    'Instagram bilingual 10am ET  +  Pinterest EN  2pm ET',
      },
      crons: [
        '0 14 * * 1,3,5  → /api/social-scheduler?action=post&platform=instagram',
        '0 16 * * 2,4    → /api/social-scheduler?action=post&platform=facebook',
        '0 18 * * 1-5    → /api/social-scheduler?action=post&platform=pinterest',
      ],
      note: 'Each cron generates 1 post and fires it to Make.com immediately.',
    });
  }

  // ── TikTok / YouTube scripts ───────────────────────────────────────────────
  if (action === 'tiktok') {
    const scripts = await generateVideoScripts(theme);
    return res.status(200).json({ success: true, theme, scripts });
  }

  // ── Post — generate 1 post for the specified platform ─────────────────────
  if (action === 'post') {
    if (!MAKE_WEBHOOK) {
      return res.status(500).json({ success: false, error: 'MAKE_WEBHOOK_URL not set in Vercel env vars.' });
    }
    if (!['instagram', 'facebook', 'pinterest'].includes(platform)) {
      return res.status(400).json({ success: false, error: 'platform must be instagram, facebook, or pinterest' });
    }

    try {
      let payload: object;

      if (platform === 'instagram') {
        payload = await makeInstagramPost(theme);
      } else if (platform === 'facebook') {
        payload = await makeFacebookPost(theme);
      } else {
        payload = await makePinterestPin(theme);
      }

      const ok = await sendToMake(payload);
      if (!ok) throw new Error('Make.com returned non-OK');

      console.log(`✅ [${platform}] → Make.com`);
      return res.status(200).json({ success: true, platform, theme, payload });
    } catch (err: any) {
      console.error(`❌ [${platform}]`, err.message);
      return res.status(500).json({ success: false, platform, error: err.message });
    }
  }

  return res.status(400).json({ error: 'Unknown action. Use: preview | post | tiktok' });
}
