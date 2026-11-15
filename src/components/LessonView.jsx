import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, setBreadcrumb, showToast } from '../legacy/app.js';
import { supabase } from '../lib/supabase.js';
import { requestConfirmation } from '../lib/dialogs.js';
import { createPage } from '../lib/queries.js';
import { markdownToHtml } from '../lib/markdown.js';
import { escapeHtml } from '../lib/sanitize.js';
import {
  LESSON_LIMITS, LESSON_SETUP_MESSAGE, isMissingLessonsTable, getLesson, updateLesson, deleteLesson,
  getLessonQuestions, saveLessonQuestion, analyzeLesson, askLesson, lessonLink,
  formatTime, splitTimestamps, searchSegments
} from '../lib/lessons.js';

let youTubeApi = null;
function loadYouTubeApi() {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (!youTubeApi) {
    youTubeApi = new Promise((resolve, reject) => {
      const previous = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => { previous?.(); resolve(window.YT); };
      const script = document.createElement('script');
      script.src = 'https://www.youtube.com/iframe_api';
      script.async = true;
      script.onerror = () => { youTubeApi = null; reject(new Error('The YouTube player could not be loaded.')); };
      document.head.append(script);
    });
  }
  return youTubeApi;
}

// Markdown answer → safe HTML with every in-range time turned into a seek button.
function answerHtml(answer, duration) {
  return markdownToHtml(answer).replace(/>([^<]+)</g, (whole, text) => `>${splitTimestamps(text, duration).map((part) => (
    part.type === 'time' ? `<button type="button" class="lesson-time" data-seek="${part.seconds}">${part.value}</button>` : part.value
  )).join('')}<`);
}

function Player({ videoId, playerRef, onReady, onError }) {
  const host = useRef(null);
  useEffect(() => {
    let player = null;
    let active = true;
    const node = host.current;
    loadYouTubeApi().then((YT) => {
      if (!active || !node) return;
      const mount = document.createElement('div');
      node.replaceChildren(mount);
      player = new YT.Player(mount, {
        videoId,
        width: '100%',
        height: '100%',
        playerVars: { rel: 0, modestbranding: 1, playsinline: 1, origin: window.location.origin },
        events: {
          onReady: () => {
            if (!active) return;
            playerRef.current = player;
            onReady({ duration: Math.floor(player.getDuration?.() || 0), title: player.getVideoData?.()?.title || '' });
          },
          onError: (event) => { if (active) onError(event?.data); }
        }
      });
    }).catch(() => { if (active) onError('blocked'); });
    return () => {
      active = false;
      playerRef.current = null;
      try { player?.destroy?.(); } catch { /* Already gone. */ }
      node?.replaceChildren();
    };
    // The callbacks are stable for a mounted lesson; re-creating the player on every render would restart the video.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoId]);
  return <div ref={host} className="lesson-player" />;
}

function LessonRoom({ lessonId, user }) {
  const [lesson, setLesson] = useState(null);
  const [project, setProject] = useState(null);
  const [questions, setQuestions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [tab, setTab] = useState('overview');
  const [playerState, setPlayerState] = useState({ ready: false, duration: 0, error: '' });
  const [manualMinutes, setManualMinutes] = useState('');
  const [progress, setProgress] = useState(null);
  const [analysisError, setAnalysisError] = useState('');
  const [currentTime, setCurrentTime] = useState(0);
  const [search, setSearch] = useState('');
  const [question, setQuestion] = useState('');
  const [asking, setAsking] = useState(false);
  const [pending, setPending] = useState({ question: '', note: '' });
  const [askError, setAskError] = useState('');
  const [saving, setSaving] = useState(false);
  // The person's role in the lesson's team decides what they can do (same rules as the database).
  const [role, setRole] = useState(null);
  const canEdit = ['owner', 'admin', 'editor'].includes(role);
  const canAsk = canEdit || role === 'commenter';
  const playerRef = useRef(null);
  const lessonRef = useRef(null);
  const canEditRef = useRef(false);
  useEffect(() => { lessonRef.current = lesson; canEditRef.current = canEdit; });
  const abortRef = useRef(null);
  const askEnd = useRef(null);

  useEffect(() => {
    let active = true;
    async function load() {
      const [lessonResult, questionsResult] = await Promise.all([getLesson(lessonId), getLessonQuestions(lessonId)]);
      if (!active) return;
      setLoading(false);
      if (lessonResult.error) {
        setLoadError(isMissingLessonsTable(lessonResult.error) ? LESSON_SETUP_MESSAGE : `Could not load the lesson: ${lessonResult.error.message}`);
        return;
      }
      if (!lessonResult.data) { setLoadError('not-found'); return; }
      setLesson(lessonResult.data);
      setQuestions(questionsResult.data || []);
      const [{ data: page }, { data: teamRole }] = await Promise.all([
        supabase.from('pages').select('id, title').eq('id', lessonResult.data.project_id).maybeSingle(),
        supabase.rpc('workspace_role_of', { target_workspace: lessonResult.data.workspace_id })
      ]);
      if (!active) return;
      setProject(page || null);
      setRole(typeof teamRole === 'string' ? teamRole : null);
    }
    void load();
    return () => { active = false; abortRef.current?.abort(); };
  }, [lessonId]);

  useEffect(() => { setBreadcrumb(lesson?.title || 'Lesson'); }, [lesson?.title]);
  useEffect(() => {
    const timer = window.setInterval(() => {
      const time = playerRef.current?.getCurrentTime?.();
      if (Number.isFinite(time)) setCurrentTime(Math.floor(time));
    }, 1000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => { if (tab === 'ask') askEnd.current?.scrollIntoView({ block: 'nearest' }); }, [tab, questions.length, asking]);

  // The player reports the real length and title; editors fill them in on the lesson once.
  const handleReady = useCallback(({ duration, title }) => {
    setPlayerState({ ready: true, duration, error: '' });
    const current = lessonRef.current;
    if (!current) return;
    const updates = {};
    if (duration && !current.duration_seconds) updates.duration_seconds = Math.min(duration, LESSON_LIMITS.maxDuration);
    if (title && current.title === 'YouTube lesson') updates.title = title.slice(0, 200);
    if (!Object.keys(updates).length) return;
    setLesson((latest) => (latest ? { ...latest, ...updates } : latest));
    if (canEditRef.current) void updateLesson(current.id, updates);
  }, []);
  const handleError = useCallback((code) => {
    setPlayerState((current) => ({ ...current, error: code === 'blocked'
      ? 'The YouTube player could not load here. You can still analyse the lesson; times will open on YouTube.'
      : 'This video cannot be played inside other sites. You can still analyse it; times will open on YouTube.' }));
  }, []);

  const seek = useCallback((seconds) => {
    const player = playerRef.current;
    if (player?.seekTo) {
      player.seekTo(seconds, true);
      player.playVideo?.();
      setCurrentTime(seconds);
      document.querySelector('.lesson-player')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    } else if (lesson) {
      window.open(lessonLink(lesson.video_id, seconds), '_blank', 'noopener');
    }
  }, [lesson]);

  const duration = lesson?.duration_seconds || playerState.duration || Math.round(Number(manualMinutes) * 60) || 0;
  const rawSegments = lesson?.segments;
  const rawChapters = lesson?.chapters;
  const segments = useMemo(() => (Array.isArray(rawSegments) ? rawSegments : []), [rawSegments]);
  const chapters = useMemo(() => (Array.isArray(rawChapters) ? rawChapters : []), [rawChapters]);
  const keyPoints = Array.isArray(lesson?.key_points) ? lesson.key_points : [];
  const visibleSegments = useMemo(() => searchSegments(segments, search), [segments, search]);
  const activeStart = (list) => {
    let active = null;
    for (const item of list) { if (item.start <= currentTime) active = item.start; else break; }
    return active;
  };
  const activeChapter = activeStart(chapters);
  const activeSegment = activeStart(segments);
  const isReady = lesson?.status === 'ready';
  const tooLong = duration > LESSON_LIMITS.maxDuration;

  async function analyze() {
    if (!lesson || progress || !duration || !canEdit) return;
    const controller = new AbortController();
    abortRef.current = controller;
    setAnalysisError('');
    setProgress({ step: 0, steps: 1, label: 'Starting' });
    try {
      const done = await analyzeLesson(lesson, {
        duration: Math.min(duration, LESSON_LIMITS.maxDuration),
        signal: controller.signal,
        onProgress: (next) => { setProgress(next); if (next.lesson) setLesson(next.lesson); }
      });
      setLesson(done);
      showToast('Lesson analysed', 'success');
    } catch (error) {
      if (error?.name !== 'AbortError') setAnalysisError(error?.message || 'The analysis failed.');
      const { data } = await getLesson(lesson.id);
      if (data) setLesson(data);
    } finally {
      abortRef.current = null;
      setProgress(null);
    }
  }

  async function ask(event) {
    event.preventDefault();
    const text = question.trim();
    if (!text || asking || !lesson || !segments.length || !canAsk) return;
    setAsking(true);
    setAskError('');
    setPending({ question: text, note: '' });
    try {
      const history = questions.slice(-3).flatMap((item) => [
        { role: 'user', content: item.question.slice(0, LESSON_LIMITS.historyText) },
        { role: 'assistant', content: item.answer.slice(0, LESSON_LIMITS.historyText) }
      ]);
      const answer = await askLesson({ ...lesson, duration_seconds: duration }, text, history, undefined,
        (pause) => setPending({ question: text, note: `The free AI allowance is busy. Retrying in ${pause} seconds…` }));
      setQuestion('');
      const { data, error } = await saveLessonQuestion({ lessonId: lesson.id, userId: user.id, question: text, answer });
      setQuestions((current) => [...current, data || { id: `local-${current.length}`, user_id: user.id, question: text, answer, created_at: new Date().toISOString() }]);
      if (error) setAskError(`The answer could not be saved for your team: ${error.message}`);
    } catch (error) {
      setAskError(error?.message || 'The question could not be answered.');
    } finally {
      setAsking(false);
    }
  }

  async function saveAsPage() {
    if (!lesson || saving || !canEdit) return;
    setSaving(true);
    const link = (seconds) => `<a href="${escapeHtml(lessonLink(lesson.video_id, seconds))}">${formatTime(seconds)}</a>`;
    const html = [
      `<p><a href="${escapeHtml(lessonLink(lesson.video_id))}">Watch on YouTube</a></p>`,
      '<h2>Summary</h2>',
      ...String(lesson.summary || 'No summary.').split(/\n{2,}/).map((paragraph) => `<p>${escapeHtml(paragraph.trim())}</p>`),
      keyPoints.length ? `<h2>Key points</h2><ul>${keyPoints.map((point) => `<li>${escapeHtml(point)}</li>`).join('')}</ul>` : '',
      chapters.length ? `<h2>Chapters</h2><ul>${chapters.map((chapter) => `<li>${link(chapter.start)} — ${escapeHtml(chapter.title)}</li>`).join('')}</ul>` : '',
      `<h2>Notes</h2><ul>${segments.map((segment) => `<li>${link(segment.start)} — ${escapeHtml(segment.text)}</li>`).join('')}</ul>`
    ].join('');
    const { data, error } = await createPage(lesson.workspace_id, `Lesson notes: ${lesson.title}`.slice(0, 200), 'note', { html }, lesson.project_id);
    setSaving(false);
    if (error || !data) return showToast(`Could not create the page: ${error?.message || 'unknown error'}`, 'error');
    window.dispatchEvent(new CustomEvent('motion:pages-changed', { detail: data.id }));
    showToast('Lesson notes saved as a page', 'success');
    window.location.hash = `editor/${data.id}`;
  }

  async function remove() {
    if (!lesson || !await requestConfirmation(`Delete the lesson “${lesson.title}” and its notes and questions for everyone?`)) return;
    const { error } = await deleteLesson(lesson.id);
    if (error) return showToast(`Could not delete the lesson: ${error.message}`, 'error');
    showToast('Lesson deleted', 'success');
    window.location.hash = `project/${lesson.project_id}/lessons`;
  }

  function onPanelClick(event) {
    const button = event.target.closest('[data-seek]');
    if (button) seek(Number(button.dataset.seek));
  }

  if (loading) return <div className="lesson-view"><p className="meeting-muted" role="status">Loading lesson…</p></div>;
  if (loadError === 'not-found' || (!lesson && !loadError)) {
    return <div className="project-empty-state"><span className="material-symbols-outlined">videocam_off</span><h2>Lesson not found</h2><p>It may have been deleted, or it belongs to another team.</p><a href="#dashboard">Go home</a></div>;
  }
  if (!lesson) return <div className="lesson-view"><div className="team-chat-error" role="alert">{loadError}</div></div>;

  const percent = progress ? Math.round(((progress.step - 0.5) / progress.steps) * 100) : 0;
  const resumable = lesson.status === 'analyzing' && !progress;

  return (
    <section className="lesson-view" aria-label="Lesson">
      <header className="meeting-header">
        <a className="meeting-back" href={`#project/${lesson.project_id}/lessons`}>
          <span className="material-symbols-outlined" aria-hidden="true">arrow_back</span>
          {project?.title || 'Project'} · YouTube lessons
        </a>
        <div className="meeting-title-row">
          <h1>{lesson.title}</h1>
          <span className={`meeting-status ${isReady ? 'is-ended' : ''}`}>{isReady ? 'Analysed' : lesson.status === 'analyzing' ? 'Partly analysed' : 'Not analysed'}</span>
        </div>
        <p className="meeting-muted">
          {duration ? `${formatTime(duration)} long` : 'Length unknown'}{segments.length ? ` · ${segments.length} notes` : ''}{questions.length ? ` · ${questions.length} question${questions.length === 1 ? '' : 's'}` : ''}
        </p>
      </header>

      <div className="lesson-layout">
        <div className="lesson-video">
          <Player videoId={lesson.video_id} playerRef={playerRef} onReady={handleReady} onError={handleError} />
          {playerState.error && <p className="meeting-notice" role="status"><span className="material-symbols-outlined" aria-hidden="true">info</span>{playerState.error}</p>}
          <div className="lesson-video-actions">
            <a className="project-btn" href={lessonLink(lesson.video_id)} target="_blank" rel="noreferrer"><span className="material-symbols-outlined" aria-hidden="true">open_in_new</span>YouTube</a>
            {isReady && canEdit && <button type="button" className="project-btn" disabled={saving} onClick={saveAsPage}><span className="material-symbols-outlined" aria-hidden="true">note_add</span>{saving ? 'Saving…' : 'Save as page'}</button>}
            {isReady && canEdit && <button type="button" className="project-btn" disabled={Boolean(progress)} onClick={async () => {
              if (!await requestConfirmation('Analyse this lesson again? The current notes, summary and chapters will be replaced.')) return;
              const { data, error } = await updateLesson(lesson.id, { status: 'new', analyzed_seconds: 0 });
              if (error || !data) return showToast(`Could not start again: ${error?.message || 'you may not have permission'}`, 'error');
              setLesson(data);
            }}><span className="material-symbols-outlined" aria-hidden="true">refresh</span>Re-analyse</button>}
            {(lesson.created_by === user?.id || ['owner', 'admin'].includes(role)) && <button type="button" className="project-btn lesson-danger" onClick={remove}><span className="material-symbols-outlined" aria-hidden="true">delete</span>Delete</button>}
          </div>
        </div>

        <div className="lesson-panel project-section" onClick={onPanelClick}>
          {!isReady && !canEdit && !progress && (
            <div className="lesson-analyze">
              <h2>{segments.length ? 'Analysis not finished yet' : 'Not analysed yet'}</h2>
              <p className="meeting-muted">{role
                ? 'A team owner, admin or editor can analyse this lesson. Once they do, the notes, summary and chapters appear here for everyone.'
                : 'Loading your permissions…'}</p>
            </div>
          )}
          {!isReady && canEdit && (
            <div className="lesson-analyze" aria-busy={Boolean(progress)}>
              {progress ? (
                <>
                  <p role="status"><span className="material-symbols-outlined meeting-spin" aria-hidden="true">progress_activity</span> {progress.label}… <small>(step {Math.max(progress.step, 1)} of {progress.steps})</small></p>
                  <div className="meeting-timer-track" aria-hidden="true"><span style={{ width: `${Math.max(percent, 4)}%` }} /></div>
                  <div className="lesson-analyze-actions">
                    <small className="meeting-muted">You can keep this tab open and watch the video meanwhile. Progress is saved after every step.</small>
                    <button type="button" className="project-btn" onClick={() => abortRef.current?.abort()}>Stop</button>
                  </div>
                </>
              ) : (
                <>
                  <h2>{resumable ? 'Analysis was interrupted' : 'Analyse this lesson'}</h2>
                  <p className="meeting-muted">
                    {resumable
                      ? `Notes are saved up to ${formatTime(lesson.analyzed_seconds)}. Continue to finish the rest.`
                      : 'The AI watches the video once and writes timestamped notes, a summary and chapters. After that, questions are answered instantly from the notes, for your whole team.'}
                  </p>
                  {!duration && (
                    <label className="lesson-minutes">
                      <span>{playerState.ready || playerState.error ? 'Video length in minutes' : 'Waiting for the player… or enter the video length in minutes'}</span>
                      <input type="number" className="modal-input" min="1" max={LESSON_LIMITS.maxDuration / 60} value={manualMinutes} onChange={(event) => setManualMinutes(event.target.value)} />
                    </label>
                  )}
                  {tooLong && <p className="meeting-notice"><span className="material-symbols-outlined" aria-hidden="true">info</span>Only the first {LESSON_LIMITS.maxDuration / 3600} hours will be analysed.</p>}
                  {analysisError && <div className="team-chat-error" role="alert">{analysisError}</div>}
                  <button type="button" className="project-btn primary" disabled={!duration} onClick={analyze}>
                    <span className="material-symbols-outlined" aria-hidden="true">auto_awesome</span>
                    {resumable ? 'Continue analysis' : `Analyse lesson${duration ? ` (about ${Math.max(1, Math.round(Math.min(duration, LESSON_LIMITS.maxDuration) / 600 * 0.4))} min)` : ''}`}
                  </button>
                </>
              )}
            </div>
          )}

          {(isReady || segments.length > 0) && (
            <>
              <div className="lesson-tabs" role="tablist" aria-label="Lesson sections">
                {[['overview', 'Overview'], ['notes', `Notes (${segments.length})`], ['ask', 'Ask AI']].map(([id, label]) => (
                  <button key={id} type="button" role="tab" aria-selected={tab === id} className={tab === id ? 'is-active' : ''} onClick={() => setTab(id)}>{label}</button>
                ))}
              </div>

              {tab === 'overview' && (
                <div className="lesson-tab" role="tabpanel">
                  {lesson.summary ? <p className="meeting-summary" dir="auto">{lesson.summary}</p> : <p className="meeting-muted">The summary appears when the analysis finishes.</p>}
                  {keyPoints.length > 0 && (<><h3>Key points</h3><ul className="meeting-decisions">{keyPoints.map((point, index) => <li key={index}>{point}</li>)}</ul></>)}
                  {chapters.length > 0 && (
                    <>
                      <h3>Chapters</h3>
                      <ol className="lesson-chapters">
                        {chapters.map((chapter) => (
                          <li key={chapter.start} className={chapter.start === activeChapter ? 'is-current' : ''}>
                            <button type="button" data-seek={chapter.start}><span className="lesson-time-chip">{formatTime(chapter.start)}</span><span>{chapter.title}</span></button>
                          </li>
                        ))}
                      </ol>
                    </>
                  )}
                </div>
              )}

              {tab === 'notes' && (
                <div className="lesson-tab" role="tabpanel">
                  <label className="lesson-search">
                    <span className="material-symbols-outlined" aria-hidden="true">search</span>
                    <input type="search" value={search} placeholder="Search the notes…" aria-label="Search the notes" onChange={(event) => setSearch(event.target.value)} />
                  </label>
                  {visibleSegments.length ? (
                    <ol className="lesson-notes">
                      {visibleSegments.map((segment) => (
                        <li key={segment.start} className={segment.start === activeSegment ? 'is-current' : ''}>
                          <button type="button" className="lesson-time-chip" data-seek={segment.start} aria-label={`Play from ${formatTime(segment.start)}`}>{formatTime(segment.start)}</button>
                          <p dir="auto">{segment.text}</p>
                        </li>
                      ))}
                    </ol>
                  ) : <p className="meeting-muted">No notes match “{search}”. Try the Ask AI tab for a question in your own words.</p>}
                </div>
              )}

              {tab === 'ask' && (
                <div className="lesson-tab lesson-ask" role="tabpanel">
                  <div className="lesson-thread" role="log" aria-live="polite">
                    {!questions.length && !asking && !canAsk && <p className="meeting-muted">No questions have been asked about this lesson yet.</p>}
                    {!questions.length && !asking && canAsk && (
                      <div className="lesson-ask-empty">
                        <p className="meeting-muted">Ask anything about this lesson. Answers include times you can click to jump there.</p>
                        <div className="lesson-suggestions">
                          {['What is this lesson about?', 'Which parts are most important for an exam?', 'Give me 5 practice questions with the time where each answer is explained.'].map((sample) => (
                            <button key={sample} type="button" onClick={() => setQuestion(sample)}>{sample}</button>
                          ))}
                        </div>
                      </div>
                    )}
                    {questions.map((item) => (
                      <article key={item.id} className="lesson-qa">
                        <p className="lesson-question" dir="auto"><strong>{item.user_id === user?.id ? 'You' : item.asker?.name || 'Teammate'}</strong>{item.question}</p>
                        <div className="lesson-answer" dir="auto" dangerouslySetInnerHTML={{ __html: answerHtml(item.answer, duration) }} />
                      </article>
                    ))}
                    {asking && (
                      <article className="lesson-qa">
                        <p className="lesson-question" dir="auto"><strong>You</strong>{pending.question}</p>
                        <p className="meeting-muted" role="status"><span className="material-symbols-outlined meeting-spin" aria-hidden="true">progress_activity</span> {pending.note || 'Thinking…'}</p>
                      </article>
                    )}
                    <div ref={askEnd} />
                  </div>
                  {askError && <div className="team-chat-error" role="alert">{askError}</div>}
                  {!canAsk ? (
                    <p className="meeting-notice" role="note"><span className="material-symbols-outlined" aria-hidden="true">visibility</span>You can read the team’s questions and answers. To ask the AI yourself, a team owner or admin can make you a commenter or editor.</p>
                  ) : (
                  <form className="meeting-composer" onSubmit={ask}>
                    <label htmlFor="lesson-question" className="sr-only">Ask about this lesson</label>
                    <input id="lesson-question" type="text" dir="auto" value={question} maxLength={LESSON_LIMITS.question} autoComplete="off" disabled={asking} placeholder="e.g. At what minute is recursion explained?" onChange={(event) => setQuestion(event.target.value)} />
                    <button type="submit" className="project-btn primary" disabled={asking || !question.trim()} aria-label="Ask"><span className="material-symbols-outlined" aria-hidden="true">send</span></button>
                  </form>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </section>
  );
}

export default function LessonView({ lessonId, user }) {
  if (!lessonId) return <div className="project-empty-state"><span className="material-symbols-outlined">videocam_off</span><h2>Lesson not found</h2><a href="#dashboard">Go home</a></div>;
  return <LessonRoom key={lessonId} lessonId={lessonId} user={user || AppState.user} />;
}
