// Page tools: public share links, version history, and team templates.
import { supabase } from './supabase.js';
import { AppState, showToast } from '../legacy/app.js';
import { escapeHtml, sanitizeHtml } from './sanitize.js';
import { updatePage, timeAgo } from './queries.js';
import { requestForm } from './dialogs.js';

// ---------- small modal shell ----------

function openPanel({ title, body, wide = false }) {
  const previousFocus = document.activeElement;
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.style.zIndex = '1000';
  backdrop.innerHTML = `<section class="modal-container page-tool-panel ${wide ? 'is-wide' : ''}" role="dialog" aria-modal="true" aria-label="${escapeHtml(title)}">
    <div class="modal-header page-tool-head"><h3>${escapeHtml(title)}</h3><button type="button" class="page-tool-close" data-close aria-label="Close">×</button></div>
    <div class="modal-body page-tool-body">${body}</div>
  </section>`;
  const close = () => { backdrop.remove(); if (previousFocus?.isConnected) previousFocus.focus(); };
  backdrop.addEventListener('mousedown', (event) => { if (event.target === backdrop) close(); });
  backdrop.addEventListener('keydown', (event) => { if (event.key === 'Escape') { event.stopPropagation(); close(); } });
  backdrop.querySelector('[data-close]').addEventListener('click', close);
  document.body.append(backdrop);
  backdrop.querySelector('[data-close]').focus();
  return { root: backdrop, close };
}

// ---------- share ----------

export function shareUrl(token) {
  return `${window.location.origin}${window.location.pathname}#share/${token}`;
}

export async function openShareDialog(page) {
  const teamUrl = `${window.location.origin}${window.location.pathname}#editor/${page.id}`;
  const { root } = openPanel({
    title: 'Share page',
    body: `
      <div class="share-block">
        <div class="share-row"><span class="material-symbols-outlined">group</span><div><strong>Your team</strong><small>Everyone on ${escapeHtml(AppState.workspace?.name || 'the team')} can open and edit this page.</small></div><button type="button" class="project-btn" data-copy="${escapeHtml(teamUrl)}">Copy link</button></div>
      </div>
      <div class="share-block">
        <div class="share-row"><span class="material-symbols-outlined">public</span><div><strong>Anyone with the link</strong><small>Read-only. People don’t need an account. Turn it off any time.</small></div><label class="share-switch"><input type="checkbox" data-public /><span></span></label></div>
        <div class="share-public" hidden><input class="modal-input" readonly data-public-url /><button type="button" class="project-btn primary" data-copy-public>Copy</button></div>
        <p class="share-status" role="status"></p>
      </div>`
  });
  const toggle = root.querySelector('[data-public]');
  const box = root.querySelector('.share-public');
  const urlInput = root.querySelector('[data-public-url]');
  const status = root.querySelector('.share-status');
  const render = (share) => {
    toggle.checked = Boolean(share?.enabled);
    box.hidden = !share?.enabled;
    if (share?.token) urlInput.value = shareUrl(share.token);
  };
  const copy = async (text) => {
    try { await navigator.clipboard.writeText(text); showToast('Link copied', 'success'); } catch { urlInput.select(); }
  };
  root.querySelector('[data-copy]').addEventListener('click', (event) => copy(event.currentTarget.dataset.copy));
  root.querySelector('[data-copy-public]').addEventListener('click', () => copy(urlInput.value));

  const { data: existing, error: loadError } = await supabase.from('page_shares').select('*').eq('page_id', page.id).maybeSingle();
  if (loadError) status.textContent = `Public links are unavailable: ${loadError.message}`;
  let share = existing;
  render(share);
  toggle.addEventListener('change', async () => {
    toggle.disabled = true;
    status.textContent = 'Saving…';
    const result = share
      ? await supabase.from('page_shares').update({ enabled: toggle.checked }).eq('page_id', page.id).select().single()
      : await supabase.from('page_shares').insert({ page_id: page.id, workspace_id: page.workspace_id, enabled: true }).select().single();
    toggle.disabled = false;
    if (result.error) {
      status.textContent = `Could not update sharing: ${result.error.message}`;
      render(share);
      return;
    }
    share = result.data;
    render(share);
    status.textContent = share.enabled ? 'Anyone with this link can view the page.' : 'Public link turned off. The old link no longer works.';
  });
}

export async function fetchSharedPage(token) {
  const { data, error } = await supabase.rpc('get_shared_page', { share_token: token });
  if (error) return { error };
  return { data: Array.isArray(data) ? data[0] || null : data };
}

// ---------- history ----------

export async function openHistory(page, onRestored) {
  const { root, close } = openPanel({ title: 'Page history', wide: true, body: '<p class="history-loading">Loading versions…</p>' });
  const body = root.querySelector('.page-tool-body');
  const { data: versions, error } = await supabase
    .from('page_versions')
    .select('id, title, html, saved_at, created_at, editor:users!replaced_by(name)')
    .eq('page_id', page.id)
    .order('created_at', { ascending: false })
    .limit(50);
  if (error) {
    body.innerHTML = `<p class="history-empty">History is unavailable: ${escapeHtml(error.message)}</p>`;
    return;
  }
  if (!versions?.length) {
    body.innerHTML = '<p class="history-empty">No earlier versions yet. Motion saves a version automatically every 10 minutes while people edit.</p>';
    return;
  }
  body.innerHTML = `<div class="history">
    <ol class="history-list">${versions.map((version, index) => `<li><button type="button" data-version="${index}" class="${index === 0 ? 'is-active' : ''}">
      <strong>${escapeHtml(new Date(version.saved_at).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }))}</strong>
      <small>${escapeHtml(timeAgo(version.saved_at))}${version.editor?.name ? ` · before ${escapeHtml(version.editor.name)}’s edit` : ''}</small>
    </button></li>`).join('')}</ol>
    <div class="history-preview"><div class="history-preview-head"><span data-preview-title></span><button type="button" class="project-btn primary" data-restore>Restore this version</button></div><article class="history-doc editor-rich-content" data-preview></article></div>
  </div>`;
  let selected = 0;
  const show = (index) => {
    selected = index;
    body.querySelectorAll('[data-version]').forEach((button) => button.classList.toggle('is-active', Number(button.dataset.version) === index));
    body.querySelector('[data-preview-title]').textContent = versions[index].title || 'Untitled';
    body.querySelector('[data-preview]').innerHTML = sanitizeHtml(versions[index].html || '<p><em>Empty page</em></p>');
  };
  body.querySelector('.history-list').addEventListener('click', (event) => {
    const button = event.target.closest('[data-version]');
    if (button) show(Number(button.dataset.version));
  });
  body.querySelector('[data-restore]').addEventListener('click', async () => {
    const version = versions[selected];
    const { requestConfirmation } = await import('./dialogs.js');
    const ok = await requestConfirmation(`Replace the current page with the version from ${new Date(version.saved_at).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}? Edits made in the last few minutes may not be in history yet.`);
    if (!ok) return;
    const { error: restoreError } = await updatePage(page.id, { title: version.title || page.title, content: { ...(page.content || {}), html: version.html || '' } });
    if (restoreError) return showToast(`Could not restore: ${restoreError.message}`, 'error');
    try { localStorage.removeItem(`motion-page-draft:${page.id}`); } catch { /* ignore */ }
    showToast('Version restored', 'success');
    close();
    await onRestored?.();
  });
  show(0);
}

// ---------- team templates ----------

export async function loadTeamTemplates(kind = 'page') {
  const workspaceId = AppState.workspace?.id;
  if (!workspaceId) return [];
  const { data, error } = await supabase.from('page_templates').select('*').eq('workspace_id', workspaceId).eq('kind', kind).order('created_at', { ascending: false });
  return error ? [] : data || [];
}

export async function saveAsTemplate(page, { isProject = false, tasks = [] } = {}) {
  const values = await requestForm({
    title: isProject ? 'Save project as a team template' : 'Save page as a team template',
    description: isProject
      ? 'Your team can start new projects from it. The plan page and the task list (titles and priorities) are copied; owners and dates are not.'
      : 'Your team can create new pages from it. The page content is copied.',
    submitLabel: 'Save template',
    fields: [{ name: 'title', label: 'Template name', value: page.title || 'Untitled', required: true, maxLength: 120 }]
  });
  if (!values?.title) return null;
  const { data, error } = await supabase.from('page_templates').insert({
    workspace_id: page.workspace_id,
    kind: isProject ? 'project' : 'page',
    title: values.title,
    icon: page.icon || (isProject ? '📁' : '📄'),
    html: page.content?.html || '',
    tasks: isProject ? tasks.map((task) => ({ title: task.title, priority: task.priority || 'medium' })).slice(0, 50) : [],
    created_by: AppState.user?.id
  }).select().single();
  if (error) {
    showToast(`Could not save template: ${error.message}`, 'error');
    return null;
  }
  showToast(`Template “${values.title}” saved for your team`, 'success');
  return data;
}
