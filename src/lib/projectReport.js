// Project progress report: the app calculates every number (so they're always right),
// the AI only writes a short summary and advice, and the result is saved as a page
// inside the project that can be edited, shared or posted in chat.
import { supabase } from './supabase.js';
import { createPage, updatePage } from './queries.js';
import { chatWithMotionAI } from './motionAI.js';
import { markdownToHtml } from './markdown.js';
import { escapeHtml } from './sanitize.js';
import { averageProgress, taskProgress } from './teams.js';

const DAY = 86400000;

function dateKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function shortDate(value) {
  if (!value) return '';
  const date = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T00:00`) : new Date(value);
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function bar(percent) {
  const filled = Math.round(percent / 10);
  return `${'▰'.repeat(filled)}${'▱'.repeat(10 - filled)} ${percent}%`;
}

const isDone = (task) => task.status === 'done' || task.completed;

// ---------- 1. Facts (pure calculation) ----------
export function buildReportFacts({ project, tasks, teams = [], members = [], comments = [], days = 7, now = new Date() }) {
  const since = new Date(now.getTime() - days * DAY);
  const today = dateKey(now);
  const soon = dateKey(new Date(now.getTime() + 7 * DAY));
  const nameOf = (userId) => {
    const member = members.find((item) => item.user_id === userId);
    return member?.user?.name || member?.user?.email?.split('@')[0] || (userId ? 'Former member' : 'No owner');
  };
  const teamOf = (task) => teams.find((team) => team.id === task.team_id) || null;

  const open = tasks.filter((task) => !isDone(task));
  const doneInPeriod = tasks
    .filter((task) => isDone(task) && task.completed_at && new Date(task.completed_at) >= since)
    .sort((a, b) => String(b.completed_at).localeCompare(String(a.completed_at)));
  const overdue = open.filter((task) => task.due_date && task.due_date < today)
    .sort((a, b) => a.due_date.localeCompare(b.due_date));
  const unassigned = open.filter((task) => !task.assignee_id);
  const upcoming = open.filter((task) => task.due_date && task.due_date >= today && task.due_date <= soon)
    .sort((a, b) => a.due_date.localeCompare(b.due_date));
  const inProgress = open.filter((task) => task.status === 'in_progress')
    .sort((a, b) => taskProgress(b) - taskProgress(a));
  const createdInPeriod = tasks.filter((task) => task.created_at && new Date(task.created_at) >= since).length;

  const teamRows = teams.map((team) => {
    const own = tasks.filter((task) => task.team_id === team.id);
    return {
      name: team.name,
      leader: team.leader?.name || team.leader?.email || nameOf(team.leader_id),
      percent: averageProgress(own),
      done: own.filter(isDone).length,
      total: own.length,
      overdue: own.filter((task) => !isDone(task) && task.due_date && task.due_date < today).length
    };
  });

  // Contributions in the period: tasks finished (by who finished it, else the owner) and comments.
  const people = new Map();
  const bump = (userId, key) => {
    if (!userId) return;
    const row = people.get(userId) || { name: nameOf(userId), finished: 0, comments: 0, open: 0 };
    row[key] += 1;
    people.set(userId, row);
  };
  doneInPeriod.forEach((task) => bump(task.completed_by || task.assignee_id, 'finished'));
  comments.filter((comment) => new Date(comment.created_at) >= since).forEach((comment) => bump(comment.user_id, 'comments'));
  open.forEach((task) => bump(task.assignee_id, 'open'));
  const contributions = [...people.values()].sort((a, b) => (b.finished - a.finished) || (b.comments - a.comments) || (b.open - a.open));

  const row = (task) => ({
    title: task.title || 'Untitled task',
    owner: nameOf(task.assignee_id),
    team: teamOf(task)?.name || '',
    due: task.due_date || '',
    progress: taskProgress(task),
    completedAt: task.completed_at || '',
    lateDays: task.due_date && task.due_date < today ? Math.round((new Date(`${today}T00:00`) - new Date(`${task.due_date}T00:00`)) / DAY) : 0
  });

  return {
    project: project.title || 'Untitled project',
    days,
    from: dateKey(since),
    to: today,
    overall: averageProgress(tasks),
    totals: { tasks: tasks.length, done: tasks.filter(isDone).length, open: open.length, doneInPeriod: doneInPeriod.length, createdInPeriod, overdue: overdue.length, unassigned: unassigned.length },
    teams: teamRows,
    done: doneInPeriod.map(row),
    inProgress: inProgress.map(row),
    overdue: overdue.map(row),
    unassigned: unassigned.map(row),
    upcoming: upcoming.map(row),
    contributions
  };
}

// ---------- 2. AI summary (optional; the report works without it) ----------
function factsAsText(facts) {
  const list = (items, format, max = 12) => (items.length ? items.slice(0, max).map(format).join('\n') : '- none');
  return [
    `PROJECT: ${facts.project}`,
    `PERIOD: last ${facts.days} days (${facts.from} to ${facts.to})`,
    `OVERALL PROGRESS: ${facts.overall}% · ${facts.totals.done}/${facts.totals.tasks} tasks done · ${facts.totals.doneInPeriod} finished this period · ${facts.totals.createdInPeriod} new · ${facts.totals.overdue} overdue · ${facts.totals.unassigned} without an owner`,
    'TEAMS:', list(facts.teams, (t) => `- ${t.name} (leader ${t.leader}): ${t.percent}%, ${t.done}/${t.total} done, ${t.overdue} overdue`),
    'FINISHED THIS PERIOD:', list(facts.done, (t) => `- ${t.title} by ${t.owner}${t.team ? ` (${t.team})` : ''}`),
    'IN PROGRESS:', list(facts.inProgress, (t) => `- ${t.title}: ${t.progress}%, owner ${t.owner}${t.due ? `, due ${t.due}` : ''}`),
    'OVERDUE:', list(facts.overdue, (t) => `- ${t.title}: ${t.lateDays} days late, owner ${t.owner}`),
    'NO OWNER:', list(facts.unassigned, (t) => `- ${t.title}`),
    'DUE IN THE NEXT 7 DAYS:', list(facts.upcoming, (t) => `- ${t.title}: due ${t.due}, owner ${t.owner}`),
    'CONTRIBUTIONS THIS PERIOD:', list(facts.contributions, (p) => `- ${p.name}: finished ${p.finished}, comments ${p.comments}, open tasks ${p.open}`)
  ].join('\n');
}

const SUMMARY_PROMPT = `Write the opening of a short progress report for a student project team and their supervisor, using ONLY the attached facts.
Return Markdown with exactly two parts and nothing else:
1. A heading "### Summary" followed by 2–3 sentences: overall status (on track / at risk / behind) and the most important change this period.
2. A heading "### Recommended next steps" followed by 2–4 bullet points with concrete, practical actions (who should do what), focused on overdue work, tasks without an owner, and slow teams.
Do not repeat full task lists, do not invent people, tasks or numbers, and keep it under 150 words.`;

export async function writeReportSummary(facts) {
  return chatWithMotionAI({
    newUserPrompt: SUMMARY_PROMPT,
    attachedFile: { name: `${facts.project} report facts`, content: factsAsText(facts) }
  });
}

// ---------- 3. Page HTML ----------
export function renderReportHtml(facts, { summaryMarkdown = '', author = '' } = {}) {
  const e = escapeHtml;
  const items = (rows, format, empty) => (rows.length ? `<ul>${rows.map((row) => `<li>${format(row)}</li>`).join('')}</ul>` : `<p><em>${e(empty)}</em></p>`);
  const parts = [];
  parts.push(`<p><em>Period: ${e(shortDate(facts.from))} – ${e(shortDate(facts.to))} (${facts.days} days)${author ? ` · Generated by ${e(author)}` : ''} · Numbers are calculated by Groupify; the summary is written by AI.</em></p>`);
  parts.push(summaryMarkdown
    ? markdownToHtml(summaryMarkdown)
    : '<h3>Summary</h3><p><em>The AI summary isn’t available right now. All numbers below are complete.</em></p>');

  parts.push('<h2>📈 At a glance</h2>');
  parts.push(`<p><strong>Overall progress:</strong> ${e(bar(facts.overall))}</p>`);
  parts.push(`<ul><li><strong>${facts.totals.done}/${facts.totals.tasks}</strong> tasks done</li><li><strong>${facts.totals.doneInPeriod}</strong> finished in this period · <strong>${facts.totals.createdInPeriod}</strong> new</li><li><strong>${facts.totals.overdue}</strong> overdue · <strong>${facts.totals.unassigned}</strong> without an owner</li></ul>`);

  if (facts.teams.length) {
    parts.push('<h2>👥 Teams</h2>');
    parts.push(items(facts.teams, (t) => `<strong>${e(t.name)}</strong> — ${e(bar(t.percent))} · ${t.done}/${t.total} done${t.overdue ? ` · ⚠️ ${t.overdue} overdue` : ''} · led by ${e(t.leader)}`, ''));
  }

  parts.push('<h2>✅ Finished this period</h2>');
  parts.push(items(facts.done, (t) => `${e(t.title)} — <strong>${e(t.owner)}</strong>${t.team ? ` (${e(t.team)})` : ''}${t.completedAt ? ` · ${e(shortDate(t.completedAt))}` : ''}`, 'Nothing was finished in this period.'));

  parts.push('<h2>🔄 In progress</h2>');
  parts.push(items(facts.inProgress.slice(0, 15), (t) => `${e(t.title)} — ${e(t.owner)} · ${t.progress}%${t.due ? ` · due ${e(shortDate(t.due))}` : ''}`, 'No tasks are marked in progress.'));

  parts.push('<h2>⚠️ Needs attention</h2>');
  const attention = [
    ...facts.overdue.map((t) => `<strong>Overdue ${t.lateDays} day${t.lateDays === 1 ? '' : 's'}:</strong> ${e(t.title)} — ${e(t.owner)}`),
    ...facts.unassigned.slice(0, 10).map((t) => `<strong>No owner:</strong> ${e(t.title)}`)
  ];
  parts.push(attention.length ? `<ul>${attention.map((line) => `<li>${line}</li>`).join('')}</ul>` : '<p><em>Nothing overdue and every open task has an owner. 🎉</em></p>');

  parts.push('<h2>➡️ Coming up (next 7 days)</h2>');
  parts.push(items(facts.upcoming, (t) => `${e(t.title)} — ${e(t.owner)} · due ${e(shortDate(t.due))}`, 'Nothing is due in the next 7 days.'));

  parts.push('<h2>🙌 Contributions this period</h2>');
  parts.push(items(facts.contributions, (p) => `<strong>${e(p.name)}</strong> — ${p.finished} task${p.finished === 1 ? '' : 's'} finished · ${p.comments} comment${p.comments === 1 ? '' : 's'} · ${p.open} open`, 'No activity recorded in this period.'));
  return parts.join('');
}

// ---------- 4. Whole flow ----------
async function loadComments(taskIds, pageIds) {
  const [taskComments, pageComments] = await Promise.all([
    taskIds.length ? supabase.from('task_comments').select('user_id, created_at').in('task_id', taskIds.slice(0, 300)) : Promise.resolve({ data: [] }),
    pageIds.length ? supabase.from('comments').select('user_id, created_at').in('page_id', pageIds.slice(0, 300)) : Promise.resolve({ data: [] })
  ]);
  return [...(taskComments.data || []), ...(pageComments.data || [])];
}

export async function generateProjectReport({ workspaceId, project, tasks, teams, members, pageIds = [], days = 7, author = '', useAI = true }) {
  const comments = await loadComments(tasks.map((task) => task.id), pageIds);
  const facts = buildReportFacts({ project, tasks, teams, members, comments, days });
  let summaryMarkdown = '';
  let aiError = '';
  if (useAI) {
    try { summaryMarkdown = await writeReportSummary(facts); } catch (error) { aiError = error?.message || 'AI unavailable'; }
  }
  const html = renderReportHtml(facts, { summaryMarkdown, author });
  const title = `Progress report · ${shortDate(facts.to)}`;
  const { data: page, error } = await createPage(workspaceId, title, 'note', { html }, project.id);
  if (error) throw error;
  await updatePage(page.id, { icon: '📊' });
  return { page, facts, aiError };
}
