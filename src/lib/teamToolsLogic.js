// Pure calculations for team tools (no database), so they can be unit-tested.

const DAY = 86400000;

export function todayKey(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

// Deadline health: compare progress with the share of time used up.
// Returns { status: 'none'|'done'|'on_track'|'at_risk'|'behind', label, detail, next, finalDate, expected, actual }.
export function deadlineHealth({ milestones = [], progress = 0, projectStart, today = todayKey() }) {
  const open = milestones.filter((milestone) => !milestone.done_at);
  if (!milestones.length) return { status: 'none', label: 'No milestones yet', detail: 'Add key dates to see if you’re on track.' };
  if (!open.length) return { status: 'done', label: 'All milestones done', detail: 'Every key date has been reached. 🎉' };
  const next = open[0];
  const finalDate = milestones[milestones.length - 1].due_date;
  const overdue = open.filter((milestone) => milestone.due_date < today);
  const start = new Date(`${String(projectStart || today).slice(0, 10)}T00:00`).getTime();
  const end = new Date(`${finalDate}T00:00`).getTime();
  const now = new Date(`${today}T00:00`).getTime();
  const expected = end > start ? Math.max(0, Math.min(100, Math.round(((now - start) / (end - start)) * 100))) : 100;
  const actual = Math.max(0, Math.min(100, Math.round(progress)));
  const daysToNext = Math.round((new Date(`${next.due_date}T00:00`).getTime() - now) / DAY);
  const nextText = overdue.length
    ? `“${overdue[0].title}” was due ${Math.abs(Math.round((new Date(`${overdue[0].due_date}T00:00`).getTime() - now) / DAY))} day(s) ago`
    : daysToNext === 0 ? `“${next.title}” is due today` : `Next: “${next.title}” in ${daysToNext} day(s)`;
  let status = 'on_track';
  if (overdue.length || actual < expected - 25) status = 'behind';
  else if (actual < expected - 10) status = 'at_risk';
  const label = { on_track: 'On track', at_risk: 'At risk', behind: 'Behind' }[status];
  return { status, label, detail: `${actual}% done, ${expected}% of the time used · ${nextText}`, next, finalDate, expected, actual, overdue: overdue.length };
}

export function pollResults(poll) {
  const options = Array.isArray(poll?.options) ? poll.options : [];
  const counts = options.map((_, index) => (poll.votes || []).filter((entry) => entry.option_index === index).length);
  const total = counts.reduce((sum, count) => sum + count, 0);
  const top = Math.max(0, ...counts);
  const winners = top > 0 ? counts.map((count, index) => (count === top ? index : -1)).filter((index) => index >= 0) : [];
  return { options, counts, total, winners };
}

export function isSafeUrl(url) {
  return /^https?:\/\/[^\s]+$/i.test(String(url || '').trim());
}

// Who may change something someone added: the author or the team owner/admins.
export function canManageItem(item, { userId, role }) {
  return Boolean(item) && (item.created_by === userId || role === 'owner' || role === 'admin');
}

export function canAdd(role) {
  return ['owner', 'admin', 'editor'].includes(role);
}

// "Catch me up": what changed since the user last looked, most useful first.
// Returns [{ kind, icon, title, items: [{ text, href }], tone }].
export function catchUpItems({ tasks = [], updates = {}, me, since, today = todayKey(), projectTitle = () => '', projectOf = () => null }) {
  const sinceTime = new Date(since).getTime();
  const after = (value) => Boolean(value) && new Date(value).getTime() >= sinceTime;
  const isOpen = (task) => task.status !== 'done' && !task.completed;
  const where = (projectId) => (projectTitle(projectId) ? ` · ${projectTitle(projectId)}` : '');
  const taskHref = (task) => `#kanban?task=${encodeURIComponent(task.id)}`;
  const groups = [];
  const add = (kind, icon, title, items, tone = '') => { if (items.length) groups.push({ kind, icon, title, items, tone }); };

  add('assigned', 'assignment_ind', 'New tasks for you',
    tasks.filter((task) => task.assignee_id === me && isOpen(task) && after(task.created_at) && task.created_by && task.created_by !== me)
      .map((task) => ({ text: `${task.title}${task.due_date ? ` · due ${task.due_date}` : ''}`, href: taskHref(task) })), 'warn');
  add('blockers', 'block', 'Teammates are blocked',
    (updates.blockers || []).filter((row) => row.user_id !== me)
      .map((row) => ({ text: `${row.user?.name || row.user?.email?.split('@')[0] || 'A teammate'}: ${row.blockers}${where(row.project_id)}`, href: `#project/${row.project_id}/checkins` })), 'bad');
  add('polls', 'how_to_vote', 'Polls waiting for your vote',
    (updates.polls || []).filter((poll) => !(poll.votes || []).some((entry) => entry.user_id === me))
      .map((poll) => ({ text: `${poll.question}${where(poll.project_id)}`, href: `#project/${poll.project_id}/decisions` })));
  const soon = todayKey(new Date(new Date(`${today}T00:00`).getTime() + 14 * DAY));
  add('milestones', 'flag', 'Milestones coming up',
    (updates.milestones || []).filter((milestone) => milestone.due_date <= soon)
      .map((milestone) => ({ text: `${milestone.due_date < today ? 'LATE · ' : ''}${milestone.title} · ${milestone.due_date}${where(milestone.project_id)}`, href: `#project/${milestone.project_id}` })), (updates.milestones || []).some((milestone) => milestone.due_date < today) ? 'bad' : '');
  add('decisions', 'gavel', 'Decisions made',
    (updates.decisions || []).filter((decision) => decision.created_by !== me)
      .map((decision) => ({ text: `${decision.title}${where(decision.project_id)}`, href: `#project/${decision.project_id}/decisions` })));
  add('finished', 'task_alt', 'Finished by teammates',
    tasks.filter((task) => !isOpen(task) && after(task.completed_at) && (task.completed_by || task.assignee_id) !== me)
      .sort((a, b) => String(b.completed_at).localeCompare(String(a.completed_at)))
      .map((task) => ({ text: `${task.title}${where(projectOf(task))}`, href: taskHref(task) })), 'good');
  return groups;
}
