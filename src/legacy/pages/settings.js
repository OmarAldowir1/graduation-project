import { requestInput, requestConfirmation } from "../../lib/dialogs.js";
// ============================================
// MOTION — Settings Page Module (Legacy)
// ============================================

import { AppState, setBreadcrumb, showToast, handleSignOut } from '../app.js';
import {
  getUserProfile,
  updateUserProfile,
  getSettings,
  updateSettings,
  getWorkspaceMembers,
  getWorkspaceInvitations,
  getPages,
  getTasks,
  createPage,
  createTask,
  updatePage,
  getArchivedPages,
  createWorkspaceInvitation,
  removeWorkspaceInvitation,
  updateWorkspace,
  updateWorkspaceMember,
  removeWorkspaceMember,
  restorePage
} from '../../lib/queries.js';
import { escapeHtml } from '../../lib/sanitize.js';

export async function renderSettings(container) {
  setBreadcrumb('Settings');

  const userId = AppState.user?.id;
  if (!userId) return;

  const workspaceId = AppState.workspace?.id;
  const isWorkspaceOwner = AppState.workspace?.owner_id === userId;
  const [profileResult, settingsResult, membersResult, invitationsResult, archivedPagesResult] = await Promise.all([
    getUserProfile(userId),
    getSettings(userId),
    workspaceId ? getWorkspaceMembers(workspaceId) : Promise.resolve({ data: [] }),
    workspaceId ? getWorkspaceInvitations(workspaceId) : Promise.resolve({ data: [] }),
    workspaceId ? getArchivedPages(workspaceId) : Promise.resolve({ data: [] })
  ]);

  const loadError = profileResult.error || settingsResult.error;
  if (loadError) {
    container.innerHTML = `<div class="error-state m-8"><span class="material-symbols-outlined">error</span><h3>Failed to load settings</h3><p>${escapeHtml(loadError.message || 'Please try again.')}</p><button id="settings-retry" class="mt-4 px-4 py-2 bg-primary text-on-primary rounded-lg text-sm font-semibold" type="button">Retry</button></div>`;
    container.querySelector('#settings-retry')?.addEventListener('click', async () => renderSettings(container));
    return;
  }

  const profile = profileResult.data || {};
  const settings = settingsResult.data || {};
  const prefs = settings.preferences || {};
  const members = membersResult.data || [];
  const invitations = invitationsResult.data || [];
  const archivedPages = archivedPagesResult.data || [];
  const safeProfileEmail = escapeHtml(profile.email || '');
  const safeWorkspaceName = escapeHtml(AppState.workspace?.name || 'this workspace');
  const safeAvatarUrl = /^https?:\/\//i.test(profile.avatar_url || '') ? escapeHtml(profile.avatar_url) : '';

  container.innerHTML = `
    <div class="flex-1 overflow-y-auto p-8 lg:p-12">
      <div class="max-w-4xl mx-auto">
        <header class="mb-12">
          <h2 class="font-['Inter'] tracking-tight text-on-surface text-3xl font-bold">Settings</h2>
          <p class="text-on-surface-variant mt-2">Manage your personal preferences and workspace configuration.</p>
        </header>

        <div class="grid grid-cols-1 md:grid-cols-12 gap-8">
          <nav class="md:col-span-3 space-y-1">
            <button class="w-full text-left px-4 py-2.5 rounded-lg bg-surface-container-lowest text-on-surface font-semibold shadow-sm text-sm flex items-center gap-3" data-settings-tab="account">
              <span class="material-symbols-outlined text-lg">person</span>
              My Account
            </button>
            <button class="w-full text-left px-4 py-2.5 rounded-lg text-on-surface-variant hover:bg-surface-container-low transition-colors text-sm flex items-center gap-3" data-settings-tab="workspace">
              <span class="material-symbols-outlined text-lg">business</span>
              Workspace
            </button>
            <button class="w-full text-left px-4 py-2.5 rounded-lg text-on-surface-variant hover:bg-surface-container-low transition-colors text-sm flex items-center gap-3" data-settings-tab="notifications">
              <span class="material-symbols-outlined text-lg">notifications</span>
              Notifications
            </button>
            <button class="w-full text-left px-4 py-2.5 rounded-lg text-on-surface-variant hover:bg-surface-container-low transition-colors text-sm flex items-center gap-3" data-settings-tab="archive">
              <span class="material-symbols-outlined text-lg">archive</span>
              Archived
            </button>
            <button class="w-full text-left px-4 py-2.5 rounded-lg text-on-surface-variant hover:bg-surface-container-low transition-colors text-sm flex items-center gap-3 mt-6 text-error" id="btn-sign-out">
              <span class="material-symbols-outlined text-lg">logout</span>
              Sign Out
            </button>
          </nav>

          <div class="md:col-span-9 space-y-12">
            <section class="space-y-6" id="settings-account">
              <div>
                <h3 class="text-lg font-semibold text-on-surface">My Account</h3>
                <p class="text-sm text-on-surface-variant">Update your photo and personal details.</p>
              </div>
              <div class="bg-surface-container-lowest p-6 rounded-xl space-y-8">
                <div class="flex items-center gap-6 pb-8 border-b border-surface-container-high">
                  <div class="relative group">
                    <div class="w-20 h-20 rounded-full overflow-hidden bg-surface-container-low flex items-center justify-center">
                      ${
                        safeAvatarUrl
                          ? `<img class="w-full h-full object-cover" src="${safeAvatarUrl}" alt="Profile" />`
                          : `<span class="text-2xl font-bold text-on-surface-variant">${escapeHtml((profile.name || 'U')[0].toUpperCase())}</span>`
                      }
                    </div>
                    <button id="settings-avatar-edit" class="absolute bottom-0 right-0 p-1.5 bg-white shadow-lg rounded-full text-primary hover:text-on-surface transition-colors" type="button" title="Change profile photo">
                      <span class="material-symbols-outlined text-sm">edit</span>
                    </button>
                  </div>
                  <div>
                    <h4 class="font-medium">Profile Photo</h4>
                    <p class="text-xs text-on-surface-variant mt-1">PNG, JPG or GIF. Max 2MB.</p>
                  </div>
                </div>

                <div class="grid grid-cols-1 sm:grid-cols-2 gap-6">
                  <div class="space-y-2">
                    <label class="text-xs font-bold uppercase tracking-widest text-on-surface-variant">Full Name</label>
                    <input id="settings-name" class="w-full px-4 py-2.5 bg-surface-container rounded-lg border-none focus:ring-1 focus:ring-primary focus:bg-surface-container-lowest text-sm transition-all" type="text" value="${
                      escapeHtml(profile.name || '')
                    }" placeholder="Your name" />
                  </div>
                  <div class="space-y-2">
                    <label class="text-xs font-bold uppercase tracking-widest text-on-surface-variant">Email Address</label>
                    <input id="settings-email" class="w-full px-4 py-2.5 bg-surface-container rounded-lg border-none focus:ring-1 focus:ring-primary focus:bg-surface-container-lowest text-sm transition-all opacity-60" type="email" value="${
                      safeProfileEmail
                    }" disabled />
                  </div>
                </div>
              </div>

              <div class="bg-surface-container-lowest p-6 rounded-xl space-y-4">
                <div>
                  <h4 class="font-semibold text-on-surface">Workspace backup</h4>
                  <p class="text-sm text-on-surface-variant mt-1">Export your pages and tasks as JSON, or import a backup into this workspace.</p>
                </div>
                <div class="flex flex-wrap gap-3">
                  <button id="settings-export-backup" class="px-4 py-2.5 bg-primary text-on-primary rounded-lg text-sm font-semibold" type="button">
                    <span class="material-symbols-outlined text-sm align-middle">download</span> Export backup
                  </button>
                  <button id="settings-import-backup" class="px-4 py-2.5 bg-surface-container-high text-on-surface rounded-lg text-sm font-semibold" type="button">
                    <span class="material-symbols-outlined text-sm align-middle">upload_file</span> Import backup
                  </button>
                  <input id="settings-backup-input" type="file" accept="application/json,.json" hidden />
                </div>
                <p class="text-xs text-on-surface-variant">Imported records are added as new records; existing content is not overwritten.</p>
              </div>
            </section>

            <section class="space-y-6" id="settings-notifications">
              <div>
                <h3 class="text-lg font-semibold text-on-surface">Notifications</h3>
                <p class="text-sm text-on-surface-variant">Configure how you want to be notified.</p>
              </div>
              <div class="bg-surface-container-lowest rounded-xl overflow-hidden">
                ${renderNotificationRow('email_notifications', 'mail', 'Email Notifications', 'Receive daily digests and activity summaries.', prefs.email_notifications)}
                ${renderNotificationRow('direct_messages', 'chat_bubble', 'Direct Messages', 'Get notified when someone sends you a message.', prefs.direct_messages)}
                ${renderNotificationRow('product_updates', 'rocket_launch', 'Product Updates', 'Stay up to date with new features and releases.', prefs.product_updates)}
              </div>

            </section>

            <section class="space-y-6" id="settings-archive">
              <div>
                <h3 class="text-lg font-semibold text-on-surface">Archived pages</h3>
                <p class="text-sm text-on-surface-variant">Archived pages are hidden from Notes and Database until restored.</p>
              </div>
              <div class="bg-surface-container-lowest rounded-xl overflow-hidden">
                ${archivedPages.length === 0
                  ? '<p class="p-5 text-sm text-on-surface-variant">No archived pages.</p>'
                  : archivedPages.map((page) => `
                    <div class="flex items-center gap-3 p-4 border-b border-surface-container-low last:border-b-0">
                      <span class="text-lg">${escapeHtml(page.icon || '📄')}</span>
                      <div class="min-w-0 flex-1">
                        <p class="text-sm font-semibold truncate">${escapeHtml(page.title || 'Untitled')}</p>
                        <p class="text-xs text-on-surface-variant">Archived ${timeSince(page.archived_at)}</p>
                      </div>
                      <button type="button" class="restore-page text-primary text-xs font-semibold hover:underline" data-page-id="${page.id}">Restore</button>
                    </div>
                  `).join('')}
              </div>
            </section>

            <section class="space-y-6" id="settings-workspace">
              <div>
                <h3 class="text-lg font-semibold text-on-surface">Workspace</h3>
                <p class="text-sm text-on-surface-variant">Manage the people who can access ${safeWorkspaceName}.</p>
              </div>
              ${isWorkspaceOwner ? `<form id="workspace-name-form" class="flex flex-col sm:flex-row gap-3">
                <input id="workspace-name-input" class="flex-1 px-4 py-2.5 bg-surface-container rounded-lg border-0 text-sm" value="${escapeHtml(AppState.workspace?.name || '')}" maxlength="80" required />
                <button class="px-4 py-2.5 bg-primary text-on-primary rounded-lg text-sm font-semibold" type="submit">Save name</button>
              </form>` : ''}
              <div class="bg-surface-container-lowest rounded-xl overflow-hidden">
                ${isWorkspaceOwner ? `<form id="invite-member-form" class="flex flex-col sm:flex-row gap-3 p-5 border-b border-surface-container-low">
                  <input id="invite-member-email" class="flex-1 min-w-0 px-4 py-2.5 bg-surface-container rounded-lg border-0 text-sm" type="email" placeholder="colleague@example.com" required />
                  <select id="invite-member-role" class="px-3 py-2.5 bg-surface-container rounded-lg border-0 text-sm">
                    <option value="editor">Editor</option>
                    <option value="commenter">Commenter</option>
                    <option value="viewer">Viewer</option>
                  </select>
                  <button class="px-4 py-2.5 bg-primary text-on-primary rounded-lg text-sm font-semibold" type="submit">Invite</button>
                </form>` : ''}
                ${
                  invitations.length
                    ? `<div class="border-b border-surface-container-low">
                        <div class="px-5 pt-4 pb-2 text-xs font-bold uppercase tracking-widest text-on-surface-variant">Pending invitations</div>
                        ${invitations.map((invitation) => `
                          <div class="flex items-center gap-3 px-5 py-3">
                            <span class="material-symbols-outlined text-on-surface-variant">mail</span>
                            <div class="min-w-0 flex-1">
                              <p class="text-sm font-medium truncate">${escapeHtml(invitation.email)}</p>
                              <p class="text-xs text-on-surface-variant">${escapeHtml(invitation.role)} · ${timeSince(invitation.created_at)}</p>
                            </div>
                            ${isWorkspaceOwner ? `<button class="revoke-invitation text-error text-xs font-semibold hover:underline" data-invitation-id="${invitation.id}" type="button">Revoke</button>` : ''}
                          </div>
                        `).join('')}
                      </div>`
                    : ''
                }
                ${
                  members.length === 0
                    ? '<div class="p-6 text-sm text-on-surface-variant">No workspace members are available yet. Apply the collaboration schema to enable this list.</div>'
                    : members
                        .map((member) => {
                          const memberName = member.user?.name || member.user?.email || 'Workspace member';
                          const safeMemberName = escapeHtml(memberName);
                          const safeMemberEmail = escapeHtml(member.user?.email || '');
                          const initials = memberName.split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase();
                          const isSelf = member.user_id === userId;
                          return `
                            <div class="workspace-member-row flex items-center gap-4 p-5 border-b border-surface-container-low last:border-b-0">
                              <div class="w-10 h-10 rounded-full bg-primary-container text-on-primary-container flex items-center justify-center text-xs font-bold">${initials}</div>
                              <div class="min-w-0 flex-1">
                                <p class="text-sm font-semibold truncate">${safeMemberName}${isSelf ? ' (you)' : ''}</p>
                                <p class="text-xs text-on-surface-variant truncate">${safeMemberEmail}</p>
                              </div>
                              <select class="member-role-select text-xs rounded-lg bg-surface-container px-3 py-2 border-0" data-member-id="${member.id}" ${isSelf || !isWorkspaceOwner ? 'disabled' : ''}>
                                ${[...(member.role === 'owner' ? ['owner'] : []), 'admin', 'editor', 'commenter', 'viewer'].map((role) => `<option value="${role}" ${member.role === role ? 'selected' : ''}>${role[0].toUpperCase() + role.slice(1)}</option>`).join('')}
                              </select>
                              ${isSelf || !isWorkspaceOwner ? '' : `<button class="remove-member text-error text-xs font-semibold hover:underline" data-member-id="${member.id}" type="button">Remove</button>`}
                            </div>
                          `;
                        })
                        .join('')
                }
              </div>
            </section>

            <div class="flex items-center justify-end gap-3 pt-6 border-t border-surface-container-high">
              <button class="px-6 py-2 text-sm font-medium text-on-surface-variant hover:text-on-surface transition-colors" id="btn-cancel">Cancel</button>
              <button class="px-8 py-2 text-sm font-semibold bg-primary text-on-primary rounded-lg shadow-sm hover:bg-primary-dim transition-all active:scale-95" id="btn-save-settings">Save Changes</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;

  document.getElementById('btn-save-settings')?.addEventListener('click', async () => {
    const name = document.getElementById('settings-name')?.value;
    const toggles = container.querySelectorAll('.notification-toggle');
    const newPrefs = {};
    toggles.forEach((t) => {
      newPrefs[t.dataset.key] = t.checked;
    });

    try {
      const { error: profileError } = await updateUserProfile(userId, { name });
      if (profileError) throw profileError;
      const { error: settingsError } = await updateSettings(userId, { preferences: newPrefs });
      if (settingsError) throw settingsError;
      AppState.profile = { ...AppState.profile, name };
      showToast('Settings saved!', 'success');
    } catch (err) {
      showToast('Failed to save: ' + err.message, 'error');
    }
  });

  document.getElementById('btn-sign-out')?.addEventListener('click', handleSignOut);
  document.getElementById('btn-cancel')?.addEventListener('click', async () => renderSettings(container));

  container.querySelectorAll('.restore-page').forEach((button) => {
    button.addEventListener('click', async () => {
      const { error: restoreError } = await restorePage(button.dataset.pageId);
      if (restoreError) {
        showToast('Could not restore page: ' + restoreError.message, 'error');
        return;
      }
      showToast('Page restored', 'success');
      renderSettings(container);
    });
  });

  document.getElementById('settings-avatar-edit')?.addEventListener('click', async () => {
    const avatarUrl = await requestInput('Paste a profile image URL:', profile.avatar_url || '');
    if (avatarUrl === null) return;
    if (avatarUrl && !/^https?:\/\//i.test(avatarUrl)) return showToast('Image URL must start with http:// or https://', 'error');
    const { error: avatarError } = await updateUserProfile(userId, { avatar_url: avatarUrl || null });
    if (avatarError) return showToast(`Could not update photo: ${avatarError.message}`, 'error');
    AppState.profile = { ...AppState.profile, avatar_url: avatarUrl || null };
    showToast('Profile photo updated', 'success');
    await renderSettings(container);
  });

  document.getElementById('settings-export-backup')?.addEventListener('click', async () => {
    if (!workspaceId) return showToast('No workspace is selected', 'error');
    const [{ data: pages, error: pagesError }, { data: tasks, error: tasksError }] = await Promise.all([
      getPages(workspaceId),
      getTasks({ workspaceId })
    ]);
    if (pagesError || tasksError) return showToast(`Could not export backup: ${(pagesError || tasksError).message}`, 'error');
    const backup = {
      format: 'motion-workspace-backup',
      version: 1,
      exportedAt: new Date().toISOString(),
      workspace: { name: AppState.workspace?.name || 'Workspace' },
      pages: (pages || []).map((page) => ({
        title: page.title,
        content: page.content || {},
        icon: page.icon,
        cover_url: page.cover_url,
        page_type: page.page_type,
        is_favorite: page.is_favorite,
        parent_id: page.parent_id || null
      })),
      tasks: (tasks || []).map((task) => ({
        title: task.title,
        status: task.status,
        priority: task.priority,
        due_date: task.due_date,
        tags: task.tags || [],
        page_id: task.page_id || null,
        sort_order: Number.isFinite(task.sort_order) ? task.sort_order : 0
      }))
    };
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' }));
    link.download = `${(AppState.workspace?.name || 'motion-workspace').replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-backup.json`;
    link.click();
    URL.revokeObjectURL(link.href);
    showToast('Workspace backup exported', 'success');
  });

  document.getElementById('settings-import-backup')?.addEventListener('click', async () => container.querySelector('#settings-backup-input')?.click());
  document.getElementById('settings-backup-input')?.addEventListener('change', async (event) => {
    const file = event.target.files?.[0];
    if (!file || !workspaceId) return;
    try {
      const backup = JSON.parse(await file.text());
      if (backup?.format !== 'motion-workspace-backup' || !Array.isArray(backup.pages) || !Array.isArray(backup.tasks)) {
        throw new Error('This is not a valid Motion backup file.');
      }
      if (!await requestConfirmation(`Import ${backup.pages.length} pages and ${backup.tasks.length} tasks? Existing records will remain unchanged.`)) return;
      const pageMap = new Map();
      let importedPages = 0;
      const pagesToImport = [...backup.pages].sort((left, right) => backupPageDepth(left, backup.pages) - backupPageDepth(right, backup.pages));
      for (const sourcePage of pagesToImport) {
        const parentId = sourcePage.parent_id ? pageMap.get(sourcePage.parent_id) || null : null;
        const { data: importedPage, error: pageError } = await createPage(
          workspaceId,
          String(sourcePage.title || 'Imported page').slice(0, 200),
          ['note', 'document', 'database', 'kanban'].includes(sourcePage.page_type) ? sourcePage.page_type : 'note',
          sourcePage.content && typeof sourcePage.content === 'object' ? sourcePage.content : {},
          parentId
        );
        if (pageError) throw pageError;
        if (importedPage?.id) {
          pageMap.set(sourcePage.id, importedPage.id);
          const metadata = {
            icon: typeof sourcePage.icon === 'string' ? sourcePage.icon.slice(0, 8) : '📄',
            cover_url: /^https?:\/\//i.test(sourcePage.cover_url || '') ? sourcePage.cover_url : null,
            is_favorite: Boolean(sourcePage.is_favorite)
          };
          await updatePage(importedPage.id, metadata);
          importedPages += 1;
        }
      }
      let importedTasks = 0;
      for (const sourceTask of backup.tasks) {
        const { error: taskError } = await createTask(String(sourceTask.title || 'Imported task').slice(0, 240), {
          workspaceId,
          pageId: sourceTask.page_id ? pageMap.get(sourceTask.page_id) || null : null,
          status: ['todo', 'in_progress', 'done'].includes(sourceTask.status) ? sourceTask.status : 'todo',
          priority: ['low', 'medium', 'high', 'urgent'].includes(sourceTask.priority) ? sourceTask.priority : 'medium',
          dueDate: /^\d{4}-\d{2}-\d{2}$/.test(sourceTask.due_date || '') ? sourceTask.due_date : null,
          tags: Array.isArray(sourceTask.tags) ? sourceTask.tags.map((tag) => String(tag).slice(0, 40)).slice(0, 10) : [],
          sortOrder: Number.isFinite(sourceTask.sort_order) ? sourceTask.sort_order : Date.now()
        });
        if (taskError) throw taskError;
        importedTasks += 1;
      }
      showToast(`Imported ${importedPages} pages and ${importedTasks} tasks`, 'success');
      await renderSettings(container);
    } catch (error) {
      showToast(`Could not import backup: ${error.message}`, 'error');
    } finally {
      event.target.value = '';
    }
  });

  container.querySelectorAll('[data-settings-tab]').forEach((button) => {
    button.addEventListener('click', async () => {
      const target = document.getElementById(`settings-${button.dataset.settingsTab}`);
      target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  });

  container.querySelectorAll('.member-role-select').forEach((select) => {
    select.addEventListener('change', async () => {
      const { error } = await updateWorkspaceMember(select.dataset.memberId, { role: select.value });
      showToast(error ? `Failed to update role: ${error.message}` : 'Member role updated', error ? 'error' : 'success');
    });
  });

  document.getElementById('invite-member-form')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!workspaceId) return showToast('No workspace is selected', 'error');
    const emailInput = document.getElementById('invite-member-email');
    const roleInput = document.getElementById('invite-member-role');
    const { data: invitation, error } = await createWorkspaceInvitation(workspaceId, emailInput.value, roleInput.value, userId);
    if (error) return showToast(`Could not invite member: ${error.message}`, 'error');
    const inviteUrl = `${window.location.origin}${window.location.pathname}#invite/${invitation.token}`;
    try {
      await navigator.clipboard.writeText(inviteUrl);
      showToast('Invitation saved and link copied', 'success');
    } catch {
      await requestInput('Copy this invitation link:', inviteUrl);
      showToast('Invitation saved', 'success');
    }
    emailInput.value = '';
  });

  document.getElementById('workspace-name-form')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const name = document.getElementById('workspace-name-input')?.value.trim();
    if (!name || !workspaceId) return;
    const { data, error } = await updateWorkspace(workspaceId, { name });
    if (error) return showToast(`Could not rename workspace: ${error.message}`, 'error');
    AppState.workspace = { ...AppState.workspace, ...data, name };
    showToast('Workspace name updated', 'success');
    await renderSettings(container);
  });

  container.querySelectorAll('.remove-member').forEach((button) => {
    button.addEventListener('click', async () => {
      if (!await requestConfirmation('Remove this member from the workspace?')) return;
      const { error } = await removeWorkspaceMember(button.dataset.memberId);
      if (error) {
        showToast(`Failed to remove member: ${error.message}`, 'error');
        return;
      }
      showToast('Member removed', 'success');
      await renderSettings(container);
    });
  });

  container.querySelectorAll('.revoke-invitation').forEach((button) => {
    button.addEventListener('click', async () => {
      if (!await requestConfirmation('Revoke this invitation?')) return;
      const { error } = await removeWorkspaceInvitation(button.dataset.invitationId);
      if (error) return showToast(`Failed to revoke invitation: ${error.message}`, 'error');
      showToast('Invitation revoked', 'success');
      await renderSettings(container);
    });
  });
}

function timeSince(timestamp) {
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(timestamp).getTime()) / 1000));
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

function backupPageDepth(page, pages, seen = new Set()) {
  if (!page?.parent_id || seen.has(page.parent_id)) return 0;
  const parent = pages.find((candidate) => candidate.id === page.parent_id);
  if (!parent) return 0;
  seen.add(page.parent_id);
  return 1 + backupPageDepth(parent, pages, seen);
}

function renderNotificationRow(key, icon, label, description, checked) {
  return `
    <div class="flex items-center justify-between p-5 hover:bg-surface-container-low/30 transition-colors ${
      key !== 'email_notifications' ? 'border-t border-surface-container-low' : ''
    }">
      <div class="flex items-center gap-4">
        <div class="w-10 h-10 rounded-lg bg-tertiary-container/30 flex items-center justify-center text-tertiary">
          <span class="material-symbols-outlined">${icon}</span>
        </div>
        <div>
          <p class="text-sm font-medium">${label}</p>
          <p class="text-xs text-on-surface-variant">${description}</p>
        </div>
      </div>
      <label class="relative inline-flex items-center cursor-pointer">
        <input class="sr-only peer notification-toggle" type="checkbox" data-key="${key}" ${checked ? 'checked' : ''} />
        <div class="w-10 h-5 bg-surface-container-highest rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-primary"></div>
      </label>
    </div>
  `;
}
