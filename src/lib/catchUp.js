// Catch-up card on Home: "what's new since you last checked". Pure functions only —
// no browser or Supabase imports — so the summary logic is unit tested in Node.
import { describeNotification } from './notificationText.js';

export const FIRST_VISIT_DAYS = 3;
export const MAX_DAYS = 14;
const DAY_MS = 86400000;
const ITEMS_PER_SECTION = 3;

// The window starts at the last "Mark all as seen", never more than MAX_DAYS ago.
// Someone who has never marked it sees the last FIRST_VISIT_DAYS days.
export function resolveSince(seenAt, now = Date.now()) {
  const floor = now - MAX_DAYS * DAY_MS;
  const seen = Date.parse(seenAt || '');
  if (!Number.isFinite(seen)) return { since: new Date(now - FIRST_VISIT_DAYS * DAY_MS).toISOString(), firstVisit: true };
  return { since: new Date(Math.min(now, Math.max(seen, floor))).toISOString(), firstVisit: false };
}

function after(value, since) {
  const time = Date.parse(value || '');
  return Number.isFinite(time) && time > Date.parse(since);
}

function plural(count, one, many = `${one}s`) {
  return `${count} ${count === 1 ? one : many}`;
}

function quoted(value, fallback = 'Untitled') {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim() || fallback;
  return text.length > 60 ? `${text.slice(0, 57)}…` : text;
}

function isDone(task) {
  return task?.status === 'done' || Boolean(task?.completed);
}

// Inputs are the rows already loaded for Home plus a few "since" queries. Every list is optional,
// so a missing table or column only removes its section.
export function buildCatchUp({
  since, me, workspaceId,
  notifications = [], tasks = [], pages = [], pageEdits = [], meetings = [], messageCount = 0,
  nameOf = () => 'A teammate'
}) {
  const sections = [];
  const pageById = new Map(pages.filter((page) => !page.archived_at).map((page) => [page.id, page]));
  const fresh = notifications.filter((item) => after(item.created_at, since)
    && (!item.workspace_id || !workspaceId || item.workspace_id === workspaceId)
    && item.actor_id !== me);
  const ofType = (...types) => fresh.filter((item) => types.includes(item.type));
  const notificationItems = (list) => list.slice(0, ITEMS_PER_SECTION).map((item) => {
    const info = describeNotification(item);
    return { text: info.text, href: info.href ? `#${info.href}` : '#dashboard' };
  });

  const live = meetings.filter((meeting) => meeting.status === 'live');
  if (live.length) {
    sections.push({
      id: 'live', icon: 'radio_button_checked', tone: 'live',
      label: live.length === 1 ? 'A meeting is live now' : `${live.length} meetings are live now`,
      count: live.length,
      items: live.slice(0, ITEMS_PER_SECTION).map((meeting) => ({ text: `Join “${quoted(meeting.title)}”`, href: `#meeting/${meeting.id}` }))
    });
  }

  // Assigned to me: notifications, plus tasks created for me by someone else (covers older databases).
  const assigned = new Map();
  for (const item of ofType('task_assigned')) {
    const key = item.payload?.task_id || item.id;
    if (!assigned.has(key)) assigned.set(key, notificationItems([item])[0]);
  }
  for (const task of tasks) {
    if (task.assignee_id === me && !isDone(task) && after(task.created_at, since) && task.created_by && task.created_by !== me && !assigned.has(task.id)) {
      assigned.set(task.id, { text: `${nameOf(task.created_by)} assigned you “${quoted(task.title)}”`, href: `#kanban?task=${encodeURIComponent(task.id)}` });
    }
  }
  if (assigned.size) {
    sections.push({ id: 'assigned', icon: 'assignment_ind', label: `${plural(assigned.size, 'new task')} assigned to you`, count: assigned.size, items: [...assigned.values()].slice(0, ITEMS_PER_SECTION), href: '#kanban?assignee=mine' });
  }

  const mentions = ofType('mention');
  if (mentions.length) {
    sections.push({ id: 'mentions', icon: 'alternate_email', label: `You were mentioned ${mentions.length === 1 ? 'once' : `${mentions.length} times`}`, count: mentions.length, items: notificationItems(mentions) });
  }

  const comments = ofType('comment_added', 'comment_reply', 'task_comment');
  if (comments.length) {
    sections.push({ id: 'comments', icon: 'forum', label: comments.length === 1 ? '1 new comment or reply' : `${comments.length} new comments and replies`, count: comments.length, items: notificationItems(comments) });
  }

  const decided = meetings.filter((meeting) => meeting.status === 'ended' && after(meeting.ended_at, since));
  if (decided.length) {
    const decisionCount = decided.reduce((sum, meeting) => sum + (Array.isArray(meeting.decisions) ? meeting.decisions.length : 0), 0);
    sections.push({
      id: 'meetings', icon: 'gavel',
      label: `${plural(decided.length, 'meeting')} ended${decisionCount ? ` with ${plural(decisionCount, 'decision')}` : ''}`,
      count: decided.length,
      items: decided.slice(0, ITEMS_PER_SECTION).map((meeting) => {
        const count = Array.isArray(meeting.decisions) ? meeting.decisions.length : 0;
        return { text: `“${quoted(meeting.title)}”${count ? ` · ${plural(count, 'decision')}` : meeting.summary ? '' : ' · minutes not saved yet'}`, href: `#meeting/${meeting.id}` };
      })
    });
  }

  const completed = tasks
    .filter((task) => isDone(task) && after(task.completed_at, since) && (task.completed_by ? task.completed_by !== me : task.assignee_id !== me))
    .sort((a, b) => String(b.completed_at).localeCompare(String(a.completed_at)));
  if (completed.length) {
    sections.push({
      id: 'completed', icon: 'task_alt', label: `${plural(completed.length, 'task')} completed by your team`, count: completed.length,
      items: completed.slice(0, ITEMS_PER_SECTION).map((task) => ({ text: `${task.completed_by ? `${nameOf(task.completed_by)} finished` : 'Done:'} “${quoted(task.title)}”`, href: `#kanban?task=${encodeURIComponent(task.id)}` }))
    });
  }

  const added = tasks.filter((task) => after(task.created_at, since) && task.created_by && task.created_by !== me && task.assignee_id !== me && !isDone(task));
  if (added.length) {
    sections.push({
      id: 'added', icon: 'add_task', label: `${plural(added.length, 'new task')} added by teammates`, count: added.length,
      items: added.slice(0, ITEMS_PER_SECTION).map((task) => ({ text: `${nameOf(task.created_by)} added “${quoted(task.title)}”`, href: `#kanban?task=${encodeURIComponent(task.id)}` })),
      href: '#kanban'
    });
  }

  // Pages someone else edited: page history snapshots plus "page updated" notifications.
  const edited = new Map();
  for (const edit of pageEdits) {
    if (edit.replaced_by && edit.replaced_by !== me && after(edit.created_at, since) && pageById.has(edit.page_id) && !edited.has(edit.page_id)) edited.set(edit.page_id, edit.replaced_by);
  }
  for (const item of ofType('page_updated')) {
    if (item.page_id && pageById.has(item.page_id) && !edited.has(item.page_id)) edited.set(item.page_id, item.actor_id || null);
  }
  if (edited.size) {
    sections.push({
      id: 'pages', icon: 'edit_note', label: `${plural(edited.size, 'page')} edited by teammates`, count: edited.size,
      items: [...edited].slice(0, ITEMS_PER_SECTION).map(([pageId, editor]) => {
        const page = pageById.get(pageId);
        return { text: `${page.icon ? `${page.icon} ` : ''}${quoted(page.title)}${editor ? ` · ${nameOf(editor)}` : ''}`, href: `#editor/${pageId}` };
      })
    });
  }

  if (messageCount > 0) {
    sections.push({ id: 'chat', icon: 'chat', label: `${plural(messageCount, 'new message')} in Team chat`, count: messageCount, items: [{ text: 'Open Team chat', href: '#chat' }] });
  }

  return { since, total: sections.reduce((sum, section) => sum + section.count, 0), sections };
}

export function describeWindow({ since, firstVisit }, now = Date.now()) {
  if (firstVisit) return `In the last ${FIRST_VISIT_DAYS} days`;
  const hours = Math.max(0, Math.round((now - Date.parse(since)) / 3600000));
  if (hours < 1) return 'Since you last checked, a few minutes ago';
  if (hours < 24) return `Since you last checked, ${plural(hours, 'hour')} ago`;
  const days = Math.round(hours / 24);
  return days >= MAX_DAYS ? `In the last ${MAX_DAYS} days` : `Since you last checked, ${plural(days, 'day')} ago`;
}
