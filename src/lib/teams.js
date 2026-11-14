// Teams inside a project: each team has a leader, members and its own tasks.
// The database (sql/project-teams.sql) enforces who may change what; the helpers
// here only mirror those rules so the screens show the right buttons.
import { supabase } from './supabase.js';

export const TEAM_COLORS = {
  blue: '#2E7CA9',
  teal: '#1f8a8a',
  green: '#2f7d4f',
  amber: '#b7791f',
  orange: '#c2541b',
  red: '#b3261e',
  pink: '#b8457a',
  purple: '#6b4fb3',
  slate: '#5d6b75'
};
export const TEAM_COLOR_NAMES = Object.keys(TEAM_COLORS);

const TEAM_SELECT = 'id, workspace_id, project_id, name, color, leader_id, sort_order, created_by, created_at, leader:users!leader_id(id, name, email, avatar_url), members:project_team_members(user_id, user:users(id, name, email, avatar_url))';

function isMissingTeamsTable(error) {
  return Boolean(error) && (error.code === '42P01' || error.code === 'PGRST205' || /project_teams/.test(error.message || ''));
}

export async function getProjectTeams(projectId) {
  const { data, error } = await supabase
    .from('project_teams')
    .select(TEAM_SELECT)
    .eq('project_id', projectId)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true });
  if (isMissingTeamsTable(error)) return { data: [], error: null, unavailable: true };
  return { data: data || [], error };
}

export async function getWorkspaceTeams(workspaceId) {
  const { data, error } = await supabase
    .from('project_teams')
    .select('id, project_id, name, color, leader_id, members:project_team_members(user_id)')
    .eq('workspace_id', workspaceId)
    .order('sort_order', { ascending: true });
  if (isMissingTeamsTable(error)) return { data: [], error: null, unavailable: true };
  return { data: data || [], error };
}

async function setTeamMembers(teamId, userIds, existing = []) {
  const wanted = new Set(userIds.filter(Boolean));
  const current = new Set(existing);
  const toAdd = [...wanted].filter((id) => !current.has(id));
  const toRemove = [...current].filter((id) => !wanted.has(id));
  if (toAdd.length) {
    const { error } = await supabase.from('project_team_members').insert(toAdd.map((user_id) => ({ team_id: teamId, user_id })));
    if (error) return { error };
  }
  if (toRemove.length) {
    const { error } = await supabase.from('project_team_members').delete().eq('team_id', teamId).in('user_id', toRemove);
    if (error) return { error };
  }
  return { error: null };
}

export async function createTeam({ workspaceId, projectId, name, color = 'blue', leaderId = null, memberIds = [], sortOrder = Date.now() % 2147483647 }) {
  const { data, error } = await supabase
    .from('project_teams')
    .insert({ workspace_id: workspaceId, project_id: projectId, name: String(name).trim().slice(0, 60), color: TEAM_COLORS[color] ? color : 'blue', leader_id: leaderId || null, sort_order: sortOrder })
    .select('id')
    .single();
  if (error) return { data: null, error };
  const members = new Set(memberIds);
  if (leaderId) members.add(leaderId);
  const { error: memberError } = await setTeamMembers(data.id, [...members]);
  return { data, error: memberError };
}

export async function updateTeam(team, { name, color, leaderId, memberIds }) {
  const { error } = await supabase
    .from('project_teams')
    .update({ name: String(name).trim().slice(0, 60), color: TEAM_COLORS[color] ? color : team.color, leader_id: leaderId || null })
    .eq('id', team.id);
  if (error) return { error };
  if (!Array.isArray(memberIds)) return { error: null };
  const members = new Set(memberIds);
  if (leaderId) members.add(leaderId);
  return setTeamMembers(team.id, [...members], (team.members || []).map((member) => member.user_id));
}

export async function deleteTeam(teamId) {
  const { error } = await supabase.from('project_teams').delete().eq('id', teamId);
  return { error };
}

// ---------- Rules mirrored from the database ----------
export function workspaceRole(members = [], userId = null, workspace = null) {
  if (workspace?.owner_id && workspace.owner_id === userId) return 'owner';
  return members.find((member) => member.user_id === userId)?.role || null;
}

export function canManageTeam(team, role, userId) {
  if (!team) return false;
  return team.leader_id === userId || role === 'owner' || role === 'admin';
}

export function canCreateTeams(role) {
  return ['owner', 'admin', 'editor'].includes(role);
}

// What the current user may do with one task.
export function taskPermissions(task, team, role, userId) {
  const editorRole = ['owner', 'admin', 'editor'].includes(role);
  if (!task?.team_id || !team) return { full: editorRole, progressOnly: false, readOnly: !editorRole };
  if (canManageTeam(team, role, userId)) return { full: true, progressOnly: false, readOnly: false };
  if (task.assignee_id === userId && editorRole) return { full: false, progressOnly: true, readOnly: false };
  return { full: false, progressOnly: false, readOnly: true };
}

// ---------- Progress ----------
export function taskProgress(task) {
  if (task?.status === 'done' || task?.completed) return 100;
  const value = Number(task?.progress);
  return Number.isFinite(value) ? Math.max(0, Math.min(100, Math.round(value))) : 0;
}

export function averageProgress(tasks = []) {
  if (!tasks.length) return 0;
  return Math.round(tasks.reduce((sum, task) => sum + taskProgress(task), 0) / tasks.length);
}

export function teamStats(team, tasks = []) {
  const own = tasks.filter((task) => task.team_id === team.id);
  const done = own.filter((task) => task.status === 'done' || task.completed).length;
  const today = new Date().toISOString().slice(0, 10);
  const overdue = own.filter((task) => task.status !== 'done' && task.due_date && task.due_date < today).length;
  return { tasks: own, total: own.length, done, open: own.length - done, overdue, percent: averageProgress(own) };
}
