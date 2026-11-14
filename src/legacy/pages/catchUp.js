// ============================================
// Home — Catch-up card: what's new since you last checked
// ============================================
import { showToast } from '../app.js';
import { supabase } from '../../lib/supabase.js';
import { escapeHtml } from '../../lib/sanitize.js';
import { resolveSince, buildCatchUp, describeWindow } from '../../lib/catchUp.js';

const MISSING = ['42P01', 'PGRST205', '42703', 'PGRST204'];

function localKey(workspaceId, userId) {
  return `groupify:catch-up-seen:${workspaceId}:${userId}`;
}

// Prefer the synced value (sql/catch-up.sql); fall back to this browser until it is installed.
async function readSeenAt(workspaceId, userId) {
  const { data, error } = await supabase.from('user_catch_up').select('seen_at').eq('workspace_id', workspaceId).eq('user_id', userId).maybeSingle();
  let local = null;
  try { local = localStorage.getItem(localKey(workspaceId, userId)); } catch { /* Storage blocked. */ }
  if (error) return { seenAt: local, synced: false };
  // Keep whichever is newer, so marking as seen before the SQL was installed still counts.
  const synced = data?.seen_at || null;
  const newest = [synced, local].filter((value) => Number.isFinite(Date.parse(value))).sort((a, b) => Date.parse(a) - Date.parse(b)).at(-1);
  return { seenAt: newest || null, synced: true };
}

async function writeSeenAt(workspaceId, userId, synced) {
  const seenAt = new Date().toISOString();
  try { localStorage.setItem(localKey(workspaceId, userId), seenAt); } catch { /* Storage blocked. */ }
  if (!synced) return { error: null };
  return supabase.from('user_catch_up').upsert({ user_id: userId, workspace_id: workspaceId, seen_at: seenAt }, { onConflict: 'user_id,workspace_id' });
}

// Each query is optional: a table or column that is not installed only hides its section.
async function optional(promise) {
  try {
    const result = await promise;
    if (result.error && !MISSING.includes(result.error.code)) console.warn('Catch-up query failed:', result.error.message);
    return result.error ? { data: [], count: 0 } : result;
  } catch (error) {
    console.warn('Catch-up query failed:', error?.message || error);
    return { data: [], count: 0 };
  }
}

export async function mountCatchUp(slot, { workspaceId, userId, tasks = [], pages = [], members = [] }) {
  if (!slot || !workspaceId || !userId) return;
  const { seenAt, synced } = await readSeenAt(workspaceId, userId);
  const range = resolveSince(seenAt);
  const { since } = range;

  const [notifications, pageEdits, meetings, messages] = await Promise.all([
    optional(supabase.from('notifications').select('id, type, payload, page_id, workspace_id, actor_id, created_at')
      .eq('recipient_id', userId).gt('created_at', since).order('created_at', { ascending: false }).limit(100)),
    optional(supabase.from('page_versions').select('page_id, replaced_by, created_at')
      .eq('workspace_id', workspaceId).gt('created_at', since).order('created_at', { ascending: false }).limit(200)),
    optional(supabase.from('meetings').select('id, title, status, ended_at, decisions, summary')
      .eq('workspace_id', workspaceId).or(`status.eq.live,ended_at.gt."${since}"`).order('created_at', { ascending: false }).limit(20)),
    optional(supabase.from('workspace_messages').select('id', { count: 'exact', head: true })
      .eq('workspace_id', workspaceId).neq('user_id', userId).gt('created_at', since))
  ]);
  if (!slot.isConnected) return;

  const names = new Map(members.map((member) => [member.user_id, member.user?.name || member.user?.email]));
  const summary = buildCatchUp({
    since, me: userId, workspaceId, tasks, pages,
    notifications: notifications.data || [],
    pageEdits: pageEdits.data || [],
    meetings: meetings.data || [],
    messageCount: messages.count || 0,
    nameOf: (id) => names.get(id) || 'A teammate'
  });
  if (!summary.sections.length) {
    slot.innerHTML = '';
    return;
  }

  slot.innerHTML = `
    <section class="catch-up" aria-labelledby="catch-up-title">
      <header class="catch-up-head">
        <div>
          <h2 id="catch-up-title"><span class="material-symbols-outlined" aria-hidden="true">mark_email_unread</span>What’s new</h2>
          <p>${escapeHtml(describeWindow(range))}</p>
        </div>
        <button type="button" class="project-btn" data-catch-up-seen><span class="material-symbols-outlined" aria-hidden="true">done_all</span> Mark all as seen</button>
      </header>
      <ul class="catch-up-list">
        ${summary.sections.map((section) => `
          <li class="catch-up-row ${section.tone ? `is-${section.tone}` : ''}">
            <span class="catch-up-icon material-symbols-outlined" aria-hidden="true">${escapeHtml(section.icon)}</span>
            <div class="catch-up-body">
              ${section.href ? `<a class="catch-up-label" href="${escapeHtml(section.href)}">${escapeHtml(section.label)}</a>` : `<strong class="catch-up-label">${escapeHtml(section.label)}</strong>`}
              <ul class="catch-up-items">
                ${section.items.map((item) => `<li><a href="${escapeHtml(item.href)}">${escapeHtml(item.text)}</a></li>`).join('')}
                ${section.count > section.items.length && section.id !== 'chat' ? `<li class="catch-up-more">+${section.count - section.items.length} more</li>` : ''}
              </ul>
            </div>
          </li>`).join('')}
      </ul>
    </section>`;

  slot.querySelector('[data-catch-up-seen]')?.addEventListener('click', async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    const { error } = await writeSeenAt(workspaceId, userId, synced);
    if (error) {
      button.disabled = false;
      return showToast(`Could not save: ${error.message}`, 'error');
    }
    slot.innerHTML = '';
    showToast('You’re all caught up', 'success');
  });
}
