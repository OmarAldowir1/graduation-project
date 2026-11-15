// Google Gemini (generateContent REST API), used only for YouTube lessons because it can
// read a public YouTube URL directly. The key stays on the server; callers never choose the model.
// The second model has its own free-tier allowance and is used when the first is busy or missing.
export const GEMINI_MODELS = ['gemini-3.6-flash', 'gemini-3.5-flash-lite'];
const API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

export class GeminiError extends Error {
  constructor(status, code, message, retryAfter = 0) {
    super(message);
    this.status = status;
    this.code = code;
    if (retryAfter) this.retryAfter = retryAfter;
  }
}

export function isGeminiConfigured(env) {
  return /^[A-Za-z0-9._-]{20,200}$/.test(env('GEMINI_API_KEY') || '');
}

function modelsFor(env) {
  const chosen = env('GEMINI_MODEL') || '';
  return /^gemini-[a-z0-9.-]{3,60}$/.test(chosen) ? [chosen, ...GEMINI_MODELS.filter((model) => model !== chosen)] : GEMINI_MODELS;
}

// Google's 429 says how long to wait and whether the daily allowance (not just this minute's) is gone.
function rateLimit(payload) {
  const details = Array.isArray(payload?.error?.details) ? payload.error.details : [];
  const delay = details.find((item) => String(item?.['@type'] || '').endsWith('RetryInfo'))?.retryDelay;
  const seconds = Math.ceil(Number(String(delay || '').replace(/s$/, '')));
  const daily = details.some((item) => (item?.violations || []).some((violation) => /PerDay/i.test(`${violation?.quotaId || ''} ${violation?.quotaMetric || ''}`)));
  return { retryAfter: Number.isFinite(seconds) && seconds > 0 ? Math.min(seconds, 120) : 0, daily };
}

// parts: Gemini content parts for one user turn. With `schema` the reply is parsed JSON, otherwise text.
export async function requestGemini({ env, fetchImpl, parts, system, schema, history = [], hasVideo = false, maxOutputTokens = 8192, timeoutMs = 120000 }) {
  if (!isGeminiConfigured(env)) {
    throw new GeminiError(503, 'AI_NOT_CONFIGURED', 'Lesson AI is not activated yet. The workspace administrator needs to add the Gemini API key.');
  }
  const body = JSON.stringify({
    ...(system ? { system_instruction: { parts: [{ text: system }] } } : {}),
    contents: [...history, { role: 'user', parts }],
    generationConfig: {
      temperature: 0.2,
      maxOutputTokens,
      ...(schema ? { responseMimeType: 'application/json', responseSchema: schema } : {})
    }
  });
  let response;
  let payload = null;
  for (const model of modelsFor(env)) {
    response = await fetchImpl(`${API_BASE}/${model}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': env('GEMINI_API_KEY') },
      signal: AbortSignal.timeout(timeoutMs),
      body
    });
    try { payload = await response.json(); } catch { payload = null; }
    // 404: model name not available to this key. 429/503: busy or out of allowance. Try the next model.
    if (![404, 429, 503].includes(response.status)) break;
  }
  if (!response.ok) {
    const detail = String(payload?.error?.message || '');
    if (response.status === 429) {
      const { retryAfter, daily } = rateLimit(payload);
      throw daily
        ? new GeminiError(429, 'FREE_LIMIT_REACHED', 'Today’s free Gemini allowance is used up. Please try again tomorrow.')
        : new GeminiError(429, 'FREE_LIMIT_REACHED', 'The free Gemini allowance for this minute is used up. Please try again in a minute.', retryAfter || 30);
    }
    if (/api key/i.test(detail) || response.status === 401) throw new GeminiError(503, 'KEY_REJECTED', 'The Gemini API key was rejected. The workspace administrator needs to check it.');
    if (hasVideo && [400, 403, 404].includes(response.status)) throw new GeminiError(422, 'VIDEO_UNAVAILABLE', 'This video could not be read. It must be a public YouTube video (not private, unlisted or age-restricted).');
    if (response.status === 403) throw new GeminiError(503, 'KEY_REJECTED', 'The Gemini API key was rejected. The workspace administrator needs to check it.');
    throw new GeminiError(503, 'PROVIDER_UNAVAILABLE', 'Lesson AI is temporarily unavailable. Please try again later.');
  }
  const candidate = payload?.candidates?.[0];
  const text = (candidate?.content?.parts || []).filter((part) => !part.thought && typeof part.text === 'string').map((part) => part.text).join('').trim();
  if (!text) {
    const blocked = payload?.promptFeedback?.blockReason || (candidate?.finishReason && candidate.finishReason !== 'STOP' ? candidate.finishReason : '');
    throw new GeminiError(502, 'INVALID_DRAFT', blocked ? `The AI could not process this (${String(blocked).toLowerCase().replaceAll('_', ' ')}).` : 'The AI returned an empty response. Please try again.');
  }
  if (!schema) return text;
  try {
    return JSON.parse(text);
  } catch {
    throw new GeminiError(502, 'INVALID_DRAFT', candidate?.finishReason === 'MAX_TOKENS' ? 'The AI answer was cut off. Please try again.' : 'The AI returned an unreadable response. Please try again.');
  }
}
