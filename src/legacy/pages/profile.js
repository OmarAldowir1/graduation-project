// ============================================
// GROUPIFY — Profile page
// An overview of you in the current team. Editing happens in Settings › My account.
// ============================================

import { AppState, setBreadcrumb } from '../app.js';
import { getUserProfile, getRecentPages, getTasks, getWorkspaceMembers, timeAgo } from '../../lib/queries.js';
import { escapeHtml } from '../../lib/sanitize.js';

const ROLE_LABEL = { owner: 'Owner', admin: 'Admin', editor: 'Editor', commenter: 'Commenter', viewer: 'Viewer' };

export async function renderProfile(container) {
  setBreadcrumb('Profile');

  const userId = AppState.user?.id;
  if (!userId) return;
  const workspaceId = AppState.workspace?.id;

  const [profileResult, pagesResult, tasksResult, membersResult] = await Promise.all([
    getUserProfile(userId),
    getRecentPages(4, workspaceId),
    workspaceId ? getTasks({ workspaceId }) : Promise.resolve({ data: [] }),
    workspaceId ? getWorkspaceMembers(workspaceId) : Promise.resolve({ data: [] })
  ]);

  const loadError = profileResult.error || pagesResult.error || tasksResult.error;
  if (loadError) {
    container.innerHTML = `<div class="gs-page"><div class="gs-card gs-error"><span class="material-symbols-outlined">error</span><h3>Your profile could not load</h3><p>${escapeHtml(loadError.message || 'Please try again.')}</p><button id="profile-retry" class="gs-btn gs-btn-primary" type="button">Try again</button></div></div>`;
    container.querySelector('#profile-retry')?.addEventListener('click', () => renderProfile(container));
    return;
  }

  const profile = profileResult.data || {};
  const pages = pagesResult.data || [];
  const myTasks = (tasksResult.data || []).filter((task) => task.assignee_id === userId);
  const done = myTasks.filter((task) => task.status === 'done').length;
  const open = myTasks.filter((task) => task.status !== 'done');
  const today = new Date().toISOString().slice(0, 10);
  const overdue = open.filter((task) => task.due_date && task.due_date < today).length;
  const completion = myTasks.length ? Math.round((done / myTasks.length) * 100) : 0;
  const role = (membersResult.data || []).find((member) => member.user_id === userId)?.role;
  const teamName = AppState.workspace?.name || '';
  const name = profile.name || profile.email || 'You';
  const avatar = /^https?:\/\//i.test(profile.avatar_url || '') ? escapeHtml(profile.avatar_url) : '';
  const initials = name.trim().split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase();
  const upcoming = [...open].sort((a, b) => (a.due_date || '9999').localeCompare(b.due_date || '9999')).slice(0, 5);
  const missingName = !profile.name;
  const missingPhoto = !avatar;

  container.innerHTML = `
    <div class="gs-page gp-page">
      <section class="gp-hero">
        <span class="gs-avatar gs-avatar-xl">${avatar ? `<img src="${avatar}" alt="" />` : escapeHtml(initials || 'U')}</span>
        <div class="gp-hero-main">
          <p class="gs-eyebrow">Profile</p>
          <h1>${escapeHtml(name)}</h1>
          <p class="gp-meta">
            <span>${escapeHtml(profile.email || '')}</span>
            ${teamName ? `<span class="gs-role-chip">${escapeHtml(ROLE_LABEL[role] || 'Member')} · ${escapeHtml(teamName)}</span>` : ''}
          </p>
        </div>
        <a class="gs-btn gs-btn-primary" href="#settings?section=account"><span class="material-symbols-outlined">edit</span>Edit profile</a>
      </section>

      ${missingName || missingPhoto ? `
      <a class="gp-nudge" href="#settings?section=account">
        <span class="material-symbols-outlined">tips_and_updates</span>
        <span>${missingName ? 'Add your name' : 'Add a photo'} so teammates recognise you in tasks and comments.</span>
        <span class="material-symbols-outlined">arrow_forward</span>
      </a>` : ''}

      <section class="gp-stats" aria-label="Your tasks in this team">
        <div class="gp-stat"><strong>${open.length}</strong><span>open tasks for you</span></div>
        <div class="gp-stat ${overdue ? 'is-warn' : ''}"><strong>${overdue}</strong><span>overdue</span></div>
        <div class="gp-stat"><strong>${done}</strong><span>tasks finished</span></div>
        <div class="gp-stat gp-stat-progress">
          <strong>${completion}%</strong><span>of your tasks done</span>
          <div class="gp-bar"><i style="width:${completion}%"></i></div>
        </div>
      </section>

      <div class="gp-grid">
        <section class="gs-card">
          <div class="gs-card-head"><div><h2>Up next for you</h2><p>Your open tasks, soonest due first.</p></div><a class="gs-link" href="#my-tasks">All my tasks →</a></div>
          <div class="gs-list">
            ${upcoming.length ? upcoming.map((task) => {
              const late = task.due_date && task.due_date < today;
              return `
              <a class="gs-row gp-task" href="#my-tasks">
                <span class="gp-check" aria-hidden="true"></span>
                <span class="gs-row-main"><strong>${escapeHtml(task.title || 'Untitled task')}</strong><small>${escapeHtml(task.status === 'in_progress' ? 'In progress' : 'To do')}</small></span>
                ${task.due_date ? `<span class="gp-due ${late ? 'is-late' : ''}">${late ? 'Overdue · ' : ''}${escapeHtml(new Date(`${task.due_date}T00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }))}</span>` : ''}
              </a>`;
            }).join('') : '<p class="gs-empty">Nothing assigned to you right now. 🎉</p>'}
          </div>
        </section>

        <section class="gs-card">
          <div class="gs-card-head"><div><h2>Recently edited</h2><p>${teamName ? `Latest pages in ${escapeHtml(teamName)}.` : 'Latest pages.'}</p></div></div>
          <div class="gs-list">
            ${pages.length ? pages.map((page) => `
              <a class="gs-row" href="#editor/${escapeHtml(page.id)}">
                <span class="gs-page-icon">${escapeHtml(page.icon || '📄')}</span>
                <span class="gs-row-main"><strong>${escapeHtml(page.title || 'Untitled')}</strong><small>${escapeHtml(timeAgo(page.updated_at))}</small></span>
                <span class="material-symbols-outlined gs-row-arrow">chevron_right</span>
              </a>`).join('') : '<p class="gs-empty">No pages yet.</p>'}
          </div>
        </section>
      </div>
    </div>
  `;
}
