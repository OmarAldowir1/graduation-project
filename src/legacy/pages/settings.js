import { requestInput, requestConfirmation } from "../../lib/dialogs.js";
// ============================================
// GROUPIFY — Settings page (tabs: account, notifications, team, archive & backup)
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

const SECTIONS = [
  { id: 'account', icon: 'person', label: 'My account', hint: 'Name, photo and look' },
  { id: 'notifications', icon: 'notifications', label: 'Notifications', hint: 'What we tell you about' },
  { id: 'team', icon: 'group', label: 'Team', hint: 'Members and invitations' },
  { id: 'data', icon: 'inventory_2', label: 'Archive & backup', hint: 'Restore and export' }
];

const ROLE_HELP = {
  owner: 'Full control of the team',
  admin: 'Can manage members and content',
  editor: 'Can create and edit everything',
  commenter: 'Can read and comment',
  viewer: 'Can only read'
};

function initialsOf(text) {
  return String(text || 'U').trim().split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase() || 'U';
}

function avatarMarkup(url, name, size = 'md') {
  const safe = /^https?:\/\//i.test(url || '') ? escapeHtml(url) : '';
  return `<span class="gs-avatar gs-avatar-${size}">${safe ? `<img src="${safe}" alt="" />` : escapeHtml(initialsOf(name))}</span>`;
}

export async function renderSettings(container, route) {
  setBreadcrumb('Settings');

  const userId = AppState.user?.id;
  if (!userId) return;

  const workspaceId = AppState.workspace?.id;
  const isWorkspaceOwner = AppState.workspace?.owner_id === userId;
  const requested = route?.query?.get('section');
  let activeSection = SECTIONS.some((section) => section.id === requested) ? requested : 'account';

  const [profileResult, settingsResult, membersResult, invitationsResult, archivedPagesResult] = await Promise.all([
    getUserProfile(userId),
    getSettings(userId),
    workspaceId ? getWorkspaceMembers(workspaceId) : Promise.resolve({ data: [] }),
    workspaceId ? getWorkspaceInvitations(workspaceId) : Promise.resolve({ data: [] }),
    workspaceId ? getArchivedPages(workspaceId) : Promise.resolve({ data: [] })
  ]);

  const loadError = profileResult.error || settingsResult.error;
  if (loadError) {
    container.innerHTML = `<div class="gs-page"><div class="gs-card gs-error"><span class="material-symbols-outlined">error</span><h3>Settings could not load</h3><p>${escapeHtml(loadError.message || 'Please try again.')}</p><button id="settings-retry" class="gs-btn gs-btn-primary" type="button">Try again</button></div></div>`;
    container.querySelector('#settings-retry')?.addEventListener('click', () => renderSettings(container, route));
    return;
  }

  const rerender = (section = activeSection) => renderSettings(container, { query: new URLSearchParams({ section }) });

  const profile = profileResult.data || {};
  const settings = settingsResult.data || {};
  const prefs = settings.preferences || {};
  const members = membersResult.data || [];
  const invitations = invitationsResult.data || [];
  const archivedPages = archivedPagesResult.data || [];
  const myRole = members.find((member) => member.user_id === userId)?.role || (isWorkspaceOwner ? 'owner' : 'member');
  const teamName = AppState.workspace?.name || 'your team';
  const safeTeamName = escapeHtml(teamName);
  const currentTheme = document.documentElement.classList.contains('dark') ? 'dark' : 'light';

  container.innerHTML = `
    <div class="gs-page">
      <header class="gs-head">
        <p class="gs-eyebrow">Account &amp; team</p>
        <h1>Settings</h1>
        <p>Your account, notifications and the <strong>${safeTeamName}</strong> team. Each section saves on its own.</p>
      </header>

      <div class="gs-layout">
        <nav class="gs-tabs" role="tablist" aria-label="Settings sections">
          ${SECTIONS.map((section) => `
            <button type="button" role="tab" class="gs-tab" id="gs-tab-${section.id}" data-settings-tab="${section.id}" aria-controls="settings-${section.id}">
              <span class="material-symbols-outlined">${section.icon}</span>
              <span class="gs-tab-text"><strong>${section.label}</strong><small>${section.hint}</small></span>
              ${section.id === 'team' && invitations.length ? `<span class="gs-tab-badge">${invitations.length}</span>` : ''}
            </button>`).join('')}
        </nav>

        <div class="gs-panels">
          <!-- ===== My account ===== -->
          <section class="gs-panel" id="settings-account" role="tabpanel" aria-labelledby="gs-tab-account">
            <form class="gs-card" id="gs-profile-form" novalidate>
              <div class="gs-card-head">
                <div><h2>Profile</h2><p>How teammates see you in tasks, comments and chat.</p></div>
              </div>
              <div class="gs-profile-preview">
                <span id="gs-avatar-preview">${avatarMarkup(profile.avatar_url, profile.name || profile.email, 'lg')}</span>
                <div>
                  <strong id="gs-name-preview">${escapeHtml(profile.name || 'Your name')}</strong>
                  <span>${escapeHtml(profile.email || '')}</span>
                </div>
              </div>
              <div class="gs-fields">
                <label class="gs-field">
                  <span>Display name</span>
                  <input id="settings-name" name="name" type="text" maxlength="80" autocomplete="name" value="${escapeHtml(profile.name || '')}" placeholder="e.g. Omar Aldowir" required />
                </label>
                <label class="gs-field">
                  <span>Email</span>
                  <input id="settings-email" type="email" value="${escapeHtml(profile.email || '')}" disabled />
                  <small>This is the email you sign in with. It can’t be changed here.</small>
                </label>
                <label class="gs-field gs-field-wide">
                  <span>Photo link</span>
                  <div class="gs-inline">
                    <input id="settings-avatar-url" name="avatar" type="url" inputmode="url" value="${escapeHtml(profile.avatar_url || '')}" placeholder="https://… link to an image" />
                    <button type="button" class="gs-btn gs-btn-ghost" id="settings-avatar-clear" ${profile.avatar_url ? '' : 'hidden'}>Remove</button>
                  </div>
                  <small>Paste a link to a square image (PNG or JPG). Leave empty to show your initials.</small>
                </label>
              </div>
              <div class="gs-card-foot">
                <span class="gs-status" id="gs-profile-status" aria-live="polite"></span>
                <button type="button" class="gs-btn gs-btn-ghost" id="gs-profile-reset" disabled>Discard</button>
                <button type="submit" class="gs-btn gs-btn-primary" id="btn-save-settings" disabled>Save changes</button>
              </div>
            </form>

            <div class="gs-card">
              <div class="gs-card-head">
                <div><h2>Appearance</h2><p>Choose how Groupify looks on this device.</p></div>
                <div class="gs-segment" role="radiogroup" aria-label="Theme">
                  <button type="button" role="radio" data-theme-choice="light" aria-checked="${currentTheme === 'light'}"><span class="material-symbols-outlined">light_mode</span>Light</button>
                  <button type="button" role="radio" data-theme-choice="dark" aria-checked="${currentTheme === 'dark'}"><span class="material-symbols-outlined">dark_mode</span>Dark</button>
                </div>
              </div>
            </div>

            <div class="gs-card gs-card-quiet">
              <div class="gs-card-head">
                <div><h2>Log out</h2><p>Sign out of Groupify on this device. Your work stays saved.</p></div>
                <button type="button" class="gs-btn gs-btn-danger" id="btn-sign-out"><span class="material-symbols-outlined">logout</span>Log out</button>
              </div>
            </div>
          </section>

          <!-- ===== Notifications ===== -->
          <section class="gs-panel" id="settings-notifications" role="tabpanel" aria-labelledby="gs-tab-notifications">
            <div class="gs-card">
              <div class="gs-card-head">
                <div><h2>Notifications</h2><p>Changes save as soon as you flip a switch.</p></div>
                <span class="gs-status" id="gs-notif-status" aria-live="polite"></span>
              </div>
              <div class="gs-list">
                ${renderNotificationRow('email_notifications', 'mail', 'Email summaries', 'A daily digest of what changed in your projects.', prefs.email_notifications)}
                ${renderNotificationRow('direct_messages', 'chat_bubble', 'Messages and mentions', 'When someone messages you or @mentions you.', prefs.direct_messages)}
                ${renderNotificationRow('product_updates', 'rocket_launch', 'Groupify news', 'New features and improvements, now and then.', prefs.product_updates)}
              </div>
            </div>
          </section>

          <!-- ===== Team ===== -->
          <section class="gs-panel" id="settings-team" role="tabpanel" aria-labelledby="gs-tab-team">
            ${!workspaceId ? '<div class="gs-card"><p class="gs-empty">You are not in a team yet. Create one from the sidebar with “New team”.</p></div>' : `
            <form class="gs-card" id="workspace-name-form">
              <div class="gs-card-head">
                <div><h2>Team name</h2><p>${isWorkspaceOwner ? 'Shown in the sidebar and on invitations.' : 'Only the team owner can rename the team.'}</p></div>
              </div>
              <div class="gs-inline">
                <input id="workspace-name-input" value="${safeTeamName}" maxlength="80" required ${isWorkspaceOwner ? '' : 'disabled'} aria-label="Team name" />
                ${isWorkspaceOwner ? '<button class="gs-btn gs-btn-primary" type="submit" id="workspace-name-save" disabled>Save</button>' : ''}
              </div>
            </form>

            <div class="gs-card">
              <div class="gs-card-head">
                <div><h2>Invite people</h2><p>${isWorkspaceOwner ? 'We create an invite link and copy it for you. Send it to your teammate.' : 'Ask the team owner to invite new people.'}</p></div>
              </div>
              ${isWorkspaceOwner ? `
              <form id="invite-member-form" class="gs-invite">
                <input id="invite-member-email" type="email" placeholder="teammate@university.edu" required aria-label="Email address" />
                <select id="invite-member-role" aria-label="Role">
                  <option value="editor">Editor</option>
                  <option value="commenter">Commenter</option>
                  <option value="viewer">Viewer</option>
                </select>
                <button class="gs-btn gs-btn-primary" type="submit"><span class="material-symbols-outlined">person_add</span>Invite</button>
              </form>
              <p class="gs-role-help" id="gs-role-help">${ROLE_HELP.editor}.</p>` : ''}
            </div>

            ${invitations.length ? `
            <div class="gs-card">
              <div class="gs-card-head"><div><h2>Waiting to join <span class="gs-count">${invitations.length}</span></h2><p>Invites that haven’t been accepted yet.</p></div></div>
              <div class="gs-list">
                ${invitations.map((invitation) => `
                  <div class="gs-row">
                    <span class="gs-avatar gs-avatar-md gs-avatar-muted"><span class="material-symbols-outlined">mail</span></span>
                    <div class="gs-row-main"><strong>${escapeHtml(invitation.email)}</strong><small>${escapeHtml(capitalize(invitation.role))} · invited ${timeSince(invitation.created_at)}</small></div>
                    ${isWorkspaceOwner ? `
                      <button class="gs-btn gs-btn-ghost copy-invitation" data-token="${escapeHtml(invitation.token || '')}" type="button"><span class="material-symbols-outlined">link</span>Copy link</button>
                      <button class="gs-icon-btn revoke-invitation" data-invitation-id="${invitation.id}" type="button" title="Cancel invitation" aria-label="Cancel invitation for ${escapeHtml(invitation.email)}"><span class="material-symbols-outlined">close</span></button>` : ''}
                  </div>`).join('')}
              </div>
            </div>` : ''}

            <div class="gs-card">
              <div class="gs-card-head"><div><h2>Members <span class="gs-count">${members.length}</span></h2><p>Everyone here can see the team’s projects, pages and tasks.</p></div></div>
              <div class="gs-list">
                ${members.length === 0 ? '<p class="gs-empty">No members yet.</p>' : members.map((member) => {
                  const memberName = member.user?.name || member.user?.email || 'Team member';
                  const isSelf = member.user_id === userId;
                  const canEdit = isWorkspaceOwner && !isSelf && member.role !== 'owner';
                  return `
                    <div class="gs-row workspace-member-row">
                      ${avatarMarkup(member.user?.avatar_url, memberName)}
                      <div class="gs-row-main"><strong>${escapeHtml(memberName)}${isSelf ? ' <em>(you)</em>' : ''}</strong><small>${escapeHtml(member.user?.email || '')}</small></div>
                      ${canEdit ? `
                        <select class="member-role-select" data-member-id="${member.id}" aria-label="Role for ${escapeHtml(memberName)}">
                          ${['admin', 'editor', 'commenter', 'viewer'].map((role) => `<option value="${role}" ${member.role === role ? 'selected' : ''}>${capitalize(role)}</option>`).join('')}
                        </select>
                        <button class="gs-icon-btn remove-member" data-member-id="${member.id}" data-member-name="${escapeHtml(memberName)}" type="button" title="Remove from team" aria-label="Remove ${escapeHtml(memberName)}"><span class="material-symbols-outlined">person_remove</span></button>`
                        : `<span class="gs-role-chip" title="${escapeHtml(ROLE_HELP[member.role] || '')}">${escapeHtml(capitalize(member.role || 'member'))}</span>`}
                    </div>`;
                }).join('')}
              </div>
              ${isWorkspaceOwner ? '' : `<p class="gs-foot-note">Your role: <strong>${escapeHtml(capitalize(myRole))}</strong> — ${escapeHtml(ROLE_HELP[myRole] || 'member of this team')}.</p>`}
            </div>`}
          </section>

          <!-- ===== Archive & backup ===== -->
          <section class="gs-panel" id="settings-data" role="tabpanel" aria-labelledby="gs-tab-data">
            <div class="gs-card">
              <div class="gs-card-head"><div><h2>Archived pages <span class="gs-count">${archivedPages.length}</span></h2><p>Archived pages are hidden everywhere until you restore them.</p></div></div>
              <div class="gs-list">
                ${archivedPages.length === 0 ? '<p class="gs-empty">Nothing archived. Pages you archive will wait here.</p>' : archivedPages.map((page) => `
                  <div class="gs-row">
                    <span class="gs-page-icon">${escapeHtml(page.icon || '📄')}</span>
                    <div class="gs-row-main"><strong>${escapeHtml(page.title || 'Untitled')}</strong><small>Archived ${timeSince(page.archived_at)}</small></div>
                    <button type="button" class="gs-btn gs-btn-ghost restore-page" data-page-id="${page.id}"><span class="material-symbols-outlined">unarchive</span>Restore</button>
                  </div>`).join('')}
              </div>
            </div>

            <div class="gs-card">
              <div class="gs-card-head"><div><h2>Backup</h2><p>Download the team’s pages and tasks as a file, or add them back from one. Importing never overwrites anything.</p></div></div>
              <div class="gs-actions">
                <button id="settings-export-backup" class="gs-btn gs-btn-primary" type="button"><span class="material-symbols-outlined">download</span>Download backup</button>
                <button id="settings-import-backup" class="gs-btn gs-btn-ghost" type="button"><span class="material-symbols-outlined">upload_file</span>Import a backup…</button>
                <input id="settings-backup-input" type="file" accept="application/json,.json" hidden />
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  `;

  // ---------- Section switching (tabs) ----------
  const showSection = (id, { focus = false } = {}) => {
    activeSection = id;
    container.querySelectorAll('[data-settings-tab]').forEach((tab) => {
      const on = tab.dataset.settingsTab === id;
      tab.classList.toggle('is-active', on);
      tab.setAttribute('aria-selected', String(on));
      tab.tabIndex = on ? 0 : -1;
      if (on && focus) tab.focus();
    });
    container.querySelectorAll('.gs-panel').forEach((panel) => { panel.hidden = panel.id !== `settings-${id}`; });
    const hash = `#settings?section=${id}`;
    if (window.location.hash !== hash) history.replaceState(null, '', hash);
  };
  const tabs = [...container.querySelectorAll('[data-settings-tab]')];
  tabs.forEach((tab, index) => {
    tab.addEventListener('click', () => showSection(tab.dataset.settingsTab));
    tab.addEventListener('keydown', (event) => {
      const step = ['ArrowDown', 'ArrowRight'].includes(event.key) ? 1 : ['ArrowUp', 'ArrowLeft'].includes(event.key) ? -1 : 0;
      if (!step) return;
      event.preventDefault();
      showSection(tabs[(index + step + tabs.length) % tabs.length].dataset.settingsTab, { focus: true });
    });
  });
  showSection(activeSection);
  // Links like "Edit profile" in the avatar menu change the hash while this page is open.
  if (container._gsHashListener) window.removeEventListener('hashchange', container._gsHashListener);
  container._gsHashListener = () => {
    if (!container.isConnected) {
      window.removeEventListener('hashchange', container._gsHashListener);
      return;
    }
    const match = window.location.hash.match(/^#settings\?section=([a-z]+)/);
    if (match && SECTIONS.some((section) => section.id === match[1])) showSection(match[1]);
  };
  window.addEventListener('hashchange', container._gsHashListener);

  // ---------- Profile (explicit save, only when something changed) ----------
  const profileForm = container.querySelector('#gs-profile-form');
  const nameInput = container.querySelector('#settings-name');
  const avatarInput = container.querySelector('#settings-avatar-url');
  const saveButton = container.querySelector('#btn-save-settings');
  const resetButton = container.querySelector('#gs-profile-reset');
  const clearAvatar = container.querySelector('#settings-avatar-clear');
  const profileStatus = container.querySelector('#gs-profile-status');
  const original = { name: profile.name || '', avatar: profile.avatar_url || '' };
  const syncProfileForm = () => {
    const name = nameInput.value.trim();
    const avatar = avatarInput.value.trim();
    const dirty = name !== original.name || avatar !== original.avatar;
    const avatarValid = !avatar || /^https?:\/\/\S+$/i.test(avatar);
    saveButton.disabled = !dirty || !name || !avatarValid;
    resetButton.disabled = !dirty;
    clearAvatar.hidden = !avatar;
    profileStatus.textContent = !name ? 'Name can’t be empty' : !avatarValid ? 'Photo link must start with https://' : dirty ? 'Unsaved changes' : '';
    profileStatus.dataset.tone = !name || !avatarValid ? 'error' : dirty ? 'pending' : '';
    container.querySelector('#gs-name-preview').textContent = name || 'Your name';
    container.querySelector('#gs-avatar-preview').innerHTML = avatarMarkup(avatarValid ? avatar : '', name || profile.email, 'lg');
  };
  nameInput.addEventListener('input', syncProfileForm);
  avatarInput.addEventListener('input', syncProfileForm);
  clearAvatar.addEventListener('click', () => { avatarInput.value = ''; syncProfileForm(); avatarInput.focus(); });
  resetButton.addEventListener('click', () => { nameInput.value = original.name; avatarInput.value = original.avatar; syncProfileForm(); });
  profileForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (saveButton.disabled) return;
    const name = nameInput.value.trim();
    const avatar = avatarInput.value.trim() || null;
    saveButton.disabled = true;
    saveButton.textContent = 'Saving…';
    const { error } = await updateUserProfile(userId, { name, avatar_url: avatar });
    saveButton.textContent = 'Save changes';
    if (error) {
      showToast(`Could not save your profile: ${error.message}`, 'error');
      syncProfileForm();
      return;
    }
    original.name = name;
    original.avatar = avatar || '';
    AppState.profile = { ...AppState.profile, name, avatar_url: avatar };
    window.dispatchEvent(new CustomEvent('groupify:profile-updated'));
    syncProfileForm();
    profileStatus.textContent = 'Saved';
    profileStatus.dataset.tone = 'ok';
    showToast('Profile saved', 'success');
  });

  // ---------- Appearance ----------
  container.querySelectorAll('[data-theme-choice]').forEach((button) => {
    button.addEventListener('click', () => {
      const theme = button.dataset.themeChoice;
      window.dispatchEvent(new CustomEvent('groupify:set-theme', { detail: { theme } }));
      container.querySelectorAll('[data-theme-choice]').forEach((other) => other.setAttribute('aria-checked', String(other === button)));
    });
  });

  // ---------- Log out ----------
  container.querySelector('#btn-sign-out')?.addEventListener('click', async () => {
    if (!await requestConfirmation('Log out of Groupify on this device?')) return;
    handleSignOut();
  });

  // ---------- Notifications (instant save) ----------
  const notifStatus = container.querySelector('#gs-notif-status');
  container.querySelectorAll('.notification-toggle').forEach((toggle) => {
    toggle.addEventListener('change', async () => {
      const nextPrefs = { ...prefs };
      container.querySelectorAll('.notification-toggle').forEach((other) => { nextPrefs[other.dataset.key] = other.checked; });
      notifStatus.textContent = 'Saving…';
      notifStatus.dataset.tone = 'pending';
      const { error } = await updateSettings(userId, { preferences: nextPrefs });
      if (error) {
        toggle.checked = !toggle.checked;
        notifStatus.textContent = 'Not saved';
        notifStatus.dataset.tone = 'error';
        showToast(`Could not save: ${error.message}`, 'error');
        return;
      }
      Object.assign(prefs, nextPrefs);
      notifStatus.textContent = 'Saved';
      notifStatus.dataset.tone = 'ok';
    });
  });

  // ---------- Team ----------
  const teamInput = container.querySelector('#workspace-name-input');
  const teamSave = container.querySelector('#workspace-name-save');
  teamInput?.addEventListener('input', () => {
    if (teamSave) teamSave.disabled = !teamInput.value.trim() || teamInput.value.trim() === teamName;
  });
  container.querySelector('#workspace-name-form')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!isWorkspaceOwner) return;
    const name = teamInput?.value.trim();
    if (!name || !workspaceId || name === teamName) return;
    const { data, error } = await updateWorkspace(workspaceId, { name });
    if (error) return showToast(`Could not rename team: ${error.message}`, 'error');
    AppState.workspace = { ...AppState.workspace, ...data, name };
    window.dispatchEvent(new CustomEvent('groupify:profile-updated'));
    showToast('Team name saved', 'success');
    await rerender('team');
  });

  const roleSelect = container.querySelector('#invite-member-role');
  roleSelect?.addEventListener('change', () => {
    container.querySelector('#gs-role-help').textContent = `${ROLE_HELP[roleSelect.value]}.`;
  });

  const copyInviteLink = async (token) => {
    const inviteUrl = `${window.location.origin}${window.location.pathname}#invite/${token}`;
    try {
      await navigator.clipboard.writeText(inviteUrl);
      showToast('Invite link copied — send it to your teammate', 'success');
    } catch {
      await requestInput('Copy this invite link and send it to your teammate:', inviteUrl);
    }
  };

  container.querySelector('#invite-member-form')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!workspaceId) return showToast('No team is selected', 'error');
    if (!isWorkspaceOwner) return showToast('Only the team owner can invite people.', 'error');
    const emailInput = container.querySelector('#invite-member-email');
    const submit = event.currentTarget.querySelector('button[type="submit"]');
    if (submit.disabled) return;
    submit.disabled = true;
    let result;
    try {
      result = await createWorkspaceInvitation(workspaceId, emailInput.value, roleSelect.value, userId);
    } catch (error) {
      result = { error };
    } finally {
      submit.disabled = false;
    }
    if (result.error) return showToast(`Could not invite: ${result.error.message}`, 'error');
    await copyInviteLink(result.data.token);
    await rerender('team');
  });

  container.querySelectorAll('.copy-invitation').forEach((button) => {
    button.addEventListener('click', () => button.dataset.token && copyInviteLink(button.dataset.token));
  });

  container.querySelectorAll('.member-role-select').forEach((select) => {
    const previous = select.value;
    select.addEventListener('change', async () => {
      const { error } = await updateWorkspaceMember(select.dataset.memberId, { role: select.value });
      if (error) {
        select.value = previous;
        return showToast(`Could not change role: ${error.message}`, 'error');
      }
      showToast(`Role changed to ${capitalize(select.value)}`, 'success');
    });
  });

  container.querySelectorAll('.remove-member').forEach((button) => {
    button.addEventListener('click', async () => {
      if (!await requestConfirmation(`Remove ${button.dataset.memberName} from ${teamName}? They will lose access to its projects.`)) return;
      const { error } = await removeWorkspaceMember(button.dataset.memberId);
      if (error) return showToast(`Could not remove member: ${error.message}`, 'error');
      showToast('Member removed', 'success');
      await rerender('team');
    });
  });

  container.querySelectorAll('.revoke-invitation').forEach((button) => {
    button.addEventListener('click', async () => {
      if (!await requestConfirmation('Cancel this invitation? The link will stop working.')) return;
      const { error } = await removeWorkspaceInvitation(button.dataset.invitationId);
      if (error) return showToast(`Could not cancel invitation: ${error.message}`, 'error');
      showToast('Invitation cancelled', 'success');
      await rerender('team');
    });
  });

  if (requested === 'team' && isWorkspaceOwner) {
    window.setTimeout(() => container.isConnected && container.querySelector('#invite-member-email')?.focus(), 150);
  }

  // ---------- Archive & backup ----------
  container.querySelectorAll('.restore-page').forEach((button) => {
    button.addEventListener('click', async () => {
      const { error: restoreError } = await restorePage(button.dataset.pageId);
      if (restoreError) return showToast('Could not restore page: ' + restoreError.message, 'error');
      showToast('Page restored', 'success');
      window.dispatchEvent(new CustomEvent('motion:pages-changed'));
      await rerender('data');
    });
  });

  container.querySelector('#settings-export-backup')?.addEventListener('click', async () => {
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

  container.querySelector('#settings-import-backup')?.addEventListener('click', () => container.querySelector('#settings-backup-input')?.click());
  container.querySelector('#settings-backup-input')?.addEventListener('change', async (event) => {
    const file = event.target.files?.[0];
    if (!file || !workspaceId) return;
    try {
      const backup = JSON.parse(await file.text());
      if (backup?.format !== 'motion-workspace-backup' || !Array.isArray(backup.pages) || !Array.isArray(backup.tasks)) {
        throw new Error('This is not a valid Groupify backup file.');
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
          ['note', 'document', 'database', 'kanban', 'project'].includes(sourcePage.page_type) ? sourcePage.page_type : 'note',
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
      await rerender('data');
    } catch (error) {
      showToast(`Could not import backup: ${error.message}`, 'error');
    } finally {
      event.target.value = '';
    }
  });

}

function capitalize(text) {
  const value = String(text || '');
  return value ? value[0].toUpperCase() + value.slice(1) : value;
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
    <label class="gs-row gs-switch-row">
      <span class="gs-row-icon material-symbols-outlined">${icon}</span>
      <span class="gs-row-main"><strong>${label}</strong><small>${description}</small></span>
      <span class="gs-switch"><input class="notification-toggle" type="checkbox" role="switch" data-key="${key}" ${checked ? 'checked' : ''} /><span aria-hidden="true"></span></span>
    </label>
  `;
}
