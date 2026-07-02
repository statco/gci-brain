// api/submit-installer-application.ts
//
// SECURITY + BUG FIX (2026-07):
//
// 1. Was previously a client-side call to the generic /api/airtable proxy
//    with table='Installer Applications' -- a table that does not exist
//    anywhere in the Airtable base, and wasn't even in that proxy's
//    ALLOWED_TABLES list. Every real installer application has been
//    failing outright since this form was built; applicants just saw a
//    generic "connection error" with no indication why.
//
// 2. Even setting the table name aside, 8 real fields the form collects
//    (serviceRadius, licenseNumber, insuranceExpiry, calendarLink,
//    paymentMethod, bankInfo, hourlyRate, notes) were never mapped into
//    the write payload at all.
//
// Fixed: writes to the real Installers table (Status: 'Pending Review'),
// which already has Application Date / Approved Date / Rejected Date /
// Rejection Reason fields built for exactly this application->review->
// active lifecycle -- confirmed against the live Airtable schema, not
// guessed. All real form fields are now mapped using the real Airtable
// field names.
//
// Also closes the security gap the old path had: this is a narrow,
// purpose-built write (one table, one fixed field set) instead of a
// generic "any table, any method" proxy reachable from the browser.

import type { VercelRequest, VercelResponse } from '@vercel/node';

const AIRTABLE_API_KEY = process.env.AIRTABLE_API_KEY || '';
const AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID || '';
const AIRTABLE_API_URL = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/Installers`;

interface ApplicationInput {
  businessName: string;
  contactName: string;
  email: string;
  phone: string;
  address: string;
  city: string;
  province: string;
  postalCode: string;
  serviceRadius?: number;
  licenseNumber?: string;
  insuranceExpiry?: string;
  calendarLink?: string;
  paymentMethod?: string;
  bankInfo?: string;
  hourlyRate?: number;
  notes?: string;
}

const REQUIRED_FIELDS: (keyof ApplicationInput)[] = [
  'businessName', 'contactName', 'email', 'phone', 'address', 'city', 'province', 'postalCode',
];

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!AIRTABLE_API_KEY || !AIRTABLE_BASE_ID) {
    return res.status(500).json({ error: 'Airtable credentials not configured' });
  }

  const input = (req.body ?? {}) as Partial<ApplicationInput>;
  const missing = REQUIRED_FIELDS.filter(f => !input[f]);
  if (missing.length > 0) {
    return res.status(400).json({ error: `Missing required fields: ${missing.join(', ')}` });
  }

  try {
    const upstream = await fetch(AIRTABLE_API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${AIRTABLE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        // typecast lets Airtable auto-create a new select option if the
        // real value (e.g. NT province -- in the form's PROVINCES list
        // but not yet an Airtable Province option, found via live
        // testing 2026-07-02) isn't already a configured choice, instead
        // of rejecting the whole application. Safer than trying to keep
        // the form's option lists and Airtable's configured choices
        // manually in sync forever.
        typecast: true,
        fields: {
          'Name':              input.businessName,
          'Contact Name':      input.contactName,
          'Email':             input.email,
          'Phone':             input.phone,
          'Address':           input.address,
          'City':              input.city,
          'Province':          [input.province],   // multipleSelects field
          'Postal Code':       input.postalCode,
          'Service Radius':    input.serviceRadius ?? 50,
          'License Number':    input.licenseNumber || '',
          'Insurance Expiry':  input.insuranceExpiry || undefined,
          'CalendlyLink':      input.calendarLink || '',
          'Payment Method':    input.paymentMethod || undefined,
          'Bank Info':         input.bankInfo || '',
          'Hourly Rate':       input.hourlyRate ?? undefined,
          'Notes':             input.notes || '',
          'Status':            'Pending Review',
          'Application Date':  new Date().toISOString().slice(0, 10),
        },
      }),
    });

    const data = await upstream.json();
    if (!upstream.ok) {
      console.error('[submit-installer-application] upstream error:', upstream.status, data);
      return res.status(upstream.status).json({ error: 'Airtable API error', details: data });
    }

    return res.status(200).json({ success: true, recordId: data.id });
  } catch (err) {
    console.error('[submit-installer-application] unexpected error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
