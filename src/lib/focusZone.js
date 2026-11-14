// Focus Zone: a calm, timed session on one task. The session lives in this browser
// (localStorage) and is shared with teammates through live presence, so it needs no
// database table. The timer is based on the clock (endsAt), so background tabs and
// reloads never drift.

const KEY = 'groupify.focus';
export const FOCUS_EVENT = 'groupify:focus-changed';
export const FOCUS_JOIN_EVENT = 'groupify:focus-join';
export const FOCUS_SETUP_EVENT = 'groupify:focus-setup';
export const FOCUS_LENGTHS = [15, 25, 50];

// Returns the saved session, null when there is none, or undefined when this
// browser blocks storage (then the in-memory copy is used instead).
function read() {
  let raw;
  try { raw = localStorage.getItem(KEY); } catch { return undefined; }
  try {
    const value = JSON.parse(raw || 'null');
    return value && typeof value === 'object' && value.startedAt && (value.taskId || value.title) ? value : null;
  } catch {
    return null;
  }
}

function write(session) {
  try {
    if (session) localStorage.setItem(KEY, JSON.stringify(session));
    else localStorage.removeItem(KEY);
  } catch { /* private mode: the session still works for this tab */ }
  memory = session;
  window.dispatchEvent(new CustomEvent(FOCUS_EVENT, { detail: session }));
}

let memory = null;

export function getFocus() {
  const saved = read();
  return saved === undefined ? memory : saved;
}

export function remainingMs(session, now = Date.now()) {
  if (!session) return 0;
  if (session.pausedAt) return Math.max(0, session.remainingAtPause || 0);
  return Math.max(0, session.endsAt - now);
}

export function isFocusRunning(session = getFocus()) {
  return Boolean(session && !session.pausedAt && !session.finished && remainingMs(session) > 0);
}

export function startFocus({ task, minutes = 25, endsAt = null, withName = '' }) {
  const now = Date.now();
  const session = {
    taskId: task.id,
    title: task.title || 'Untitled task',
    pageId: task.page_id || null,
    teamId: task.team_id || null,
    minutes,
    startedAt: now,
    endsAt: endsAt && endsAt > now + 60000 ? endsAt : now + minutes * 60000,
    pausedAt: null,
    remainingAtPause: 0,
    withName: withName || '',
    minimized: false,
    finished: false
  };
  write(session);
  return session;
}

// Ask the Focus Zone to start on a task (the task panel calls this).
export function requestFocus(task, options = {}) {
  window.dispatchEvent(new CustomEvent(FOCUS_SETUP_EVENT, { detail: { task, ...options } }));
}

// Start focusing from anywhere: pick one of your open tasks, then a length.
export function pickAndFocus() {
  window.dispatchEvent(new CustomEvent(FOCUS_JOIN_EVENT, { detail: { endsAt: null, withName: '' } }));
}

// Join a teammate's running session (same end time, your own task).
export function joinFocus({ endsAt, withName }) {
  window.dispatchEvent(new CustomEvent(FOCUS_JOIN_EVENT, { detail: { endsAt, withName } }));
}

export function updateFocus(changes) {
  const session = getFocus();
  if (!session) return null;
  const next = { ...session, ...changes };
  write(next);
  return next;
}

export function pauseFocus() {
  const session = getFocus();
  if (!session || session.pausedAt) return session;
  return updateFocus({ pausedAt: Date.now(), remainingAtPause: remainingMs(session) });
}

export function resumeFocus() {
  const session = getFocus();
  if (!session?.pausedAt) return session;
  return updateFocus({ pausedAt: null, endsAt: Date.now() + session.remainingAtPause, remainingAtPause: 0 });
}

export function extendFocus(minutes = 5) {
  const session = getFocus();
  if (!session) return null;
  if (session.pausedAt) return updateFocus({ remainingAtPause: session.remainingAtPause + minutes * 60000 });
  return updateFocus({ endsAt: Math.max(session.endsAt, Date.now()) + minutes * 60000, finished: false });
}

export function endFocus() {
  write(null);
}

// What teammates see (sent through presence).
export function focusPresence(session = getFocus()) {
  if (!session || session.finished) return null;
  return {
    title: session.title,
    task_id: session.taskId,
    ends_at: session.pausedAt ? null : session.endsAt,
    paused: Boolean(session.pausedAt),
    minutes: session.minutes
  };
}

export function formatClock(ms) {
  const total = Math.ceil(ms / 1000);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

// A soft two-note chime when a session ends (no audio files needed).
export function playChime() {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    [[660, 0], [880, 0.22]].forEach(([frequency, delay]) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = frequency;
      gain.gain.setValueAtTime(0.0001, ctx.currentTime + delay);
      gain.gain.exponentialRampToValueAtTime(0.18, ctx.currentTime + delay + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + delay + 0.9);
      osc.connect(gain).connect(ctx.destination);
      osc.start(ctx.currentTime + delay);
      osc.stop(ctx.currentTime + delay + 1);
    });
    window.setTimeout(() => ctx.close().catch(() => {}), 1600);
  } catch { /* audio blocked: the visual change is enough */ }
}
