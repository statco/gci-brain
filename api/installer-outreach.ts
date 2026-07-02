// api/installer-outreach.ts
// ─────────────────────────────────────────────────────────────────────────────
// GCI Tires — Automated Installer Partner Recruitment
//
// 3-email drip sequence targeting garage owners in ON + QC (EN + FR)
// Runs via weekly cron (Fridays 8am ET) or manually via POST
//
// Airtable table required: "Outreach Prospects"
// Fields: Name, Shop Name, City, Province, Email, Language (EN/FR),
//         Status (New|Email1Sent|Email2Sent|Email3Sent|Applied|Declined),
//         Email1SentAt, Email2SentAt, Email3SentAt, Notes
//
// GET  /api/installer-outreach?action=preview   — show queue without sending
// GET  /api/installer-outreach?action=run       — run the sequence (cron)
// POST /api/installer-outreach                  — manual trigger with auth
// ─────────────────────────────────────────────────────────────────────────────

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Resend } from 'resend';

export const config = { maxDuration: 120 };

const resend    = new Resend(process.env.RESEND_API_KEY!);
const AT_BASE   = process.env.AIRTABLE_BASE_ID!;
const AT_KEY    = process.env.AIRTABLE_API_KEY!;
const AT_TABLE  = 'Outreach Prospects';
const FROM      = 'GCI Tires <partners@updates.gcitires.ca>';
const PORTAL    = 'https://gcitires.com/pages/installer-partner';

const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const TELEGRAM_CHAT  = process.env.TELEGRAM_CHAT_ID   || '';

// FIXED 2026-07-02: found via a real audit -- 13 of 22 real prospects
// (Ontario/Quebec tire shops that had already been sourced) were stuck
// at "New" status since 2026-04-25, silently never emailed, because
// they have no email address on file. The code already handled this
// safely (skips rather than crashing or falsely marking as sent), but
// there was no visibility anywhere that it was happening -- same blind
// spot pattern as the Make.com scenario incident earlier the same day.
// This alerts only when there's something to actually look at (missing
// data or a real send failure), not on every routine successful run.
async function sendTelegramSummary(text: string): Promise<void> {
  if (!TELEGRAM_TOKEN || !TELEGRAM_CHAT) {
    console.error('[installer-outreach] Telegram not configured, cannot alert:', text);
    return;
  }
  await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: TELEGRAM_CHAT, text, parse_mode: 'Markdown' }),
  });
}

const DAYS = { Email1: 0, Email2: 5, Email3: 10 };

// ─── Airtable helpers ──────────────────────────────────────────────────────

async function atFetch(path: string, options: RequestInit = {}) {
  const res = await fetch(
    `https://api.airtable.com/v0/${AT_BASE}/${encodeURIComponent(AT_TABLE)}${path}`,
    { ...options, headers: { Authorization: `Bearer ${AT_KEY}`, 'Content-Type': 'application/json', ...((options.headers as any) || {}) } }
  );
  if (!res.ok) throw new Error(`Airtable ${res.status}: ${await res.text()}`);
  return res.json();
}

async function getProspects() {
  const data = await atFetch(
    `?filterByFormula=NOT(OR(Status="Applied",Status="Declined"))&sort[0][field]=Name`
  );
  return (data.records || []) as any[];
}

async function updateProspect(id: string, fields: Record<string, any>) {
  await atFetch(`/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ fields }),
  });
}

// ─── Email templates ────────────────────────────────────────────────────────

function daysSince(dateStr: string | null): number {
  if (!dateStr) return 999;
  return Math.floor((Date.now() - new Date(dateStr).getTime()) / 86_400_000);
}

function email1(name: string, shop: string, city: string, lang: 'EN' | 'FR'): { subject: string; html: string } {
  if (lang === 'FR') return {
    subject: `${shop} — Recevez plus de clients pour vos changements de pneus`,
    html: `
<div style="font-family:Arial,sans-serif;max-width:560px;color:#1a1a1a;font-size:15px;line-height:1.6">
  <p>Bonjour ${name},</p>
  <p>Je vous contacte au nom de <strong>GCI Tires</strong> — un détaillant de pneus en ligne qui dessert ${city} et les environs.</p>
  <p>Nous cherchons un partenaire d'installation certifié dans votre région. Voici comment ça fonctionne :</p>
  <ul>
    <li>Un client achète ses pneus sur gcitires.com et choisit l'installation</li>
    <li>Nous vous envoyons le rendez-vous et les détails du client</li>
    <li>Vous faites l'installation et vous gardez <strong>80% des frais</strong></li>
    <li>GCI gère toute la réservation et l'administration</li>
  </ul>
  <p><strong>Aucun frais d'adhésion. Aucun abonnement mensuel.</strong> Vous ne payez que lorsque nous vous envoyons un client.</p>
  <p>À 2 emplois par jour, nos partenaires gagnent typiquement <strong>2 500 $ à 4 000 $ par mois</strong> en revenus additionnels — entièrement de clients que GCI vous envoie.</p>
  <p>Ça vous intéresse d'en savoir plus ?</p>
  <p><a href="${PORTAL}" style="display:inline-block;background:#111;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:bold">Voir les détails du programme →</a></p>
  <p>Si vous avez des questions, répondez simplement à ce courriel.</p>
  <p>Cordialement,<br><strong>L'équipe GCI Tires</strong><br><a href="https://gcitires.com">gcitires.com</a></p>
  <hr style="border:none;border-top:1px solid #eee;margin:24px 0">
  <p style="font-size:12px;color:#888">Pour vous désabonner, répondez avec "Non merci".</p>
</div>`
  };

  return {
    subject: `${shop} — Send you more tire installation customers`,
    html: `
<div style="font-family:Arial,sans-serif;max-width:560px;color:#1a1a1a;font-size:15px;line-height:1.6">
  <p>Hi ${name},</p>
  <p>I'm reaching out from <strong>GCI Tires</strong> — an online tire retailer serving ${city} and surrounding areas.</p>
  <p>We're looking for a certified installation partner in your area. Here's how it works:</p>
  <ul>
    <li>A customer buys tires on gcitires.com and selects installation</li>
    <li>We send you the appointment and customer details</li>
    <li>You do the install and keep <strong>80% of the fee</strong></li>
    <li>GCI handles all the booking and admin</li>
  </ul>
  <p><strong>No upfront cost. No monthly fee.</strong> You only pay when we send you a customer.</p>
  <p>At 2 jobs per day, our partners typically earn <strong>$2,500–$4,000/month</strong> in additional revenue — entirely from customers GCI sends them.</p>
  <p>Interested in hearing more?</p>
  <p><a href="${PORTAL}" style="display:inline-block;background:#111;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:bold">View program details →</a></p>
  <p>If you have any questions, just reply to this email.</p>
  <p>Best regards,<br><strong>The GCI Tires Team</strong><br><a href="https://gcitires.com">gcitires.com</a></p>
  <hr style="border:none;border-top:1px solid #eee;margin:24px 0">
  <p style="font-size:12px;color:#888">To opt out, reply with "Not interested".</p>
</div>`
  };
}

function email2(name: string, shop: string, city: string, lang: 'EN' | 'FR'): { subject: string; html: string } {
  if (lang === 'FR') return {
    subject: `Suivi — Programme partenaire GCI Tires pour ${shop}`,
    html: `
<div style="font-family:Arial,sans-serif;max-width:560px;color:#1a1a1a;font-size:15px;line-height:1.6">
  <p>Bonjour ${name},</p>
  <p>Je fais suite à mon message de la semaine dernière concernant le programme partenaire GCI Tires.</p>
  <p>Voici un exemple concret de ce que nos partenaires gagnent :</p>
  <div style="background:#f5f5f5;border-left:4px solid #111;padding:16px;margin:16px 0;border-radius:4px">
    <p style="margin:0;font-weight:bold">Exemple — Garage avec 2 emplois/jour :</p>
    <ul style="margin:8px 0 0">
      <li>40 emplois/mois × 100 $ = 4 000 $ facturés</li>
      <li>Vous gardez 80% = <strong>3 200 $/mois</strong></li>
      <li>GCI garde 20% = 800 $ (frais admin)</li>
      <li>Clients entièrement fournis par GCI — aucune acquisition de votre côté</li>
    </ul>
  </div>
  <p>Notre partenaire actuel à ${city} a reçu ses premières réservations dans les 48 heures suivant son inscription.</p>
  <p>L'inscription prend moins de 5 minutes :</p>
  <p><a href="${PORTAL}#apply" style="display:inline-block;background:#111;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:bold">Postuler maintenant →</a></p>
  <p>Cordialement,<br><strong>L'équipe GCI Tires</strong></p>
  <hr style="border:none;border-top:1px solid #eee;margin:24px 0">
  <p style="font-size:12px;color:#888">Pour vous désabonner, répondez avec "Non merci".</p>
</div>`
  };

  return {
    subject: `Follow-up — GCI Tires partner program for ${shop}`,
    html: `
<div style="font-family:Arial,sans-serif;max-width:560px;color:#1a1a1a;font-size:15px;line-height:1.6">
  <p>Hi ${name},</p>
  <p>Following up on my message last week about the GCI Tires partner program.</p>
  <p>Here's a concrete example of what our partners earn:</p>
  <div style="background:#f5f5f5;border-left:4px solid #111;padding:16px;margin:16px 0;border-radius:4px">
    <p style="margin:0;font-weight:bold">Example — Shop doing 2 jobs/day:</p>
    <ul style="margin:8px 0 0">
      <li>40 jobs/month × $100 = $4,000 billed</li>
      <li>You keep 80% = <strong>$3,200/month</strong></li>
      <li>GCI keeps 20% = $800 (admin fee)</li>
      <li>Customers entirely provided by GCI — zero acquisition cost on your end</li>
    </ul>
  </div>
  <p>Our current partner in ${city} received their first bookings within 48 hours of signing up.</p>
  <p>Signing up takes under 5 minutes:</p>
  <p><a href="${PORTAL}#apply" style="display:inline-block;background:#111;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:bold">Apply now →</a></p>
  <p>Best regards,<br><strong>The GCI Tires Team</strong></p>
  <hr style="border:none;border-top:1px solid #eee;margin:24px 0">
  <p style="font-size:12px;color:#888">To opt out, reply with "Not interested".</p>
</div>`
  };
}

function email3(name: string, shop: string, city: string, lang: 'EN' | 'FR'): { subject: string; html: string } {
  if (lang === 'FR') return {
    subject: `Dernier message — Partenariat GCI Tires pour ${shop}`,
    html: `
<div style="font-family:Arial,sans-serif;max-width:560px;color:#1a1a1a;font-size:15px;line-height:1.6">
  <p>Bonjour ${name},</p>
  <p>C'est mon dernier message concernant le programme partenaire GCI Tires — je ne veux pas vous déranger si le moment n'est pas idéal.</p>
  <p>Si vous souhaitez rejoindre notre réseau d'installation dans votre région à tout moment, vous pouvez postuler ici :</p>
  <p><a href="${PORTAL}#apply" style="display:inline-block;background:#111;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:bold">Programme partenaire GCI →</a></p>
  <p>En résumé : aucun frais, vous gardez 80%, nous vous envoyons les clients.</p>
  <p>Bonne continuation,<br><strong>L'équipe GCI Tires</strong></p>
  <hr style="border:none;border-top:1px solid #eee;margin:24px 0">
  <p style="font-size:12px;color:#888">Vous ne recevrez plus de messages de notre part.</p>
</div>`
  };

  return {
    subject: `Last message — GCI Tires partnership for ${shop}`,
    html: `
<div style="font-family:Arial,sans-serif;max-width:560px;color:#1a1a1a;font-size:15px;line-height:1.6">
  <p>Hi ${name},</p>
  <p>This is my last message about the GCI Tires partner program — I don't want to keep reaching out if the timing isn't right.</p>
  <p>If you ever want to join our installer network in your area, you can apply here:</p>
  <p><a href="${PORTAL}#apply" style="display:inline-block;background:#111;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:bold">GCI Partner Program →</a></p>
  <p>Quick recap: no fees, you keep 80%, we send you customers.</p>
  <p>All the best,<br><strong>The GCI Tires Team</strong></p>
  <hr style="border:none;border-top:1px solid #eee;margin:24px 0">
  <p style="font-size:12px;color:#888">You won't hear from us again after this.</p>
</div>`
  };
}

// ─── Core sequence logic ───────────────────────────────────────────────────

interface OutreachResult {
  id: string; name: string; shop: string; city: string;
  email: string; action: string; sent: boolean; error?: string;
}

async function processProspects(dryRun = false): Promise<OutreachResult[]> {
  const prospects = await getProspects();
  const results: OutreachResult[] = [];
  const now = new Date().toISOString();

  for (const rec of prospects) {
    const f = rec.fields;
    const name  = f['Name'] || 'there';
    const shop  = f['Shop Name'] || 'your shop';
    const city  = f['City'] || 'your area';
    const email = f['Email'];
    const lang  = (f['Language'] || 'EN').toUpperCase() as 'EN' | 'FR';
    const status = f['Status'] || 'New';

    if (!email) { results.push({ id: rec.id, name, shop, city, email: '', action: 'skipped-no-email', sent: false }); continue; }

    let action = '';
    let template: { subject: string; html: string } | null = null;
    let nextStatus = '';

    if (status === 'New') {
      action = 'email1';
      template = email1(name, shop, city, lang);
      nextStatus = 'Email1Sent';
    } else if (status === 'Email1Sent' && daysSince(f['Email1SentAt']) >= DAYS.Email2) {
      action = 'email2';
      template = email2(name, shop, city, lang);
      nextStatus = 'Email2Sent';
    } else if (status === 'Email2Sent' && daysSince(f['Email2SentAt']) >= DAYS.Email3) {
      action = 'email3';
      template = email3(name, shop, city, lang);
      nextStatus = 'Email3Sent';
    } else {
      results.push({ id: rec.id, name, shop, city, email, action: `waiting-${status}`, sent: false });
      continue;
    }

    if (dryRun) {
      results.push({ id: rec.id, name, shop, city, email, action: `would-send-${action}`, sent: false });
      continue;
    }

    try {
      await resend.emails.send({ from: FROM, to: [email], subject: template!.subject, html: template!.html });

      const updateFields: Record<string, any> = { Status: nextStatus };
      if (action === 'email1') updateFields['Email1SentAt'] = now;
      if (action === 'email2') updateFields['Email2SentAt'] = now;
      if (action === 'email3') updateFields['Email3SentAt'] = now;
      await updateProspect(rec.id, updateFields);

      results.push({ id: rec.id, name, shop, city, email, action, sent: true });
      console.log(`✅ ${action} sent to ${name} <${email}> (${shop}, ${city})`);
    } catch (err: any) {
      results.push({ id: rec.id, name, shop, city, email, action, sent: false, error: err.message });
      console.error(`❌ Failed ${action} for ${email}:`, err.message);
    }
  }

  return results;
}

// ─── Vercel handler ────────────────────────────────────────────────────────

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const isCron   = req.method === 'GET';
  const isManual = req.method === 'POST';

  if (!isCron && !isManual) return res.status(405).json({ error: 'GET or POST only' });

  // Auth for manual triggers
  if (isManual) {
    const secret = process.env.CRON_SECRET;
    if (secret) {
      const provided = (req.headers.authorization || '').replace('Bearer ', '');
      if (provided !== secret) return res.status(401).json({ error: 'Unauthorized' });
    }
  }

  const action = (req.query.action as string) || 'run';

  try {
    if (action === 'preview') {
      const results = await processProspects(true);
      return res.status(200).json({
        success: true, mode: 'preview',
        total: results.length,
        wouldSend: results.filter(r => r.action.startsWith('would-send')).length,
        waiting: results.filter(r => r.action.startsWith('waiting')).length,
        results,
      });
    }

    const results = await processProspects(false);
    const sent           = results.filter(r => r.sent);
    const failed         = results.filter(r => !r.sent && r.error);
    const skippedNoEmail = results.filter(r => r.action === 'skipped-no-email');

    console.log(`📬 Outreach complete: ${sent.length} sent, ${failed.length} failed, ${skippedNoEmail.length} skipped (no email), ${results.length - sent.length - failed.length - skippedNoEmail.length} waiting`);

    // Only alert Telegram when there's something to actually act on --
    // routine successful runs (the common case) just log normally,
    // same philosophy as the Make.com health check added earlier today.
    if (skippedNoEmail.length > 0 || failed.length > 0) {
      const lines = [`📬 *Installer Outreach — needs attention*`, ''];
      if (sent.length > 0) lines.push(`✅ ${sent.length} email(s) sent normally.`);
      if (skippedNoEmail.length > 0) {
        lines.push(
          `⚠️ *${skippedNoEmail.length} prospect(s) have no email on file* -- never contacted, sitting idle:`,
          ...skippedNoEmail.slice(0, 10).map(r => `   • ${r.shop || r.name} (${r.city})`),
          skippedNoEmail.length > 10 ? `   ...and ${skippedNoEmail.length - 10} more.` : '',
        );
      }
      if (failed.length > 0) {
        lines.push(
          `❌ *${failed.length} send(s) failed*:`,
          ...failed.slice(0, 5).map(r => `   • ${r.shop || r.name} <${r.email}>: ${r.error}`),
        );
      }
      await sendTelegramSummary(lines.filter(Boolean).join('\n'));
    }

    return res.status(200).json({
      success: true, mode: 'run',
      sent: sent.length, failed: failed.length, skippedNoEmail: skippedNoEmail.length,
      waiting: results.filter(r => r.action.startsWith('waiting')).length,
      results,
    });
  } catch (err: any) {
    console.error('❌ installer-outreach error:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
}
