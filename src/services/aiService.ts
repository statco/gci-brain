// src/services/aiService.ts
// 🧠 Unified AI Provider — Gemini (primary) → Deepseek (fallback)
// ---------------------------------------------------------------
// HOW IT WORKS:
//   1. Tries Gemini 2.5 Flash first (cheapest, fast)
//   2. On failure/quota → falls back to Deepseek V3 (~17x cheaper than Gemini Pro)
//   3. On both failures → throws so geminiService can use keyword fallback
//
// 🔐 SECURITY NOTE:
//   VITE_ prefixed env vars are exposed in the browser bundle.
//   For production, move these calls to /api/recommend.ts (Vercel serverless).
//   Add to vercel.json: { "functions": { "api/*.ts": { "memory": 256 } } }
// ---------------------------------------------------------------

import { GoogleGenerativeAI } from '@google/generative-ai';

// ── Env vars ──────────────────────────────────────────────────
const GEMINI_API_KEY   = import.meta.env.VITE_GEMINI_API_KEY   || '';
const DEEPSEEK_API_KEY = import.meta.env.VITE_DEEPSEEK_API_KEY || '';

// ── Provider status tracker (runtime, resets on page reload) ──
const providerStatus = {
  gemini:   { failures: 0, lastFail: 0, cooldownMs: 60_000 },
  deepseek: { failures: 0, lastFail: 0, cooldownMs: 60_000 },
};

function isCoolingDown(provider: 'gemini' | 'deepseek'): boolean {
  const s = providerStatus[provider];
  if (s.failures === 0) return false;
  return Date.now() - s.lastFail < s.cooldownMs;
}

function recordFailure(provider: 'gemini' | 'deepseek') {
  providerStatus[provider].failures++;
  providerStatus[provider].lastFail = Date.now();
}

function recordSuccess(provider: 'gemini' | 'deepseek') {
  providerStatus[provider].failures = 0;
}

// ── Shared types ──────────────────────────────────────────────
export interface AIRequest {
  prompt: string;
  systemInstruction?: string;
  model?: string;
}

export interface AIResponse {
  text: string;
  provider: 'gemini' | 'deepseek';
  model: string;
}

// ─────────────────────────────────────────────────────────────
// PROVIDER 1: Gemini 2.5 Flash
// ─────────────────────────────────────────────────────────────
async function callGemini(req: AIRequest): Promise<AIResponse> {
  if (!GEMINI_API_KEY) throw new Error('GEMINI_API_KEY not set');
  if (isCoolingDown('gemini'))
    throw new Error('Gemini is in cooldown after repeated failures');

  const modelName = req.model || 'gemini-2.5-flash';
  const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
  const model = genAI.getGenerativeModel({
    model: modelName,
    ...(req.systemInstruction
      ? { systemInstruction: req.systemInstruction }
      : {}),
  });

  const result   = await model.generateContent(req.prompt);
  const response = await result.response;
  const text     = response.text();

  if (!text || text.trim() === '') throw new Error('Empty response from Gemini');

  recordSuccess('gemini');
  return { text, provider: 'gemini', model: modelName };
}

// ─────────────────────────────────────────────────────────────
// PROVIDER 2: Deepseek V3  (OpenAI-compatible endpoint)
// Pricing: ~$0.014/1M input tokens — ~17x cheaper than Gemini Pro
// ─────────────────────────────────────────────────────────────
async function callDeepseek(req: AIRequest): Promise<AIResponse> {
  if (!DEEPSEEK_API_KEY) throw new Error('DEEPSEEK_API_KEY not set');
  if (isCoolingDown('deepseek'))
    throw new Error('Deepseek is in cooldown after repeated failures');

  const modelName = 'deepseek-chat'; // deepseek-chat = DeepSeek V3

  const messages: { role: string; content: string }[] = [];
  if (req.systemInstruction) {
    messages.push({ role: 'system', content: req.systemInstruction });
  }
  messages.push({ role: 'user', content: req.prompt });

  const response = await fetch('https://api.deepseek.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${DEEPSEEK_API_KEY}`,
    },
    body: JSON.stringify({
      model: modelName,
      messages,
      max_tokens: 500,
      temperature: 0.1, // Low temp = consistent JSON output
    }),
  });

  if (!response.ok) {
    const errBody = await response.text().catch(() => '');
    recordFailure('deepseek');
    throw new Error(`Deepseek HTTP ${response.status}: ${errBody}`);
  }

  const data = await response.json();
  const text = data?.choices?.[0]?.message?.content ?? '';

  if (!text || text.trim() === '') throw new Error('Empty response from Deepseek');

  recordSuccess('deepseek');
  return { text, provider: 'deepseek', model: modelName };
}

// ─────────────────────────────────────────────────────────────
// MAIN ENTRY — Runs providers in order, falls through on error
// ─────────────────────────────────────────────────────────────
export async function generateAIContent(req: AIRequest): Promise<AIResponse> {
  const providers: Array<() => Promise<AIResponse>> = [
    () => callGemini(req),
    () => callDeepseek(req),
  ];

  let lastError: Error | null = null;

  for (const tryProvider of providers) {
    try {
      const result = await tryProvider();
      console.log(`✅ AI response from: ${result.provider} (${result.model})`);
      return result;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      console.warn(`⚠️ AI provider failed — trying next...`, lastError.message);
      // Record failure for the appropriate provider
      if (lastError.message.toLowerCase().includes('gemini') ||
          lastError.message.includes('429') ||
          lastError.message.includes('503')) {
        recordFailure('gemini');
      }
    }
  }

  // All providers failed
  throw new Error(
    `All AI providers failed. Last error: ${lastError?.message ?? 'unknown'}`
  );
}

// ─────────────────────────────────────────────────────────────
// Utility: Get current provider health (useful for debugging)
// ─────────────────────────────────────────────────────────────
export function getProviderHealth() {
  return {
    gemini: {
      available: !!GEMINI_API_KEY && !isCoolingDown('gemini'),
      failures: providerStatus.gemini.failures,
    },
    deepseek: {
      available: !!DEEPSEEK_API_KEY && !isCoolingDown('deepseek'),
      failures: providerStatus.deepseek.failures,
    },
  };
}
