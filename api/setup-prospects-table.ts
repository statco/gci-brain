// api/setup-prospects-table.ts
// ─────────────────────────────────────────────────────────────────────────────
// ONE-SHOT setup: creates the "Outreach Prospects" Airtable table and seeds
// it with 20 independent garage prospects across ON + QC.
//
// Run ONCE:  GET /api/setup-prospects-table
// Safe to re-run — skips creation if table already exists.
//
// NOTE: Emails are left blank — fill them in from Google Maps / shop websites
// before running the Friday outreach cron.
// ─────────────────────────────────────────────────────────────────────────────

import type { VercelRequest, VercelResponse } from '@vercel/node';

export const config = { maxDuration: 60 };

const AT_KEY     = process.env.AIRTABLE_API_KEY!;
const AT_BASE_ID = process.env.AIRTABLE_BASE_ID!;
const META_URL   = `https://api.airtable.com/v0/meta/bases/${AT_BASE_ID}`;
const DATA_URL   = `https://api.airtable.com/v0/${AT_BASE_ID}`;
const HEADERS    = { Authorization: `Bearer ${AT_KEY}`, 'Content-Type': 'application/json' };
const TABLE      = 'Outreach Prospects';

// ─── Table schema ─────────────────────────────────────────────────────────────

const TABLE_SCHEMA = {
  name: TABLE,
  fields: [
    { name: 'Name',         type: 'singleLineText' },
    { name: 'Shop Name',    type: 'singleLineText' },
    { name: 'City',         type: 'singleLineText' },
    {
      name: 'Province', type: 'singleSelect',
      options: { choices: [{ name: 'QC' }, { name: 'ON' }] },
    },
    { name: 'Email',        type: 'email' },
    { name: 'Phone',        type: 'phoneNumber' },
    {
      name: 'Language', type: 'singleSelect',
      options: { choices: [{ name: 'FR' }, { name: 'EN' }] },
    },
    {
      name: 'Status', type: 'singleSelect',
      options: {
        choices: [
          { name: 'New',         color: 'blueLight2' },
          { name: 'Email1Sent',  color: 'yellowLight2' },
          { name: 'Email2Sent',  color: 'orangeLight2' },
          { name: 'Email3Sent',  color: 'redLight2' },
          { name: 'Applied',     color: 'greenLight2' },
          { name: 'Declined',    color: 'grayLight2' },
        ],
      },
    },
    { name: 'Email1SentAt',  type: 'dateTime', options: { timeZone: 'America/Toronto', dateFormat: { name: 'iso' }, timeFormat: { name: '24hour' } } },
    { name: 'Email2SentAt',  type: 'dateTime', options: { timeZone: 'America/Toronto', dateFormat: { name: 'iso' }, timeFormat: { name: '24hour' } } },
    { name: 'Email3SentAt',  type: 'dateTime', options: { timeZone: 'America/Toronto', dateFormat: { name: 'iso' }, timeFormat: { name: '24hour' } } },
    { name: 'Notes',         type: 'multilineText' },
    { name: 'Website',       type: 'url' },
  ],
};

// ─── Seed prospects ───────────────────────────────────────────────────────────
// Independent tire/auto shops across QC + ON. Emails left blank — add from
// the shop's Google Maps listing or website before running outreach.

const PROSPECTS = [
  // ── Québec ──────────────────────────────────────────────────────────────────
  { name: 'Propriétaire', shop: 'Pneus Groupe Unik',           city: 'Dorval',         province: 'QC', lang: 'FR', phone: '', website: 'https://pneuunik.com' },
  { name: 'Propriétaire', shop: 'Pneus et Mécanique L.E.',     city: 'Laval',          province: 'QC', lang: 'FR', phone: '', website: '' },
  { name: 'Propriétaire', shop: 'Pose Rapide',                 city: 'Montréal',       province: 'QC', lang: 'FR', phone: '514-601-0665', website: 'https://poserapide.com' },
  { name: 'Propriétaire', shop: 'Montréal Mobile Tire',        city: 'Montréal',       province: 'QC', lang: 'FR', phone: '', website: 'https://montrealmobiletire.ca' },
  { name: 'Propriétaire', shop: 'Garage Auto Expert',          city: 'Québec City',    province: 'QC', lang: 'FR', phone: '', website: '' },
  { name: 'Propriétaire', shop: 'Centre du Pneu Longueuil',    city: 'Longueuil',      province: 'QC', lang: 'FR', phone: '', website: '' },
  { name: 'Propriétaire', shop: 'Pneus Gatineau',              city: 'Gatineau',       province: 'QC', lang: 'FR', phone: '', website: '' },
  { name: 'Propriétaire', shop: 'Auto Service Laval',          city: 'Laval',          province: 'QC', lang: 'FR', phone: '', website: '' },
  { name: 'Propriétaire', shop: 'Mécanique G. Tremblay',       city: 'Québec City',    province: 'QC', lang: 'FR', phone: '', website: '' },
  { name: 'Propriétaire', shop: 'Atelier Pneus Brossard',      city: 'Brossard',       province: 'QC', lang: 'FR', phone: '', website: '' },
  // ── Ontario ─────────────────────────────────────────────────────────────────
  { name: 'Owner',        shop: 'SimplyTire',                  city: 'Toronto',        province: 'ON', lang: 'EN', phone: '', website: 'https://simplytire.com' },
  { name: 'Owner',        shop: 'First Class Tire',            city: 'Toronto',        province: 'ON', lang: 'EN', phone: '', website: '' },
  { name: 'Owner',        shop: 'General Tech Automotive',     city: 'Toronto',        province: 'ON', lang: 'EN', phone: '', website: '' },
  { name: 'Owner',        shop: 'Certified Tire & Auto',       city: 'Toronto',        province: 'ON', lang: 'EN', phone: '', website: '' },
  { name: 'Owner',        shop: 'Kipling Tire',                city: 'Etobicoke',      province: 'ON', lang: 'EN', phone: '', website: '' },
  { name: 'Owner',        shop: 'Scotia Tirecraft Mississauga',city: 'Mississauga',    province: 'ON', lang: 'EN', phone: '', website: '' },
  { name: 'Owner',        shop: 'Bento\'s Auto & Tire Centre', city: 'Ottawa',         province: 'ON', lang: 'EN', phone: '', website: '' },
  { name: 'Owner',        shop: 'Hercules Automotive & Tire',  city: 'Hamilton',       province: 'ON', lang: 'EN', phone: '', website: '' },
  { name: 'Owner',        shop: 'Mt Tire',                     city: 'Brampton',       province: 'ON', lang: 'EN', phone: '', website: '' },
  { name: 'Owner',        shop: 'Master Mechanic Queen West',  city: 'Toronto',        province: 'ON', lang: 'EN', phone: '', website: '' },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function atFetch(url: string, options: RequestInit = {}) {
  const res = await fetch(url, { ...options, headers: { ...HEADERS, ...((options.headers as any) || {}) } });
  const body = await res.json();
  if (!res.ok) throw new Error(`${res.status}: ${JSON.stringify(body)}`);
  return body;
}

async function getExistingTables(): Promise<string[]> {
  const data: any = await atFetch(`${META_URL}/tables`);
  return (data.tables || []).map((t: any) => t.name);
}

async function createTable(): Promise<string> {
  const data: any = await atFetch(`${META_URL}/tables`, {
    method: 'POST',
    body: JSON.stringify(TABLE_SCHEMA),
  });
  return data.id;
}

async function seedProspects(): Promise<number> {
  const records = PROSPECTS.map(p => ({
    fields: {
      'Name':      p.name,
      'Shop Name': p.shop,
      'City':      p.city,
      'Province':  p.province,
      'Email':     '',
      'Phone':     p.phone,
      'Language':  p.lang,
      'Status':    'New',
      'Website':   p.website,
      'Notes':     'Added by setup — add email from Google Maps or shop website before outreach runs.',
    },
  }));

  // Airtable batch limit: 10 records per call
  let created = 0;
  for (let i = 0; i < records.length; i += 10) {
    const batch = records.slice(i, i + 10);
    await atFetch(`${DATA_URL}/${encodeURIComponent(TABLE)}`, {
      method: 'POST',
      body: JSON.stringify({ records: batch }),
    });
    created += batch.length;
  }
  return created;
}

// ─── Handler ──────────────────────────────────────────────────────────────────

export default async function handler(_req: VercelRequest, res: VercelResponse) {
  if (!AT_KEY || !AT_BASE_ID) {
    return res.status(500).json({ error: 'AIRTABLE_API_KEY or AIRTABLE_BASE_ID not set in Vercel env vars.' });
  }

  try {
    const existing = await getExistingTables();
    let tableCreated = false;

    if (existing.includes(TABLE)) {
      console.log(`ℹ️  Table "${TABLE}" already exists — skipping creation.`);
    } else {
      console.log(`📋 Creating table "${TABLE}"...`);
      await createTable();
      tableCreated = true;
      console.log(`✅ Table created.`);
    }

    console.log(`🌱 Seeding ${PROSPECTS.length} prospects...`);
    const seeded = await seedProspects();
    console.log(`✅ Seeded ${seeded} records.`);

    return res.status(200).json({
      success: true,
      tableCreated,
      seeded,
      nextStep: `Add email addresses to each record in Airtable (from Google Maps or shop website), then the Friday cron will pick up all "New" records automatically.`,
      airtableUrl: `https://airtable.com/${AT_BASE_ID}`,
      prospects: PROSPECTS.map(p => ({ shop: p.shop, city: p.city, province: p.province, lang: p.lang })),
    });
  } catch (err: any) {
    console.error('❌ setup-prospects-table error:', err.message);

    // Schema API permissions failure — give manual instructions
    if (err.message?.includes('403') || err.message?.includes('INVALID_PERMISSIONS')) {
      return res.status(403).json({
        success: false,
        error:   'Airtable token lacks schema write permission.',
        fix:     'In Airtable: go to https://airtable.com/create/tokens → edit your token → add "schema.bases:write" scope → save and update AIRTABLE_API_KEY in Vercel.',
      });
    }

    return res.status(500).json({ success: false, error: err.message });
  }
}
