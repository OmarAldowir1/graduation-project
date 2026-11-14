import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../lib/supabase.js';
import { updateTask } from '../lib/queries.js';
import { AppState, showToast } from '../legacy/app.js';
import { GroupifyMark } from './GroupifyLogo.jsx';
import {
  FOCUS_EVENT, FOCUS_JOIN_EVENT, FOCUS_SETUP_EVENT, FOCUS_LENGTHS, getFocus, startFocus, updateFocus, pauseFocus, resumeFocus,
  extendFocus, endFocus, remainingMs, formatClock, playChime
} from '../lib/focusZone.js';

function Ring({ fraction, size = 260, stroke = 10 }) {
  const radius = (size - stroke) / 2;
  const length = 2 * Math.PI * radius;
  return (
    <svg className="focus-ring" width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
      <circle cx={size / 2} cy={size / 2} r={radius} className="focus-ring-track" strokeWidth={stroke} />
      <circle
        cx={size / 2} cy={size / 2} r={radius} className="focus-ring-arc" strokeWidth={stroke}
        strokeDasharray={length} strokeDashoffset={length * (1 - Math.max(0, Math.min(1, fraction)))}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
    </svg>
  );
}

export default function FocusZone() {
  const [session, setSession] = useState(() => getFocus());
  const [now, setNow] = useState(() => Date.now());
  const [task, setTask] = useState(null);
  const [setup, setSetup] = useState(null); // { task?, tasks?, minutes, endsAt?, withName? }
  const [progress, setProgress] = useState(0);
  const [saving, setSaving] = useState(false);
  const panelRef = useRef(null);
  const originalTitle = useRef(document.title);

  // Follow changes made anywhere (this tab, the task panel, other tabs).
  useEffect(() => {
    const sync = () => { setSession(getFocus()); setNow(Date.now()); };
    window.addEventListener(FOCUS_EVENT, sync);
    window.addEventListener('storage', sync);
    return () => { window.removeEventListener(FOCUS_EVENT, sync); window.removeEventListener('storage', sync); };
  }, []);

  // Tick while a session is running.
  const running = Boolean(session && !session.pausedAt && !session.finished);
  useEffect(() => {
    if (!running) return undefined;
    const id = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(id);
  }, [running]);

  const left = remainingMs(session, now);

  // Time's up.
  useEffect(() => {
    if (running && left <= 0) {
      playChime();
      updateFocus({ finished: true, finishedAt: Date.now(), minimized: false });
    }
  }, [running, left]);

  // Load the task (title, checklist, progress) for the session.
  useEffect(() => {
    if (!session?.taskId) return undefined;
    let cancelled = false;
    supabase.from('tasks').select('id, title, status, progress, details, assignee_id, team_id, page_id').eq('id', session.taskId).single()
      .then(({ data }) => {
        if (cancelled || !data) return;
        setTask(data);
        setProgress(data.status === 'done' ? 100 : Number(data.progress) || 0);
      });
    return () => { cancelled = true; };
  }, [session?.taskId]);

  // Browser tab title shows the countdown.
  useEffect(() => {
    if (!session || session.finished) {
      if (document.title.startsWith('🎯')) document.title = originalTitle.current;
      return;
    }
    if (!document.title.startsWith('🎯')) originalTitle.current = document.title;
    document.title = `🎯 ${session.pausedAt ? 'Paused' : formatClock(left)} · ${session.title}`;
  }, [session, left]);

  // Open the setup card from a task, or from "Join" on a teammate.
  useEffect(() => {
    const onSetup = (event) => {
      const { task: wanted, endsAt = null, withName = '' } = event.detail || {};
      if (getFocus() && !getFocus().finished) {
        updateFocus({ minimized: false });
        showToast('You are already in a focus session. End it first to start another.', 'error');
        return;
      }
      setSetup({ task: wanted, minutes: 25, endsAt, withName, joinMinutes: endsAt ? Math.ceil(Math.max(0, endsAt - Date.now()) / 60000) : 0 });
    };
    const onJoin = async (event) => {
      const { endsAt, withName } = event.detail || {};
      if (getFocus() && !getFocus().finished) { updateFocus({ minimized: false }); return; }
      const me = AppState.user?.id;
      const base = () => supabase.from('tasks')
        .select('id, title, status, page_id, team_id, due_date')
        .eq('workspace_id', AppState.workspace?.id).neq('status', 'done')
        .order('due_date', { ascending: true, nullsFirst: false }).limit(30);
      // Your own tasks first; tasks nobody owns yet as a second choice; or a free session.
      const [{ data: mine }, { data: open }] = await Promise.all([base().eq('assignee_id', me), base().is('assignee_id', null)]);
      const tasks = mine || [];
      const unassigned = open || [];
      const first = tasks[0] || unassigned[0] || null;
      setSetup({
        tasks, unassigned, task: first, free: !first, freeTitle: '',
        minutes: 25, endsAt, withName, joinMinutes: endsAt ? Math.ceil(Math.max(0, endsAt - Date.now()) / 60000) : 0
      });
    };
    window.addEventListener(FOCUS_SETUP_EVENT, onSetup);
    window.addEventListener(FOCUS_JOIN_EVENT, onJoin);
    return () => { window.removeEventListener(FOCUS_SETUP_EVENT, onSetup); window.removeEventListener(FOCUS_JOIN_EVENT, onJoin); };
  }, []);

  const minimize = useCallback(() => updateFocus({ minimized: true }), []);

  // Keyboard: Esc minimizes (or closes the setup card), Space pauses.
  useEffect(() => {
    if (!setup && (!session || session.minimized)) return undefined;
    const onKey = (event) => {
      if (event.key === 'Escape') { event.preventDefault(); if (setup) setSetup(null); else if (!session.finished) minimize(); }
      if (event.key === ' ' && session && !session.finished && !setup && !['INPUT', 'TEXTAREA', 'BUTTON'].includes(document.activeElement?.tagName)) {
        event.preventDefault();
        if (session.pausedAt) resumeFocus(); else pauseFocus();
      }
    };
    window.addEventListener('keydown', onKey);
    panelRef.current?.focus();
    return () => window.removeEventListener('keydown', onKey);
  }, [setup, session, minimize]);

  const checklist = useMemo(() => (task && task.id === session?.taskId && Array.isArray(task.details?.checklist) ? task.details.checklist : []), [task, session?.taskId]);

  const toggleStep = async (index) => {
    if (!task) return;
    const next = checklist.map((item, i) => (i === index ? { ...item, done: !item.done } : item));
    setTask({ ...task, details: { ...task.details, checklist: next } });
    const { error } = await updateTask(task.id, { details: { ...task.details, checklist: next } });
    if (error) showToast(`Could not update the checklist: ${error.message}`, 'error');
  };

  const finish = async ({ markDone = false, again = false } = {}) => {
    if (!task || !session?.taskId) {
      if (again) startFocus({ task: { id: null, title: session?.title || 'Focus session' }, minutes: session?.minutes || 25 });
      else endFocus();
      return;
    }
    setSaving(true);
    const value = markDone ? 100 : progress;
    const status = value >= 100 ? 'done' : value > 0 ? 'in_progress' : task.status;
    const { error } = await updateTask(task.id, { progress: value, status });
    setSaving(false);
    if (error) { showToast(`Could not save progress: ${error.message}`, 'error'); return; }
    showToast(markDone || value >= 100 ? `“${task.title}” is done 🎉` : `Progress saved: ${value}%`, 'success');
    window.dispatchEvent(new CustomEvent('motion:pages-changed'));
    if (again && value < 100) startFocus({ task, minutes: session?.minutes || 25 });
    else endFocus();
  };

  // ---------- Setup card ----------
  if (setup) {
    const joining = Boolean(setup.endsAt);
    return (
      <div className="focus-backdrop" role="dialog" aria-modal="true" aria-label="Start a focus session" onMouseDown={(event) => { if (event.target === event.currentTarget) setSetup(null); }}>
        <div className="focus-setup" ref={panelRef} tabIndex={-1}>
          <div className="focus-setup-head">
            <span className="focus-badge">🎯</span>
            <div>
              <h2>{joining ? `Focus with ${setup.withName || 'your teammate'}` : 'Start a focus session'}</h2>
              <p>{joining ? `You’ll finish together in ${setup.joinMinutes} min. Pick the task you’ll work on.` : 'One task, no distractions. Your team will see you’re focusing.'}</p>
            </div>
          </div>
          {setup.tasks ? (
            <>
              <label className="focus-field"><span>What will you work on?</span>
                <select
                  value={setup.free ? '__free__' : setup.task?.id || ''}
                  onChange={(event) => {
                    const value = event.target.value;
                    if (value === '__free__') setSetup({ ...setup, free: true, task: null });
                    else setSetup({ ...setup, free: false, task: [...setup.tasks, ...setup.unassigned].find((item) => item.id === value) });
                  }}
                >
                  {setup.tasks.length ? <optgroup label="My tasks">{setup.tasks.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</optgroup> : null}
                  {setup.unassigned.length ? <optgroup label="Not assigned to anyone yet">{setup.unassigned.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</optgroup> : null}
                  <option value="__free__">✏️ Something else (no task)…</option>
                </select>
              </label>
              {setup.free ? (
                <label className="focus-field"><span>Describe it in a few words</span>
                  <input
                    autoFocus maxLength={120} value={setup.freeTitle} placeholder="e.g. Read chapter 3 for the literature review"
                    onChange={(event) => setSetup({ ...setup, freeTitle: event.target.value })}
                    onKeyDown={(event) => { if (event.key === 'Enter' && setup.freeTitle.trim()) event.currentTarget.closest('.focus-setup').querySelector('.focus-btn.primary')?.click(); }}
                  />
                </label>
              ) : null}
              {!setup.tasks.length && !setup.free ? <p className="focus-setup-note">You have no tasks assigned yet. Pick one nobody owns, or focus on something else.</p> : null}
            </>
          ) : (
            <p className="focus-setup-task"><span className="material-symbols-outlined">task_alt</span>{setup.task?.title || 'Untitled task'}</p>
          )}
          {!joining ? (
            <div className="focus-lengths" role="radiogroup" aria-label="Session length">
              {FOCUS_LENGTHS.map((minutes) => (
                <button key={minutes} type="button" role="radio" aria-checked={setup.minutes === minutes} onClick={() => setSetup({ ...setup, minutes })}>
                  <strong>{minutes}</strong><small>min</small>
                </button>
              ))}
            </div>
          ) : null}
          <div className="focus-setup-actions">
            <button type="button" className="focus-btn ghost" onClick={() => setSetup(null)}>Cancel</button>
            <button
              type="button" className="focus-btn primary" disabled={setup.free ? !setup.freeTitle.trim() : !setup.task}
              onClick={() => {
                const task = setup.free ? { id: null, title: setup.freeTitle.trim() } : setup.task;
                startFocus({ task, minutes: setup.minutes, endsAt: setup.endsAt, withName: setup.withName });
                setSetup(null);
              }}
            >
              <span className="material-symbols-outlined">play_arrow</span>{joining ? 'Join session' : 'Start focusing'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!session) return null;
  const total = (session.endsAt - session.startedAt) || session.minutes * 60000;
  const fraction = session.finished ? 0 : left / total;

  // ---------- Minimized pill ----------
  if (session.minimized && !session.finished) {
    return (
      <button type="button" className={`focus-pill ${session.pausedAt ? 'is-paused' : ''}`} onClick={() => updateFocus({ minimized: false })} title="Back to Focus Zone">
        <Ring fraction={fraction} size={34} stroke={4} />
        <span className="focus-pill-time">{session.pausedAt ? 'Paused' : formatClock(left)}</span>
        <span className="focus-pill-title">{session.title}</span>
      </button>
    );
  }

  // ---------- Full screen ----------
  return (
    <div className="focus-zone" role="dialog" aria-modal="true" aria-label="Focus Zone" ref={panelRef} tabIndex={-1}>
      <div className="focus-glow" aria-hidden="true" />
      <header className="focus-top">
        <span className="focus-brand"><GroupifyMark size={18} color="#F5F7F8" dot="#2E7CA9" /> Focus Zone</span>
        <div className="focus-top-actions">
          {!session.finished ? <button type="button" className="focus-icon" onClick={minimize} title="Minimize (Esc)" aria-label="Minimize"><span className="material-symbols-outlined">close_fullscreen</span></button> : null}
          <button type="button" className="focus-icon" onClick={() => { if (session.finished) finish(); else endFocus(); }} title="End session" aria-label="End session"><span className="material-symbols-outlined">close</span></button>
        </div>
      </header>

      {!session.finished ? (
        <main className="focus-main">
          <div className={`focus-clock ${session.pausedAt ? 'is-paused' : ''}`}>
            <Ring fraction={fraction} />
            <div className="focus-clock-text">
              <strong>{formatClock(left)}</strong>
              <small>{session.pausedAt ? 'Paused' : `of ${Math.round(total / 60000)} min`}</small>
            </div>
          </div>
          <p className="focus-label">Focusing on{session.withName ? <> · with <strong>{session.withName}</strong></> : null}</p>
          <h1 className="focus-title">{session.title}</h1>
          <div className="focus-controls">
            {session.pausedAt
              ? <button type="button" className="focus-btn primary" onClick={resumeFocus}><span className="material-symbols-outlined">play_arrow</span>Resume</button>
              : <button type="button" className="focus-btn" onClick={pauseFocus}><span className="material-symbols-outlined">pause</span>Pause</button>}
            <button type="button" className="focus-btn" onClick={() => extendFocus(5)}><span className="material-symbols-outlined">more_time</span>+5 min</button>
            <button type="button" className="focus-btn" onClick={() => updateFocus({ finished: true, finishedAt: Date.now(), minimized: false })}><span className="material-symbols-outlined">flag</span>I’m done</button>
          </div>
          {checklist.length ? (
            <ul className="focus-steps" aria-label="Checklist">
              {checklist.map((item, index) => (
                <li key={item.id || index}>
                  <label><input type="checkbox" checked={Boolean(item.done)} onChange={() => toggleStep(index)} /><span>{item.text}</span></label>
                </li>
              ))}
            </ul>
          ) : null}
          <p className="focus-hint">Notifications are muted while you focus · Space to pause · Esc to minimize</p>
        </main>
      ) : (
        <main className="focus-main focus-done">
          <span className="focus-done-badge" aria-hidden="true">🎉</span>
          <h1 className="focus-title">Nice focus!</h1>
          <p className="focus-label">{Math.max(1, Math.round(((session.finishedAt || session.endsAt) - session.startedAt) / 60000))} min on “{session.title}”</p>
          {session.taskId ? (
            <>
              <div className="focus-progress">
                <label htmlFor="focus-progress">How far did you get? <output>{progress}%</output></label>
                <input id="focus-progress" type="range" min="0" max="100" step="5" value={progress} onChange={(event) => setProgress(Number(event.target.value))} />
              </div>
              <div className="focus-controls">
                <button type="button" className="focus-btn primary" disabled={saving} onClick={() => finish({ markDone: true })}><span className="material-symbols-outlined">check_circle</span>Mark task done</button>
                <button type="button" className="focus-btn" disabled={saving} onClick={() => finish()}><span className="material-symbols-outlined">save</span>Save progress</button>
                <button type="button" className="focus-btn" disabled={saving} onClick={() => finish({ again: true })}><span className="material-symbols-outlined">replay</span>Save & another round</button>
              </div>
            </>
          ) : (
            <div className="focus-controls">
              <button type="button" className="focus-btn primary" onClick={() => finish()}><span className="material-symbols-outlined">check_circle</span>Finish</button>
              <button type="button" className="focus-btn" onClick={() => finish({ again: true })}><span className="material-symbols-outlined">replay</span>Another round</button>
            </div>
          )}
          <p className="focus-hint">Tip: take a 5-minute break before the next round.</p>
        </main>
      )}
    </div>
  );
}
