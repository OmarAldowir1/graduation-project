// Supabase access for live meetings (tables from sql/meetings.sql).
import { supabase } from './supabase.js';

export const MEETING_SETUP_MESSAGE = 'Meetings need database setup. Run sql/meetings.sql in this project’s Supabase SQL editor, then reload.';
const MEETING_COLUMNS = 'id, workspace_id, project_id, title, status, agenda, current_item, item_started_at, started_at, ended_at, summary, decisions, minutes_page_id, created_by, created_at, updated_at';
const NOTE_COLUMNS = 'id, meeting_id, item_id, author_id, kind, body, created_at';

export function isMissingMeetingsTable(error) {
  return Boolean(error) && ['42P01', 'PGRST205'].includes(error.code);
}

export async function listProjectMeetings(projectId) {
  const { data, error } = await supabase.from('meetings')
    .select('id, title, status, agenda, started_at, ended_at, created_at, minutes_page_id')
    .eq('project_id', projectId)
    .order('created_at', { ascending: false })
    .limit(100);
  return { data: data || [], error };
}

export async function createMeeting({ workspaceId, projectId, title, agenda, userId }) {
  const { data, error } = await supabase.from('meetings')
    .insert({ workspace_id: workspaceId, project_id: projectId, title, agenda, created_by: userId })
    .select('id')
    .single();
  return { data, error };
}

export async function getMeeting(meetingId) {
  const { data, error } = await supabase.from('meetings').select(MEETING_COLUMNS).eq('id', meetingId).maybeSingle();
  return { data, error };
}

export async function getMeetingNotes(meetingId) {
  const { data, error } = await supabase.from('meeting_notes')
    .select(NOTE_COLUMNS)
    .eq('meeting_id', meetingId)
    .order('created_at', { ascending: true })
    .order('id', { ascending: true })
    .limit(1000);
  return { data: data || [], error };
}

// Conditional update: `match` holds extra column filters (e.g. the expected current_item)
// so two people clicking "Next" at once only advance the agenda by one step.
// Resolves with data = null when the row no longer matched.
export async function updateMeeting(meetingId, updates, match = {}) {
  let query = supabase.from('meetings').update(updates).eq('id', meetingId);
  for (const [column, value] of Object.entries(match)) query = value === null ? query.is(column, null) : query.eq(column, value);
  const { data, error } = await query.select(MEETING_COLUMNS).maybeSingle();
  return { data, error };
}

export async function addMeetingNote({ meetingId, itemId, authorId, kind, body }) {
  const { data, error } = await supabase.from('meeting_notes')
    .insert({ meeting_id: meetingId, item_id: itemId, author_id: authorId, kind, body })
    .select(NOTE_COLUMNS)
    .single();
  return { data, error };
}
