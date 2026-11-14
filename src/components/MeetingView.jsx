import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../lib/supabase.js';
import { AppState, setBreadcrumb, showToast } from '../legacy/app.js';
import { requestConfirmation } from '../lib/dialogs.js';
import { createPage, createTask, getWorkspaceMembers } from '../lib/queries.js';
import { invokeAI } from '../lib/cloudflareAI.js';
import {
  MEETING_SETUP_MESSAGE, isMissingMeetingsTable, getMeeting, getMeetingNotes, updateMeeting, addMeetingNote
} from '../lib/meetings.js';
import {
  NOTE_KINDS, buildMeetingRequest, parseMeetingResponse, fallbackProposal, buildMinutesHtml, groupNotesByItem
} from '../lib/meetingAI.js';

const POLL_MS = 15000;
const KIND_META = {
  note: { label: 'Note', icon: 'notes' },
  decision: { label: 'Decision', icon: 'gavel' },
  action: { label: 'Action', icon: 'task_alt' }
};

function reviewKey(meetingId) {
  return `groupify:meeting-review:${meetingId}`;
}
function loadReview(meetingId) {
  try { return JSON.parse(sessionStorage.getItem(reviewKey(meetingId)) || 'null'); } catch { return null; }
}
function saveReview(meetingId, review) {
  try {
    if (review) sessionStorage.setItem(reviewKey(meetingId), JSON.stringify(review));
    else sessionStorage.removeItem(reviewKey(meetingId));
  } catch { /* Storage unavailable: the review just won't survive a reload. */ }
}

function formatClock(totalSeconds) {
  const seconds = Math.abs(Math.round(totalSeconds));
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, '0')}`;
}

function localToday() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function formatDate(value) {
  return value ? new Date(value).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : '';
}

function Countdown({ item, startedAt, offset }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  if (!item || !startedAt) return null;
  const total = item.minutes * 60;
  const elapsed = Math.max(0, (now + offset - Date.parse(startedAt)) / 1000);
  const remaining = total - elapsed;
  const over = remaining < 0;
  const percent = Math.min(100, (elapsed / total) * 100);
  return (
    <div className={`meeting-timer ${over ? 'is-over' : remaining <= 60 ? 'is-warning' : ''}`} role="timer" aria-live="off">
      <span className="meeting-timer-value">{over ? `+${formatClock(-remaining)}` : formatClock(remaining)}</span>
      <span className="meeting-timer-label">{over ? 'Over time' : `of ${item.minutes} min`}</span>
      <div className="meeting-timer-track" aria-hidden="true"><span style={{ width: `${percent}%` }} /></div>
    </div>
  );
}

function MeetingRoom({ meetingId, user }) {
  const [meeting, setMeeting] = useState(null);
  const [notes, setNotes] = useState([]);
  const [members, setMembers] = useState([]);
  const [project, setProject] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [offset, setOffset] = useState(0);
  const [busy, setBusy] = useState('');
  const [draft, setDraft] = useState('');
  const [kind, setKind] = useState('note');
  const [noteError, setNoteError] = useState('');
  const [review, setReview] = useState(() => loadReview(meetingId));
  const [preparing, setPreparing] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const notesEnd = useRef(null);
  const sendLock = useRef(false);
  const aiLock = useRef(false);

  const updateReview = useCallback((next) => {
    setReview((current) => {
      const value = typeof next === 'function' ? next(current) : next;
      saveReview(meetingId, value);
      return value;
    });
  }, [meetingId]);

  // Server timestamps drive the countdown; estimate this device's clock skew from rows we just wrote.
  const acceptRow = useCallback((row) => {
    if (!row) return;
    setMeeting(row);
    const skew = Date.parse(row.updated_at) - Date.now();
    if (Number.isFinite(skew) && Math.abs(skew) > 2000) setOffset(skew);
  }, []);

  useEffect(() => {
    let active = true;
    let pending = false;
    async function load() {
      if (pending) return;
      pending = true;
      const [meetingResult, notesResult] = await Promise.all([getMeeting(meetingId), getMeetingNotes(meetingId)]);
      pending = false;
      if (!active) return;
      setLoading(false);
      const error = meetingResult.error || notesResult.error;
      if (error) {
        setLoadError(isMissingMeetingsTable(error) ? MEETING_SETUP_MESSAGE : `Could not load the meeting: ${error.message}`);
        return;
      }
      if (!meetingResult.data) { setLoadError('not-found'); return; }
      setLoadError('');
      setMeeting(meetingResult.data);
      setNotes(notesResult.data);
    }
    void load();
    const timer = window.setInterval(() => { if (!document.hidden) void load(); }, POLL_MS);
    const channel = supabase.channel(`meeting-${meetingId}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'meetings', filter: `id=eq.${meetingId}` },
        (payload) => { if (payload.new?.id) setMeeting((current) => ({ ...current, ...payload.new })); })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'meeting_notes', filter: `meeting_id=eq.${meetingId}` },
        (payload) => {
          const note = payload.new;
          if (note?.id) setNotes((current) => (current.some((item) => item.id === note.id) ? current : [...current, note]));
        })
      .subscribe();
    return () => { active = false; window.clearInterval(timer); supabase.removeChannel(channel); };
  }, [meetingId, refresh]);

  const workspaceId = meeting?.workspace_id;
  const projectId = meeting?.project_id;
  useEffect(() => {
    if (!workspaceId || !projectId) return undefined;
    let active = true;
    async function loadContext() {
      const [membersResult, projectResult] = await Promise.all([
        getWorkspaceMembers(workspaceId),
        supabase.from('pages').select('id, title, icon').eq('id', projectId).maybeSingle()
      ]);
      if (!active) return;
      setMembers((membersResult.data || []).map((row) => ({ id: row.user_id, name: row.user?.name || row.user?.email || 'Member' })));
      setProject(projectResult.data || null);
    }
    void loadContext();
    return () => { active = false; };
  }, [workspaceId, projectId]);

  useEffect(() => { setBreadcrumb(meeting?.title || 'Meeting'); }, [meeting?.title]);
  const isLive = meeting?.status === 'live';
  useEffect(() => { if (isLive) notesEnd.current?.scrollIntoView({ block: 'nearest' }); }, [notes.length, isLive]);

  const people = useMemo(() => {
    const list = [...members];
    if (user?.id && !list.some((member) => member.id === user.id)) {
      list.push({ id: user.id, name: AppState.profile?.name || user.user_metadata?.name || user.email || 'You' });
    }
    return list;
  }, [members, user]);
  const authorName = useCallback((id) => people.find((member) => member.id === id)?.name || 'Teammate', [people]);

  const rawAgenda = meeting?.agenda;
  const agenda = useMemo(() => (Array.isArray(rawAgenda) ? rawAgenda : []), [rawAgenda]);
  const status = meeting?.status;
  const currentIndex = Math.min(meeting?.current_item ?? 0, Math.max(agenda.length - 1, 0));
  const currentItem = agenda[currentIndex];
  const isLast = currentIndex >= agenda.length - 1;
  const groups = useMemo(() => groupNotesByItem(agenda, notes), [agenda, notes]);

  async function start() {
    setBusy('start');
    const { data, error } = await updateMeeting(meetingId, { status: 'live' }, { status: 'planned' });
    setBusy('');
    if (error) return showToast(`Could not start the meeting: ${error.message}`, 'error');
    if (data) acceptRow(data); else setRefresh((value) => value + 1);
  }

  async function next() {
    setBusy('next');
    const { data, error } = await updateMeeting(meetingId, { current_item: currentIndex + 1 }, { status: 'live', current_item: currentIndex });
    setBusy('');
    if (error) return showToast(`Could not move to the next item: ${error.message}`, 'error');
    if (data) acceptRow(data); else setRefresh((value) => value + 1);
  }

  async function prepareMinutes(forMeeting, forNotes) {
    if (aiLock.current) return;
    aiLock.current = true;
    setPreparing(true);
    let proposal = null;
    let notice = '';
    let source = 'ai';
    try {
      const body = buildMeetingRequest({ meeting: forMeeting, notes: forNotes, members: people, today: localToday(), authorName });
      const result = await invokeAI('text-ai', body);
      proposal = parseMeetingResponse(result?.text, people);
      if (!proposal) notice = 'The AI reply could not be read, so this list was built from notes tagged as decisions and actions.';
    } catch (error) {
      notice = `AI was unavailable (${error?.message || 'unknown error'}), so this list was built from notes tagged as decisions and actions.`;
    }
    if (!proposal) {
      source = 'local';
      proposal = fallbackProposal({ agenda: forMeeting.agenda || [], notes: forNotes, members: people });
    }
    updateReview({
      source,
      notice,
      summary: proposal.summary,
      decisions: proposal.decisions.map((text) => ({ text, checked: true })),
      tasks: proposal.tasks.map((task, index) => ({ ...task, key: `t${index}`, checked: true })),
      created: []
    });
    setPreparing(false);
    aiLock.current = false;
  }

  async function end() {
    if (!await requestConfirmation('End this meeting for everyone? Notes will close and the minutes will be prepared.')) return;
    setBusy('end');
    const { data, error } = await updateMeeting(meetingId, { status: 'ended' }, { status: 'live' });
    setBusy('');
    if (error) return showToast(`Could not end the meeting: ${error.message}`, 'error');
    if (!data) { setRefresh((value) => value + 1); return; }
    acceptRow(data);
    const { data: latestNotes } = await getMeetingNotes(meetingId);
    const finalNotes = latestNotes?.length ? latestNotes : notes;
    setNotes(finalNotes);
    await prepareMinutes(data, finalNotes);
  }

  async function sendNote(event) {
    event.preventDefault();
    const body = draft.trim();
    if (sendLock.current || !body || status !== 'live' || !currentItem || !user?.id) return;
    sendLock.current = true;
    setNoteError('');
    const { data, error } = await addMeetingNote({ meetingId, itemId: currentItem.id, authorId: user.id, kind, body: body.slice(0, 1000) });
    sendLock.current = false;
    if (error) { setNoteError(`Could not add the note: ${error.message}`); return; }
    setDraft('');
    setKind('note');
    setNotes((current) => (current.some((item) => item.id === data.id) ? current : [...current, data]));
  }

  async function apply() {
    if (!review || !meeting) return;
    setBusy('apply');
    const decisions = review.decisions.filter((item) => item.checked).map((item) => item.text.trim()).filter(Boolean);
    const summary = review.summary.trim() || 'No summary.';
    // Claim the minutes first so two teammates cannot apply the same meeting twice.
    const claim = await updateMeeting(meetingId, { summary, decisions }, { minutes_page_id: null, summary: null });
    if (claim.error || !claim.data) {
      setBusy('');
      if (claim.error) return showToast(`Could not save the minutes: ${claim.error.message}`, 'error');
      showToast('A teammate already saved minutes for this meeting.', 'error');
      updateReview(null);
      setRefresh((value) => value + 1);
      return;
    }
    const created = [...(review.created || [])];
    const failedTasks = [];
    for (const task of review.tasks.filter((item) => item.checked && item.title.trim())) {
      const { data, error } = await createTask(task.title.trim(), {
        workspaceId: meeting.workspace_id, pageId: meeting.project_id, assigneeId: task.assigneeId || null, dueDate: task.due || null, sortOrder: Date.now()
      });
      if (error) failedTasks.push(task);
      else created.push({ id: data?.id, title: task.title.trim(), owner: task.assigneeId ? authorName(task.assigneeId) : '', due: task.due || null });
    }
    const html = buildMinutesHtml({ meeting: claim.data, notes, authorName, summary, decisions, createdTasks: created });
    const day = (meeting.started_at || meeting.ended_at || meeting.created_at || '').slice(0, 10);
    const { data: page, error: pageError } = await createPage(meeting.workspace_id, `Meeting minutes: ${meeting.title}${day ? ` (${day})` : ''}`.slice(0, 200), 'note', { html }, meeting.project_id);
    if (pageError || !page) {
      // Release the claim so the minutes can be retried; tasks already created are not created again.
      await updateMeeting(meetingId, { summary: null, decisions: [] });
      updateReview((current) => current && ({ ...current, created, tasks: current.tasks.filter((task) => !task.checked || failedTasks.includes(task)) }));
      setBusy('');
      return showToast(`Could not create the minutes page: ${pageError?.message || 'unknown error'}`, 'error');
    }
    const { data: saved } = await updateMeeting(meetingId, { minutes_page_id: page.id });
    if (saved) acceptRow(saved);
    updateReview(null);
    setBusy('');
    window.dispatchEvent(new CustomEvent('motion:page-changed', { detail: page.id }));
    showToast(failedTasks.length
      ? `Minutes saved. ${failedTasks.length} task${failedTasks.length === 1 ? '' : 's'} could not be created.`
      : `Minutes saved${created.length ? ` and ${created.length} task${created.length === 1 ? '' : 's'} created` : ''}.`, failedTasks.length ? 'error' : 'success');
  }

  if (loading) return <div className="meeting-view"><p className="meeting-muted" role="status">Loading meeting…</p></div>;
  if (loadError === 'not-found' || (!meeting && !loadError)) {
    return <div className="project-empty-state"><span className="material-symbols-outlined">event_busy</span><h2>Meeting not found</h2><p>It may have been deleted, or it belongs to another team.</p><a href="#dashboard">Go home</a></div>;
  }
  if (!meeting) {
    return <div className="meeting-view"><div className="team-chat-error" role="alert">{loadError} <button type="button" onClick={() => { setLoading(true); setRefresh((value) => value + 1); }}>Retry</button></div></div>;
  }

  const canPrepare = status === 'ended' && !meeting.minutes_page_id && !meeting.summary && !review && !preparing;
  const statusLabel = status === 'live' ? 'Live' : status === 'ended' ? 'Ended' : 'Planned';

  return (
    <section className="meeting-view" aria-label="Meeting">
      <header className="meeting-header">
        <a className="meeting-back" href={`#project/${meeting.project_id}/meetings`}>
          <span className="material-symbols-outlined" aria-hidden="true">arrow_back</span>
          {project?.title || 'Project'} · Meetings
        </a>
        <div className="meeting-title-row">
          <h1>{meeting.title}</h1>
          <span className={`meeting-status is-${status}`}>{status === 'live' && <span className="meeting-live-dot" aria-hidden="true" />}{statusLabel}</span>
        </div>
        <p className="meeting-muted">
          {status === 'ended' ? `Ended ${formatDate(meeting.ended_at)}` : status === 'live' ? `Started ${formatDate(meeting.started_at)}` : `Created ${formatDate(meeting.created_at)}`}
          {' · '}{agenda.length} agenda item{agenda.length === 1 ? '' : 's'} · {agenda.reduce((sum, item) => sum + (item.minutes || 0), 0)} min planned
        </p>
        {loadError && <div className="team-chat-error" role="alert">{loadError}</div>}
      </header>

      <div className="meeting-layout">
        <aside className="meeting-agenda project-section" aria-label="Agenda">
          <div className="project-section-head"><h2>Agenda</h2></div>
          <ol>
            {agenda.map((item, index) => {
              const state = status === 'live' ? (index < currentIndex ? 'is-done' : index === currentIndex ? 'is-current' : '') : status === 'ended' ? 'is-done' : '';
              return (
                <li key={item.id} className={state} aria-current={state === 'is-current' ? 'step' : undefined}>
                  <span className="meeting-agenda-index">{state === 'is-done' ? <span className="material-symbols-outlined" aria-hidden="true">check</span> : index + 1}</span>
                  <span className="meeting-agenda-title">{item.title}</span>
                  <small>{item.minutes} min</small>
                </li>
              );
            })}
          </ol>
          {status === 'planned' && (
            <button type="button" className="project-btn primary meeting-wide-btn" disabled={Boolean(busy) || !agenda.length} onClick={start}>
              <span className="material-symbols-outlined" aria-hidden="true">play_arrow</span>{busy === 'start' ? 'Starting…' : 'Start meeting'}
            </button>
          )}
        </aside>

        <div className="meeting-main">
          {status === 'live' && currentItem && (
            <section className="meeting-current project-section" aria-label="Current agenda item">
              <div className="meeting-current-head">
                <div>
                  <small>ITEM {currentIndex + 1} OF {agenda.length}</small>
                  <h2>{currentItem.title}</h2>
                </div>
                <Countdown item={currentItem} startedAt={meeting.item_started_at} offset={offset} />
              </div>
              <div className="meeting-controls">
                {!isLast && (
                  <button type="button" className="project-btn" disabled={Boolean(busy)} onClick={next}>
                    <span className="material-symbols-outlined" aria-hidden="true">skip_next</span>{busy === 'next' ? 'Moving…' : 'Next item'}
                  </button>
                )}
                <button type="button" className={`project-btn ${isLast ? 'primary' : ''}`} disabled={Boolean(busy)} onClick={end}>
                  <span className="material-symbols-outlined" aria-hidden="true">stop_circle</span>{busy === 'end' ? 'Ending…' : 'End meeting'}
                </button>
              </div>
              <form className="meeting-composer" onSubmit={sendNote}>
                <label htmlFor="meeting-note-kind" className="sr-only">Note type</label>
                <select id="meeting-note-kind" value={kind} onChange={(event) => setKind(event.target.value)} aria-label="Note type">
                  {NOTE_KINDS.map((value) => <option key={value} value={value}>{KIND_META[value].label}</option>)}
                </select>
                <label htmlFor="meeting-note" className="sr-only">Add a note to “{currentItem.title}”</label>
                <input
                  id="meeting-note"
                  type="text"
                  value={draft}
                  maxLength={1000}
                  autoComplete="off"
                  placeholder={kind === 'action' ? 'Action item… (start with @Name to suggest an owner)' : kind === 'decision' ? 'What did the team decide?' : 'Add a note… (Enter to send)'}
                  onChange={(event) => setDraft(event.target.value)}
                />
                <button type="submit" className="project-btn primary" disabled={!draft.trim()} aria-label="Add note">
                  <span className="material-symbols-outlined" aria-hidden="true">send</span>
                </button>
              </form>
              {noteError && <div className="team-chat-error" role="alert">{noteError}</div>}
            </section>
          )}

          {status === 'planned' && (
            <div className="project-hint">
              <span className="material-symbols-outlined">groups</span>
              <div><strong>Ready when you are</strong><p>Anyone on the team can start the meeting. Everyone sees the same agenda item and timer, and can add notes as you go.</p></div>
            </div>
          )}

          {status === 'ended' && (preparing || (review && !meeting.minutes_page_id) || canPrepare) && (
            <section className="meeting-review" aria-label="Review meeting minutes" aria-busy={preparing}>
              {preparing ? (
                <p className="meeting-muted project-section" role="status"><span className="material-symbols-outlined meeting-spin" aria-hidden="true">progress_activity</span> Preparing the summary and proposed tasks…</p>
              ) : review ? (
                <ReviewPanel review={review} people={people} busy={busy === 'apply'} onChange={updateReview} onApply={apply} onCancel={() => updateReview(null)} />
              ) : (
                <div className="meeting-review-empty project-section">
                  <p>Minutes have not been saved for this meeting yet. The teammate who ended it may still be reviewing them, or you can prepare them now.</p>
                  <button type="button" className="project-btn primary" onClick={() => prepareMinutes(meeting, notes)}>
                    <span className="material-symbols-outlined" aria-hidden="true">auto_awesome</span>Prepare minutes
                  </button>
                </div>
              )}
            </section>
          )}

          {status === 'ended' && (meeting.summary || meeting.minutes_page_id) && (
            <section className="meeting-minutes project-section" aria-label="Meeting minutes">
              <div className="project-section-head">
                <h2>Minutes</h2>
                {meeting.minutes_page_id && <a className="project-link" href={`#editor/${meeting.minutes_page_id}`}>Open minutes page →</a>}
              </div>
              {meeting.summary && <p className="meeting-summary">{meeting.summary}</p>}
              {Array.isArray(meeting.decisions) && meeting.decisions.length > 0 && (
                <>
                  <h3>Decisions</h3>
                  <ul className="meeting-decisions">{meeting.decisions.map((decision, index) => <li key={index}>{String(decision)}</li>)}</ul>
                </>
              )}
            </section>
          )}

          <section className="meeting-notes project-section" aria-label="Notes">
            <div className="project-section-head"><h2>Notes</h2><small className="meeting-muted">{notes.length} line{notes.length === 1 ? '' : 's'}</small></div>
            {!notes.length ? (
              <p className="meeting-muted">{status === 'planned' ? 'Notes open when the meeting starts.' : 'No notes yet.'}</p>
            ) : (
              <div role="log" aria-live="polite" aria-relevant="additions">
                {groups.filter((group) => group.notes.length || (status === 'live' && group.item.id === currentItem?.id)).map(({ item, notes: itemNotes }) => (
                  <div key={item.id} className={`meeting-note-group ${status === 'live' && item.id === currentItem?.id ? 'is-current' : ''}`}>
                    <h3>{item.title}</h3>
                    <ul>
                      {itemNotes.map((note) => (
                        <li key={note.id} className={`meeting-note is-${note.kind}`}>
                          <span className="meeting-note-kind" title={KIND_META[note.kind]?.label}>
                            <span className="material-symbols-outlined" aria-hidden="true">{KIND_META[note.kind]?.icon || 'notes'}</span>
                            <span className="sr-only">{KIND_META[note.kind]?.label}:</span>
                          </span>
                          <p>{note.body}</p>
                          <small><strong>{note.author_id === user?.id ? 'You' : authorName(note.author_id)}</strong> · <time dateTime={note.created_at}>{new Date(note.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time></small>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            )}
            <div ref={notesEnd} />
          </section>
        </div>
      </div>
    </section>
  );
}

function ReviewPanel({ review, people, busy, onChange, onApply, onCancel }) {
  const setTask = (key, patch) => onChange((current) => ({ ...current, tasks: current.tasks.map((task) => (task.key === key ? { ...task, ...patch } : task)) }));
  const setDecision = (index, patch) => onChange((current) => ({ ...current, decisions: current.decisions.map((item, at) => (at === index ? { ...item, ...patch } : item)) }));
  const selectedTasks = review.tasks.filter((task) => task.checked).length;
  return (
    <div className="agent-card meeting-review-card">
      <div className="agent-card-head">
        <span className="material-symbols-outlined">{review.source === 'ai' ? 'auto_awesome' : 'checklist'}</span>
        <strong>Review the minutes before saving</strong>
      </div>
      <div className="meeting-review-body">
      {review.notice && <p className="meeting-notice" role="status"><span className="material-symbols-outlined" aria-hidden="true">info</span>{review.notice}</p>}
      {review.created?.length > 0 && <p className="meeting-notice">{review.created.length} task{review.created.length === 1 ? ' was' : 's were'} already created in an earlier attempt and will be listed in the minutes.</p>}

      <label className="meeting-review-label" htmlFor="meeting-summary">Summary</label>
      <textarea id="meeting-summary" className="modal-input" rows={4} maxLength={4000} value={review.summary} disabled={busy} onChange={(event) => onChange((current) => ({ ...current, summary: event.target.value }))} />

      <h3 className="meeting-review-label">Decisions</h3>
      {review.decisions.length ? (
        <ul className="meeting-review-list">
          {review.decisions.map((decision, index) => (
            <li key={index}>
              <input type="checkbox" checked={decision.checked} disabled={busy} aria-label={`Include decision: ${decision.text}`} onChange={(event) => setDecision(index, { checked: event.target.checked })} />
              <span>{decision.text}</span>
            </li>
          ))}
        </ul>
      ) : <p className="meeting-muted">No decisions found.</p>}

      <h3 className="meeting-review-label">Proposed tasks</h3>
      {review.tasks.length ? (
        <ul className="meeting-review-list">
          {review.tasks.map((task) => (
            <li key={task.key} className="meeting-review-task">
              <input type="checkbox" checked={task.checked} disabled={busy} aria-label={`Create task: ${task.title}`} onChange={(event) => setTask(task.key, { checked: event.target.checked })} />
              <input type="text" className="modal-input" value={task.title} maxLength={140} disabled={busy || !task.checked} aria-label="Task title" onChange={(event) => setTask(task.key, { title: event.target.value })} />
              <select className="modal-input" value={task.assigneeId || ''} disabled={busy || !task.checked} aria-label="Owner" onChange={(event) => setTask(task.key, { assigneeId: event.target.value || null })}>
                <option value="">Unassigned</option>
                {people.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}
              </select>
              <input type="date" className="modal-input" value={task.due || ''} disabled={busy || !task.checked} aria-label="Due date" onChange={(event) => setTask(task.key, { due: event.target.value || null })} />
            </li>
          ))}
        </ul>
      ) : <p className="meeting-muted">No follow-up tasks found.</p>}
      </div>

      <div className="agent-card-actions">
        <button type="button" className="modal-btn-secondary" disabled={busy} onClick={onCancel}>Cancel</button>
        <button type="button" className="modal-btn-primary" disabled={busy} onClick={onApply}>
          {busy ? 'Applying…' : `Apply${selectedTasks ? ` · create ${selectedTasks} task${selectedTasks === 1 ? '' : 's'}` : ''}`}
        </button>
      </div>
    </div>
  );
}

export default function MeetingView({ meetingId, user }) {
  if (!meetingId) return <div className="project-empty-state"><span className="material-symbols-outlined">event_busy</span><h2>Meeting not found</h2><a href="#dashboard">Go home</a></div>;
  return <MeetingRoom key={meetingId} meetingId={meetingId} user={user} />;
}
