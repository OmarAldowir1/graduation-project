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

// ---------- Library file uploads (mirrors the bucket rules in sql/project-files.sql) ----------
export const MAX_FILE_BYTES = 25 * 1024 * 1024;
const FILE_TYPES = {
  pdf: 'application/pdf',
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif',
  txt: 'text/plain', csv: 'text/csv', md: 'text/markdown',
  doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  zip: 'application/zip'
};
export const FILE_ACCEPT = Object.keys(FILE_TYPES).map((ext) => `.${ext}`).join(',');

function extensionOf(name = '') {
  const match = /\.([a-z0-9]{1,8})$/i.exec(String(name));
  return match ? match[1].toLowerCase() : '';
}

// Returns { ok, type, error }: the content type to store, or why the file can't be uploaded.
export function checkUploadFile(file) {
  if (!file) return { ok: false, error: 'Choose a file first.' };
  if (!file.size) return { ok: false, error: 'This file is empty.' };
  if (file.size > MAX_FILE_BYTES) return { ok: false, error: `Files can be up to 25 MB (this one is ${formatBytes(file.size)}).` };
  const type = FILE_TYPES[extensionOf(file.name)];
  if (!type) return { ok: false, error: 'This file type isn’t supported. Use PDF, Word, Excel, PowerPoint, images, text, CSV or ZIP.' };
  return { ok: true, type };
}

// A storage-safe name that keeps the extension: "Final Report (v2).pdf" → "Final-Report-v2.pdf".
export function safeFileName(name = 'file') {
  const last = String(name).split(/[\\/]/).pop();
  const ext = extensionOf(last);
  const base = last.replace(/\.[^.]*$/, '').normalize('NFKD').replace(/[^\w-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 80) || 'file';
  return ext ? `${base}.${ext}` : base;
}

export function formatBytes(bytes = 0) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

// Icon for a file in the Library.
export function fileIcon(name = '') {
  const ext = extensionOf(name);
  if (ext === 'pdf') return 'picture_as_pdf';
  if (['jpg', 'jpeg', 'png', 'webp', 'gif'].includes(ext)) return 'image';
  if (['xls', 'xlsx', 'csv'].includes(ext)) return 'table_chart';
  if (['ppt', 'pptx'].includes(ext)) return 'slideshow';
  if (ext === 'zip') return 'folder_zip';
  return 'description';
}
