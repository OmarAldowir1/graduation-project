// List, Calendar and Timeline views for tasks. Each render function returns HTML;
// interactions are wired by bindTaskView(). Board view stays in kanban.js.
import { escapeHtml } from './sanitize.js';
import { renderFieldValue } from './taskFields.js';

const STATUS_LABEL = { todo: 'To do', in_progress: 'In progress', done: 'Done' };
const PRIORITY_RANK = { urgent: 0, high: 1, medium: 2, low: 3 };
const DAY = 24 * 60 * 60 * 1000;

export function dateKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
function parseKey(key) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}
function isOverdue(task, today = dateKey(new Date())) {
  return Boolean(task.due_date && task.status !== 'done' && task.due_date < today);
}
function ownerName(task) {
  return task.assignee?.name || '';
}
function initials(name) {
  return String(name || '?').split(/\s+/).map((part) => part[0] || '').join('').slice(0, 2).toUpperCase();
}

// ---------- List ----------

export function renderListView(tasks, { fields = [], projectNames = new Map(), sort = { key: 'due', dir: 1 } } = {}) {
  const sorted = [...tasks].sort((a, b) => {
    const dir = sort.dir;
    switch (sort.key) {
      case 'title': return dir * String(a.title || '').localeCompare(String(b.title || ''));
      case 'status': return dir * (['todo', 'in_progress', 'done'].indexOf(a.status) - ['todo', 'in_progress', 'done'].indexOf(b.status));
      case 'owner': return dir * ownerName(a).localeCompare(ownerName(b));
      case 'priority': return dir * ((PRIORITY_RANK[a.priority] ?? 9) - (PRIORITY_RANK[b.priority] ?? 9));
      case 'project': return dir * String(projectNames.get(a.id) || '').localeCompare(String(projectNames.get(b.id) || ''));
      default: {
        if (sort.key.startsWith('field:')) {
          const id = sort.key.slice(6);
          return dir * String(a.fields?.[id] ?? '').localeCompare(String(b.fields?.[id] ?? ''), undefined, { numeric: true });
        }
        return dir * (a.due_date || '9999-12-31').localeCompare(b.due_date || '9999-12-31');
      }
    }
  });
  const header = (key, label) => `<th scope="col"><button type="button" data-sort="${key}" class="${sort.key === key ? 'is-sorted' : ''}">${escapeHtml(label)}${sort.key === key ? (sort.dir > 0 ? ' ↑' : ' ↓') : ''}</button></th>`;
  const showProject = projectNames.size > 0;
  if (!sorted.length) return '<div class="task-view-empty">No tasks match these filters.</div>';
  return `<div class="task-list-wrap"><table class="task-list">
    <thead><tr>${header('title', 'Task')}${header('status', 'Status')}${header('owner', 'Owner')}${header('due', 'Due')}${header('priority', 'Priority')}${showProject ? header('project', 'Project') : ''}${fields.map((field) => header(`field:${field.id}`, field.name)).join('')}</tr></thead>
    <tbody>${sorted.map((task) => `<tr class="${task.status === 'done' ? 'is-done' : ''}">
      <td><button type="button" class="task-list-title" data-open-task="${escapeHtml(task.id)}">${escapeHtml(task.title || 'Untitled task')}</button></td>
      <td><select data-status-for="${escapeHtml(task.id)}" aria-label="Status of ${escapeHtml(task.title)}">${Object.entries(STATUS_LABEL).map(([value, label]) => `<option value="${value}" ${task.status === value ? 'selected' : ''}>${label}</option>`).join('')}</select></td>
      <td>${ownerName(task) ? `<span class="task-owner"><span class="task-owner-dot">${escapeHtml(initials(ownerName(task)))}</span>${escapeHtml(ownerName(task))}</span>` : '<span class="task-muted">—</span>'}</td>
      <td class="${isOverdue(task) ? 'is-overdue' : ''}">${task.due_date ? escapeHtml(task.due_date) : '<span class="task-muted">—</span>'}</td>
      <td><span class="motion-kanban-priority ${escapeHtml(task.priority || 'medium')}">${escapeHtml(task.priority || 'medium')}</span></td>
      ${showProject ? `<td>${escapeHtml(projectNames.get(task.id) || '')}</td>` : ''}
      ${fields.map((field) => `<td>${renderFieldValue(field, task.fields?.[field.id])}</td>`).join('')}
    </tr>`).join('')}</tbody>
  </table></div>`;
}

// ---------- Calendar ----------

export function renderCalendarView(tasks, { month = new Date() } = {}) {
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const start = new Date(first);
  start.setDate(first.getDate() - ((first.getDay() + 6) % 7)); // Monday
  const today = dateKey(new Date());
  const byDay = new Map();
  for (const task of tasks) {
    if (!task.due_date) continue;
    const list = byDay.get(task.due_date) || [];
    list.push(task);
    byDay.set(task.due_date, list);
  }
  const undated = tasks.filter((task) => !task.due_date && task.status !== 'done');
  const cells = [];
  for (let i = 0; i < 42; i += 1) {
    const day = new Date(start.getTime() + i * DAY);
    day.setHours(0, 0, 0, 0);
    const key = dateKey(day);
    const items = (byDay.get(key) || []).sort((a, b) => (PRIORITY_RANK[a.priority] ?? 9) - (PRIORITY_RANK[b.priority] ?? 9));
    cells.push(`<div class="cal-day ${day.getMonth() !== first.getMonth() ? 'is-outside' : ''} ${key === today ? 'is-today' : ''}" data-drop-date="${key}">
      <span class="cal-date">${day.getDate()}</span>
      ${items.slice(0, 3).map((task) => `<button type="button" draggable="true" class="cal-task ${task.status === 'done' ? 'is-done' : ''} ${isOverdue(task, today) ? 'is-overdue' : ''} p-${escapeHtml(task.priority || 'medium')}" data-open-task="${escapeHtml(task.id)}" data-drag-task="${escapeHtml(task.id)}" title="${escapeHtml(task.title)}${ownerName(task) ? ` · ${escapeHtml(ownerName(task))}` : ''}">${escapeHtml(task.title)}</button>`).join('')}
      ${items.length > 3 ? `<button type="button" class="cal-more" data-day-more="${key}">+${items.length - 3} more</button>` : ''}
    </div>`);
  }
  const label = first.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  return `<div class="cal">
    <div class="cal-head">
      <button type="button" data-cal-nav="-1" aria-label="Previous month"><span class="material-symbols-outlined">chevron_left</span></button>
      <strong>${escapeHtml(label)}</strong>
      <button type="button" data-cal-nav="1" aria-label="Next month"><span class="material-symbols-outlined">chevron_right</span></button>
      <button type="button" data-cal-nav="0" class="cal-today">Today</button>
      <span class="cal-hint">Drag a task to another day to change its due date</span>
    </div>
    <div class="cal-grid">${['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => `<div class="cal-weekday">${d}</div>`).join('')}${cells.join('')}</div>
    ${undated.length ? `<p class="cal-undated">${undated.length} open task${undated.length === 1 ? ' has' : 's have'} no due date and ${undated.length === 1 ? 'isn’t' : 'aren’t'} shown.</p>` : ''}
  </div>`;
}

// ---------- Timeline (workload by person, next 4 weeks) ----------

export function renderTimelineView(tasks, { weeks = 4, startDate = new Date() } = {}) {
  const start = new Date(startDate);
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
  const days = weeks * 7;
  const end = new Date(start.getTime() + days * DAY);
  const today = dateKey(new Date());
  const visible = tasks.filter((task) => task.due_date && task.status !== 'done' && parseKey(task.due_date) < end && parseKey(task.due_date) >= new Date(start.getTime() - 14 * DAY));
  const groups = new Map();
  for (const task of visible) {
    const key = ownerName(task) || 'Unassigned';
    const list = groups.get(key) || [];
    list.push(task);
    groups.set(key, list);
  }
  const dayIndex = (key) => Math.round((parseKey(key) - start) / DAY);
  const header = [];
  for (let i = 0; i < days; i += 1) {
    const day = new Date(start.getTime() + i * DAY);
    const key = dateKey(day);
    header.push(`<div class="tl-day ${key === today ? 'is-today' : ''} ${day.getDay() === 0 || day.getDay() === 6 ? 'is-weekend' : ''}">${day.getDay() === 1 || i === 0 ? `<b>${day.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</b>` : day.getDate()}</div>`);
  }
  const rows = [...groups.entries()].sort(([a], [b]) => (a === 'Unassigned') - (b === 'Unassigned') || a.localeCompare(b)).map(([person, list]) => {
    const load = list.length;
    const bars = list.sort((a, b) => a.due_date.localeCompare(b.due_date)).map((task) => {
      const created = task.created_at ? dateKey(new Date(task.created_at)) : task.due_date;
      const from = Math.max(0, Math.min(dayIndex(created), dayIndex(task.due_date)));
      const to = Math.min(days - 1, Math.max(0, dayIndex(task.due_date)));
      return `<button type="button" class="tl-bar ${isOverdue(task, today) ? 'is-overdue' : ''} p-${escapeHtml(task.priority || 'medium')}" style="grid-column:${from + 1} / ${to + 2}" data-open-task="${escapeHtml(task.id)}" title="${escapeHtml(task.title)} · due ${escapeHtml(task.due_date)}">${escapeHtml(task.title)}</button>`;
    }).join('');
    return `<div class="tl-row"><div class="tl-person"><span class="task-owner-dot">${escapeHtml(initials(person))}</span><span>${escapeHtml(person)}</span><small class="${load >= 5 ? 'is-heavy' : ''}">${load} task${load === 1 ? '' : 's'}</small></div><div class="tl-track" style="grid-template-columns:repeat(${days}, minmax(28px, 1fr))">${bars}</div></div>`;
  }).join('');
  return `<div class="tl">
    <p class="tl-hint">Open tasks with a due date, grouped by owner. Bars run from when a task was created to its due date. Someone with many bars may be overloaded.</p>
    <div class="tl-scroll"><div class="tl-inner" style="--tl-days:${days}">
      <div class="tl-row tl-header"><div class="tl-person"></div><div class="tl-track" style="grid-template-columns:repeat(${days}, minmax(28px, 1fr))">${header.join('')}</div></div>
      ${rows || '<div class="task-view-empty">No open tasks with due dates in this period.</div>'}
    </div></div>
  </div>`;
}
