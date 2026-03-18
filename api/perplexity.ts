import type { VercelRequest, VercelResponse } from '@vercel/node';
const PERPLEXITY_API_KEY = process.env.PERPLEXITY_API_KEY || '';
export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!PERPLEXITY_API_KEY) {
    console.warn('[perplexity] API key not configured');
    return res.status(200).json({ choices: [{ message: { content: '' } }] });
  }
  const { messages, model = 'llama-3.1-sonar-small-128k-online' } =
    (req.body ?? {}) as Record<string, any>;
  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({ error: 'messages array is required' });
  }
  try {
    const upstream = await fetch('https://api.perplexity.ai/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${PERPLEXITY_API_KEY}`,
      },
      body: JSON.stringify({ model, messages }),
    });
    const data = await upstream.json();
    if (!upstream.ok) {
      console.error('[perplexity] upstream error:', upstream.status, data);
      return res.status(200).json({ choices: [{ message: { content: '' } }] });
    }
    return res.status(200).json(data);
  } catch (err) {
    console.error('[perplexity] unexpected error:', err);
    return res.status(200).json({ choices: [{ message: { content: '' } }] });
  }
}
