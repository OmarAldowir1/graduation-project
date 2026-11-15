import { GeminiError, isGeminiConfigured, requestGemini } from '../_shared/geminiAI.js';
import {
  LESSON_LIMITS, isVideoId, youTubeUrl, validSegments, notesText, cleanSegments, cleanOutline, cleanAnswer,
  analyzePrompt, outlinePrompt, askPrompt, ASK_INSTRUCTIONS, SEGMENTS_SCHEMA, OUTLINE_SCHEMA
} from '../_shared/lessonContract.js';

class RequestError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}

const QUOTA_MESSAGES = {
  video: 'Today’s limit for analysing video has been reached. Please try again tomorrow.',
  minute: 'Too many lesson AI requests in a minute. Please wait a moment and try again.',
  daily: 'Today’s lesson AI limit has been reached. Please try again tomorrow.'
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EDIT_ROLES = ['owner', 'admin', 'editor'];
const ASK_ROLES = [...EDIT_ROLES, 'commenter'];

function onlyKeys(input, keys) {
  return Object.keys(input).every((key) => keys.includes(key));
}

// Modes (every request names its lesson, and the person must be in that lesson's team):
//   analyze { lessonId, videoId, start, end }                       → { segments }   (owners, admins, editors)
//   outline { lessonId, title?, duration, segments }                → { summary, chapters, keyPoints }   (owners, admins, editors)
//   ask     { lessonId, title?, duration, segments, summary?, question, messages? } → { answer }   (commenters and above)
// authorizeLesson(token, lessonId) → { video_id, role } for the signed-in person, or null when they can't see it.
export function createLessonAIHandler({ env, fetchImpl = fetch, authenticate, reserveQuota, authorizeLesson }) {
  return async (request) => {
    const origin = request.headers.get('origin');
    const allowed = (env('MOTION_AI_ALLOWED_ORIGINS') || '').split(',').map((item) => item.trim()).filter(Boolean);
    const cors = origin && allowed.includes(origin) ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' } : {};
    const reply = (status, body) => Response.json(body, { status, headers: { ...cors, 'Cache-Control': 'no-store' } });
    if (origin && !allowed.includes(origin)) return reply(403, { error: { code: 'ORIGIN_DENIED', message: 'AI is not enabled for this website address.' } });
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: { ...cors, 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info' } });
    if (request.method !== 'POST') return reply(405, { error: { code: 'METHOD_NOT_ALLOWED', message: 'Use POST to request lesson AI.' } });
    try {
      const token = request.headers.get('authorization');
      if (!token?.startsWith('Bearer ') || !await authenticate(token)) throw new RequestError(401, 'SIGN_IN_REQUIRED', 'Please sign in again to use AI.');
      if (!isGeminiConfigured(env)) throw new RequestError(503, 'AI_NOT_CONFIGURED', 'Lesson AI is not activated yet. The workspace administrator needs to add the Gemini API key.');
      if (!request.headers.get('content-type')?.includes('application/json')) throw new RequestError(400, 'INVALID_REQUEST', 'The request must be JSON.');
      const body = await request.text();
      if (body.length > 900000) throw new RequestError(413, 'TOO_LARGE', 'This lesson is too large.');
      let input;
      try { input = JSON.parse(body); } catch { throw new RequestError(400, 'INVALID_REQUEST', 'The request could not be read.'); }
      if (!input || typeof input !== 'object' || Array.isArray(input)) throw new RequestError(400, 'INVALID_REQUEST', 'Unsupported lesson AI request.');
      const invalid = (message = 'Unsupported lesson AI request.') => new RequestError(400, 'INVALID_REQUEST', message);
      // Checked after the request is validated and before any quota is spent.
      const access = async (roles, denied) => {
        let lesson;
        try { lesson = await authorizeLesson(token, input.lessonId); } catch {
          throw new RequestError(503, 'SETUP_REQUIRED', 'Lesson permissions are unavailable. Make sure the latest sql/lessons.sql has been run in Supabase.');
        }
        if (!lesson?.role) throw new RequestError(404, 'LESSON_NOT_FOUND', 'This lesson was not found, or you are not in its team.');
        if (!roles.includes(lesson.role)) throw new RequestError(403, 'NOT_ALLOWED', denied);
        return lesson;
      };
      if (typeof input.lessonId !== 'string' || !UUID.test(input.lessonId)) throw invalid('Open the lesson again and retry.');
      const reserve = async (videoSeconds) => {
        let quota;
        try { quota = await reserveQuota(token, videoSeconds); } catch {
          throw new RequestError(503, 'SETUP_REQUIRED', 'Lesson AI usage tracking is unavailable. Make sure sql/lessons.sql has been run in Supabase.');
        }
        if (!quota?.allowed) throw new RequestError(429, 'FREE_LIMIT_REACHED', QUOTA_MESSAGES[quota?.reason] || QUOTA_MESSAGES.daily);
      };

      if (input.mode === 'analyze') {
        if (!onlyKeys(input, ['mode', 'lessonId', 'videoId', 'start', 'end'])) throw invalid();
        if (!isVideoId(input.videoId)) throw invalid('That does not look like a YouTube video.');
        const { start, end } = input;
        if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end <= start || end - start > LESSON_LIMITS.maxWindowSeconds || end > LESSON_LIMITS.maxDuration) throw invalid('That part of the video cannot be analysed.');
        const lesson = await access(EDIT_ROLES, 'Only team owners, admins and editors can analyse lessons.');
        if (lesson.video_id !== input.videoId) throw invalid('That video does not belong to this lesson.');
        await reserve(end - start);
        const output = await requestGemini({
          env, fetchImpl, hasVideo: true, schema: SEGMENTS_SCHEMA, maxOutputTokens: 16384, timeoutMs: 140000,
          parts: [
            { file_data: { file_uri: youTubeUrl(input.videoId) }, video_metadata: { start_offset: `${start}s`, end_offset: `${end}s` } },
            { text: analyzePrompt({ start, end }) }
          ]
        });
        return reply(200, { segments: cleanSegments(output, { start, end }) });
      }

      if (input.mode === 'outline' || input.mode === 'ask') {
        const isAsk = input.mode === 'ask';
        if (!onlyKeys(input, isAsk ? ['mode', 'lessonId', 'title', 'duration', 'segments', 'summary', 'question', 'messages'] : ['mode', 'lessonId', 'title', 'duration', 'segments'])) throw invalid();
        if (input.title !== undefined && (typeof input.title !== 'string' || input.title.length > 200)) throw invalid();
        if (!Number.isInteger(input.duration) || input.duration < 1 || input.duration > LESSON_LIMITS.maxDuration) throw invalid();
        if (!validSegments(input.segments)) throw invalid('Analyse the lesson before asking about it.');
        const notes = notesText(input.segments);
        if (!isAsk) {
          await access(EDIT_ROLES, 'Only team owners, admins and editors can analyse lessons.');
          await reserve(0);
          const output = await requestGemini({ env, fetchImpl, schema: OUTLINE_SCHEMA, parts: [{ text: outlinePrompt({ title: input.title, notes }) }] });
          const outline = cleanOutline(output, input.duration);
          if (!outline.summary && !outline.chapters.length) throw new RequestError(502, 'INVALID_DRAFT', 'The AI returned an empty outline. Please try again.');
          return reply(200, outline);
        }
        if (typeof input.question !== 'string' || !input.question.trim() || input.question.length > LESSON_LIMITS.question) throw invalid(`Enter a question of 1–${LESSON_LIMITS.question} characters.`);
        if (input.summary !== undefined && (typeof input.summary !== 'string' || input.summary.length > LESSON_LIMITS.summary)) throw invalid();
        if (input.messages !== undefined && (!Array.isArray(input.messages) || input.messages.length > LESSON_LIMITS.history
          || input.messages.some((message) => !message || !['user', 'assistant'].includes(message.role) || typeof message.content !== 'string' || !message.content || message.content.length > LESSON_LIMITS.historyText))) throw invalid('The chat history is too long.');
        await access(ASK_ROLES, 'Viewers can read lessons but not ask the AI. Ask a team owner or admin to make you a commenter or editor.');
        await reserve(0);
        const answer = await requestGemini({
          env, fetchImpl, system: ASK_INSTRUCTIONS, maxOutputTokens: 4096,
          history: (input.messages || []).map((message) => ({ role: message.role === 'assistant' ? 'model' : 'user', parts: [{ text: message.content }] })),
          parts: [{ text: askPrompt({ title: input.title, summary: input.summary, notes, question: input.question.trim() }) }]
        });
        return reply(200, { answer: cleanAnswer(answer) });
      }

      throw invalid();
    } catch (error) {
      if (error instanceof RequestError || error instanceof GeminiError) return reply(error.status, { error: { code: error.code, message: error.message, ...(error.retryAfter ? { retryAfter: error.retryAfter } : {}) } });
      if (['TimeoutError', 'AbortError'].includes(error?.name)) return reply(504, { error: { code: 'TIMEOUT', message: 'The AI took too long. Please try again.' } });
      return reply(503, { error: { code: 'SERVICE_UNAVAILABLE', message: 'Lesson AI is unavailable right now. Please try again later.' } });
    }
  };
}
