// YouTube lessons: Supabase access (tables from sql/lessons.sql) and the analysis loop.
import { supabase } from './supabase.js';
import { invokeAI } from './cloudflareAI.js';
import { buildWindows, mergeSegments, formatTime, youTubeUrl } from '../../supabase/functions/_shared/lessonContract.js';

export {
  LESSON_LIMITS, parseYouTubeId, formatTime, splitTimestamps, searchSegments, buildWindows, youTubeUrl
} from '../../supabase/functions/_shared/lessonContract.js';

export const LESSON_SETUP_MESSAGE = 'Lessons need database setup. Run sql/lessons.sql in this project’s Supabase SQL editor, then reload.';
const LESSON_COLUMNS = 'id, workspace_id, project_id, video_id, title, duration_seconds, status, analyzed_seconds, segments, summary, chapters, key_points, created_by, created_at, updated_at';

export function isMissingLessonsTable(error) {
  return Boolean(error) && ['42P01', 'PGRST205'].includes(error.code);
}

export async function listProjectLessons(projectId) {
  const { data, error } = await supabase.from('lessons')
    .select('id, video_id, title, duration_seconds, status, created_at')
    .eq('project_id', projectId)
    .order('created_at', { ascending: false })
    .limit(100);
  return { data: data || [], error };
}

export async function createLesson({ workspaceId, projectId, videoId, title, userId }) {
  const { data, error } = await supabase.from('lessons')
    .insert({ workspace_id: workspaceId, project_id: projectId, video_id: videoId, created_by: userId, ...(title ? { title } : {}) })
    .select('id')
    .single();
  return { data, error };
}

export async function findLesson(projectId, videoId) {
  const { data } = await supabase.from('lessons').select('id').eq('project_id', projectId).eq('video_id', videoId).maybeSingle();
  return data;
}

export async function getLesson(lessonId) {
  const { data, error } = await supabase.from('lessons').select(LESSON_COLUMNS).eq('id', lessonId).maybeSingle();
  return { data, error };
}

export async function updateLesson(lessonId, updates) {
  const { data, error } = await supabase.from('lessons').update(updates).eq('id', lessonId).select(LESSON_COLUMNS).maybeSingle();
  return { data, error };
}

export async function deleteLesson(lessonId) {
  const { error } = await supabase.from('lessons').delete().eq('id', lessonId);
  return { error };
}

export async function getLessonQuestions(lessonId) {
  const { data, error } = await supabase.from('lesson_questions')
    .select('id, user_id, question, answer, created_at, asker:users(name)')
    .eq('lesson_id', lessonId)
    .order('created_at', { ascending: true })
    .order('id', { ascending: true })
    .limit(200);
  return { data: data || [], error };
}

export async function saveLessonQuestion({ lessonId, userId, question, answer }) {
  const { data, error } = await supabase.from('lesson_questions')
    .insert({ lesson_id: lessonId, user_id: userId, question, answer })
    .select('id, user_id, question, answer, created_at, asker:users(name)')
    .single();
  return { data, error };
}

const wait = (ms, signal) => new Promise((resolve, reject) => {
  const timer = setTimeout(resolve, ms);
  signal?.addEventListener('abort', () => { clearTimeout(timer); reject(new DOMException('Stopped', 'AbortError')); }, { once: true });
});

// When the per-minute allowance is hit, wait as long as the server says (up to a minute) and retry,
// twice at most. Daily limits and other errors surface immediately.
async function lessonAI(body, signal, onWait = () => {}) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await invokeAI('lesson-ai', body, signal);
    } catch (error) {
      const seconds = Number(error?.retryAfter) || (/minute/i.test(error?.message || '') ? 30 : 0);
      if (error?.code !== 'FREE_LIMIT_REACHED' || !seconds || attempt >= 2) throw error;
      const pause = Math.min(Math.max(seconds, 5), 60) + 1;
      onWait(pause);
      await wait(pause * 1000, signal);
    }
  }
}

// Watches the video in 10-minute windows, saving after each one so a stopped or failed
// analysis resumes where it left off, then writes the summary and chapters from the notes.
export async function analyzeLesson(lesson, { duration, onProgress = () => {}, signal } = {}) {
  let current = lesson;
  let segments = Array.isArray(lesson.segments) ? lesson.segments : [];
  const save = async (updates) => {
    const { data, error } = await updateLesson(lesson.id, updates);
    if (error) throw new Error(`Could not save the lesson: ${error.message}`);
    if (data) current = data;
    return current;
  };
  const windows = buildWindows(duration, lesson.status === 'new' ? 0 : lesson.analyzed_seconds);
  if (lesson.status === 'new') segments = [];
  for (const [index, part] of windows.entries()) {
    onProgress({ step: index + 1, steps: windows.length + 1, label: `Watching ${formatTime(part.start)}–${formatTime(part.end)}`, lesson: current });
    const label = `Watching ${formatTime(part.start)}–${formatTime(part.end)}`;
    const result = await lessonAI({ mode: 'analyze', lessonId: lesson.id, videoId: lesson.video_id, start: part.start, end: part.end }, signal,
      (pause) => onProgress({ step: index + 1, steps: windows.length + 1, label: `${label} (the free AI allowance is busy, retrying in ${pause}s)`, lesson: current }));
    segments = mergeSegments(segments, result.segments);
    await save({ segments, analyzed_seconds: part.end, duration_seconds: duration, status: 'analyzing' });
  }
  if (!segments.length) throw new Error('No spoken content was found in this video.');
  onProgress({ step: windows.length + 1, steps: windows.length + 1, label: 'Writing the summary and chapters', lesson: current });
  const outline = await lessonAI({ mode: 'outline', lessonId: lesson.id, title: current.title, duration, segments }, signal);
  return save({ summary: outline.summary, chapters: outline.chapters, key_points: outline.keyPoints, status: 'ready', duration_seconds: duration, analyzed_seconds: duration });
}

export async function askLesson(lesson, question, history = [], signal, onWait) {
  const result = await lessonAI({
    mode: 'ask',
    lessonId: lesson.id,
    title: lesson.title,
    duration: lesson.duration_seconds,
    segments: lesson.segments,
    ...(lesson.summary ? { summary: lesson.summary } : {}),
    question,
    ...(history.length ? { messages: history } : {})
  }, signal, onWait);
  return result.answer;
}

export function lessonLink(videoId, seconds = 0) {
  return `${youTubeUrl(videoId)}${seconds ? `&t=${Math.floor(seconds)}s` : ''}`;
}
