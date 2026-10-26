import { requestInput, requestConfirmation } from "../../lib/dialogs.js";
// ============================================
// MOTION — Block Editor Page Module (Legacy)
// ============================================

import { AppState, setBreadcrumb, showToast } from '../app.js';
import { assistWithText } from '../../lib/ai.js';
import { sanitizeHtml } from '../../lib/sanitize.js';
import { openAIPagePanel } from '../../lib/aiPagePanel.js';
import { createNotionEditor } from '../../lib/notionEditor.js';
import { registerActiveEditor, unregisterActiveEditor } from '../../lib/aiEditorBridge.js';
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
  template.content.querySelectorAll('.notion-table-toolbar').forEach(el => el.remove());
  template.content.querySelectorAll('.notion-table-block').forEach(block => {
    const table = block.querySelector('table');
    if (table) block.replaceWith(table);
  });
  template.content.querySelectorAll('.editor-callout-wrapper').forEach(wrapper => {
    const callout = wrapper.querySelector('aside');
    if (callout) wrapper.replaceWith(callout);
  });
  template.content.querySelectorAll('.editor-toggle-wrapper').forEach(wrapper => {
    const toggle = wrapper.querySelector('details');
    if (toggle) wrapper.replaceWith(toggle);
  });
  template.content.querySelectorAll('[contenteditable]').forEach(element => element.removeAttribute('contenteditable'));
  template.content.querySelectorAll('.block-context-selected, .notion-block-selected, .notion-block-is-dragging').forEach(element => {
    element.classList.remove('block-context-selected', 'notion-block-selected', 'notion-block-is-dragging');
  });
  template.content.querySelectorAll('[data-block-handle], .notion-block-gutter-handle, .notion-block-drop-line').forEach(element => element.remove());
  template.content.querySelectorAll('[data-block-row], div.flex.items-start.group.relative').forEach(element => element.replaceWith(...element.childNodes));
  return template.innerHTML;
}

export async function renderEditor(container, route) {
  if (container.__editorBridgeInstance) {
    unregisterActiveEditor(container.__editorBridgeInstance);
    container.__editorBridgeInstance = null;
  }
  if (container.__notionEditor) {
    container.__notionEditor.destroy();
    container.__notionEditor = null;
  }
  document.querySelector('.ai-page-backdrop')?.dispatchEvent(new Event('motion:close'));
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
        ${safeCoverUrl
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

        <div class="mb-10 group relative">
          <h1 id="editor-title" class="text-4xl font-extrabold tracking-tight text-on-surface mb-2 outline-none focus:ring-0" contenteditable="true">${safeTitle
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

        <div id="editor-rich-content" class="editor-rich-content mb-8">
          <div id="editor-canvas" class="editor-canvas"></div>
        </div>

        <div class="editor-writing-tools flex items-center justify-between py-2 border-t border-outline-variant/30 mt-8">
          <button id="editor-add-block" class="editor-add-block-button text-xs text-on-surface-variant hover:text-primary flex items-center gap-1.5" type="button">
            <span class="material-symbols-outlined text-sm">add</span>
            <span>Add block</span>
            <kbd class="px-1.5 py-0.5 text-[10px] bg-surface-container-high rounded border border-outline-variant">/</kbd>
          </button>
          <span class="editor-block-hint text-xs text-on-surface-variant opacity-70">Select text for toolbar · Type / for blocks · AI writing in Skills</span>
        </div>
      </div>
    </div>
  `;

  const titleEl = container.querySelector('#editor-title');
  let saveTimeout;
  let notionEditor = null;

  const canvasEl = container.querySelector('#editor-canvas');
  if (canvasEl) {
    notionEditor = createNotionEditor({
      container: canvasEl,
      initialHtml: contentHtml,
      onChange: () => debouncedSave(),
      onAddComment: async ({ selectedText, content }) => {
        const { data: newComment, error } = await createComment(page.id, content);
        if (error) {
          showToast(`Could not post comment: ${error.message}`, 'error');
          return null;
        }
        showToast('Comment attached to selection', 'success');
        await loadComments();
        return newComment?.id || null;
      },
      onCommentClick: (commentId) => {
        const commentEl = container.querySelector(`[data-comment-id="${commentId}"]`);
        if (commentEl) {
          commentEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
          commentEl.classList.add('comment-highlight-pulse');
          setTimeout(() => commentEl.classList.remove('comment-highlight-pulse'), 2000);
        } else {
          container.querySelector('#editor-comments')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      },
      onOpenContextMenu: ({ block, x, y }) => {
        showBlockContextMenu(block, x, y);
      }
    });
    container.__notionEditor = notionEditor;
  }

  function editorHtml() {
    if (notionEditor) {
      return cleanBlockContent(notionEditor.getHtml());
    }
    return '';
  }

  async function saveNow() {
    clearTimeout(saveTimeout);
    const title = titleEl?.textContent || 'Untitled';
    const html = editorHtml();
    writeLocalDraft(page.id, { title, html });
    const status = container.querySelector('#editor-save-status');
    if (status) status.textContent = 'Saving…';
    const { error } = await updatePage(page.id, { title, content: { ...(page.content || {}), html } });
    if (status) status.textContent = error ? 'Save failed — local draft kept' : 'Saved';
    if (!error) clearLocalDraft(page.id);
    else showToast(`Could not save page: ${error.message}`, 'error');
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

  const editorBridgeInstance = {
    pageId: page.id,
    page,
    getTitle: () => titleEl?.textContent || page.title || 'Untitled',
    setTitle: (newTitle) => {
      if (titleEl) {
        titleEl.textContent = newTitle;
        debouncedSave();
      }
    },
    getHtml: () => editorHtml(),
    getText: () => notionEditor ? notionEditor.quill.getText() : (titleEl?.textContent || ''),
    replaceContent: async ({ html, title }) => {
      if (title && titleEl) {
        titleEl.textContent = title;
      }
      if (html !== undefined && notionEditor) {
        notionEditor.setHtml(html);
      }
      await saveNow();
    },
    insertContent: async (html, position = 'end') => {
      if (!notionEditor) return;
      if (position === 'start') {
        const current = notionEditor.getHtml();
        notionEditor.setHtml(html + current);
      } else {
        const len = notionEditor.quill.getLength();
        const separator = len > 1 ? '<p><br></p>' : '';
        notionEditor.quill.clipboard.dangerouslyPasteHTML(len - 1, separator + html);
      }
      await saveNow();
    },
    saveNow
  };
  container.__editorBridgeInstance = editorBridgeInstance;
  registerActiveEditor(editorBridgeInstance);

  container.querySelector('#editor-add-block')?.addEventListener('click', () => {
    if (!notionEditor) return;
    const len = notionEditor.quill.getLength();
    notionEditor.quill.setSelection(len - 1, 0);
    notionEditor.quill.focus();
    notionEditor.quill.root.dispatchEvent(new KeyboardEvent('keydown', { key: '/', bubbles: true }));
  });

  function decorateBlocks() { }

  const aiUndoKey = `motion-ai-undo:${page.id}`;
  const triggerAIPanel = (customPrompt = '') => {
    const plain = notionEditor ? notionEditor.quill.getText() : (titleEl?.textContent || '');
    openAIPagePanel({
      pageId: page.id,
      pageTitle: titleEl?.textContent || 'Untitled',
      pageText: plain,
      initialPrompt: customPrompt,
      applyBlocks: async html => {
        if (!titleEl.isConnected) throw new Error('The editor changed. Reopen the AI assistant on the current page.');
        clearTimeout(saveTimeout);
        if (notionEditor) {
          const before = notionEditor.getHtml();
          const cleanHtml = sanitizeHtml(html);
          notionEditor.setHtml(before + cleanHtml);
          if (!await saveNow()) {
            notionEditor.setHtml(before);
            throw new Error('Apply failed. The proposal was not kept on the page.');
          }
          try { localStorage.setItem(aiUndoKey, JSON.stringify({ before })); } catch { /* ignore */ }
        }
      },
      undoApply: async () => {
        if (!titleEl.isConnected) throw new Error('The editor changed. Reopen the AI assistant on the current page.');
        let undo; try { undo = JSON.parse(localStorage.getItem(aiUndoKey)); } catch { undo = null; }
        if (!undo?.before) throw new Error('There is no saved AI addition to undo on this browser.');
        clearTimeout(saveTimeout);
        if (notionEditor) {
          notionEditor.setHtml(undo.before);
          if (!await saveNow()) {
            throw new Error('Undo could not save.');
          }
          localStorage.removeItem(aiUndoKey);
        }
      }
    });
  };
  container.querySelector('#editor-page-ai')?.addEventListener('click', () => triggerAIPanel());

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
  const insertAtEditor = (html) => {
    if (notionEditor) {
      const sel = notionEditor.quill.getSelection() || { index: notionEditor.quill.getLength() - 1, length: 0 };
      notionEditor.quill.clipboard.dangerouslyPasteHTML(sel.index, html);
      debouncedSave();
      return;
    }
  };

  const defaultBlockTemplates = {
    text: '<p><br></p>',
    heading1: '<h1>Heading 1</h1>',
    heading2: '<h2>Heading 2</h2>',
    heading3: '<h3>Heading 3</h3>',
    bulleted: '<ul><li>List item</li></ul>',
    numbered: '<ol><li>List item</li></ol>',
    todo: '<ul data-checked="false"><li>To-do item</li></ul>',
    quote: '<blockquote>Quote</blockquote>',
    code: '<pre class="ql-syntax">// Code here</pre>',
    divider: '<hr class="motion-divider" />',
    table: '<table class="editor-simple-table"><thead><tr><th>Header 1</th><th>Header 2</th><th>Header 3</th></tr></thead><tbody><tr><td>Data 1</td><td>Data 2</td><td>Data 3</td></tr><tr><td>Data 4</td><td>Data 5</td><td>Data 6</td></tr></tbody></table>',
    callout: '<aside class="editor-callout"><span class="editor-callout-icon">💡</span><div class="editor-callout-text">Highlight note or callout</div></aside>',
    toggle: '<details class="editor-toggle" open><summary>Toggle header</summary><div class="editor-toggle-content"><p>Toggle details</p></div></details>'
  };

  const insertBlock = async (type) => {
    if (type === 'ai-table') {
      triggerAIPanel('Create a detailed table on this page with clear rows and columns for: ');
      return;
    }
    if (type === 'ai') {
      triggerAIPanel();
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
    const html = defaultBlockTemplates[type] || '<p><br></p>';
    insertAtEditor(html);
    debouncedSave();
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
      const sel = window.getSelection();
      const block = sel?.anchorNode?.nodeType === Node.ELEMENT_NODE ? sel.anchorNode : sel?.anchorNode?.parentElement;
      const currentText = block?.textContent || '';
      if (/^\/[^\s]*$/.test(currentText.trim()) || /^\/[^\s]*$/.test((editor.textContent || '').trim())) {
        openBlockMenu(editor);
      }
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

  function editBlock(block = getSelectedBlock()) {
    if (!block) return showToast('Add a block first, or click the block you want to edit.', 'error');
    selectedBlock = block;
    lastBlockEditor?.focus();
    const focusTarget = block.querySelector('span:not(.editor-callout-icon), summary, p, li, code, th, td') || block;
    focusTarget.focus?.();
    const sel = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(focusTarget);
    sel.removeAllRanges();
    sel.addRange(range);
  }

  async function deleteBlock(block = getSelectedBlock()) {
    if (!block) return showToast('Click the block you want to delete first.', 'error');
    const preview = (block.textContent || '').trim().slice(0, 100) || 'this block';
    if (!await requestConfirmation(`Are you sure you want to delete “${preview}”?`)) return;
    if (!block.isConnected) return;
    const parent = block.parentNode;
    const parentHost = parent?.parentNode;
    const parentNext = parent?.nextSibling;
    const next = block.nextSibling;
    block.remove();
    selectedBlock = null;
    blockRange = null;
    if (notionEditor?.quill) {
      notionEditor.quill.update();
    }
    if (await saveNow()) {
      showToast('Block deleted', 'success');
    } else {
      if (parent && !parent.isConnected && parentHost?.isConnected) parentHost.insertBefore(parent, parentNext?.parentNode === parentHost ? parentNext : null);
      if (parent?.isConnected) parent.insertBefore(block, next?.parentNode === parent ? next : null);
      selectedBlock = block;
      writeLocalDraft(page.id, { title: titleEl?.textContent || 'Untitled', html: editorHtml() });
    }
  }

  const contextMenu = document.createElement('div');
  contextMenu.className = 'editor-block-context-menu';
  contextMenu.setAttribute('role', 'menu');
  contextMenu.setAttribute('aria-label', 'Block actions');
  contextMenu.hidden = true;
  contextMenu.innerHTML = '<button type="button" role="menuitem" data-context-ai><span class="material-symbols-outlined" style="color:var(--primary)" aria-hidden="true">auto_awesome</span>Edit with AI</button><button type="button" role="menuitem" data-context-edit><span class="material-symbols-outlined" aria-hidden="true">edit</span>Edit</button><button type="button" role="menuitem" data-context-delete><span class="material-symbols-outlined" aria-hidden="true">delete</span>Delete</button>';
  container.append(contextMenu);
  let contextBlock = null;
  let contextEvents;
  const closeContextMenu = () => {
    contextMenu.hidden = true;
    contextBlock?.classList.remove('block-context-selected');
    contextEvents?.abort();
  };

  function showBlockContextMenu(block, x, y) {
    if (!block) return;
    closeBlockMenu();
    closeContextMenu();
    selectedBlock = contextBlock = block;
    block.classList.add('block-context-selected');
    contextMenu.hidden = false;
    contextMenu.style.left = `${Math.max(8, Math.min(x, window.innerWidth - contextMenu.offsetWidth - 8))}px`;
    contextMenu.style.top = `${Math.max(8, Math.min(y, window.innerHeight - contextMenu.offsetHeight - 8))}px`;
    contextEvents = new AbortController();
    const signal = contextEvents.signal;
    document.addEventListener('pointerdown', outside => { if (!contextMenu.contains(outside.target)) closeContextMenu(); }, { signal });
    window.addEventListener('scroll', closeContextMenu, { capture: true, signal });
    window.addEventListener('resize', closeContextMenu, { signal });
    window.addEventListener('hashchange', closeContextMenu, { signal });
    contextMenu.querySelector('button')?.focus();
  }

  function openContextMenu(event, editor) {
    let block = event.target.closest('h1,h2,h3,p,ul,ol,details,blockquote,pre,hr,table,aside');
    if (!block || !editor.contains(block)) return;
    const compound = block.parentElement?.closest('ul,ol,details,table,aside');
    if (compound && editor.contains(compound)) block = compound;
    event.preventDefault();
    lastBlockEditor = editor;
    const rect = block.getBoundingClientRect();
    const x = event.clientX || rect.left + 16;
    const y = event.clientY || rect.top + 16;
    showBlockContextMenu(block, x, y);
  }
  contextMenu.querySelector('[data-context-ai]')?.addEventListener('click', () => {
    const block = contextBlock; closeContextMenu();
    if (!block) return;
    const text = (block.textContent || '').trim();
    triggerAIPanel(`Rewrite, enhance, or convert this paragraph into an organized table:\n"${text}"`);
  });
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
        if (block) openContextMenu({ target: block, preventDefault: () => event.preventDefault() }, editor);
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
    const html = notionEditor ? notionEditor.getHtml() : '';
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
    if (notionEditor) notionEditor.setHtml(html);
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
    const html = notionEditor ? notionEditor.getHtml() : '';
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
      const text = `${titleEl?.textContent || ''}\n${notionEditor ? notionEditor.quill.getText() : ''}`;
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

    list.querySelectorAll('[data-comment-resolve]').forEach((button) => {
      button.addEventListener('click', async () => {
        const comment = comments.find((item) => item.id === button.dataset.commentResolve);
        if (!comment) return;
        const isResolved = comment.content.startsWith('[RESOLVED] ');
        const nextContent = isResolved ? comment.content.replace('[RESOLVED] ', '') : `[RESOLVED] ${comment.content}`;
        const { error: updateError } = await updateComment(comment.id, nextContent);
        if (updateError) return showToast(`Could not update comment: ${updateError.message}`, 'error');
        if (!isResolved && notionEditor) {
          const delta = notionEditor.quill.getContents();
          let pos = 0;
          delta.ops.forEach(op => {
            const len = typeof op.insert === 'string' ? op.insert.length : 1;
            if (op.attributes && op.attributes.comment === comment.id) {
              notionEditor.quill.formatText(pos, len, 'comment', false);
            }
            pos += len;
          });
          await saveNow();
        }
        showToast(isResolved ? 'Comment reopened' : 'Comment marked resolved', 'success');
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
  const isResolved = String(comment.content || '').startsWith('[RESOLVED] ');
  const displayContent = isResolved ? comment.content.replace('[RESOLVED] ', '') : comment.content;

  return `
    <article class="editor-comment ${isResolved ? 'comment-resolved opacity-60' : ''}" data-comment-id="${comment.id}" id="comment-${comment.id}" style="margin-left:${depth * 1.25}rem">
      <div class="editor-comment-meta">
        <span class="editor-comment-avatar">${escapeComment(author.slice(0, 1).toUpperCase())}</span>
        <strong>${escapeComment(author)}</strong>
        <time>${timeAgo(comment.created_at)}</time>
        ${isResolved ? '<span class="text-[11px] text-primary font-semibold">✓ Resolved</span>' : ''}
        <span class="editor-comment-actions">
          <button type="button" data-comment-resolve="${comment.id}" title="${isResolved ? 'Reopen comment' : 'Resolve comment'}">${isResolved ? 'Reopen' : 'Resolve'}</button>
          <button type="button" data-comment-reply="${comment.id}">Reply</button>
          ${comment.user_id === currentUserId ? `<button type="button" data-comment-edit="${comment.id}">Edit</button><button type="button" data-comment-delete="${comment.id}">Delete</button>` : ''}
        </span>
      </div>
      <p>${escapeComment(displayContent)}</p>
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
