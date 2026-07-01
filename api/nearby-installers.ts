// api/nearby-installers.ts
//
// SECURITY FIX (2026-07): replaces a client-side call to the generic
// /api/airtable proxy (table: 'Installers', full record read) that was
// sending every field on the Installers table -- including Bank Info,
// License Number, Insurance Expiry, Payment Method, Hourly Rate, and
// internal Notes -- to every customer's browser during a normal AI Match
// booking flow. The frontend only ever displayed a handful of those
// fields; the full raw response was visible in the Network tab regardless.
//
// This endpoint holds the Airtable key server-side and returns ONLY the
// fields the frontend actually uses (same set as the old client-side
// mapping in airtableService.ts), nothing else. No auth required -- it's
// meant to be public, same as installer search always was -- but the
// *shape* of what it returns is now the security boundary, not who's
// allowed to call it.

import type { VercelRequest, VercelResponse } from '@vercel/node';

const AIRTABLE_API_KEY = process.env.AIRTABLE_API_KEY || '';
const AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID || '';
const AIRTABLE_API_URL = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/Installers`;

function calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371; // km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

const MOCK_DATA = [
  {
    id: 'mock-1',
    name: 'GCI Partner - Rouyn (Mock)',
    address: '1014 Chemin des Coniferes',
    city: 'Rouyn-Noranda',
    province: 'QC',
    phone: '819-555-0123',
    calendlyLink: 'https://calendly.com/gci-tires',
    distance: 1.2,
    pricePerTire: 20,
    rating: undefined,
    couponCode: null,
  },
];

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const lat = Number(req.query.lat);
  const lng = Number(req.query.lng);
  const radiusKm = req.query.radiusKm ? Number(req.query.radiusKm) : 100;

  if (isNaN(lat) || isNaN(lng)) {
    return res.status(400).json({ error: 'lat and lng query params are required' });
  }
  if (!AIRTABLE_API_KEY || !AIRTABLE_BASE_ID) {
    return res.status(200).json({ installers: MOCK_DATA });
  }

  try {
    const url = `${AIRTABLE_API_URL}?filterByFormula=${encodeURIComponent("{Status}='Active'")}`;
    const upstream = await fetch(url, {
      headers: { 'Authorization': `Bearer ${AIRTABLE_API_KEY}` },
    });
    const data = await upstream.json();
    if (!upstream.ok) {
      console.error('[nearby-installers] upstream error:', upstream.status, data);
      return res.status(200).json({ installers: MOCK_DATA });
    }

    const records = (data.records || []).map((record: any) => {
      const fields = record.fields;
      const iLat = Number(fields.Latitude);
      const iLng = Number(fields.Longitude);
      const hasValidCoords = !isNaN(iLat) && !isNaN(iLng);
      const dist = hasValidCoords ? calculateDistance(lat, lng, iLat, iLng) : 999;

      // SAFE FIELD WHITELIST -- do not add fields here without checking
      // whether they're OK to send to any anonymous site visitor. Bank
      // Info, License Number, Insurance Expiry, Payment Method, Hourly
      // Rate, Notes, Email, Contact Name, and all date/rejection fields
      // are deliberately excluded.
      return {
        id: record.id,
        name: fields.Name || 'Certified Partner',
        address: fields.Address || '',
        city: fields.City || '',
        province: fields.Province || '',
        phone: fields.Phone || '',
        calendlyLink: fields.CalendlyLink || '',
        pricePerTire: fields.PricePerTire,
        rating: fields.Rating,
        couponCode: fields.CouponCode || null,
        distance: dist,
        lat: hasValidCoords ? iLat : undefined,
        lng: hasValidCoords ? iLng : undefined,
      };
    });

    const filtered = records
      .filter((r: any) => r.lat !== undefined && r.lng !== undefined && r.distance <= radiusKm)
      .sort((a: any, b: any) => a.distance - b.distance);

    return res.status(200).json({ installers: filtered.length > 0 ? filtered : MOCK_DATA });
  } catch (err) {
    console.error('[nearby-installers] unexpected error:', err);
    return res.status(200).json({ installers: MOCK_DATA });
  }
}
