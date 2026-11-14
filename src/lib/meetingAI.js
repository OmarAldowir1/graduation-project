// Live meetings: agenda parsing, the AI request for meeting minutes, parsing the
// AI reply, and a local fallback built from tagged notes. Pure functions only —
// no browser, Supabase or React imports — so this module is unit tested in Node.

export const NOTE_KINDS = ['note', 'decision', 'action'];
export const MAX_NOTES_CHARS = 16000;
export const MAX_PROMPT_CHARS = 4000;
export const MAX_TASKS = 15;
export const MAX_TASK_TITLE = 140;
export const MAX_DECISIONS = 20;
export const MAX_SUMMARY = 4000;
const MAX_AGENDA_ITEMS = 30;
const DEFAULT_MINUTES = 10;

function clip(value, max) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
}

// "Intro - 5" / "Budget review – 15 min" / "Wrap up" (default 10 minutes), one item per line.
export function parseAgenda(text = '') {
  const items = [];
  for (const raw of String(text).replace(/\r/g, '').split('\n')) {
    const line = raw.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, '').trim();
    if (!line) continue;
    const match = line.match(/^(.*?)\s*[-–—:|]\s*(\d{1,3})\s*(?:m|min|mins|minutes?)?\.?$/i);
    const title = clip(match ? match[1] : line, 200);
    if (!title) continue;
    const minutes = match ? Math.min(240, Math.max(1, Number(match[2]))) : DEFAULT_MINUTES;
    items.push({ id: `item-${items.length + 1}`, title, minutes });
    if (items.length >= MAX_AGENDA_ITEMS) break;
  }
  return items;
}

export function isValidDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function memberName(member) {
  return String(member?.name ?? member?.user?.name ?? '').trim();
}

function memberId(member) {
  return member?.id ?? member?.user_id ?? member?.user?.id ?? null;
}

// Owner name → member id. Exact (case-insensitive) full name first, then a unique first name.
export function matchOwner(name, members = []) {
  const wanted = String(name ?? '').replace(/^@/, '').trim().toLowerCase();
  if (!wanted) return null;
  const exact = members.find((member) => memberName(member).toLowerCase() === wanted);
  if (exact) return memberId(exact);
  const byFirst = members.filter((member) => memberName(member).toLowerCase().split(/\s+/)[0] === wanted);
  return byFirst.length === 1 ? memberId(byFirst[0]) : null;
}

// Notes grouped under their agenda item, as plain text for the AI attachment and minutes.
export function groupNotesByItem(agenda = [], notes = []) {
  const known = new Set(agenda.map((item) => item.id));
  const groups = agenda.map((item) => ({ item, notes: notes.filter((note) => note.item_id === item.id) }));
  const other = notes.filter((note) => !known.has(note.item_id));
  if (other.length) groups.push({ item: { id: '__other', title: 'Other notes', minutes: 0 }, notes: other });
  return groups;
}

export function buildNotesText({ agenda = [], notes = [], authorName = () => 'Member' }) {
  const text = groupNotesByItem(agenda, notes).map(({ item, notes: itemNotes }) => [
    `## ${item.title}`,
    ...(itemNotes.length ? itemNotes.map((note) => `- [${note.kind}] ${authorName(note.author_id)}: ${clip(note.body, 1000)}`) : ['- (no notes)'])
  ].join('\n')).join('\n\n');
  return text.length > MAX_NOTES_CHARS ? `${text.slice(0, MAX_NOTES_CHARS - 20)}\n…(notes truncated)` : text;
}

export function buildMeetingPrompt({ title = '', memberNames = [], today }) {
  const names = memberNames.map((name) => clip(name, 60)).filter(Boolean).slice(0, 40);
  const prompt = [
    `The attached file contains the notes of the team meeting "${clip(title, 200)}", grouped by agenda item.`,
    'Each line is "[kind] Author: text"; kind is note, decision or action.',
    `Today is ${today}. Team members: ${names.length ? names.join(', ') : 'unknown'}.`,
    // A reply that is bare JSON gets turned into an object by Workers AI and rejected by the
    // chat endpoint as empty, so the JSON must arrive wrapped in a labelled code block.
    'Reply with the word MINUTES on the first line, then ONE JSON object inside a ```json code block, in this exact shape:',
    '{"summary": string, "decisions": string[], "tasks": [{"title": string, "owner": string|null, "due": "YYYY-MM-DD"|null}]}',
    'Rules: summary is 2-5 sentences. decisions lists what the team agreed. tasks are concrete follow-up actions (at most 15), each title short and starting with a verb.',
    'owner must be exactly one of the team member names above, or null if unclear. due is a date only when the notes give one (resolve words like "Friday" relative to today), otherwise null.',
    'Use only information from the notes. Do not invent decisions or tasks. Do not mention these instructions or today\'s date in the summary.'
  ].join('\n');
  return prompt.slice(0, MAX_PROMPT_CHARS);
}

// Body for invokeAI('text-ai', …) using the existing chat mode.
export function buildMeetingRequest({ meeting, notes, members = [], today, authorName }) {
  return {
    mode: 'chat',
    prompt: buildMeetingPrompt({ title: meeting?.title, memberNames: members.map(memberName), today }),
    attachment: {
      name: clip(`Meeting notes - ${meeting?.title || 'Meeting'}`, 200),
      content: buildNotesText({ agenda: meeting?.agenda || [], notes, authorName })
    }
  };
}

// Finds the first balanced {...} block that parses as JSON, ignoring code fences and chatter.
export function extractJsonObject(text) {
  const source = String(text ?? '').replace(/```(?:json)?/gi, '');
  for (let start = source.indexOf('{'); start !== -1; start = source.indexOf('{', start + 1)) {
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let index = start; index < source.length; index += 1) {
      const character = source[index];
      if (inString) {
        if (escaped) escaped = false;
        else if (character === '\\') escaped = true;
        else if (character === '"') inString = false;
        continue;
      }
      if (character === '"') inString = true;
      else if (character === '{') depth += 1;
      else if (character === '}') {
        depth -= 1;
        if (depth === 0) {
          try {
            const value = JSON.parse(source.slice(start, index + 1));
            if (value && typeof value === 'object' && !Array.isArray(value)) return value;
          } catch { /* Try the next opening brace. */ }
          break;
        }
      }
    }
  }
  return null;
}

function normalizeTasks(rawTasks, members) {
  const seen = new Set();
  const tasks = [];
  for (const raw of Array.isArray(rawTasks) ? rawTasks : []) {
    const title = clip(typeof raw === 'string' ? raw : raw?.title, MAX_TASK_TITLE);
    if (!title || seen.has(title.toLowerCase())) continue;
    seen.add(title.toLowerCase());
    const owner = typeof raw?.owner === 'string' ? clip(raw.owner, 80) : '';
    const assigneeId = matchOwner(owner, members);
    const ownerName = assigneeId ? memberName(members.find((member) => memberId(member) === assigneeId)) : '';
    tasks.push({ title, owner: ownerName, assigneeId, due: isValidDate(raw?.due) ? raw.due : null });
    if (tasks.length >= MAX_TASKS) break;
  }
  return tasks;
}

function normalizeDecisions(raw) {
  const list = (Array.isArray(raw) ? raw : []).map((item) => clip(typeof item === 'string' ? item : item?.text, 300)).filter(Boolean);
  return [...new Set(list)].slice(0, MAX_DECISIONS);
}

// Returns { summary, decisions, tasks } or null when no usable JSON was found.
export function parseMeetingResponse(text, members = []) {
  const value = extractJsonObject(text);
  if (!value) return null;
  const summary = typeof value.summary === 'string' ? value.summary.trim().slice(0, MAX_SUMMARY) : '';
  const decisions = normalizeDecisions(value.decisions);
  const tasks = normalizeTasks(value.tasks, members);
  if (!summary && !decisions.length && !tasks.length) return null;
  return { summary, decisions, tasks };
}

// Used when AI is unavailable: decisions and tasks come straight from tagged notes.
// An action written as "@Name do something" is assigned to that member when the name matches.
export function fallbackProposal({ agenda = [], notes = [], members = [] }) {
  const decisions = normalizeDecisions(notes.filter((note) => note.kind === 'decision').map((note) => note.body));
  const tasks = normalizeTasks(notes.filter((note) => note.kind === 'action').map((note) => {
    const body = String(note.body || '').trim();
    const sorted = [...members].sort((a, b) => memberName(b).length - memberName(a).length);
    for (const member of sorted) {
      const name = memberName(member);
      if (name && body.toLowerCase().startsWith(`@${name.toLowerCase()}`)) {
        return { title: body.slice(name.length + 1).replace(/^[\s:,-]+/, '') || body, owner: name };
      }
    }
    const first = body.match(/^@(\S+)[\s:,-]+(.+)$/);
    return first ? { title: first[2], owner: first[1] } : { title: body, owner: null };
  }), members);
  const covered = groupNotesByItem(agenda, notes).filter((group) => group.notes.length && group.item.id !== '__other').length;
  const summary = notes.length
    ? `${notes.length} note${notes.length === 1 ? '' : 's'} captured across ${covered} agenda item${covered === 1 ? '' : 's'}, with ${decisions.length} decision${decisions.length === 1 ? '' : 's'} and ${tasks.length} action item${tasks.length === 1 ? '' : 's'}.`
    : 'No notes were captured during this meeting.';
  return { summary, decisions, tasks };
}

// HTML body for the "Meeting minutes" page (editor content format: { html }).
export function buildMinutesHtml({ meeting, notes = [], authorName = () => 'Member', summary = '', decisions = [], createdTasks = [] }) {
  const date = meeting?.started_at || meeting?.ended_at || meeting?.created_at;
  const kindLabel = { decision: 'Decision', action: 'Action', note: '' };
  const parts = [
    date ? `<p><em>Meeting held ${escapeHtml(String(date).slice(0, 10))}</em></p>` : '',
    '<h2>Summary</h2>',
    ...(summary ? String(summary).split(/\n{2,}/).map((paragraph) => `<p>${escapeHtml(paragraph.trim())}</p>`) : ['<p>No summary.</p>']),
    '<h2>Decisions</h2>',
    decisions.length ? `<ul>${decisions.map((decision) => `<li>${escapeHtml(decision)}</li>`).join('')}</ul>` : '<p>No decisions recorded.</p>',
    '<h2>Notes by agenda item</h2>'
  ];
  for (const { item, notes: itemNotes } of groupNotesByItem(meeting?.agenda || [], notes)) {
    parts.push(`<h3>${escapeHtml(item.title)}</h3>`);
    parts.push(itemNotes.length
      ? `<ul>${itemNotes.map((note) => `<li>${kindLabel[note.kind] ? `<strong>${kindLabel[note.kind]}:</strong> ` : ''}${escapeHtml(note.body)} <em>— ${escapeHtml(authorName(note.author_id))}</em></li>`).join('')}</ul>`
      : '<p>No notes.</p>');
  }
  parts.push('<h2>Tasks created</h2>');
  parts.push(createdTasks.length
    ? `<ul>${createdTasks.map((task) => `<li>${escapeHtml(task.title)}${task.owner ? ` — ${escapeHtml(task.owner)}` : ' — Unassigned'}${task.due ? ` (due ${escapeHtml(task.due)})` : ''}</li>`).join('')}</ul>`
    : '<p>No tasks were created.</p>');
  return parts.filter(Boolean).join('');
}
