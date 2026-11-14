// Weekly check-ins: three short answers per person, per project, per week
// (weeks start on Monday). Table and rules: sql/checkins.sql.
import { supabase } from './supabase.js';

export const MOODS = {
  3: { emoji: '😀', label: 'Going well' },
  2: { emoji: '😐', label: 'Okay' },
  1: { emoji: '😫', label: 'Struggling' }
};

const pad = (value) => String(value).padStart(2, '0');
export function dateKey(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

// Monday of the week that contains `date` (local time).
export function weekStart(date = new Date()) {
  const day = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const offset = (day.getDay() + 6) % 7; // Monday = 0
  day.setDate(day.getDate() - offset);
  return dateKey(day);
}

export function shiftWeek(week, by) {
  const [year, month, day] = week.split('-').map(Number);
  return dateKey(new Date(year, month - 1, day + by * 7));
}

export function weekLabel(week) {
  const [year, month, day] = week.split('-').map(Number);
  const start = new Date(year, month - 1, day);
  const end = new Date(year, month - 1, day + 6);
  const fmt = (date) => date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  return `${fmt(start)} – ${fmt(end)}`;
}

function isMissingTable(error) {
  return Boolean(error) && (error.code === '42P01' || error.code === 'PGRST205' || /project_checkins/.test(error.message || ''));
}

export async function getCheckins({ projectId, weeks }) {
  const { data, error } = await supabase
    .from('project_checkins')
    .select('id, project_id, user_id, week_start, mood, done, next, blockers, created_at, updated_at, user:users(id, name, email, avatar_url)')
    .eq('project_id', projectId)
    .in('week_start', weeks)
    .order('updated_at', { ascending: false });
  if (isMissingTable(error)) return { data: [], error: null, unavailable: true };
  return { data: data || [], error };
}

export async function getMyCheckinsForWeek(workspaceId, userId, week = weekStart()) {
  const { data, error } = await supabase
    .from('project_checkins')
    .select('project_id')
    .eq('workspace_id', workspaceId)
    .eq('user_id', userId)
    .eq('week_start', week);
  if (isMissingTable(error)) return { data: [], unavailable: true };
  return { data: data || [], error };
}

export async function saveCheckin({ workspaceId, projectId, userId, week = weekStart(), mood = null, done = '', next = '', blockers = '' }) {
  const row = { workspace_id: workspaceId, project_id: projectId, user_id: userId, week_start: week, mood: mood || null, done, next, blockers };
  const { data, error } = await supabase
    .from('project_checkins')
    .upsert(row, { onConflict: 'project_id,user_id,week_start' })
    .select('id')
    .single();
  return { data, error };
}

export async function deleteCheckin(id) {
  const { error } = await supabase.from('project_checkins').delete().eq('id', id);
  return { error };
}

// Who is expected to check in for a project: people with open tasks in it, plus
// the members and leaders of its teams.
export function expectedPeople(projectTasks = [], teams = []) {
  const ids = new Set();
  projectTasks.forEach((task) => { if (task.assignee_id && task.status !== 'done' && !task.completed) ids.add(task.assignee_id); });
  teams.forEach((team) => {
    if (team.leader_id) ids.add(team.leader_id);
    (team.members || []).forEach((member) => member.user_id && ids.add(member.user_id));
  });
  return ids;
}

export function blockersOf(checkins = []) {
  return checkins.filter((checkin) => checkin.blockers && checkin.blockers.trim());
}
