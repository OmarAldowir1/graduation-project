import { requestInput, requestConfirmation } from "../../lib/dialogs.js";
// ============================================
// MOTION — Notes Page Module (Legacy)
// ============================================

import { AppState, setBreadcrumb, showToast } from '../app.js';
import { getPages, getPage, createPage, updatePage, togglePageFavorite, archivePage, timeAgo } from '../../lib/queries.js';
import { escapeHtml, sanitizeHtml } from '../../lib/sanitize.js';

export async function renderNotes(container) {
  setBreadcrumb('Notes');

  const workspaceId = AppState.workspace?.id;
  if (!workspaceId) {
    container.innerHTML =
      `<div class="empty-state" style="min-height:60vh;"><span class="material-symbols-outlined">folder_off</span><h3>No workspace found</h3><p>Please create a workspace first.</p></div>`;
    return;
  }

  const { data: pages, error } = await getPages(workspaceId);
  if (error) {
    container.innerHTML =
      `<div class="error-state m-8"><span class="material-symbols-outlined">error</span><h3>Failed to load pages</h3><p>${escapeHtml(error.message || 'Please try again.')}</p></div>`;
    return;
  }

  let currentPage = pages.length > 0 ? pages[0] : null;
  const userName = AppState.profile?.name || 'You';

  container.innerHTML = `
    <div class="flex flex-1 min-h-0">
      <div class="w-64 bg-surface-container-low/50 border-r border-outline-variant/10 flex flex-col overflow-hidden">
        <div class="p-4 flex items-center justify-between">
          <div class="flex items-center gap-2">
            <h3 class="font-bold text-sm text-on-surface">All Notes</h3>
            <span class="text-[10px] text-on-surface-variant" id="notes-visible-count">${pages.length}</span>
          </div>
          <button id="btn-new-note-page" class="p-1 hover:bg-surface-container-high rounded transition-colors">
            <span class="material-symbols-outlined text-sm">add</span>
          </button>
        </div>
        <label class="mx-3 mb-3 flex items-center gap-2 px-3 py-2 bg-surface-container rounded-lg text-xs text-on-surface-variant">
          <span class="material-symbols-outlined text-sm">search</span>
          <input id="notes-search" class="min-w-0 flex-1 bg-transparent border-none outline-none text-on-surface placeholder:text-on-surface-variant/60" type="search" placeholder="Find notes..." />
        </label>
        <label class="mx-3 mb-3 flex items-center gap-2 text-xs text-on-surface-variant">
          <input id="notes-favorites-only" type="checkbox" />
          Favorites only
        </label>
        <select id="notes-sort" class="mx-3 mb-3 w-[calc(100%-1.5rem)] px-3 py-2 bg-surface-container rounded-lg border-none outline-none text-xs text-on-surface-variant" aria-label="Sort notes">
          <option value="updated">Recently updated</option>
          <option value="title">Title A–Z</option>
          <option value="favorite">Favorites first</option>
        </select>
        <div class="flex-1 overflow-y-auto px-2 pb-4 space-y-1" id="notes-page-list">
          <div id="notes-root-drop" class="px-3 py-2 text-[11px] uppercase tracking-wider text-on-surface-variant/60 rounded-lg border border-dashed border-transparent transition-colors" aria-label="Drop here to move a page to the root level">Root pages</div>
          ${
            pages.length === 0
              ? `<div class="text-center py-8 text-on-surface-variant/40 text-xs px-4">No pages yet. Create one to start writing.</div>`
              : pages
                  .map(
                    (page, i) => `
            <div role="button" tabindex="0" draggable="true" style="padding-left:${Math.min(4, getPageDepth(page, pages)) * 0.75 + 0.75}rem" class="w-full text-left px-3 py-2.5 rounded-lg text-sm transition-colors ${
              i === 0
                ? 'bg-white shadow-sm font-semibold text-on-surface'
                : 'text-on-surface-variant hover:bg-surface-container-low'
            }" data-page-id="${page.id}" data-page-title="${escapeHtml(String(page.title || '').toLowerCase())}" data-page-favorite="${page.is_favorite ? 'true' : 'false'}" data-page-updated="${page.updated_at || ''}">
              <div class="flex items-center gap-2">
                <span class="text-base">${escapeHtml(page.parent_id ? '↳' : page.icon || '📄')}</span>
                <div class="min-w-0">
                  <p class="truncate font-medium">${escapeHtml(page.title || 'Untitled')}</p>
                  <p class="text-[10px] text-on-surface-variant truncate">${timeAgo(page.updated_at)}</p>
                </div>
                <button type="button" class="toggle-note-favorite ml-auto text-tertiary hover:text-primary" data-toggle-favorite="${page.id}" data-favorite="${page.is_favorite ? 'true' : 'false'}" aria-label="${page.is_favorite ? 'Remove from favorites' : 'Add to favorites'}">
                  <span class="material-symbols-outlined text-sm">${page.is_favorite ? 'star' : 'star_outline'}</span>
                </button>
              </div>
            </div>
          `
                  )
                  .join('')
          }
        </div>
      </div>

      <div class="flex-1 overflow-y-auto">
        ${
          currentPage
            ? renderNoteEditor(currentPage, userName)
            : `<div class="empty-state" style="min-height:60vh;"><span class="material-symbols-outlined">edit_note</span><h3>Select or create a note</h3><p>Choose a page from the sidebar to start editing.</p></div>`
        }
      </div>
    </div>

    <div class="fixed bottom-8 left-1/2 -translate-x-1/2 glass-panel border border-outline-variant/20 rounded-full px-6 py-3 flex items-center gap-6 shadow-2xl z-50">
      <button data-note-tool="text" class="flex items-center gap-2 text-sm font-medium text-on-surface-variant hover:text-on-surface transition-colors" type="button">
        <span class="material-symbols-outlined">text_fields</span>
        Type
      </button>
      <div class="w-[1px] h-4 bg-outline-variant/30"></div>
      <button data-note-tool="list" class="flex items-center gap-2 text-sm font-medium text-on-surface-variant hover:text-on-surface transition-colors" type="button">
        <span class="material-symbols-outlined">format_list_bulleted</span>
        List
      </button>
      <button data-note-tool="media" class="flex items-center gap-2 text-sm font-medium text-on-surface-variant hover:text-on-surface transition-colors" type="button">
        <span class="material-symbols-outlined">image</span>
        Media
      </button>
      <button data-note-tool="link" class="flex items-center gap-2 text-sm font-medium text-on-surface-variant hover:text-on-surface transition-colors" type="button">
        <span class="material-symbols-outlined">add_link</span>
        Link
      </button>
    </div>
  `;

  let saveTimeout;
  function bindEditorAutosave(page) {
    const editorEl = container.querySelector('#note-content');
    const titleEl = container.querySelector('#note-title');
    if (!editorEl || !titleEl || !page?.id) return;

    function debouncedSave() {
      clearTimeout(saveTimeout);
      const status = container.querySelector('#notes-save-status');
      if (status) status.textContent = 'Saving…';
      saveTimeout = setTimeout(async () => {
        const content = { ...(page.content || {}), html: sanitizeHtml(editorEl.innerHTML || '') };
        const title = titleEl.textContent || 'Untitled';
      writeNoteDraft(page.id, { title, html: content.html });
        const { error } = await updatePage(page.id, { title, content });
        if (status) status.textContent = error ? 'Save failed' : 'Saved';
      if (!error) clearNoteDraft(page.id);
        if (error) showToast('Failed to save: ' + error.message, 'error');
      }, 1500);
    }

    editorEl.addEventListener('input', debouncedSave);
    editorEl.addEventListener('change', (event) => {
      if (event.target.matches('input[type="checkbox"]')) {
        event.target.toggleAttribute('checked', event.target.checked);
        debouncedSave();
      }
    });
    titleEl.addEventListener('input', debouncedSave);
  }

  if (currentPage) bindEditorAutosave(currentPage);
  if (currentPage) bindNoteArchive(currentPage, container);

  const handleRemotePage = async (event) => {
    if (!currentPage || event.detail !== currentPage.id || !container.isConnected) return;
    if (document.activeElement?.isContentEditable) return;
    const { data: refreshedPage } = await getPage(currentPage.id);
    if (!refreshedPage) return;
    currentPage = refreshedPage;
    const editorArea = container.querySelector('.flex-1.overflow-y-auto');
    if (editorArea) {
      editorArea.innerHTML = renderNoteEditor(currentPage, userName);
      bindEditorAutosave(currentPage);
      bindNoteArchive(currentPage, container);
    }
  };
  if (container.__motionNotesPageHandler) {
    window.removeEventListener('motion:page-changed', container.__motionNotesPageHandler);
  }
  container.__motionNotesPageHandler = handleRemotePage;
  window.addEventListener('motion:page-changed', handleRemotePage);

  container.querySelector('#notes-search')?.addEventListener('input', async (event) => {
    applyNotesFilter(container, event.target.value);
  });
  container.querySelector('#notes-favorites-only')?.addEventListener('change', async () => applyNotesFilter(container));
  container.querySelector('#notes-sort')?.addEventListener('change', async () => applyNotesFilter(container));

  container.querySelectorAll('[data-note-tool]').forEach((button) => {
    button.addEventListener('click', async () => {
      const editor = container.querySelector('#note-content');
      if (!editor) return;
      editor.focus();
      const tool = button.dataset.noteTool;
      if (tool === 'text') document.execCommand('formatBlock', false, 'p');
      if (tool === 'list') document.execCommand('insertUnorderedList');
      if (tool === 'link') {
        const url = await requestInput('Enter a URL');
        if (url && /^https?:\/\//i.test(url)) document.execCommand('createLink', false, url);
      }
      if (tool === 'media') {
        const url = await requestInput('Paste an image URL');
        if (url && /^https?:\/\//i.test(url)) document.execCommand('insertHTML', false, `<img src="${escapeAttribute(url)}" alt="Inserted image" class="max-w-full rounded-xl" />`);
      }
      editor.dispatchEvent(new Event('input', { bubbles: true }));
    });
  });

  container.querySelector('#btn-new-note-page')?.addEventListener('click', async () => {
    const title = await requestInput('Note title:') || 'Untitled';
    const { error } = await createPage(workspaceId, title, 'note');
    if (error) {
      showToast('Failed to create note: ' + error.message, 'error');
      return;
    }
    showToast('Note created!', 'success');
    renderNotes(container);
  });

  container.querySelectorAll('[data-page-id]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const pageId = btn.dataset.pageId;
      const { data: page } = await getPage(pageId);
      if (page) {
        container.querySelectorAll('#notes-page-list [data-page-id]').forEach((item) => {
          item.classList.remove('bg-white', 'shadow-sm', 'font-semibold', 'text-on-surface');
          item.classList.add('text-on-surface-variant', 'hover:bg-surface-container-low');
        });
        btn.classList.remove('text-on-surface-variant', 'hover:bg-surface-container-low');
        btn.classList.add('bg-white', 'shadow-sm', 'font-semibold', 'text-on-surface');
        currentPage = page;
        const editorArea = container.querySelector('.flex-1.overflow-y-auto');
        if (editorArea) {
          editorArea.innerHTML = renderNoteEditor(page, userName);
          bindEditorAutosave(page);
          bindNoteArchive(page, container);
        }
      }
    });
    btn.addEventListener('keydown', async (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        btn.click();
      }
    });
    btn.addEventListener('dragstart', async (event) => {
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', btn.dataset.pageId);
      btn.classList.add('opacity-50');
    });
    btn.addEventListener('dragend', async () => btn.classList.remove('opacity-50'));
    btn.addEventListener('dragover', async (event) => {
      const draggedId = event.dataTransfer.types.includes('text/plain') ? event.dataTransfer.getData('text/plain') : null;
      if (!draggedId || draggedId === btn.dataset.pageId) return;
      event.preventDefault();
      btn.classList.add('ring-2', 'ring-primary');
    });
    btn.addEventListener('dragleave', async () => btn.classList.remove('ring-2', 'ring-primary'));
    btn.addEventListener('drop', async (event) => {
      event.preventDefault();
      btn.classList.remove('ring-2', 'ring-primary');
      const draggedId = event.dataTransfer.getData('text/plain');
      const draggedPage = pages.find((page) => page.id === draggedId);
      const targetPage = pages.find((page) => page.id === btn.dataset.pageId);
      if (!draggedPage || !targetPage) return;
      if (draggedPage.id === targetPage.id || isPageDescendant(targetPage.id, draggedPage.id, pages)) {
        showToast('A page cannot be nested inside itself or its descendants', 'error');
        return;
      }
      const { error: moveError } = await updatePage(draggedPage.id, { parent_id: targetPage.id });
      if (moveError) return showToast(`Could not nest page: ${moveError.message}`, 'error');
      showToast(`Moved under “${targetPage.title || 'Untitled'}”`, 'success');
      renderNotes(container);
    });
  });

  container.querySelectorAll('.toggle-note-favorite').forEach((button) => {
    button.addEventListener('click', async (event) => {
      event.stopPropagation();
      const nextFavorite = button.dataset.favorite !== 'true';
      const { error: favoriteError } = await togglePageFavorite(button.dataset.toggleFavorite, nextFavorite);
      if (favoriteError) {
        showToast('Could not update favorite: ' + favoriteError.message, 'error');
        return;
      }
      showToast(nextFavorite ? 'Added to favorites' : 'Removed from favorites', 'success');
      renderNotes(container);
    });
  });

  const rootDrop = container.querySelector('#notes-root-drop');
  rootDrop?.addEventListener('dragover', async (event) => {
    if (!event.dataTransfer.types.includes('text/plain')) return;
    event.preventDefault();
    rootDrop.classList.add('border-primary', 'bg-primary-container/30', 'text-primary');
  });
  rootDrop?.addEventListener('dragleave', async () => rootDrop.classList.remove('border-primary', 'bg-primary-container/30', 'text-primary'));
  rootDrop?.addEventListener('drop', async (event) => {
    event.preventDefault();
    rootDrop.classList.remove('border-primary', 'bg-primary-container/30', 'text-primary');
    const draggedId = event.dataTransfer.getData('text/plain');
    const draggedPage = pages.find((page) => page.id === draggedId);
    if (!draggedPage || !draggedPage.parent_id) return;
    const { error: moveError } = await updatePage(draggedPage.id, { parent_id: null });
    if (moveError) return showToast(`Could not move page: ${moveError.message}`, 'error');
    showToast('Moved to root pages', 'success');
    renderNotes(container);
  });
}

function applyNotesFilter(container, queryValue) {
  const query = (queryValue ?? container.querySelector('#notes-search')?.value ?? '').trim().toLowerCase();
  const favoritesOnly = Boolean(container.querySelector('#notes-favorites-only')?.checked);
  const sort = container.querySelector('#notes-sort')?.value || 'updated';
  const list = container.querySelector('#notes-page-list');
  const buttons = [...container.querySelectorAll('#notes-page-list [data-page-id]')];
  buttons.sort((left, right) => {
    if (sort === 'title') return left.dataset.pageTitle.localeCompare(right.dataset.pageTitle);
    if (sort === 'favorite') return Number(right.dataset.pageFavorite === 'true') - Number(left.dataset.pageFavorite === 'true') || right.dataset.pageUpdated.localeCompare(left.dataset.pageUpdated);
    return right.dataset.pageUpdated.localeCompare(left.dataset.pageUpdated);
  });
  buttons.forEach((button) => list?.appendChild(button));
  buttons.forEach((button) => {
    const matchesQuery = !query || button.dataset.pageTitle.includes(query);
    const matchesFavorite = !favoritesOnly || button.dataset.pageFavorite === 'true';
    button.hidden = !(matchesQuery && matchesFavorite);
  });
  const count = container.querySelector('#notes-visible-count');
  if (count) count.textContent = buttons.filter((button) => !button.hidden).length;
}

function getPageDepth(page, pages, seen = new Set()) {
  if (!page?.parent_id || seen.has(page.id)) return 0;
  const parent = pages.find((candidate) => candidate.id === page.parent_id);
  if (!parent) return 0;
  seen.add(page.id);
  return 1 + getPageDepth(parent, pages, seen);
}

function isPageDescendant(candidateId, ancestorId, pages) {
  const byId = new Map(pages.map((page) => [page.id, page]));
  const seen = new Set();
  let current = byId.get(candidateId);
  while (current?.parent_id && !seen.has(current.id)) {
    if (current.parent_id === ancestorId) return true;
    seen.add(current.id);
    current = byId.get(current.parent_id);
  }
  return false;
}

function renderNoteEditor(page, userName) {
  const draft = readNoteDraft(page.id);
  const contentHtml = sanitizeHtml(draft ? draft.html : page.content?.html || '<p class="text-on-surface-variant">Start writing here...</p>');
  const safeTitle = escapeHtml((draft ? draft.title : page.title) || 'Untitled');
  const safeIcon = escapeHtml(page.icon || '📄');
  const safeUserName = escapeHtml(userName);

  return `
    <section class="flex-1 overflow-y-auto px-6 py-12 bg-surface">
      <article class="max-w-[800px] mx-auto animate-fade-in">
        <header class="mb-12 group">
          <div class="mb-6 opacity-80 hover:opacity-100 transition-opacity cursor-pointer inline-block">
            <span class="text-5xl">${safeIcon}</span>
          </div>
          <h1 id="note-title" class="text-5xl font-extrabold tracking-tighter text-on-surface mb-4 outline-none border-none focus:ring-0" contenteditable="true">
            ${safeTitle}
          </h1>
          <div class="flex items-center gap-6 text-on-surface-variant text-sm">
            <div class="flex items-center gap-2">
              <span class="material-symbols-outlined text-sm">person</span>
              <span>${safeUserName}</span>
            </div>
            <div class="flex items-center gap-2">
              <span class="material-symbols-outlined text-sm">schedule</span>
              <span>${timeAgo(page.updated_at)}</span>
            </div>
            <div class="flex items-center gap-2 text-primary" aria-live="polite">
              <span class="material-symbols-outlined text-sm">${draft ? 'cloud_off' : 'cloud_done'}</span>
              <span id="notes-save-status">${draft ? 'Local draft recovered' : 'Saved'}</span>
            </div>
          </div>
          <button id="note-archive" class="mt-5 inline-flex items-center gap-1.5 text-xs font-semibold text-on-surface-variant hover:text-primary transition-colors" type="button">
            <span class="material-symbols-outlined text-sm">archive</span>
            Archive note
          </button>
        </header>

        <div id="note-content" class="space-y-8 text-on-surface leading-relaxed text-lg outline-none" contenteditable="true">
          ${contentHtml}
        </div>
      </article>
    </section>
  `;
}

function noteDraftKey(pageId) {
  return `motion-page-draft:${pageId}`;
}

function readNoteDraft(pageId) {
  try {
    const raw = localStorage.getItem(noteDraftKey(pageId));
    if (!raw) return null;
    const draft = JSON.parse(raw);
    return draft && typeof draft === 'object'
      ? { title: typeof draft.title === 'string' ? draft.title : '', html: typeof draft.html === 'string' ? draft.html : '' }
      : null;
  } catch {
    try {
      localStorage.removeItem(noteDraftKey(pageId));
    } catch {
      // Ignore storage cleanup failures.
    }
    return null;
  }
}

function writeNoteDraft(pageId, draft) {
  try {
    localStorage.setItem(noteDraftKey(pageId), JSON.stringify({ ...draft, savedAt: new Date().toISOString() }));
  } catch {
    // Local storage may be unavailable; the remote save still runs.
  }
}

function clearNoteDraft(pageId) {
  try {
    localStorage.removeItem(noteDraftKey(pageId));
  } catch {
    // Ignore storage cleanup failures.
  }
}

function bindNoteArchive(page, container) {
  container.querySelector('#note-archive')?.addEventListener('click', async () => {
    if (!await requestConfirmation(`Archive “${page.title || 'Untitled'}”? You can restore it later from Settings.`)) return;
    const { error } = await archivePage(page.id);
    if (error) {
      showToast('Could not archive note: ' + error.message, 'error');
      return;
    }
    clearNoteDraft(page.id);
    showToast('Note archived', 'success');
    renderNotes(container);
  });

}

function escapeAttribute(value = '') {
  return String(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[character]);
}
