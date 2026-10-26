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

  // Preserve selected page across re-renders
  let currentPage = (container.__motionCurrentPageId && pages.find((p) => p.id === container.__motionCurrentPageId)) || (pages.length > 0 ? pages[0] : null);
  container.__motionCurrentPageId = currentPage?.id || null;
  const userName = AppState.profile?.name || 'You';

  // Sort pages according to selected sort mode before building hierarchy
  const sortMode = container.__motionSortMode || 'updated';
  pages.sort((left, right) => {
    if (sortMode === 'title') return (left.title || '').localeCompare(right.title || '');
    if (sortMode === 'favorite') {
      return (Number(right.is_favorite === true) - Number(left.is_favorite === true)) || (right.updated_at || '').localeCompare(left.updated_at || '');
    }
    return (right.updated_at || '').localeCompare(left.updated_at || '');
  });

  const { roots } = buildNotesHierarchy(pages);
  const expandedSet = getExpandedFolderSet();

  container.innerHTML = `
    <div class="flex flex-1 min-h-0">
      <div class="w-64 bg-surface-container-low/50 border-r border-outline-variant/10 flex flex-col overflow-hidden">
        <div class="p-4 flex items-center justify-between">
          <div class="flex items-center gap-2">
            <h3 class="font-bold text-sm text-on-surface">All Notes</h3>
            <span class="text-[10px] text-on-surface-variant" id="notes-visible-count">${pages.length}</span>
          </div>
          <button id="btn-new-note-page" class="p-1 hover:bg-surface-container-high rounded transition-colors" title="New Note">
            <span class="material-symbols-outlined text-sm">add</span>
          </button>
        </div>
        <label class="mx-3 mb-2 flex items-center gap-2 px-3 py-2 bg-surface-container rounded-lg text-xs text-on-surface-variant">
          <span class="material-symbols-outlined text-sm">search</span>
          <input id="notes-search" class="min-w-0 flex-1 bg-transparent border-none outline-none text-on-surface placeholder:text-on-surface-variant/60" type="search" placeholder="Find notes..." />
        </label>
        <div class="mx-3 mb-2 flex items-center justify-between gap-2">
          <label class="flex items-center gap-1.5 text-xs text-on-surface-variant cursor-pointer select-none">
            <input id="notes-favorites-only" type="checkbox" class="rounded border-outline-variant text-primary focus:ring-0" />
            Favorites only
          </label>
          <select id="notes-sort" class="px-2 py-1 bg-surface-container rounded text-[11px] border-none outline-none text-on-surface-variant" aria-label="Sort notes">
            <option value="updated" ${sortMode === 'updated' ? 'selected' : ''}>Recently updated</option>
            <option value="title" ${sortMode === 'title' ? 'selected' : ''}>Title A–Z</option>
            <option value="favorite" ${sortMode === 'favorite' ? 'selected' : ''}>Favorites first</option>
          </select>
        </div>

        <div class="flex-1 overflow-y-auto px-2 pb-4 space-y-1" id="notes-page-list">
          <!-- Root drop zone for un-nesting files -->
          <div
            id="notes-root-drop"
            class="px-2.5 py-1.5 text-[11px] text-on-surface-variant/60 rounded-lg border border-dashed border-outline-variant/30 transition-all flex items-center gap-1.5 cursor-pointer hover:border-primary/50"
            aria-label="Drop here to move a page to the root level"
            title="Drop here to move page to root level"
          >
            <span class="material-symbols-outlined text-sm opacity-70">drive_file_move</span>
            <span class="truncate">Root pages (Drop here to un-nest)</span>
          </div>

          ${
            roots.length === 0
              ? `<div class="text-center py-8 text-on-surface-variant/40 text-xs px-4">No pages yet. Create one to start writing.</div>`
              : renderNoteTree(roots, pages, currentPage?.id, expandedSet, 0)
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
  container.querySelector('#notes-sort')?.addEventListener('change', async (e) => {
    container.__motionSortMode = e.target.value;
    renderNotes(container);
  });

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
    const title = (await requestInput('Note title:')) || 'Untitled';
    const { error } = await createPage(workspaceId, title, 'note');
    if (error) {
      showToast('Failed to create note: ' + error.message, 'error');
      return;
    }
    showToast('Note created!', 'success');
    renderNotes(container);
  });

  // Toggle Folder Buttons (side arrow -> points down on expand)
  container.querySelectorAll('.toggle-folder-btn').forEach((btn) => {
    btn.addEventListener('click', (event) => {
      event.stopPropagation();
      const folderId = btn.dataset.toggleFolder;
      const childContainer = container.querySelector(`.note-children-container[data-children-of="${folderId}"]`);
      const arrowIcon = btn.querySelector('.note-folder-arrow');
      const folderIcon = btn.closest('.note-row')?.querySelector('.folder-state-icon');
      const expSet = getExpandedFolderSet();

      if (childContainer) {
        const isHidden = childContainer.classList.contains('hidden');
        if (isHidden) {
          childContainer.classList.remove('hidden');
          arrowIcon?.classList.add('rotate-90', 'is-expanded');
          if (folderIcon) folderIcon.textContent = 'folder_open';
          expSet.add(folderId);
        } else {
          childContainer.classList.add('hidden');
          arrowIcon?.classList.remove('rotate-90', 'is-expanded');
          if (folderIcon) folderIcon.textContent = 'folder';
          expSet.delete(folderId);
        }
        saveExpandedFolderSet(expSet);
      }
    });
  });

  // Page Row Selection & Drag and Drop
  container.querySelectorAll('.note-row').forEach((btn) => {
    btn.addEventListener('click', async (event) => {
      if (event.target.closest('.toggle-folder-btn') || event.target.closest('.toggle-note-favorite')) {
        return;
      }

      const pageId = btn.dataset.pageId;
      const hasChildren = btn.dataset.hasChildren === 'true';

      // When clicking parent folder, expand it if currently collapsed
      if (hasChildren) {
        const childContainer = container.querySelector(`.note-children-container[data-children-of="${pageId}"]`);
        const arrowBtn = btn.querySelector('.toggle-folder-btn');
        const arrowIcon = arrowBtn?.querySelector('.note-folder-arrow');
        const folderIcon = btn.querySelector('.folder-state-icon');
        if (childContainer && childContainer.classList.contains('hidden')) {
          childContainer.classList.remove('hidden');
          arrowIcon?.classList.add('rotate-90', 'is-expanded');
          if (folderIcon) folderIcon.textContent = 'folder_open';
          const expSet = getExpandedFolderSet();
          expSet.add(pageId);
          saveExpandedFolderSet(expSet);
        }
      }

      container.__motionCurrentPageId = pageId;
      const { data: page } = await getPage(pageId);
      if (page) {
        container.querySelectorAll('#notes-page-list .note-row').forEach((item) => {
          item.classList.remove('bg-white', 'dark:bg-stone-800', 'shadow-sm', 'font-semibold', 'text-on-surface', 'ring-1', 'ring-outline-variant/15');
          item.classList.add('text-on-surface-variant', 'hover:bg-surface-container-low', 'hover:text-on-surface');
        });
        btn.classList.remove('text-on-surface-variant', 'hover:bg-surface-container-low', 'hover:text-on-surface');
        btn.classList.add('bg-white', 'dark:bg-stone-800', 'shadow-sm', 'font-semibold', 'text-on-surface', 'ring-1', 'ring-outline-variant/15');
        currentPage = page;
        const editorArea = container.querySelector('.flex-1.overflow-y-auto');
        if (editorArea) {
          editorArea.innerHTML = renderNoteEditor(page, userName);
          bindEditorAutosave(page);
          bindNoteArchive(page, container);
        }
      }
    });

    btn.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        btn.click();
      }
    });

    btn.addEventListener('dragstart', (event) => {
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', btn.dataset.pageId);
      btn.classList.add('opacity-40');
    });

    btn.addEventListener('dragend', () => {
      btn.classList.remove('opacity-40');
      container.querySelectorAll('.note-row').forEach((r) => r.classList.remove('drag-over', 'ring-2', 'ring-primary', 'bg-primary/10'));
    });

    btn.addEventListener('dragover', (event) => {
      const draggedId = event.dataTransfer.types.includes('text/plain') ? event.dataTransfer.getData('text/plain') : null;
      if (draggedId === btn.dataset.pageId) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
      btn.classList.add('drag-over', 'ring-2', 'ring-primary', 'bg-primary/10');
    });

    btn.addEventListener('dragleave', (event) => {
      if (!btn.contains(event.relatedTarget)) {
        btn.classList.remove('drag-over', 'ring-2', 'ring-primary', 'bg-primary/10');
      }
    });

    btn.addEventListener('drop', async (event) => {
      event.preventDefault();
      event.stopPropagation();
      btn.classList.remove('drag-over', 'ring-2', 'ring-primary', 'bg-primary/10');

      const draggedId = event.dataTransfer.getData('text/plain');
      const targetId = btn.dataset.pageId;

      if (!draggedId || draggedId === targetId) return;

      const draggedPage = pages.find((p) => p.id === draggedId);
      const targetPage = pages.find((p) => p.id === targetId);

      if (!draggedPage || !targetPage) return;

      if (isPageDescendant(targetPage.id, draggedPage.id, pages)) {
        showToast('Cannot move a folder inside itself or one of its subpages', 'error');
        return;
      }

      const { error: moveError } = await updatePage(draggedPage.id, { parent_id: targetPage.id });
      if (moveError) {
        showToast(`Failed to move page: ${moveError.message}`, 'error');
        return;
      }

      // Automatically expand target folder so user immediately sees the dropped child
      const expSet = getExpandedFolderSet();
      expSet.add(targetPage.id);
      saveExpandedFolderSet(expSet);

      showToast(`Moved page into "${targetPage.title || 'Untitled'}" successfully`, 'success');
      window.dispatchEvent(new CustomEvent('motion:page-changed', { detail: draggedPage.id }));
      renderNotes(container);
    });
  });

  // Favorite buttons
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

  // Root drop zone
  const rootDrop = container.querySelector('#notes-root-drop');
  rootDrop?.addEventListener('dragover', (event) => {
    if (!event.dataTransfer.types.includes('text/plain')) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    rootDrop.classList.add('border-primary', 'bg-primary/10', 'text-primary');
  });
  rootDrop?.addEventListener('dragleave', (event) => {
    if (!rootDrop.contains(event.relatedTarget)) {
      rootDrop.classList.remove('border-primary', 'bg-primary/10', 'text-primary');
    }
  });
  rootDrop?.addEventListener('drop', async (event) => {
    event.preventDefault();
    rootDrop.classList.remove('border-primary', 'bg-primary/10', 'text-primary');
    const draggedId = event.dataTransfer.getData('text/plain');
    const draggedPage = pages.find((page) => page.id === draggedId);
    if (!draggedPage || !draggedPage.parent_id) return;
    const { error: moveError } = await updatePage(draggedPage.id, { parent_id: null });
    if (moveError) return showToast(`Could not move page: ${moveError.message}`, 'error');
    showToast('Moved page to root level', 'success');
    window.dispatchEvent(new CustomEvent('motion:page-changed', { detail: draggedPage.id }));
    renderNotes(container);
  });
}

const NOTES_EXPANDED_KEY = 'motion-notes-expanded-folders';

function getExpandedFolderSet() {
  try {
    const raw = localStorage.getItem(NOTES_EXPANDED_KEY);
    return raw ? new Set(JSON.parse(raw)) : new Set();
  } catch {
    return new Set();
  }
}

function saveExpandedFolderSet(set) {
  try {
    localStorage.setItem(NOTES_EXPANDED_KEY, JSON.stringify([...set]));
  } catch {
    // Ignore storage errors
  }
}

function buildNotesHierarchy(pages) {
  const map = new Map();
  pages.forEach((p) => map.set(p.id, { ...p, children: [] }));
  const roots = [];

  pages.forEach((p) => {
    const node = map.get(p.id);
    if (p.parent_id && map.has(p.parent_id)) {
      map.get(p.parent_id).children.push(node);
    } else {
      roots.push(node);
    }
  });

  return { roots, map };
}

function renderNoteTree(nodes, pages, currentSelectedId, expandedSet, depth = 0) {
  if (!nodes || nodes.length === 0) return '';

  return nodes
    .map((node) => {
      const hasChildren = node.children && node.children.length > 0;
      const isExpanded = expandedSet.has(node.id);
      const isSelected = currentSelectedId === node.id;
      const isNested = depth > 0;

      // Font size: Root notes have text-sm, nested notes have text-xs (slightly smaller font!)
      const fontClass = isNested ? 'text-xs' : 'text-sm font-medium';
      const pyClass = isNested ? 'py-1.5' : 'py-2';
      const iconSizeClass = isNested ? 'text-[15px]' : 'text-base';
      const timeClass = isNested ? 'text-[9px]' : 'text-[10px]';

      return `
        <div class="note-node-wrapper w-full" data-node-id="${node.id}">
          <div
            role="button"
            tabindex="0"
            draggable="true"
            data-page-id="${node.id}"
            data-page-title="${escapeHtml(String(node.title || '').toLowerCase())}"
            data-page-favorite="${node.is_favorite ? 'true' : 'false'}"
            data-page-updated="${node.updated_at || ''}"
            data-has-children="${hasChildren ? 'true' : 'false'}"
            data-depth="${depth}"
            class="note-row group w-full text-left flex items-center gap-1.5 px-2.5 ${pyClass} rounded-lg ${fontClass} transition-colors duration-150 cursor-pointer select-none ${
              isSelected
                ? 'bg-white dark:bg-stone-800 shadow-sm font-semibold text-on-surface ring-1 ring-outline-variant/15'
                : 'text-on-surface-variant hover:bg-surface-container-low hover:text-on-surface'
            }"
          >
            <!-- Arrow toggle if parent folder (points down when expanded) -->
            ${
              hasChildren
                ? `
              <button
                type="button"
                class="toggle-folder-btn p-1 -ml-1.5 rounded hover:bg-surface-container-high text-on-surface-variant/70 hover:text-on-surface flex items-center justify-center flex-shrink-0"
                data-toggle-folder="${node.id}"
                title="${isExpanded ? 'Collapse folder' : 'Expand folder'}"
                aria-label="${isExpanded ? 'Collapse folder' : 'Expand folder'}"
              >
                <span class="material-symbols-outlined text-[17px] note-folder-arrow ${isExpanded ? 'is-expanded rotate-90' : ''}">
                  chevron_right
                </span>
              </button>
            `
                : `
              <span class="w-5 h-5 flex-shrink-0 -ml-1.5 inline-block"></span>
            `
            }

            <!-- Folder or Page Icon -->
            <span class="flex-shrink-0 flex items-center justify-center mr-0.5">
              ${
                hasChildren
                  ? `
                <span class="material-symbols-outlined ${iconSizeClass} text-amber-500 folder-state-icon flex-shrink-0">
                  ${isExpanded ? 'folder_open' : 'folder'}
                </span>
              `
                  : node.icon
                  ? `<span class="${iconSizeClass}">${escapeHtml(node.icon)}</span>`
                  : `
                <span class="material-symbols-outlined ${iconSizeClass} opacity-70 flex-shrink-0">
                  ${node.page_type === 'kanban' ? 'view_kanban' : node.page_type === 'database' ? 'local_library' : 'description'}
                </span>
              `
              }
            </span>

            <!-- Title & Timestamp -->
            <div class="min-w-0 flex-1">
              <p class="truncate leading-tight ${isNested ? 'text-[12px] font-normal' : 'text-sm font-medium'}">${escapeHtml(node.title || 'Untitled')}</p>
              <p class="${timeClass} text-on-surface-variant/60 truncate leading-none mt-0.5">${timeAgo(node.updated_at)}</p>
            </div>

            <!-- Favorite star button -->
            <button
              type="button"
              class="toggle-note-favorite ml-auto p-1 rounded transition-opacity flex-shrink-0 ${
                node.is_favorite ? 'text-amber-400 opacity-100' : 'text-on-surface-variant/30 hover:text-amber-400 opacity-0 group-hover:opacity-100'
              }"
              data-toggle-favorite="${node.id}"
              data-favorite="${node.is_favorite ? 'true' : 'false'}"
              aria-label="${node.is_favorite ? 'Remove from favorites' : 'Add to favorites'}"
            >
              <span class="material-symbols-outlined text-sm">${node.is_favorite ? 'star' : 'star_outline'}</span>
            </button>
          </div>

          <!-- Dropdown/Nested children list (indented with slightly smaller font) -->
          ${
            hasChildren
              ? `
            <div
              class="note-children-container relative border-l-2 border-outline-variant/15 space-y-0.5 mt-0.5 mb-1 ${
                isExpanded ? '' : 'hidden'
              }"
              data-children-of="${node.id}"
              style="margin-left: 1.15rem; padding-left: 0.25rem;"
            >
              ${renderNoteTree(node.children, pages, currentSelectedId, expandedSet, depth + 1)}
            </div>
          `
              : ''
          }
        </div>
      `;
    })
    .join('');
}

function applyNotesFilter(container, queryValue) {
  const query = (queryValue ?? container.querySelector('#notes-search')?.value ?? '').trim().toLowerCase();
  const favoritesOnly = Boolean(container.querySelector('#notes-favorites-only')?.checked);
  const allRows = [...container.querySelectorAll('.note-row')];

  if (!query && !favoritesOnly) {
    const expSet = getExpandedFolderSet();
    allRows.forEach((row) => {
      const wrapper = row.closest('.note-node-wrapper');
      if (wrapper) wrapper.hidden = false;
    });
    container.querySelectorAll('.note-children-container').forEach((childContainer) => {
      const folderId = childContainer.dataset.childrenOf;
      const isExpanded = expSet.has(folderId);
      childContainer.classList.toggle('hidden', !isExpanded);
    });
    const count = container.querySelector('#notes-visible-count');
    if (count) count.textContent = allRows.length;
    return;
  }

  let matchCount = 0;
  const matchMap = new Map();
  allRows.forEach((row) => {
    const title = row.dataset.pageTitle || '';
    const fav = row.dataset.pageFavorite === 'true';
    const matchesQuery = !query || title.includes(query);
    const matchesFav = !favoritesOnly || fav;
    const isDirectMatch = matchesQuery && matchesFav;
    matchMap.set(row.dataset.pageId, isDirectMatch);
    if (isDirectMatch) matchCount++;
  });

  allRows.forEach((row) => {
    const pageId = row.dataset.pageId;
    const isMatch = matchMap.get(pageId);
    const wrapper = row.closest('.note-node-wrapper');

    if (!wrapper) return;

    if (isMatch) {
      wrapper.hidden = false;
      let parentContainer = wrapper.parentElement?.closest('.note-children-container');
      while (parentContainer) {
        parentContainer.classList.remove('hidden');
        const parentWrapper = parentContainer.closest('.note-node-wrapper');
        if (parentWrapper) parentWrapper.hidden = false;
        parentContainer = parentWrapper?.parentElement?.closest('.note-children-container');
      }
    } else {
      const hasMatchingDescendant =
        wrapper.querySelector('.note-children-container') &&
        [...wrapper.querySelectorAll('.note-row')].some((r) => r.dataset.pageId !== pageId && matchMap.get(r.dataset.pageId));
      wrapper.hidden = !hasMatchingDescendant;
      if (hasMatchingDescendant) {
        const directChildContainer = wrapper.querySelector(`:scope > .note-children-container`);
        if (directChildContainer) directChildContainer.classList.remove('hidden');
      }
    }
  });

  const count = container.querySelector('#notes-visible-count');
  if (count) count.textContent = matchCount;
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
