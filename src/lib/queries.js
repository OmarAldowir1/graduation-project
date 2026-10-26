// ============================================
// MOTION — Data Access Layer (Supabase Queries)
// ============================================

import { supabase } from './supabase.js';
import { saveWorkspaceInvitation } from './workspaceInvitations.js';

// ============================================
// USER QUERIES
// ============================================

export async function getUserProfile(userId) {
  const { data, error } = await supabase.from('users').select('*').eq('id', userId).single();
  return { data, error };
}

export async function updateUserProfile(userId, updates) {
  const { data, error } = await supabase
    .from('users')
    .update(updates)
    .eq('id', userId)
    .select()
    .single();
  return { data, error };
}

export async function createWorkspaceInvitation(workspaceId, email, role = 'editor', invitedBy) {
  return saveWorkspaceInvitation(supabase, workspaceId, email, role, invitedBy);
}

export async function getWorkspaceInvitations(workspaceId) {
  const { data, error } = await supabase
    .from('workspace_invitations')
    .select('id, workspace_id, email, role, token, created_at, accepted_at')
    .eq('workspace_id', workspaceId)
    .is('accepted_at', null)
    .order('created_at', { ascending: false });
  return { data: data || [], error };
}

export async function removeWorkspaceInvitation(invitationId) {
  const { error } = await supabase.from('workspace_invitations').delete().eq('id', invitationId);
  return { error };
}

export async function acceptWorkspaceInvitation(token) {
  const { data, error } = await supabase.rpc('accept_workspace_invitation', { invite_token: token });
  return { data, error };
}

// ============================================
// WORKSPACE QUERIES
// ============================================

export async function getWorkspaces() {
  const { data, error } = await supabase
    .from('workspaces')
    .select('*')
    .order('created_at', { ascending: false });
  return { data: data || [], error };
}

export async function getWorkspace(workspaceId) {
  const { data, error } = await supabase
    .from('workspaces')
    .select('*')
    .eq('id', workspaceId)
    .single();
  return { data, error };
}

export async function createWorkspace(name, ownerId) {
  const { data, error } = await supabase
    .from('workspaces')
    .insert({ name, owner_id: ownerId })
    .select()
    .single();
  return { data, error };
}

export async function updateWorkspace(workspaceId, updates) {
  const { data, error } = await supabase
    .from('workspaces')
    .update(updates)
    .eq('id', workspaceId)
    .select()
    .single();
  return { data, error };
}

// ============================================
// PAGE QUERIES
// ============================================

function isMissingColumnError(error, table, column) {
  const message = String(error?.message || '').toLowerCase();
  return (message.includes(`column ${table}.${column}`) && message.includes('does not exist')) ||
    (message.includes(`'${column}' column of '${table}'`) && message.includes('schema cache'));
}

export async function getPages(workspaceId) {
  let { data, error } = await supabase
    .from('pages')
    .select('*')
    .eq('workspace_id', workspaceId)
    .is('archived_at', null)
    .order('updated_at', { ascending: false });
  // Older shared projects may not have received the latest schema migration yet.
  // Keep the workspace usable while the missing archive column is added.
  if (isMissingColumnError(error, 'pages', 'archived_at')) {
    ({ data, error } = await supabase
      .from('pages')
      .select('*')
      .eq('workspace_id', workspaceId)
      .order('updated_at', { ascending: false }));
    data = (data || []).map((page) => ({ ...page, archived_at: null }));
  }
  return { data: data || [], error };
}

export async function getArchivedPages(workspaceId) {
  let { data, error } = await supabase
    .from('pages')
    .select('*')
    .eq('workspace_id', workspaceId)
    .not('archived_at', 'is', null)
    .order('archived_at', { ascending: false });
  if (isMissingColumnError(error, 'pages', 'archived_at')) {
    data = [];
    error = null;
  }
  return { data: data || [], error };
}

export async function getRecentPages(limit = 4, workspaceId = null) {
  let query = supabase
    .from('pages')
    .select('*, workspaces!inner(owner_id)')
    .is('archived_at', null)
    .order('updated_at', { ascending: false })
    .limit(limit);
  if (workspaceId) query = query.eq('workspace_id', workspaceId);
  let { data, error } = await query;
  if (isMissingColumnError(error, 'pages', 'archived_at')) {
    query = supabase
      .from('pages')
      .select('*, workspaces!inner(owner_id)')
      .order('updated_at', { ascending: false })
      .limit(limit);
    if (workspaceId) query = query.eq('workspace_id', workspaceId);
    ({ data, error } = await query);
    data = (data || []).map((page) => ({ ...page, archived_at: null }));
  }
  return { data: data || [], error };
}

export async function getPage(pageId) {
  const { data, error } = await supabase.from('pages').select('*').eq('id', pageId).single();
  return { data, error };
}

export async function createPage(workspaceId, title = 'Untitled', pageType = 'note', content = {}, parentId = null) {
  const { data, error } = await supabase
    .from('pages')
    .insert({
      workspace_id: workspaceId,
      // Omit the optional parent field for root pages so older schemas work.
      ...(parentId ? { parent_id: parentId } : {}),
      title,
      page_type: pageType,
      content
    })
    .select()
    .single();
  if (parentId && isMissingColumnError(error, 'pages', 'parent_id')) {
    return {
      data: null,
      error: { ...error, message: 'Nested pages require a database update. Ask the Supabase project owner to apply sql/schema.sql; you can create a root page in the meantime.' }
    };
  }
  return { data, error };
}

export async function updatePage(pageId, updates) {
  const { data, error } = await supabase
    .from('pages')
    .update(updates)
    .eq('id', pageId)
    .select()
    .single();
  return { data, error };
}

export async function togglePageFavorite(pageId, isFavorite) {
  return updatePage(pageId, { is_favorite: isFavorite });
}

export async function deletePage(pageId) {
  const { error } = await supabase.from('pages').delete().eq('id', pageId);
  return { error };
}

export async function archivePage(pageId) {
  return updatePage(pageId, { archived_at: new Date().toISOString() });
}

export async function restorePage(pageId) {
  return updatePage(pageId, { archived_at: null });
}

// ============================================
// NOTE QUERIES
// ============================================

export async function getNotes(pageId) {
  const { data, error } = await supabase
    .from('notes')
    .select('*')
    .eq('page_id', pageId)
    .order('sort_order', { ascending: true });
  return { data: data || [], error };
}

export async function createNote(pageId, content = '') {
  const { data, error } = await supabase
    .from('notes')
    .insert({ page_id: pageId, content })
    .select()
    .single();
  return { data, error };
}

export async function updateNote(noteId, content) {
  const { data, error } = await supabase
    .from('notes')
    .update({ content })
    .eq('id', noteId)
    .select()
    .single();
  return { data, error };
}

export async function deleteNote(noteId) {
  const { error } = await supabase.from('notes').delete().eq('id', noteId);
  return { error };
}

// ============================================
// TASK QUERIES
// ============================================

export async function getTasks({ workspaceId, pageId, status, limit } = {}) {
  let query = supabase
    .from('tasks')
    .select('*, assignee:users(id, name, avatar_url)')
    .order('sort_order', { ascending: true });

  if (pageId) query = query.eq('page_id', pageId);
  if (workspaceId) query = query.eq('workspace_id', workspaceId);
  if (status) query = query.eq('status', status);
  if (limit) query = query.limit(limit);

  let { data, error } = await query;
  if (isMissingColumnError(error, 'tasks', 'workspace_id')) {
    query = supabase
      .from('tasks')
      .select('*, assignee:users(id, name, avatar_url)')
      .order('sort_order', { ascending: true });
    if (pageId) query = query.eq('page_id', pageId);
    if (status) query = query.eq('status', status);
    if (limit) query = query.limit(limit);
    ({ data, error } = await query);
  }
  return { data: data || [], error };
}

export async function getTaskCounts(workspaceId) {
  let query = supabase.from('tasks').select('status, due_date');
  if (workspaceId) query = query.eq('workspace_id', workspaceId);
  let { data, error } = await query;
  if (isMissingColumnError(error, 'tasks', 'workspace_id')) {
    ({ data, error } = await supabase.from('tasks').select('status, due_date'));
  }

  if (error) return { data: { total: 0, todo: 0, in_progress: 0, done: 0, overdue: 0 }, error };

  const counts = {
    total: data.length,
    todo: data.filter((t) => t.status === 'todo').length,
    in_progress: data.filter((t) => t.status === 'in_progress').length,
    done: data.filter((t) => t.status === 'done').length,
    overdue: data.filter((t) => t.status !== 'done' && t.due_date && new Date(`${t.due_date}T23:59:59`) < new Date()).length
  };
  return { data: counts, error: null };
}

export async function createTask(
  title,
  { workspaceId, pageId, status = 'todo', priority = 'medium', assigneeId, dueDate, tags, sortOrder = Date.now() } = {}
) {
  const { data, error } = await supabase
    .from('tasks')
    .insert({
      title,
      workspace_id: workspaceId || null,
      page_id: pageId || null,
      status,
      priority,
      assignee_id: assigneeId || null,
      due_date: dueDate || null,
      tags: tags || [],
      sort_order: sortOrder
    })
    .select('*, assignee:users(id, name, avatar_url)')
    .single();
  return { data, error };
}

export async function updateTask(taskId, updates) {
  const nextUpdates = { ...updates };
  if (Object.hasOwn(nextUpdates, 'status')) {
    nextUpdates.completed = nextUpdates.status === 'done';
  }
  const { data, error } = await supabase
    .from('tasks')
    .update(nextUpdates)
    .eq('id', taskId)
    .select('*, assignee:users(id, name, avatar_url)')
    .single();
  return { data, error };
}

export async function toggleTask(taskId, completed) {
  return updateTask(taskId, {
    completed,
    status: completed ? 'done' : 'todo'
  });
}

export async function deleteTask(taskId) {
  const { error } = await supabase.from('tasks').delete().eq('id', taskId);
  return { error };
}

// ============================================
// COLLABORATION QUERIES
// ============================================

export async function getWorkspaceMembers(workspaceId) {
  const { data, error } = await supabase
    .from('workspace_members')
    .select('id, workspace_id, user_id, role, created_at, user:users(id, name, email, avatar_url)')
    .eq('workspace_id', workspaceId)
    .order('created_at', { ascending: true });
  return { data: data || [], error };
}

export async function inviteWorkspaceMember(workspaceId, userId, role = 'editor') {
  const { data, error } = await supabase
    .from('workspace_members')
    .insert({ workspace_id: workspaceId, user_id: userId, role })
    .select('id, workspace_id, user_id, role, created_at, user:users(id, name, email, avatar_url)')
    .single();
  return { data, error };
}

export async function updateWorkspaceMember(memberId, updates) {
  const { data, error } = await supabase
    .from('workspace_members')
    .update(updates)
    .eq('id', memberId)
    .select('id, workspace_id, user_id, role, created_at, user:users(id, name, email, avatar_url)')
    .single();
  return { data, error };
}

export async function removeWorkspaceMember(memberId) {
  const { error } = await supabase.from('workspace_members').delete().eq('id', memberId);
  return { error };
}

export async function getComments(pageId) {
  const { data, error } = await supabase
    .from('comments')
    .select('*, author:users(id, name, avatar_url)')
    .eq('page_id', pageId)
    .order('created_at', { ascending: true });
  return { data: data || [], error };
}

export async function createComment(pageId, content, parentId = null) {
  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError || !authData?.user) return { data: null, error: authError || { message: 'Sign in to post a comment.' } };
  const { data, error } = await supabase
    .from('comments')
    .insert({ page_id: pageId, user_id: authData.user.id, content, parent_id: parentId })
    .select('*, author:users(id, name, avatar_url)')
    .single();
  return { data, error };
}

export async function updateComment(commentId, content) {
  const { data, error } = await supabase
    .from('comments')
    .update({ content })
    .eq('id', commentId)
    .select('*, author:users(id, name, avatar_url)')
    .single();
  return { data, error };
}

export async function deleteComment(commentId) {
  const { error } = await supabase.from('comments').delete().eq('id', commentId);
  return { error };
}

export async function getNotifications(limit = 25) {
  const { data, error } = await supabase
    .from('notifications')
    .select('*, actor:users(id, name, avatar_url)')
    .order('created_at', { ascending: false })
    .limit(limit);
  return { data: data || [], error };
}

export async function markNotificationRead(notificationId) {
  const { data, error } = await supabase
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('id', notificationId)
    .select()
    .single();
  return { data, error };
}

export async function markAllNotificationsRead() {
  const { error } = await supabase
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .is('read_at', null);
  return { error };
}

// ============================================
// SETTINGS QUERIES
// ============================================

export async function getSettings(userId) {
  const { data, error } = await supabase.from('settings').select('*').eq('user_id', userId).single();
  return { data, error };
}

export async function updateSettings(userId, updates) {
  const { data, error } = await supabase
    .from('settings')
    .upsert({ user_id: userId, ...updates }, { onConflict: 'user_id' })
    .select()
    .single();
  return { data, error };
}

export async function updatePreferences(userId, preferences) {
  const { data: current } = await getSettings(userId);
  const merged = { ...current?.preferences, ...preferences };
  return updateSettings(userId, { preferences: merged });
}

// ============================================
// UTILITY: Relative time formatting
// ============================================

export function timeAgo(timestamp) {
  const now = new Date();
  const then = new Date(timestamp);
  const seconds = Math.floor((now - then) / 1000);

  if (seconds < 60) return 'Just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;
  return then.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}
