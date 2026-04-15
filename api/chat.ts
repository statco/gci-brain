// api/chat.ts
// Follow-up chat endpoint — sits on top of existing tire results.
// POST /api/chat
// Body: { question: string, tires: TireProduct[], conversationHistory: {role,content}[], language: 'en'|'fr' }
// Returns: { reply: string }

import type { VercelRequest, VercelResponse } from '@vercel/node';

const GEMINI_API_KEY  = process.env.VITE_GEMINI_API_KEY  || process.env.GEMINI_API_KEY  || '';
const DEEPSEEK_API_KEY = process.env.VITE_DEEPSEEK_API_KEY || process.env.DEEPSEEK_API_KEY || '';

async function callGemini(systemPrompt: string, messages: {role: string; content: string}[]): Promise<string> {
  const contents = messages.map(m => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }],
  }));
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemPrompt }] },
        contents,
        generationConfig: { maxOutputTokens: 400, temperature: 0.5 },
      }),
    }
  );
  if (!res.ok) throw new Error(`Gemini ${res.status}`);
  const data = await res.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
}

async function callDeepseek(systemPrompt: string, messages: {role: string; content: string}[]): Promise<string> {
  const res = await fetch('https://api.deepseek.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${DEEPSEEK_API_KEY}` },
    body: JSON.stringify({
      model: 'deepseek-chat',
      messages: [{ role: 'system', content: systemPrompt }, ...messages],
      max_tokens: 400,
      temperature: 0.5,
    }),
  });
  if (!res.ok) throw new Error(`Deepseek ${res.status}`);
  const data = await res.json();
  return data.choices?.[0]?.message?.content ?? '';
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { question, tires = [], conversationHistory = [], language = 'en' } = req.body ?? {};
  if (!question) return res.status(400).json({ error: 'Missing question' });

  const tiresSummary = tires.length > 0
    ? tires.map((t: any) => `- ${t.brand} ${t.model} ${t.size} (${t.season}, $${t.pricePerUnit ?? t.price}/tire, ${t.fitmentVerified ? 'fitment verified' : 'not fitment verified'})`).join('\n')
    : 'No specific tires were recommended.';

  const systemPrompt = language === 'fr'
    ? `Vous êtes un conseiller expert en pneus pour GCI Tires (Canada). Le client a reçu les recommandations de pneus suivantes:\n${tiresSummary}\n\nRépondez aux questions de suivi sur ces pneus spécifiques. Soyez concis (2-4 phrases max). Ne recommandez pas d'autres pneus sauf si explicitement demandé. Répondez en français.`
    : `You are an expert tire consultant for GCI Tires (Canada). The customer was already recommended these tires:\n${tiresSummary}\n\nAnswer follow-up questions about these specific tires only. Be concise (2-4 sentences max). Do not suggest different tires unless explicitly asked.`;

  const messages = [
    ...conversationHistory,
    { role: 'user', content: question },
  ];

  try {
    let reply = '';
    try {
      reply = await callGemini(systemPrompt, messages);
    } catch (e) {
      console.error('[chat] Gemini failed, trying Deepseek:', e);
      reply = await callDeepseek(systemPrompt, messages);
    }
    if (!reply) return res.status(500).json({ error: 'Empty AI response' });
    return res.status(200).json({ reply });
  } catch (err: any) {
    console.error('[chat] Both providers failed:', err);
    return res.status(500).json({ error: 'AI unavailable' });
  }
}
