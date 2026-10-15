import { requestInput, requestConfirmation } from "../../lib/dialogs.js";
// ============================================
// MOTION — Block Editor Page Module (Legacy)
// ============================================

import { AppState, setBreadcrumb, showToast } from '../app.js';
import { assistWithText } from '../../lib/ai.js';
import { sanitizeHtml } from '../../lib/sanitize.js';
import { composeBlock, getBlockType } from '../../lib/blockComposer.js';
import {
  getRecentPages,
  getPages,
  getPage,
  getTasks,
  createPage,
  createTask,
  toggleTask,
  updatePage,
  togglePageFavorite,
  archivePage,
  deletePage,
  getComments,
  createComment,
  updateComment,
  deleteComment,
  timeAgo
} from '../../lib/queries.js';

function cleanBlockContent(html) {
  const template = document.createElement('template');
  template.innerHTML = sanitizeHtml(html);
  template.content.querySelectorAll('[data-editor-add-block], #editor-add-block').forEach(button => {
    if (button.parentElement?.classList.contains('absolute')) button.parentElement.remove();
    else button.remove();
  });
  template.content.querySelectorAll('[contenteditable]').forEach(element => element.removeAttribute('contenteditable'));
  template.content.querySelectorAll('.block-context-selected').forEach(element => element.classList.remove('block-context-selected'));
  template.content.querySelectorAll('[data-block-handle]').forEach(element => element.remove());
  template.content.querySelectorAll('[data-block-row], div.flex.items-start.group.relative').forEach(element => element.replaceWith(...element.childNodes));
  return template.innerHTML;
}

export async function renderEditor(container, route) {
  setBreadcrumb('Editor');

  const pageIdFromRoute = route?.segments?.[0] || null;
  let page = null;

  if (pageIdFromRoute) {
    const { data } = await getPage(pageIdFromRoute);
    page = data || null;
  }

  if (!page) {
    const { data: pages } = await getRecentPages(1, AppState.workspace?.id);
    page = pages?.[0] || null;
  }
  if (!page) {
    container.innerHTML = `
      <div class="empty-state" style="min-height:70vh;">
        <span class="material-symbols-outlined">edit_document</span>
        <h3>No pages to edit</h3>
        <p>Create a new page from the sidebar to start writing.</p>
      </div>
    `;
    return;
  }

  const { data: linkedTasks } = await getTasks({ pageId: page.id });
  const { data: workspacePages } = AppState.workspace?.id ? await getPages(AppState.workspace.id) : { data: [] };
  const backlinks = (workspacePages || []).filter((candidate) => {
    if (candidate.id === page.id) return false;
    const html = String(candidate.content?.html || '');
    return html.includes(`#editor/${page.id}`) || html.includes(`data-page-link="${page.id}"`);
  });
  const userName = AppState.profile?.name || 'You';

  const draft = readLocalDraft(page.id);
  const contentHtml = cleanBlockContent(draft ? draft.html : page.content?.html || '');
  const safeTitle = escapeComment((draft ? draft.title : page.title) || 'Untitled');
  const safeUserName = escapeComment(userName);
  const safeIcon = escapeComment(page.icon || '📄');
  const safeCoverUrl = /^https?:\/\//i.test(page.cover_url || '') ? escapeComment(page.cover_url) : '';

  container.innerHTML = `
    <div class="editor-layout flex-1 bg-surface overflow-y-auto relative">
      <div class="max-w-3xl mx-auto pt-12 pb-48 px-12">
        <div class="flex items-center justify-end gap-2 mb-6 editor-actions">
          <button id="editor-copy-link" class="editor-action-button" type="button" title="Copy page link">
            <span class="material-symbols-outlined text-sm">link</span>
            Copy link
          </button>
          <button id="editor-share-page" class="editor-action-button" type="button" title="Share page">
            <span class="material-symbols-outlined text-sm">share</span>
            Share
          </button>
          <button id="editor-favorite-page" class="editor-action-button" type="button" title="Favorite page">
            <span class="material-symbols-outlined text-sm">${page.is_favorite ? 'star' : 'star_outline'}</span>
            ${page.is_favorite ? 'Favorited' : 'Favorite'}
          </button>
          <button id="editor-export-markdown" class="editor-action-button" type="button" title="Export as Markdown">
            <span class="material-symbols-outlined text-sm">download</span>
            Export
          </button>
          <button id="editor-import-markdown" class="editor-action-button" type="button" title="Import Markdown">
            <span class="material-symbols-outlined text-sm">upload_file</span>
            Import
          </button>
          <input id="editor-import-input" type="file" accept=".md,.markdown,text/markdown,text/plain" hidden />
          <button id="editor-ai-toggle" class="editor-action-button" type="button" title="Smart assist">
            <span class="material-symbols-outlined text-sm">auto_awesome</span>
            Smart assist
          </button>
          <button id="editor-add-task" class="editor-action-button" type="button" title="Create a task linked to this page">
            <span class="material-symbols-outlined text-sm">add_task</span>
            Add task
          </button>
          <button id="editor-link-page" class="editor-action-button" type="button" title="Link another page here">
            <span class="material-symbols-outlined text-sm">link</span>
            Link page
          </button>
          ${page.page_type === 'database' ? '<button id="editor-open-view" class="editor-action-button" type="button" title="Open database view"><span class="material-symbols-outlined text-sm">database</span> Open database</button>' : ''}
          ${page.page_type === 'kanban' ? '<button id="editor-open-view" class="editor-action-button" type="button" title="Open Kanban view"><span class="material-symbols-outlined text-sm">view_kanban</span> Open board</button>' : ''}
          <button id="editor-delete-page" class="editor-action-button editor-action-danger" type="button" title="Delete page">
            <span class="material-symbols-outlined text-sm">delete</span>
            Delete
          </button>
          <button id="editor-archive-page" class="editor-action-button" type="button" title="Move page to archive">
            <span class="material-symbols-outlined text-sm">archive</span>
            Archive
          </button>
          <button id="editor-duplicate-page" class="editor-action-button" type="button" title="Duplicate page">
            <span class="material-symbols-outlined text-sm">content_copy</span>
            Duplicate
          </button>
          <button id="editor-move-page" class="editor-action-button" type="button" title="Move page into another page">
            <span class="material-symbols-outlined text-sm">drive_file_move</span>
            Move
          </button>
        </div>
        <div id="editor-ai-panel" class="editor-ai-panel" hidden>
          <div class="editor-ai-heading">
            <div>
              <strong>Smart assist</strong>
              <p>Summarize, improve, or extract action items from this page.</p>
            </div>
            <button id="editor-ai-close" type="button" aria-label="Close smart assist">×</button>
          </div>
          <div class="editor-ai-actions">
            <button type="button" data-ai-action="summarize">Summarize</button>
            <button type="button" data-ai-action="tasks">Extract tasks</button>
            <button type="button" data-ai-action="improve">Improve writing</button>
          </div>
          <div id="editor-ai-output" class="editor-ai-output">Choose an action to analyze this page.</div>
        </div>
        ${
          safeCoverUrl
            ? `
          <div class="w-full h-48 mb-12 rounded-xl overflow-hidden group relative">
            <img class="w-full h-full object-cover" src="${safeCoverUrl}" alt="Cover" />
            <div class="absolute inset-0 bg-black/5 group-hover:bg-black/0 transition-all"></div>
            <button id="editor-change-cover" class="absolute bottom-4 right-4 bg-surface-container-lowest/90 backdrop-blur px-3 py-1 rounded-md text-[11px] font-medium text-on-surface-variant opacity-0 group-hover:opacity-100 transition-opacity" type="button">Change cover</button>
          </div>
        `
            : `
          <div class="mb-4 opacity-0 hover:opacity-60 transition-opacity">
            <button id="editor-add-cover" class="text-xs text-on-surface-variant flex items-center gap-1" type="button">
              <span class="material-symbols-outlined text-sm">add_photo_alternate</span>
              Add cover
            </button>
          </div>
        `
        }

        <button id="editor-change-icon" class="block text-5xl leading-none mb-5" type="button" title="Change page icon">${safeIcon}</button>

        <div class="mb-10 group relative">
          <h1 id="editor-title" class="text-4xl font-extrabold tracking-tight text-on-surface mb-2 outline-none focus:ring-0" contenteditable="true">${
            safeTitle
          }</h1>
          <div class="flex gap-4 text-sm text-on-surface-variant/60">
            <span class="flex items-center gap-1">
              <span class="material-symbols-outlined text-[14px]">face</span>
              Created by ${safeUserName}
            </span>
            <span class="flex items-center gap-1">
              <span class="material-symbols-outlined text-[14px]">history</span>
              ${timeAgo(page.updated_at)}
            </span>
            <span id="editor-save-status" class="flex items-center gap-1 text-primary" aria-live="polite">
              <span class="material-symbols-outlined text-[14px]">${draft ? 'cloud_off' : 'cloud_done'}</span>
              ${draft ? 'Local draft recovered' : 'Saved'}
            </span>
          </div>
        </div>

        <section class="editor-linked-tasks mb-8" aria-label="Tasks linked to this page">
          <div class="flex items-center justify-between mb-3">
            <h2 class="text-xs font-bold uppercase tracking-widest text-on-surface-variant">Linked tasks</h2>
            <span class="text-xs text-on-surface-variant">${linkedTasks?.length || 0}</span>
          </div>
          ${linkedTasks?.length
            ? linkedTasks.map((task) => `
              <div class="w-full flex items-center gap-3 text-left px-3 py-2 rounded-lg hover:bg-surface-container-low transition-colors">
                <button type="button" class="editor-linked-task-toggle" data-task-id="${task.id}" data-completed="${task.completed ? 'true' : 'false'}" aria-label="${task.completed ? 'Reopen' : 'Complete'} ${escapeComment(task.title || 'Untitled task')}">
                <span class="material-symbols-outlined text-base ${task.completed ? 'text-primary' : 'text-on-surface-variant'}">${task.completed ? 'check_circle' : 'radio_button_unchecked'}</span>
                </button>
                <a href="#kanban?task=${task.id}" class="text-sm text-on-surface hover:underline ${task.completed ? 'line-through opacity-60' : ''}">${escapeComment(task.title || 'Untitled task')}</a>
                <span class="ml-auto text-[10px] uppercase tracking-wider text-on-surface-variant">${escapeComment(task.status || 'todo')}</span>
              </div>
            `).join('')
            : '<p class="text-sm text-on-surface-variant">No tasks linked yet. Use Add task to connect work to this page.</p>'}
        </section>

        <section class="editor-backlinks mb-8" aria-label="Backlinks to this page">
          <div class="flex items-center justify-between mb-3">
            <h2 class="text-xs font-bold uppercase tracking-widest text-on-surface-variant">Backlinks</h2>
            <span class="text-xs text-on-surface-variant">${backlinks.length}</span>
          </div>
          ${backlinks.length
            ? backlinks.map((backlink) => `<a class="flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-surface-container-low text-sm text-on-surface" href="#editor/${backlink.id}"><span class="text-base">${escapeComment(backlink.icon || '📄')}</span><span>${escapeComment(backlink.title || 'Untitled')}</span></a>`).join('')
            : '<p class="text-sm text-on-surface-variant">No pages link here yet. Use Link page to create a connection.</p>'}
        </section>

        <div id="editor-blocks" class="space-y-4">
          ${
            contentHtml
              ? `
            <div class="flex items-start group relative">
              <div class="absolute -left-12 top-1 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <button data-editor-add-block class="w-6 h-6 flex items-center justify-center hover:bg-surface-container rounded text-on-surface-variant" type="button" title="Add block">
                  <span class="material-symbols-outlined text-[18px]">add</span>
                </button>
              </div>
              <div class="motion-block-content w-full outline-none text-[16px] leading-relaxed text-on-surface" contenteditable="true">${contentHtml}</div>
            </div>
          `
              : ''
          }
        </div>

        <div class="editor-writing-tools">
          <button id="editor-add-block" class="editor-add-block-button" type="button">
            <span class="material-symbols-outlined">add</span>
            <span>Add a block</span>
            <kbd>/</kbd>
          </button>
          <span class="editor-block-hint">Right-click a block to edit or delete it.</span>
          <div id="editor-block-menu" class="editor-block-menu" hidden>
            <div class="editor-block-menu-search">
              <span class="material-symbols-outlined">search</span>
              <input id="editor-block-search" type="search" placeholder="Filter blocks..." autocomplete="off" />
            </div>
            <div class="editor-block-menu-scroll">
              <div class="editor-block-menu-group">
                <p>Basic blocks</p>
                <button type="button" data-block-type="text"><span class="material-symbols-outlined">text_fields</span><span><strong>Text</strong><small>Start writing with plain text</small></span></button>
                <button type="button" data-block-type="heading1"><span class="editor-block-icon">H1</span><span><strong>Heading 1</strong><small>Large section heading</small></span></button>
                <button type="button" data-block-type="heading2"><span class="editor-block-icon">H2</span><span><strong>Heading 2</strong><small>Medium section heading</small></span></button>
                <button type="button" data-block-type="heading3"><span class="editor-block-icon">H3</span><span><strong>Heading 3</strong><small>Small section heading</small></span></button>
                <button type="button" data-block-type="page"><span class="material-symbols-outlined">description</span><span><strong>Page</strong><small>Create a linked sub-page</small></span></button>
                <button type="button" data-block-type="page-link"><span class="material-symbols-outlined">subdirectory_arrow_right</span><span><strong>Page link</strong><small>Link to another page</small></span></button>
              </div>
              <div class="editor-block-menu-group">
                <p>Lists</p>
                <button type="button" data-block-type="bulleted"><span class="material-symbols-outlined">format_list_bulleted</span><span><strong>Bulleted list</strong><small>Simple list of items</small></span></button>
                <button type="button" data-block-type="numbered"><span class="material-symbols-outlined">format_list_numbered</span><span><strong>Numbered list</strong><small>List items in order</small></span></button>
                <button type="button" data-block-type="todo"><span class="material-symbols-outlined">check_box</span><span><strong>To-do list</strong><small>Track tasks and action items</small></span></button>
                <button type="button" data-block-type="toggle"><span class="material-symbols-outlined">arrow_right</span><span><strong>Toggle list</strong><small>Hide content inside a disclosure</small></span></button>
              </div>
              <div class="editor-block-menu-group">
                <p>Media &amp; advanced</p>
                <button type="button" data-block-type="quote"><span class="material-symbols-outlined">format_quote</span><span><strong>Quote</strong><small>Capture a memorable quote</small></span></button>
                <button type="button" data-block-type="callout"><span class="material-symbols-outlined">lightbulb</span><span><strong>Callout</strong><small>Highlight important information</small></span></button>
                <button type="button" data-block-type="code"><span class="material-symbols-outlined">code</span><span><strong>Code</strong><small>Display a code snippet</small></span></button>
                <button type="button" data-block-type="divider"><span class="material-symbols-outlined">horizontal_rule</span><span><strong>Divider</strong><small>Separate sections visually</small></span></button>
                <button type="button" data-block-type="table"><span class="material-symbols-outlined">table</span><span><strong>Simple table</strong><small>Start with a 3 × 3 table</small></span></button>
                <button type="button" data-block-type="link"><span class="material-symbols-outlined">link</span><span><strong>Link</strong><small>Add a web link</small></span></button>
                <button type="button" data-block-type="equation"><span class="material-symbols-outlined">functions</span><span><strong>Equation</strong><small>Write a mathematical expression</small></span></button>
                <button type="button" data-block-type="comment"><span class="material-symbols-outlined">comment</span><span><strong>Comment</strong><small>Discuss this page with your team</small></span></button>
                <button type="button" data-block-type="ai"><span class="material-symbols-outlined">auto_awesome</span><span><strong>AI assistant</strong><small>Summarize or improve your page</small></span></button>
              </div>
            </div>
          </div>
        </div>
        <div id="editor-empty-area" class="motion-block-content editor-empty-area mt-3 text-on-surface transition-colors cursor-text text-sm min-h-[200px]" contenteditable="true" data-placeholder="Add a block, or type / to choose a block type..."></div>
      </div>

      <aside id="editor-comments" class="editor-comments-panel" aria-label="Page comments">
        <div class="editor-comments-heading">
          <div>
            <h2>Comments</h2>
            <p>Discuss this page with your workspace.</p>
          </div>
          <span class="material-symbols-outlined">forum</span>
        </div>
        <div class="editor-comments-list">
          <p class="editor-comments-empty">Loading comments...</p>
        </div>
      </aside>
    </div>
  `;

  const titleEl = container.querySelector('#editor-title');
  let saveTimeout;

  function editorHtml() {
    const blocks = container.querySelector('#editor-blocks [contenteditable="true"]');
    const empty = container.querySelector('#editor-empty-area');
    const template = document.createElement('template');
    template.innerHTML = (blocks?.innerHTML || '') + (empty?.innerHTML || '');
    template.content.querySelectorAll('[data-editor-add-block]').forEach(button => button.parentElement.remove());
    return cleanBlockContent(template.innerHTML);
  }

  async function saveNow() {
    clearTimeout(saveTimeout);
    decorateBlocks();
    const title = titleEl?.textContent || 'Untitled';
    const html = editorHtml();
    writeLocalDraft(page.id, { title, html });
    const status = container.querySelector('#editor-save-status');
    if (status) status.textContent = 'Saving…';
    const { error } = await updatePage(page.id, { title, content: { ...(page.content || {}), html } });
    if (status) status.textContent = error ? 'Save failed — local draft kept' : 'Saved';
    if (!error) clearLocalDraft(page.id);
    else showToast(`Could not save block: ${error.message}`, 'error');
    return !error;
  }

  function debouncedSave() {
    clearTimeout(saveTimeout);
    const status = container.querySelector('#editor-save-status');
    if (status) status.innerHTML = '<span class="material-symbols-outlined text-[14px]">cloud_upload</span>Saving…';
    writeLocalDraft(page.id, { title: titleEl?.textContent || 'Untitled', html: editorHtml() });
    saveTimeout = setTimeout(saveNow, 2000);
  }

  if (titleEl) titleEl.addEventListener('input', debouncedSave);
  container.querySelector('#editor-blocks')?.addEventListener('input', debouncedSave);
  container.querySelector('#editor-empty-area')?.addEventListener('input', debouncedSave);

  let dragState = null;
  const blockRoots = [...container.querySelectorAll('#editor-blocks [contenteditable="true"], #editor-empty-area')];
  function decorateBlocks() {
    blockRoots.forEach(root => {
      root.querySelectorAll(':scope > [data-block-row]').forEach(row => {
        if (row.children.length <= 1) row.remove();
      });
      [...root.children].filter(block => !block.hasAttribute('data-block-row')).forEach(block => {
        const row = document.createElement('div');
        row.className = 'editor-draggable-block';
        row.dataset.blockRow = '';
        const handle = document.createElement('button');
        handle.type = 'button'; handle.contentEditable = 'false';
        handle.dataset.blockHandle = '';
        handle.className = 'editor-block-drag-handle';
        handle.setAttribute('aria-label', `Move block: ${(block.textContent || 'Divider').trim().slice(0,60)}`);
        handle.title = 'Drag to move · Alt + ↑/↓ to reorder';
        handle.innerHTML = '<span class="material-symbols-outlined" aria-hidden="true">drag_indicator</span>';
        block.before(row); row.append(handle,block);
      });
    });
  }
  function clearBlockDrag() {
    container.querySelectorAll('.block-drop-before,.block-drop-after,.block-is-dragging').forEach(row => row.classList.remove('block-drop-before','block-drop-after','block-is-dragging'));
    dragState = null;
  }
  container.addEventListener('pointerdown', event => {
    const handle = event.target.closest('[data-block-handle]');
    if (!handle || event.button !== 0) return;
    event.preventDefault();
    const row = handle.closest('[data-block-row]');
    handle.setPointerCapture(event.pointerId);
    dragState = {row,handle,id:event.pointerId,startX:event.clientX,startY:event.clientY,target:null,after:false,moved:false};
  });
  container.addEventListener('pointermove', event => {
    if (!dragState || event.pointerId !== dragState.id) return;
    if (!dragState.moved && Math.hypot(event.clientX-dragState.startX,event.clientY-dragState.startY) < 5) return;
    dragState.moved = true;
    dragState.row.classList.add('block-is-dragging');
    const target = document.elementFromPoint(event.clientX,event.clientY)?.closest('[data-block-row]');
    container.querySelectorAll('.block-drop-before,.block-drop-after').forEach(row => row.classList.remove('block-drop-before','block-drop-after'));
    dragState.target = target && target !== dragState.row && container.contains(target) ? target : null;
    if (dragState.target) {
      const rect = target.getBoundingClientRect();
      dragState.after = event.clientY > rect.top + rect.height/2;
      target.classList.add(dragState.after ? 'block-drop-after' : 'block-drop-before');
    }
    const scroller = container.querySelector('.editor-layout');
    const bounds = scroller?.getBoundingClientRect();
    if (bounds && event.clientY < bounds.top + 60) scroller.scrollTop -= 20;
    else if (bounds && event.clientY > bounds.bottom - 60) scroller.scrollTop += 20;
  });
  container.addEventListener('pointerup', async event => {
    if (!dragState || event.pointerId !== dragState.id) return;
    const {row,target,after,moved,handle} = dragState;
    if(handle.hasPointerCapture(event.pointerId)) handle.releasePointerCapture(event.pointerId);
    clearBlockDrag();
    if (!moved || !target) return;
    if(after) target.after(row); else target.before(row);
    selectedBlock = row.querySelector(':scope > :not([data-block-handle])');
    lastBlockEditor = row.parentElement;
    if(await saveNow()) showToast('Block moved and saved', 'success');
  });
  container.addEventListener('pointercancel', clearBlockDrag);
  container.addEventListener('keydown', async event => {
    const handle = event.target.closest('[data-block-handle]');
    if (!handle || !event.altKey || !['ArrowUp','ArrowDown'].includes(event.key)) return;
    event.preventDefault();
    const rows = [...container.querySelectorAll('[data-block-row]')];
    const row = handle.closest('[data-block-row]');
    const target = rows[rows.indexOf(row) + (event.key === 'ArrowUp' ? -1 : 1)];
    if(!target) return;
    if(event.key === 'ArrowUp') target.before(row); else target.after(row);
    if(await saveNow()) showToast('Block moved and saved', 'success');
    handle.focus();
  });
  decorateBlocks();

  const changeCover = async () => {
    const url = await requestInput('Paste an image URL (leave blank to remove the cover):', page.cover_url || '');
    if (url === null) return;
    if (url && !/^https?:\/\//i.test(url)) {
      showToast('Cover URL must start with http:// or https://', 'error');
      return;
    }
    const { error: coverError } = await updatePage(page.id, { cover_url: url || null });
    if (coverError) return showToast(`Could not update cover: ${coverError.message}`, 'error');
    showToast(url ? 'Cover updated' : 'Cover removed', 'success');
    await renderEditor(container, route);
  };
  container.querySelector('#editor-change-cover')?.addEventListener('click', changeCover);
  container.querySelector('#editor-add-cover')?.addEventListener('click', changeCover);

  container.querySelector('#editor-change-icon')?.addEventListener('click', async (event) => {
    const button = event.currentTarget;
    const icon = await requestInput('Enter an emoji for this page:', page.icon || '📄');
    if (icon === null || !icon.trim()) return;
    const nextIcon = icon.trim().slice(0, 4);
    const { error: iconError } = await updatePage(page.id, { icon: nextIcon });
    if (iconError) return showToast(`Could not update icon: ${iconError.message}`, 'error');
    page.icon = nextIcon;
    button.textContent = nextIcon;
    showToast('Page icon updated', 'success');
  });

  const blockMenu = container.querySelector('#editor-block-menu');
  const blockSearch = container.querySelector('#editor-block-search');
  let lastBlockEditor = container.querySelector('#editor-empty-area');
  let blockRange = null;
  let selectedBlock = null;

  const closeBlockMenu = () => {
    if (blockMenu) blockMenu.hidden = true;
    if (blockSearch) blockSearch.value = '';
    container.querySelectorAll('[data-block-type]').forEach((button) => { button.hidden = false; });
  };

  const openBlockMenu = (editor = lastBlockEditor) => {
    lastBlockEditor = editor || lastBlockEditor;
    const selection = window.getSelection();
    if (selection?.rangeCount && lastBlockEditor?.contains(selection.anchorNode)) {
      blockRange = selection.getRangeAt(0).cloneRange();
    }
    if (!blockMenu) return;
    blockMenu.hidden = false;
    if (blockSearch) {
      blockSearch.value = '';
      window.setTimeout(() => blockSearch.focus(), 0);
    }
  };

  const insertAtEditor = (html, editor = lastBlockEditor) => {
    const target = editor || container.querySelector('#editor-empty-area');
    if (!target) return;
    target.focus();
    const selection = window.getSelection();
    if (/^\/[^\s]*$/.test((target.textContent || '').trim())) {
      target.textContent = '';
      blockRange = null;
    }
    const range = blockRange && target.contains(blockRange.startContainer) ? blockRange : document.createRange();
    if (range !== blockRange) {
      range.selectNodeContents(target);
      range.collapse(false);
    }
    selection.removeAllRanges();
    selection.addRange(range);
    const fragment = range.createContextualFragment(sanitizeHtml(html));
    const firstNode = fragment.firstElementChild;
    if (selectedBlock && target.contains(selectedBlock)) (selectedBlock.closest('[data-block-row]') || selectedBlock).after(fragment);
    else target.append(fragment);
    selectedBlock = firstNode;
    blockRange = null;
    target.dispatchEvent(new Event('input', { bubbles: true }));
  };


  const insertBlock = async (type) => {
    closeBlockMenu();
    if (type === 'ai') {
      if (aiPanel) aiPanel.hidden = false;
      return;
    }
    if (type === 'comment') {
      container.querySelector('#editor-comments')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      container.querySelector('#editor-comments textarea')?.focus();
      return;
    }
    if (type === 'link') {
      const url = await requestInput('Paste a URL:', 'https://');
      if (!url || !/^https?:\/\//i.test(url)) return;
      insertAtEditor(`<a href="${escapeComment(url)}" target="_blank" rel="noreferrer">${escapeComment(url)}</a>`);
      return;
    }
    if (type === 'page-link') {
      const candidates = (workspacePages || []).filter((candidate) => candidate.id !== page.id && !candidate.archived_at);
      if (!candidates.length) return showToast('Create another page before linking it', 'error');
      const choices = candidates.map((candidate, index) => `${index + 1}: ${candidate.title || 'Untitled'}`).join('\n');
      const answer = await requestInput(`Link which page?\n\n${choices}\n\nEnter its number:`, '1');
      const target = candidates[Number(answer) - 1];
      if (!target) return showToast('Choose a valid page number', 'error');
      insertAtEditor(`<a href="#editor/${escapeComment(target.id)}" data-page-link="${escapeComment(target.id)}">${escapeComment(target.title || 'Untitled')}</a>`);
      return;
    }
    if (type === 'page') {
      if (!AppState.workspace?.id) return showToast('No workspace is selected', 'error');
      const title = await requestInput('New page title:', 'Untitled');
      if (!title?.trim()) return;
      const { data: child, error } = await createPage(AppState.workspace.id, title.trim(), 'note', {}, page.id);
      if (error) return showToast(`Could not create page: ${error.message}`, 'error');
      if (child?.id) insertAtEditor(`<a class="editor-page-link" href="#editor/${escapeComment(child.id)}" data-page-link="${escapeComment(child.id)}">📄 ${escapeComment(child.title || title.trim())}</a>`);
      return;
    }
    clearTimeout(saveTimeout);
    const html = await composeBlock(type);
    if (html === null) return;
    insertAtEditor(html);
    if (await saveNow()) showToast(`${type.startsWith('heading') ? 'Heading' : 'Block'} applied and saved`, 'success');
  };

  container.querySelectorAll('[data-editor-add-block], #editor-add-block').forEach((button) => {
    button.addEventListener('click', async () => openBlockMenu(lastBlockEditor));
  });
  container.querySelectorAll('[data-block-type]').forEach((button) => {
    button.addEventListener('click', async () => insertBlock(button.dataset.blockType));
  });
  blockSearch?.addEventListener('input', async () => {
    const query = blockSearch.value.trim().toLowerCase();
    container.querySelectorAll('[data-block-type]').forEach((button) => {
      button.hidden = Boolean(query) && !button.textContent.toLowerCase().includes(query);
    });
  });
  container.addEventListener('click', async (event) => {
    if (blockMenu && !blockMenu.hidden && !event.target.closest('#editor-block-menu, #editor-add-block, [data-editor-add-block]')) closeBlockMenu();
  });
  container.querySelectorAll('#editor-empty-area, #editor-blocks [contenteditable="true"]').forEach((editor) => {
    editor.addEventListener('beforeinput', (event) => {
      if (event.inputType === 'historyUndo' || event.inputType === 'historyRedo') return;
      event.preventDefault();
      lastBlockEditor = editor;
      if (event.data === '/') { openBlockMenu(editor); return; }
      if (selectedBlock?.isConnected) editBlock(selectedBlock);
      else insertBlock('text');
    });
    editor.addEventListener('click', (event) => {
      let block = event.target.closest('h1,h2,h3,p,ul,ol,details,blockquote,pre,hr,table,aside');
      while (block?.parentElement && block.parentElement !== editor && block.parentElement.closest('ul,ol,details,table,aside')) block = block.parentElement.closest('ul,ol,details,table,aside');
      if (block && editor.contains(block)) selectedBlock = block;
      lastBlockEditor = editor;
    });
    editor.addEventListener('change', (event) => {
      if (event.target.matches('input[type="checkbox"]')) {
        event.target.toggleAttribute('checked', event.target.checked);
        editor.dispatchEvent(new Event('input', { bubbles: true }));
      }
    });
    editor.addEventListener('focus', async () => { lastBlockEditor = editor; });
    editor.addEventListener('input', async () => {
      lastBlockEditor = editor;
      const text = editor.textContent || '';
      if (/^\/[^\s]*$/.test(text.trim())) openBlockMenu(editor);
    });
    editor.addEventListener('keydown', async (event) => {
      if (event.key === 'Escape') closeBlockMenu();
      if (event.key === 'ArrowDown' && blockMenu && !blockMenu.hidden) {
        event.preventDefault();
        blockMenu.querySelector('[data-block-type]:not([hidden])')?.focus();
      }
    });
  });

  function getSelectedBlock() {
    const node = window.getSelection()?.anchorNode;
    const anchor = node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement;
    let caretBlock = anchor?.closest('h1,h2,h3,p,ul,ol,details,blockquote,pre,hr,table,aside');
    if (!lastBlockEditor?.contains(caretBlock)) caretBlock = null;
    const block = caretBlock || (selectedBlock?.isConnected ? selectedBlock : null);
    const compound = block?.parentElement?.closest('ul,ol,details,table,aside');
    return compound && lastBlockEditor?.contains(compound) ? compound : block;
  }

  async function editBlock(block = getSelectedBlock()) {
    if (!block) return showToast('Add a block first, or click the block you want to edit.', 'error');
    clearTimeout(saveTimeout);
    const html = await composeBlock(getBlockType(block), block.outerHTML);
    if (html === null || !block.isConnected) return;
    const template = document.createElement('template'); template.innerHTML = sanitizeHtml(html);
    selectedBlock = template.content.firstElementChild;
    block.replaceWith(template.content);
    if (await saveNow()) showToast('Block updated and saved', 'success');
  }

  async function deleteBlock(block = getSelectedBlock()) {
    if (!block) return showToast('Click the block you want to delete first.', 'error');
    const preview = (block.textContent || '').trim().slice(0, 100) || 'this block';
    if (!await requestConfirmation(`Are you sure you want to delete “${preview}”?`)) return;
    if (!block.isConnected) return;
    const parent = block.parentNode;
    const parentHost = parent.parentNode;
    const parentNext = parent.nextSibling;
    const next = block.nextSibling;
    block.remove();
    selectedBlock = null;
    blockRange = null;
    if (await saveNow()) {
      showToast('Block deleted', 'success');
    } else {
      if (!parent.isConnected && parentHost?.isConnected) parentHost.insertBefore(parent, parentNext?.parentNode === parentHost ? parentNext : null);
      parent.insertBefore(block, next?.parentNode === parent ? next : null);
      selectedBlock = block;
      writeLocalDraft(page.id, { title: titleEl?.textContent || 'Untitled', html: editorHtml() });
    }
  }

  const contextMenu = document.createElement('div');
  contextMenu.className = 'editor-block-context-menu';
  contextMenu.setAttribute('role', 'menu');
  contextMenu.setAttribute('aria-label', 'Block actions');
  contextMenu.hidden = true;
  contextMenu.innerHTML = '<button type="button" role="menuitem" data-context-edit><span class="material-symbols-outlined" aria-hidden="true">edit</span>Edit</button><button type="button" role="menuitem" data-context-delete><span class="material-symbols-outlined" aria-hidden="true">delete</span>Delete</button>';
  container.append(contextMenu);
  let contextBlock = null;
  let contextEvents;
  const closeContextMenu = () => {
    contextMenu.hidden = true;
    contextBlock?.classList.remove('block-context-selected');
    contextEvents?.abort();
  };
  function openContextMenu(event, editor) {
    let block = event.target.closest('h1,h2,h3,p,ul,ol,details,blockquote,pre,hr,table,aside');
    if (!block || !editor.contains(block)) return;
    const compound = block.parentElement?.closest('ul,ol,details,table,aside');
    if (compound && editor.contains(compound)) block = compound;
    event.preventDefault();
    closeBlockMenu();
    closeContextMenu();
    lastBlockEditor = editor;
    selectedBlock = contextBlock = block;
    block.classList.add('block-context-selected');
    contextMenu.hidden = false;
    const rect = block.getBoundingClientRect();
    const x = event.clientX || rect.left + 16;
    const y = event.clientY || rect.top + 16;
    contextMenu.style.left = `${Math.max(8, Math.min(x, window.innerWidth - contextMenu.offsetWidth - 8))}px`;
    contextMenu.style.top = `${Math.max(8, Math.min(y, window.innerHeight - contextMenu.offsetHeight - 8))}px`;
    contextEvents = new AbortController();
    const signal = contextEvents.signal;
    document.addEventListener('pointerdown', outside => { if (!contextMenu.contains(outside.target)) closeContextMenu(); }, {signal});
    window.addEventListener('scroll', closeContextMenu, {capture:true,signal});
    window.addEventListener('resize', closeContextMenu, {signal});
    window.addEventListener('hashchange', closeContextMenu, {signal});
    contextMenu.querySelector('button').focus();
  }
  contextMenu.querySelector('[data-context-edit]').addEventListener('click', () => {
    const block = contextBlock; closeContextMenu(); editBlock(block);
  });
  contextMenu.querySelector('[data-context-delete]').addEventListener('click', () => {
    const block = contextBlock; closeContextMenu(); deleteBlock(block);
  });
  contextMenu.addEventListener('keydown', event => {
    if (event.key === 'Escape' || event.key === 'Tab') { closeContextMenu(); lastBlockEditor?.focus(); }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const buttons = [...contextMenu.querySelectorAll('button')];
      const index = buttons.indexOf(document.activeElement);
      buttons[(index + 1) % buttons.length].focus();
    }
  });
  container.querySelectorAll('#editor-empty-area, #editor-blocks [contenteditable="true"]').forEach(editor => {
    editor.addEventListener('contextmenu', event => openContextMenu(event, editor));
    editor.addEventListener('keydown', event => {
      if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
        const block = getSelectedBlock();
        if (block) openContextMenu({target:block, preventDefault:() => event.preventDefault()}, editor);
      }
    });
  });

  container.querySelector('#editor-add-task')?.addEventListener('click', async () => {
    if (!AppState.workspace?.id) return showToast('No workspace is selected', 'error');
    const title = await requestInput('Task title:');
    if (!title?.trim()) return;
    const priorityInput = await requestInput('Priority: low, medium, high, or urgent', 'medium');
    if (priorityInput === null) return;
    const priority = ['low', 'medium', 'high', 'urgent'].includes(priorityInput.trim().toLowerCase())
      ? priorityInput.trim().toLowerCase()
      : 'medium';
    const dueDateInput = await requestInput('Due date (YYYY-MM-DD, optional):', '');
    if (dueDateInput === null) return;
    const dueDate = dueDateInput.trim();
    if (dueDate && !/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) return showToast('Use the date format YYYY-MM-DD', 'error');
    const { data: task, error: taskError } = await createTask(title.trim(), {
      workspaceId: AppState.workspace.id,
      pageId: page.id,
      priority,
      dueDate: dueDate || null,
      assigneeId: AppState.user?.id || null
    });
    if (taskError) return showToast(`Could not create task: ${taskError.message}`, 'error');
    showToast('Task linked to this page', 'success');
    window.location.hash = `kanban?task=${encodeURIComponent(task.id)}`;
  });

  container.querySelector('#editor-link-page')?.addEventListener('click', async () => {
    const candidates = (workspacePages || []).filter((candidate) => candidate.id !== page.id && !candidate.archived_at);
    if (!candidates.length) return showToast('Create another page before linking it', 'error');
    const choices = candidates.map((candidate, index) => `${index + 1}: ${candidate.title || 'Untitled'}`).join('\n');
    const answer = await requestInput(`Link which page?\n\n${choices}\n\nEnter its number:`, '1');
    if (answer === null) return;
    const index = Number(answer) - 1;
    const target = Number.isInteger(index) ? candidates[index] : null;
    if (!target) return showToast('Choose a valid page number', 'error');
    const linkHtml = `<a href="#editor/${escapeComment(target.id)}" data-page-link="${escapeComment(target.id)}">${escapeComment(target.title || 'Untitled')}</a>`;
    const editor = container.querySelector('#editor-empty-area') || container.querySelector('#editor-blocks [contenteditable="true"]');
    if (!editor) return showToast('This page is not ready for editing', 'error');
    editor.focus();
    document.execCommand('insertHTML', false, `${editor.textContent?.trim() ? ' ' : ''}${linkHtml}`);
    editor.dispatchEvent(new Event('input', { bubbles: true }));
    showToast(`Linked to “${target.title || 'Untitled'}”`, 'success');
  });

  container.querySelector('#editor-open-view')?.addEventListener('click', async () => {
    window.location.hash = page.page_type === 'database' ? 'database' : 'kanban';
  });

  container.querySelectorAll('.editor-linked-task-toggle').forEach((button) => {
    button.addEventListener('click', async () => {
      const { error: taskError } = await toggleTask(button.dataset.taskId, button.dataset.completed !== 'true');
      if (taskError) return showToast(`Could not update task: ${taskError.message}`, 'error');
      await renderEditor(container, route);
    });
  });

  container.querySelector('#editor-copy-link')?.addEventListener('click', async () => {
    const url = `${window.location.origin}${window.location.pathname}#editor/${page.id}`;
    try {
      await navigator.clipboard.writeText(url);
      showToast('Page link copied', 'success');
    } catch {
      await requestInput('Copy this page link:', url);
    }
  });

  container.querySelector('#editor-share-page')?.addEventListener('click', async () => {
    const url = `${window.location.origin}${window.location.pathname}#editor/${page.id}`;
    if (navigator.share) {
      try {
        await navigator.share({ title: page.title || 'Motion page', text: 'View this Motion page', url });
        return;
      } catch (error) {
        if (error?.name === 'AbortError') return;
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      showToast('Share link copied', 'success');
    } catch {
      await requestInput('Copy this share link:', url);
    }
  });

  container.querySelector('#editor-favorite-page')?.addEventListener('click', async (event) => {
    const button = event.currentTarget;
    const nextFavorite = !page.is_favorite;
    const { error: favoriteError } = await togglePageFavorite(page.id, nextFavorite);
    if (favoriteError) return showToast(`Could not update favorite: ${favoriteError.message}`, 'error');
    page.is_favorite = nextFavorite;
    button.innerHTML = `<span class="material-symbols-outlined text-sm">${nextFavorite ? 'star' : 'star_outline'}</span>${nextFavorite ? 'Favorited' : 'Favorite'}`;
    showToast(nextFavorite ? 'Added to favorites' : 'Removed from favorites', 'success');
  });

  container.querySelector('#editor-export-markdown')?.addEventListener('click', async () => {
    const title = titleEl?.textContent?.trim() || 'Untitled';
    const blocksEl = container.querySelector('#editor-blocks');
    const emptyEl = container.querySelector('#editor-empty-area');
    const html = `${blocksEl?.innerHTML || ''}${emptyEl?.innerHTML || ''}`;
    const markdown = `# ${title}\n\n${htmlToMarkdown(html).trim()}\n`;
    const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `${title.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'motion-page'}.md`;
    link.click();
    URL.revokeObjectURL(link.href);
    showToast('Markdown export downloaded', 'success');
  });

  container.querySelector('#editor-import-markdown')?.addEventListener('click', async () => container.querySelector('#editor-import-input')?.click());
  container.querySelector('#editor-import-input')?.addEventListener('change', async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const markdown = await file.text();
    const html = markdownToHtml(markdown);
    const { error: importError } = await updatePage(page.id, { content: { ...(page.content || {}), html } });
    if (importError) return showToast(`Could not import Markdown: ${importError.message}`, 'error');
    showToast('Markdown imported', 'success');
    await renderEditor(container, route);
  });

  const aiPanel = container.querySelector('#editor-ai-panel');
  container.querySelector('#editor-ai-toggle')?.addEventListener('click', async () => {
    if (aiPanel) aiPanel.hidden = !aiPanel.hidden;
  });
  container.querySelector('#editor-ai-close')?.addEventListener('click', async () => {
    if (aiPanel) aiPanel.hidden = true;
  });

  container.querySelector('#editor-delete-page')?.addEventListener('click', async () => {
    if (!await requestConfirmation(`Delete “${page.title || 'Untitled'}”? This cannot be undone.`)) return;
    const { error: deleteError } = await deletePage(page.id);
    if (deleteError) return showToast(`Could not delete page: ${deleteError.message}`, 'error');
    clearLocalDraft(page.id);
    showToast('Page deleted', 'success');
    window.location.hash = 'notes';
  });

  container.querySelector('#editor-archive-page')?.addEventListener('click', async () => {
    if (!await requestConfirmation(`Archive “${page.title || 'Untitled'}”? You can restore it later from Settings.`)) return;
    const { error: archiveError } = await archivePage(page.id);
    if (archiveError) return showToast(`Could not archive page: ${archiveError.message}`, 'error');
    clearLocalDraft(page.id);
    showToast('Page archived', 'success');
    window.location.hash = 'notes';
  });

  container.querySelector('#editor-duplicate-page')?.addEventListener('click', async () => {
    if (!AppState.workspace?.id) return showToast('No workspace is selected', 'error');
    const title = `${page.title || 'Untitled'} copy`;
    const blocksEl = container.querySelector('#editor-blocks');
    const emptyEl = container.querySelector('#editor-empty-area');
    const html = `${blocksEl?.innerHTML || ''}${emptyEl?.innerHTML || ''}`;
    const duplicateContent = { ...(page.content || {}), html: sanitizeHtml(html) };
    const { data: duplicate, error: duplicateError } = await createPage(
      AppState.workspace.id,
      title,
      page.page_type || 'note',
      duplicateContent,
      page.parent_id || null
    );
    if (duplicateError) return showToast(`Could not duplicate page: ${duplicateError.message}`, 'error');
    if (duplicate?.id) {
      await updatePage(duplicate.id, { icon: page.icon || '📄', cover_url: page.cover_url || null });
      const { data: pageTasks } = await getTasks({ pageId: page.id });
      for (const task of pageTasks || []) {
        await createTask(task.title || 'Untitled task', {
          workspaceId: AppState.workspace.id,
          pageId: duplicate.id,
          status: task.status || 'todo',
          priority: task.priority || 'medium',
          assigneeId: task.assignee_id || null,
          dueDate: task.due_date || null,
          tags: task.tags || [],
          sortOrder: Number.isFinite(task.sort_order) ? task.sort_order : Date.now()
        });
      }
      showToast('Page duplicated', 'success');
      window.location.hash = `editor/${duplicate.id}`;
    }
  });

  container.querySelector('#editor-move-page')?.addEventListener('click', async () => {
    if (!AppState.workspace?.id) return showToast('No workspace is selected', 'error');
    const { data: pages, error: pagesError } = await getPages(AppState.workspace.id);
    if (pagesError) return showToast(`Could not load pages: ${pagesError.message}`, 'error');
    const candidates = (pages || []).filter(
      (candidate) => candidate.id !== page.id && !candidate.archived_at && !isPageDescendant(candidate.id, page.id, pages)
    );
    const choices = ['(root page)', ...candidates.map((candidate) => candidate.title || 'Untitled')];
    const answer = await requestInput(`Move “${page.title || 'Untitled'}” under which page?\n\n${choices.map((choice, index) => `${index}: ${choice}`).join('\n')}\n\nEnter a number, or leave blank for root:`, '0');
    if (answer === null) return;
    const selectedIndex = answer.trim() === '' ? 0 : Number(answer);
    if (!Number.isInteger(selectedIndex) || selectedIndex < 0 || selectedIndex >= choices.length) {
      return showToast('Choose a valid page number', 'error');
    }
    const parent = selectedIndex === 0 ? null : candidates[selectedIndex - 1];
    if (parent?.id === page.id) return showToast('A page cannot contain itself', 'error');
    const { error: moveError } = await updatePage(page.id, { parent_id: parent?.id || null });
    if (moveError) return showToast(`Could not move page: ${moveError.message}`, 'error');
    showToast(parent ? `Moved under “${parent.title || 'Untitled'}”` : 'Moved to root level', 'success');
  });
  container.querySelectorAll('[data-ai-action]').forEach((button) => {
    button.addEventListener('click', async () => {
      const output = container.querySelector('#editor-ai-output');
      const text = `${titleEl?.textContent || ''}\n${container.querySelector('#editor-blocks')?.textContent || ''}\n${container.querySelector('#editor-empty-area')?.textContent || ''}`;
      button.disabled = true;
      if (output) output.textContent = 'Working…';
      const result = await assistWithText(text, button.dataset.aiAction);
      if (output) {
        output.dataset.source = result.source;
        if (button.dataset.aiAction === 'tasks' && !/No action items were detected/i.test(result.text)) {
          output.innerHTML = `<div>${escapeComment(result.text)}</div><button id="editor-ai-create-tasks" class="editor-ai-create-tasks" type="button">Create Kanban tasks</button>`;
          output.querySelector('#editor-ai-create-tasks')?.addEventListener('click', async () => {
            const items = result.text.split('\n').map((item) => item.replace(/^\s*[☐*-]\s*/, '').trim()).filter(Boolean);
            let created = 0;
            for (const item of items) {
              const { error: taskError } = await createTask(item, { workspaceId: AppState.workspace?.id, assigneeId: AppState.user?.id });
              if (!taskError) created += 1;
            }
            showToast(`${created} task${created === 1 ? '' : 's'} created`, created ? 'success' : 'error');
          });
        } else {
          output.textContent = result.text;
        }
      }
      button.disabled = false;
      if (result.error) showToast('AI provider unavailable; used local assist', 'success');
    });
  });

  async function loadComments() {
    const panel = container.querySelector('#editor-comments');
    const list = panel?.querySelector('.editor-comments-list');
    if (!list) return;

    const { data: comments, error } = await getComments(page.id);
    if (error) {
      list.innerHTML = '<p class="editor-comments-empty">Comments will be available when collaboration is enabled.</p>';
      return;
    }

    const childrenByParent = new Map();
    comments.forEach((comment) => {
      const children = childrenByParent.get(comment.parent_id) || [];
      children.push(comment);
      childrenByParent.set(comment.parent_id, children);
    });
    const renderThread = (comment, depth = 0) => `${renderComment(comment, AppState.user?.id, depth)}${(childrenByParent.get(comment.id) || []).map((child) => renderThread(child, Math.min(depth + 1, 3))).join('')}`;
    const rootComments = childrenByParent.get(null) || comments.filter((comment) => !comment.parent_id);

    list.innerHTML = `
      ${comments.length ? rootComments.map((comment) => renderThread(comment)).join('') : '<p class="editor-comments-empty">No comments yet. Start a conversation.</p>'}
      <form class="editor-comment-form" id="editor-comment-form">
        <textarea name="content" rows="3" placeholder="Write a comment..." required></textarea>
        <button type="submit" class="modal-btn-primary">
          <span class="material-symbols-outlined text-sm">send</span>
          Comment
        </button>
      </form>
    `;

    list.querySelector('#editor-comment-form')?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const textarea = form.elements.content;
      const content = textarea.value.trim();
      if (!content) return;
      const button = form.querySelector('button');
      button.disabled = true;
      const { error: createError } = await createComment(page.id, content);
      if (createError) {
        button.disabled = false;
        showToast(`Could not post comment: ${createError.message}`, 'error');
        return;
      }
      await loadComments();
    });

    list.querySelectorAll('[data-comment-edit]').forEach((button) => {
      button.addEventListener('click', async () => {
        const comment = comments.find((item) => item.id === button.dataset.commentEdit);
        if (!comment) return;
        const content = await requestInput('Edit comment:', comment.content);
        if (content === null || !content.trim()) return;
        const { error: updateError } = await updateComment(comment.id, content.trim());
        if (updateError) return showToast(`Could not update comment: ${updateError.message}`, 'error');
        await loadComments();
      });
    });

    list.querySelectorAll('[data-comment-delete]').forEach((button) => {
      button.addEventListener('click', async () => {
        if (!await requestConfirmation('Delete this comment?')) return;
        const { error: deleteError } = await deleteComment(button.dataset.commentDelete);
        if (deleteError) return showToast(`Could not delete comment: ${deleteError.message}`, 'error');
        await loadComments();
      });
    });

    list.querySelectorAll('[data-comment-reply]').forEach((button) => {
      button.addEventListener('click', async () => {
        const content = await requestInput('Write a reply:');
        if (content === null || !content.trim()) return;
        const { error: replyError } = await createComment(page.id, content.trim(), button.dataset.commentReply);
        if (replyError) return showToast(`Could not add reply: ${replyError.message}`, 'error');
        await loadComments();
      });
    });
  }

  const handleRemoteComments = (event) => {
    if (event.detail && event.detail !== page.id) return;
    if (!container.isConnected) {
      window.removeEventListener('motion:comments-changed', handleRemoteComments);
      return;
    }
    loadComments();
  };
  if (container.__motionCommentsHandler) {
    window.removeEventListener('motion:comments-changed', container.__motionCommentsHandler);
  }
  container.__motionCommentsHandler = handleRemoteComments;
  window.addEventListener('motion:comments-changed', handleRemoteComments);

  const handleRemotePage = (event) => {
    if (event.detail !== page.id || !container.isConnected) return;
    if (document.activeElement?.isContentEditable) return;
    renderEditor(container, route);
  };
  if (container.__motionPageHandler) {
    window.removeEventListener('motion:page-changed', container.__motionPageHandler);
  }
  container.__motionPageHandler = handleRemotePage;
  window.addEventListener('motion:page-changed', handleRemotePage);
  await loadComments();
}

function escapeComment(value = '') {
  return String(value).replace(/[&<>'"]/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    "'": '&#39;',
    '"': '&quot;'
  })[character]);
}

function localDraftKey(pageId) {
  return `motion-page-draft:${pageId}`;
}

function readLocalDraft(pageId) {
  try {
    const raw = localStorage.getItem(localDraftKey(pageId));
    if (!raw) return null;
    const draft = JSON.parse(raw);
    if (!draft || typeof draft !== 'object') return null;
    return {
      title: typeof draft.title === 'string' ? draft.title : '',
      html: typeof draft.html === 'string' ? draft.html : ''
    };
  } catch {
    try {
      localStorage.removeItem(localDraftKey(pageId));
    } catch {
      // Ignore storage cleanup failures.
    }
    return null;
  }
}

function writeLocalDraft(pageId, draft) {
  try {
    localStorage.setItem(localDraftKey(pageId), JSON.stringify({ ...draft, savedAt: new Date().toISOString() }));
  } catch {
    // Local storage may be unavailable in private browsing; the remote save still runs.
  }
}

function clearLocalDraft(pageId) {
  try {
    localStorage.removeItem(localDraftKey(pageId));
  } catch {
    // Ignore storage cleanup failures.
  }
}

function isPageDescendant(candidateId, ancestorId, pages = []) {
  const byId = new Map(pages.map((candidate) => [candidate.id, candidate]));
  const seen = new Set();
  let current = byId.get(candidateId);
  while (current?.parent_id && !seen.has(current.id)) {
    if (current.parent_id === ancestorId) return true;
    seen.add(current.id);
    current = byId.get(current.parent_id);
  }
  return false;
}

function renderComment(comment, currentUserId, depth = 0) {
  const author = comment.author?.name || 'Workspace member';
  return `
    <article class="editor-comment" style="margin-left:${depth * 1.25}rem">
      <div class="editor-comment-meta">
        <span class="editor-comment-avatar">${escapeComment(author.slice(0, 1).toUpperCase())}</span>
        <strong>${escapeComment(author)}</strong>
        <time>${timeAgo(comment.created_at)}</time>
        <span class="editor-comment-actions"><button type="button" data-comment-reply="${comment.id}">Reply</button>${comment.user_id === currentUserId ? `<button type="button" data-comment-edit="${comment.id}">Edit</button><button type="button" data-comment-delete="${comment.id}">Delete</button>` : ''}</span>
      </div>
      <p>${escapeComment(comment.content)}</p>
    </article>
  `;
}

function htmlToMarkdown(html = '') {
  const template = document.createElement('template');
  template.innerHTML = html;
  const convert = (node) => {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent;
    if (node.nodeType !== Node.ELEMENT_NODE) return '';
    const content = Array.from(node.childNodes).map(convert).join('');
    const tag = node.tagName.toLowerCase();
    if (tag === 'h1') return `# ${content}\n\n`;
    if (tag === 'h2') return `## ${content}\n\n`;
    if (tag === 'h3') return `### ${content}\n\n`;
    if (tag === 'p' || tag === 'div') return `${content}\n\n`;
    if (tag === 'strong' || tag === 'b') return `**${content}**`;
    if (tag === 'em' || tag === 'i') return `*${content}*`;
    if (tag === 'br') return '\n';
    if (tag === 'li') return `- ${content}\n`;
    if (tag === 'ul' || tag === 'ol') return `${content}\n`;
    if (tag === 'a') return `[${content}](${node.getAttribute('href') || ''})`;
    if (tag === 'img') return `![${node.getAttribute('alt') || 'image'}](${node.getAttribute('src') || ''})\n\n`;
    return content;
  };
  return Array.from(template.content.childNodes).map(convert).join('').replace(/\n{3,}/g, '\n\n');
}

function markdownToHtml(markdown = '') {
  return escapeComment(markdown)
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^# (.+)$/gm, '<h1>$1</h1>')
    .replace(/^[-*] (.+)$/gm, '<li>$1</li>')
    .replace(/(<li>.*<\/li>\n?)+/g, (items) => `<ul>${items}</ul>`)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .split(/\n{2,}/)
    .map((block) => /^<h[1-3]>|^<ul>/.test(block.trim()) ? block : `<p>${block.replace(/\n/g, '<br />')}</p>`)
    .join('');
}
