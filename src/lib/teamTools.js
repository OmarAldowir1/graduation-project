// Team tools for a project: milestones (with deadline health), decisions, polls and
// resources. Tables and permission rules: sql/team-tools.sql.
import { supabase } from './supabase.js';
import { cachedRead, invalidateQueryCache } from './queries.js';
import { pollResults, isSafeUrl } from './teamToolsLogic.js';

export { todayKey, deadlineHealth, pollResults, isSafeUrl, canManageItem, canAdd, catchUpItems } from './teamToolsLogic.js';

function isMissingTable(error) {
  return Boolean(error) && (error.code === '42P01' || error.code === 'PGRST205' || /project_(milestones|decisions|polls|poll_votes|resources)/.test(error.message || ''));
}

function list(table, projectId, select, order) {
  return cachedRead(`teamtools:${table}:${projectId}`, async () => {
    const { data, error } = await supabase.from(table).select(select).eq('project_id', projectId).order(order.column, { ascending: order.ascending });
    if (isMissingTable(error)) return { data: [], error: null, unavailable: true };
    return { data: data || [], error };
  });
}

function changed() {
  invalidateQueryCache('teamtools');
}

// ---------- Milestones ----------
export function getMilestones(projectId) {
  return list('project_milestones', projectId, 'id, workspace_id, project_id, title, due_date, done_at, created_by, created_at', { column: 'due_date', ascending: true });
}

export async function createMilestone({ workspaceId, projectId, title, dueDate }) {
  changed();
  return supabase.from('project_milestones').insert({ workspace_id: workspaceId, project_id: projectId, title: String(title).trim().slice(0, 120), due_date: dueDate }).select('id').single();
}

export async function updateMilestone(id, updates) {
  changed();
  const row = {};
  if (updates.title !== undefined) row.title = String(updates.title).trim().slice(0, 120);
  if (updates.dueDate !== undefined) row.due_date = updates.dueDate;
  if (updates.done !== undefined) row.done_at = updates.done ? new Date().toISOString() : null;
  return supabase.from('project_milestones').update(row).eq('id', id);
}

export async function deleteMilestone(id) {
  changed();
  return supabase.from('project_milestones').delete().eq('id', id);
}

// ---------- Decisions ----------
export function getDecisions(projectId) {
  return list('project_decisions', projectId, 'id, workspace_id, project_id, title, details, poll_id, created_by, created_at, author:users!created_by(id, name, email)', { column: 'created_at', ascending: false });
}

export async function createDecision({ workspaceId, projectId, title, details = '', pollId = null }) {
  changed();
  return supabase.from('project_decisions').insert({ workspace_id: workspaceId, project_id: projectId, title: String(title).trim().slice(0, 200), details: String(details || '').trim().slice(0, 2000), poll_id: pollId }).select('id').single();
}

export async function deleteDecision(id) {
  changed();
  return supabase.from('project_decisions').delete().eq('id', id);
}

// ---------- Polls ----------
export function getPolls(projectId) {
  return list('project_polls', projectId, 'id, workspace_id, project_id, question, options, closed_at, created_by, created_at, author:users!created_by(id, name, email), votes:project_poll_votes(user_id, option_index)', { column: 'created_at', ascending: false });
}

export async function createPoll({ workspaceId, projectId, question, options }) {
  changed();
  const clean = options.map((option) => String(option).trim().slice(0, 80)).filter(Boolean).slice(0, 6);
  return supabase.from('project_polls').insert({ workspace_id: workspaceId, project_id: projectId, question: String(question).trim().slice(0, 200), options: clean }).select('id').single();
}

export async function vote(pollId, userId, optionIndex) {
  changed();
  return supabase.from('project_poll_votes').upsert({ poll_id: pollId, user_id: userId, option_index: optionIndex }, { onConflict: 'poll_id,user_id' });
}

export async function removeVote(pollId, userId) {
  changed();
  return supabase.from('project_poll_votes').delete().eq('poll_id', pollId).eq('user_id', userId);
}

// Closing a poll records the result as a decision (unless it's a tie or nobody voted).
export async function closePoll(poll, { workspaceId }) {
  changed();
  const { error } = await supabase.from('project_polls').update({ closed_at: new Date().toISOString() }).eq('id', poll.id);
  if (error) return { error };
  const { options, counts, total, winners } = pollResults(poll);
  if (winners.length !== 1) return { error: null, decision: null, tie: winners.length > 1, empty: total === 0 };
  const winner = options[winners[0]];
  const { error: decisionError } = await createDecision({
    workspaceId,
    projectId: poll.project_id,
    title: `${poll.question} → ${winner}`,
    details: `Decided by poll: ${options.map((option, index) => `${option} (${counts[index]})`).join(', ')}.`,
    pollId: poll.id
  });
  return { error: decisionError, decision: winner };
}

export async function deletePoll(id) {
  changed();
  return supabase.from('project_polls').delete().eq('id', id);
}

// ---------- Resources ----------
export function getResources(projectId) {
  return list('project_resources', projectId, 'id, workspace_id, project_id, title, url, note, tag, created_by, created_at, author:users!created_by(id, name, email)', { column: 'created_at', ascending: false });
}

export async function createResource({ workspaceId, projectId, title, url = '', note = '', tag = '' }) {
  changed();
  const cleanUrl = String(url || '').trim();
  if (cleanUrl && !isSafeUrl(cleanUrl)) return { error: { message: 'Links must start with http:// or https://' } };
  return supabase.from('project_resources').insert({ workspace_id: workspaceId, project_id: projectId, title: String(title).trim().slice(0, 200), url: cleanUrl, note: String(note || '').trim().slice(0, 1000), tag: String(tag || '').trim().slice(0, 40) }).select('id').single();
}

export async function deleteResource(id) {
  changed();
  return supabase.from('project_resources').delete().eq('id', id);
}

// ---------- Catch me up (whole workspace, since a moment in time) ----------
// Decisions made, open polls (with votes) and milestones that are not reached yet.
export async function getWorkspaceUpdates(workspaceId, sinceIso) {
  const [decisions, polls, milestones, blockers] = await Promise.all([
    supabase.from('project_decisions').select('id, project_id, title, created_by, created_at').eq('workspace_id', workspaceId).gte('created_at', sinceIso).order('created_at', { ascending: false }).limit(20),
    supabase.from('project_polls').select('id, project_id, question, created_by, created_at, votes:project_poll_votes(user_id)').eq('workspace_id', workspaceId).is('closed_at', null).order('created_at', { ascending: false }).limit(20),
    supabase.from('project_milestones').select('id, project_id, title, due_date').eq('workspace_id', workspaceId).is('done_at', null).order('due_date', { ascending: true }).limit(20),
    supabase.from('project_checkins').select('id, project_id, user_id, blockers, created_at, user:users!user_id(id, name, email)').eq('workspace_id', workspaceId).neq('blockers', '').is('blocker_resolved_at', null).gte('updated_at', sinceIso).limit(20)
  ]);
  const rows = (result) => (result.error ? [] : result.data || []);
  return { decisions: rows(decisions), polls: rows(polls), milestones: rows(milestones), blockers: rows(blockers) };
}
