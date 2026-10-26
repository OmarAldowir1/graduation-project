import {AIProviderError, isFreeAIConfigured, requestFreeAI} from '../_shared/cloudflareAI.js';

const CHAT_INSTRUCTIONS = `You are Motion AI, a helpful workspace assistant and academic tutor. Use only the supplied conversation and document text; do not claim to read other files or pages. Answer in the user's language. Use clear Markdown when helpful. You cannot edit the page or create records; the user must apply any suggested content themselves.`;
const EDIT_INSTRUCTIONS = 'You are a writing assistant. Return only the resulting text, without quotes, introductions, or explanations.';
const EDIT_ACTIONS = {
  improve: 'Improve clarity and flow while preserving meaning and language.',
  proofread: 'Correct spelling, grammar, and punctuation while preserving style.',
  rewrite: 'Rewrite naturally while preserving the key message.',
  summarize: 'Summarize concisely and accurately.',
  explain: 'Explain simply and clearly.'
};

class RequestError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}

export function createTextAIHandler({env, fetchImpl = fetch, authenticate, reserveQuota}) {
  return async request => {
    const origin = request.headers.get('origin');
    const allowed = (env('MOTION_AI_ALLOWED_ORIGINS') || '').split(',').map(x => x.trim()).filter(Boolean);
    const cors = origin && allowed.includes(origin) ? {'Access-Control-Allow-Origin': origin, Vary: 'Origin'} : {};
    const reply = (status, body) => Response.json(body, {status, headers: {...cors, 'Cache-Control': 'no-store'}});
    if (origin && !allowed.includes(origin)) return reply(403, {error: {code: 'ORIGIN_DENIED', message: 'AI is not enabled for this website address.'}});
    if (request.method === 'OPTIONS') return new Response(null, {status: 204, headers: {...cors, 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info'}});
    if (request.method !== 'POST') return reply(405, {error: {code: 'METHOD_NOT_ALLOWED', message: 'Use POST to request AI text.'}});
    try {
      const token = request.headers.get('authorization');
      if (!token?.startsWith('Bearer ') || !await authenticate(token)) throw new RequestError(401, 'SIGN_IN_REQUIRED', 'Please sign in again to use AI.');
      if (!isFreeAIConfigured(env)) throw new RequestError(503, 'AI_NOT_CONFIGURED', 'AI is not activated yet. The workspace administrator needs to finish the free AI setup.');
      if (!request.headers.get('content-type')?.includes('application/json')) throw new RequestError(400, 'INVALID_REQUEST', 'The request must be JSON.');
      const body = await request.text();
      if (body.length > 40000) throw new RequestError(413, 'TOO_LARGE', 'This request is too large.');
      let input;
      try { input = JSON.parse(body); } catch { throw new RequestError(400, 'INVALID_REQUEST', 'The request could not be read.'); }
      if (!input || typeof input !== 'object' || Array.isArray(input)) throw new RequestError(400, 'INVALID_REQUEST', 'Unsupported AI request.');
      let messages;
      let maxTokens;
      if (input.mode === 'chat') {
        if (Object.keys(input).some(key => !['mode','prompt','messages','attachment','pageContext','workspaceName'].includes(key))) throw new RequestError(400, 'INVALID_REQUEST', 'Unsupported AI request.');
        if (typeof input.prompt !== 'string' || !input.prompt.trim() || input.prompt.length > 4000) throw new RequestError(400, 'INVALID_REQUEST', 'Enter a message of 1–4,000 characters.');
        if (input.messages !== undefined && (!Array.isArray(input.messages) || input.messages.length > 10 || input.messages.some(m => !m || !['user','assistant'].includes(m.role) || typeof m.content !== 'string' || m.content.length > 2000))) throw new RequestError(400, 'INVALID_REQUEST', 'The chat history is too long.');
        if (input.attachment !== undefined && (!input.attachment || typeof input.attachment.name !== 'string' || input.attachment.name.length > 200 || typeof input.attachment.content !== 'string' || input.attachment.content.length > 16000)) throw new RequestError(400, 'INVALID_REQUEST', 'The attachment text is too long.');
        if (input.pageContext !== undefined && (!input.pageContext || typeof input.pageContext.title !== 'string' || input.pageContext.title.length > 200 || typeof input.pageContext.text !== 'string' || input.pageContext.text.length > 12000)) throw new RequestError(400, 'INVALID_REQUEST', 'The page context is too long.');
        if (input.workspaceName !== undefined && (typeof input.workspaceName !== 'string' || input.workspaceName.length > 200)) throw new RequestError(400, 'INVALID_REQUEST', 'Invalid workspace name.');
        const history = (input.messages || []).map(m => ({role: m.role, content: m.content}));
        const context = [input.workspaceName && `Workspace: ${input.workspaceName}`, input.pageContext && `Current page: ${input.pageContext.title}\n${input.pageContext.text}`, input.attachment && `Attached file: ${input.attachment.name}\n${input.attachment.content}`].filter(Boolean).join('\n\n');
        messages = [{role: 'system', content: CHAT_INSTRUCTIONS}, ...history, {role: 'user', content: `${context ? `${context}\n\n` : ''}${input.prompt.trim()}`}];
        maxTokens = 3000;
      } else if (input.mode === 'edit') {
        if (Object.keys(input).some(key => !['mode','action','text','tone','language'].includes(key))) throw new RequestError(400, 'INVALID_REQUEST', 'Unsupported AI request.');
        if (typeof input.text !== 'string' || !input.text.trim() || input.text.length > 12000) throw new RequestError(400, 'INVALID_REQUEST', 'Select up to 12,000 characters.');
        if (!Object.hasOwn(EDIT_ACTIONS, input.action) && !['tone','translate'].includes(input.action)) throw new RequestError(400, 'INVALID_REQUEST', 'Unsupported text action.');
        if (input.tone !== undefined && (typeof input.tone !== 'string' || input.tone.length > 40) || input.language !== undefined && (typeof input.language !== 'string' || input.language.length > 40)) throw new RequestError(400, 'INVALID_REQUEST', 'Invalid text option.');
        const instruction = input.action === 'tone' ? `Rewrite with a ${input.tone || 'professional'} tone while preserving meaning.` : input.action === 'translate' ? `Translate accurately to ${input.language || 'English'}.` : EDIT_ACTIONS[input.action];
        messages = [{role: 'system', content: EDIT_INSTRUCTIONS}, {role: 'user', content: `${instruction}\n\nText:\n${input.text}`}];
        maxTokens = 2048;
      } else throw new RequestError(400, 'INVALID_REQUEST', 'Unsupported AI request.');
      const quota = await reserveQuota(token);
      if (!quota?.allowed) throw new RequestError(429, 'FREE_LIMIT_REACHED', 'The free AI usage limit has been reached. Please try again later. No paid service will be used.');
      const output = await requestFreeAI({env, fetchImpl, messages, maxTokens});
      if (typeof output !== 'string') throw new RequestError(502, 'INVALID_DRAFT', 'AI returned an invalid response.');
      return reply(200, {text: output.trim()});
    } catch (error) {
      if (error instanceof RequestError || error instanceof AIProviderError) return reply(error.status, {error: {code: error.code, message: error.message}});
      if (['TimeoutError','AbortError'].includes(error?.name)) return reply(504, {error: {code: 'TIMEOUT', message: 'AI took too long. Please try again.'}});
      return reply(503, {error: {code: 'SERVICE_UNAVAILABLE', message: 'AI is unavailable right now. Please try again later.'}});
    }
  };
}
