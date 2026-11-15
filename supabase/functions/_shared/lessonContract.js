// YouTube lessons: limits, prompts and validation shared by the lesson-ai function and the app.
// Pure functions only (no Deno, browser or network access) so both sides and the tests can import it.

export const LESSON_LIMITS = {
  windowSeconds: 600,       // one analysis request covers this much video
  maxWindowSeconds: 900,
  maxDuration: 4 * 3600,
  maxSegments: 900,
  segmentText: 700,
  chapters: 40,
  keyPoints: 12,
  summary: 6000,
  question: 1000,
  answer: 6000,
  history: 8,
  historyText: 2000
};

const YOUTUBE_HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtube-nocookie.com', 'www.youtube-nocookie.com']);
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

export function isVideoId(value) {
  return typeof value === 'string' && VIDEO_ID.test(value);
}

// Accepts watch, youtu.be, embed, shorts and live links, or a bare 11-character id.
export function parseYouTubeId(input) {
  const text = String(input ?? '').trim();
  if (isVideoId(text)) return text;
  let url;
  try { url = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`); } catch { return null; }
  const host = url.hostname.toLowerCase();
  let id = null;
  if (host === 'youtu.be') id = url.pathname.split('/')[1];
  else if (YOUTUBE_HOSTS.has(host)) {
    const parts = url.pathname.split('/').filter(Boolean);
    if (parts[0] === 'watch') id = url.searchParams.get('v');
    else if (['embed', 'shorts', 'live', 'v'].includes(parts[0])) id = parts[1];
  }
  return isVideoId(id) ? id : null;
}

export function youTubeUrl(videoId) {
  return `https://www.youtube.com/watch?v=${videoId}`;
}

// "12:40", "1:02:05" or "75s" → seconds; null when it is not a time.
export function parseTime(value) {
  const text = String(value ?? '').trim().replace(/^\[|\]$/g, '');
  if (/^\d{1,5}(\.\d+)?s$/.test(text)) return Math.floor(Number(text.slice(0, -1)));
  const match = text.match(/^(?:(\d{1,2}):)?(\d{1,3}):(\d{2})$/);
  if (!match) return null;
  const [hours, minutes, seconds] = [Number(match[1] || 0), Number(match[2]), Number(match[3])];
  if (seconds > 59 || (match[1] !== undefined && minutes > 59)) return null;
  return hours * 3600 + minutes * 60 + seconds;
}

export function formatTime(totalSeconds) {
  const seconds = Math.max(0, Math.floor(Number(totalSeconds) || 0));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = String(seconds % 60).padStart(2, '0');
  return hours ? `${hours}:${String(minutes).padStart(2, '0')}:${rest}` : `${minutes}:${rest}`;
}

function clip(value, max) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

// The analysis windows still to do for a video, resuming after `analyzedSeconds`.
export function buildWindows(duration, analyzedSeconds = 0, size = LESSON_LIMITS.windowSeconds) {
  const total = Math.min(Math.floor(Number(duration) || 0), LESSON_LIMITS.maxDuration);
  const windows = [];
  for (let start = Math.max(0, Math.floor(analyzedSeconds / size) * size); start < total; start += size) {
    // Fold a very short tail into the previous window instead of paying for a tiny request.
    const end = total - (start + size) < 45 ? total : Math.min(start + size, total);
    windows.push({ start, end });
    if (end === total) break;
  }
  return windows;
}

// AI output for one window → [{ start, text }], inside the window, ordered, no duplicates.
export function cleanSegments(raw, { start = 0, end = LESSON_LIMITS.maxDuration } = {}) {
  const list = Array.isArray(raw?.segments) ? raw.segments : Array.isArray(raw) ? raw : [];
  const seen = new Set();
  const segments = [];
  for (const item of list) {
    const at = typeof item?.start === 'number' ? Math.floor(item.start) : parseTime(item?.start);
    const text = clip(item?.text, LESSON_LIMITS.segmentText);
    if (at === null || !Number.isFinite(at) || !text) continue;
    // Models sometimes count from the start of the clip instead of the full video.
    const time = at < start && at + start < end ? at + start : at;
    if (time < start - 5 || time >= end + 5 || seen.has(time)) continue;
    seen.add(time);
    segments.push({ start: Math.min(Math.max(time, start), Math.max(start, end - 1)), text });
  }
  return segments.sort((a, b) => a.start - b.start).slice(0, 120);
}

export function mergeSegments(existing = [], incoming = []) {
  const byStart = new Map();
  for (const segment of [...existing, ...incoming]) {
    if (Number.isFinite(segment?.start) && segment?.text) byStart.set(Math.floor(segment.start), { start: Math.floor(segment.start), text: String(segment.text) });
  }
  return [...byStart.values()].sort((a, b) => a.start - b.start).slice(0, LESSON_LIMITS.maxSegments);
}

// Request-side validation of segments sent back to the server for outline / ask.
export function validSegments(value) {
  return Array.isArray(value) && value.length > 0 && value.length <= LESSON_LIMITS.maxSegments
    && value.every((item) => item && Number.isInteger(item.start) && item.start >= 0 && item.start <= LESSON_LIMITS.maxDuration
      && typeof item.text === 'string' && item.text.length > 0 && item.text.length <= LESSON_LIMITS.segmentText + 50);
}

export function notesText(segments = []) {
  return segments.map((segment) => `[${formatTime(segment.start)}] ${segment.text}`).join('\n');
}

export function cleanOutline(raw, duration = LESSON_LIMITS.maxDuration) {
  const summary = typeof raw?.summary === 'string' ? raw.summary.trim().slice(0, LESSON_LIMITS.summary) : '';
  const seen = new Set();
  const chapters = [];
  for (const item of Array.isArray(raw?.chapters) ? raw.chapters : []) {
    const at = typeof item?.start === 'number' ? Math.floor(item.start) : parseTime(item?.start);
    const title = clip(item?.title, 120);
    if (at === null || !Number.isFinite(at) || at < 0 || at > duration || !title || seen.has(at)) continue;
    seen.add(at);
    chapters.push({ start: at, title });
  }
  chapters.sort((a, b) => a.start - b.start);
  const keyPoints = [...new Set((Array.isArray(raw?.keyPoints) ? raw.keyPoints : []).map((point) => clip(point, 300)).filter(Boolean))].slice(0, LESSON_LIMITS.keyPoints);
  return { summary, chapters: chapters.slice(0, LESSON_LIMITS.chapters), keyPoints };
}

// Models sometimes wrap times in backticks or bold; keep them as plain [12:40] so they become seek buttons.
export function cleanAnswer(text) {
  return String(text ?? '').replace(/(`|\*\*)(\[(?:\d{1,2}:)?\d{1,3}:\d{2}\])\1/g, '$2').trim().slice(0, LESSON_LIMITS.answer);
}

// Splits an answer into text and clickable times. Only times inside the video count.
export function splitTimestamps(text, duration = LESSON_LIMITS.maxDuration) {
  const parts = [];
  const pattern = /\[?((?:\d{1,2}:)?\d{1,3}:\d{2})\]?/g;
  const source = String(text ?? '');
  let last = 0;
  for (const match of source.matchAll(pattern)) {
    const seconds = parseTime(match[1]);
    const before = source[match.index - 1];
    const after = source[match.index + match[0].length];
    // A bare time must not be part of a longer number (3:4:50); a bracketed one is unambiguous.
    const bracketed = match[0].startsWith('[') && match[0].endsWith(']');
    if (seconds === null || seconds > duration || (!bracketed && (/[\d:]/.test(before || '') || /[\d:]/.test(after || '')))) continue;
    if (match.index > last) parts.push({ type: 'text', value: source.slice(last, match.index) });
    parts.push({ type: 'time', value: formatTime(seconds), seconds });
    last = match.index + match[0].length;
  }
  if (last < source.length) parts.push({ type: 'text', value: source.slice(last) });
  return parts;
}

// Search that ignores case, Arabic diacritics and common Arabic letter variants.
export function normalizeForSearch(text) {
  return String(text ?? '').toLowerCase()
    .replace(/[ً-ٰٟـ]/g, '')
    .replace(/[آأإ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/\s+/g, ' ')
    .trim();
}

export function searchSegments(segments = [], query = '') {
  const terms = normalizeForSearch(query).split(' ').filter(Boolean);
  if (!terms.length) return segments;
  return segments.filter((segment) => {
    const haystack = normalizeForSearch(segment.text);
    return terms.every((term) => haystack.includes(term));
  });
}

// ---------- Prompts and response schemas (Gemini) ----------

export function analyzePrompt({ start, end }) {
  return [
    `You are taking study notes on one part of a video lesson, from ${formatTime(start)} to ${formatTime(end)} of the full video.`,
    `Split this part into segments. Start a new segment whenever the topic, step or example changes, and at least once per minute: write at least ${Math.max(1, Math.round((end - start) / 60))} segments for this part, covering it from beginning to end without gaps.`,
    'For each segment give "start": the time it begins, as MM:SS or H:MM:SS counted from the beginning of the full video (not from the beginning of this part).',
    'and "text": two or three sentences on what is taught there. Name the specific terms, definitions, formulas, people and examples that are mentioned, so a student can find them by searching.',
    'Write the notes in the language spoken in the video. Describe only what is actually said or shown; do not add outside knowledge.'
  ].join('\n');
}

export const SEGMENTS_SCHEMA = {
  type: 'OBJECT',
  properties: {
    segments: {
      type: 'ARRAY',
      items: { type: 'OBJECT', properties: { start: { type: 'STRING' }, text: { type: 'STRING' } }, required: ['start', 'text'] }
    }
  },
  required: ['segments']
};

export function outlinePrompt({ title = '', notes }) {
  return [
    `These are timestamped notes of the video lesson${title ? ` "${clip(title, 200)}"` : ''}. Each line starts with the time in the video.`,
    'Write: "summary" (one or two short paragraphs on what the lesson teaches), "chapters" (5 to 15 main parts in order, each with "start" copied from the time of the note where it begins and a short "title"), and "keyPoints" (4 to 10 things a student should remember).',
    'Use the language of the notes. Use only what the notes say.',
    '',
    'NOTES:',
    notes
  ].join('\n');
}

export const OUTLINE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    summary: { type: 'STRING' },
    chapters: {
      type: 'ARRAY',
      items: { type: 'OBJECT', properties: { start: { type: 'STRING' }, title: { type: 'STRING' } }, required: ['start', 'title'] }
    },
    keyPoints: { type: 'ARRAY', items: { type: 'STRING' } }
  },
  required: ['summary', 'chapters', 'keyPoints']
};

export const ASK_INSTRUCTIONS = [
  'You are a tutor answering questions about one video lesson, using only the lesson notes provided. Each note line starts with its time in the video.',
  'Whenever you refer to a part of the lesson, cite its time in square brackets, like [12:40], using only times that appear in the notes. Write times as plain text: never put them in backticks, code formatting or bold. When asked where or when something is explained, lead with the time.',
  'If the notes do not cover the question, say that the lesson does not seem to cover it; do not answer from outside knowledge.',
  'Answer in the language of the question. Be concise. Use short Markdown lists when they help. Write maths in plain text (Ax = b), never in LaTeX or dollar signs.'
].join('\n');

export function askPrompt({ title = '', summary = '', notes, question }) {
  return [
    title ? `LESSON: ${clip(title, 200)}` : '',
    summary ? `SUMMARY:\n${summary}` : '',
    'NOTES:',
    notes,
    '',
    `QUESTION: ${question}`
  ].filter((line) => line !== '').join('\n');
}
