import { requestInput, requestConfirmation, requestChoice } from "../../lib/dialogs.js";
import { requestNewTask } from "../../lib/taskDetails.js";
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
  getWorkspaceMembers,
  timeAgo
} from '../../lib/queries.js';
import { buildProjectIndex, tasksForProject } from '../../lib/projects.js';
import { openShareDialog, openHistory, saveAsTemplate } from '../../lib/pageTools.js';
import { attachEditorMentions } from '../../lib/editorMentions.js';
import { startLiveCollaboration } from '../../lib/liveCollab.js';
import { supabase } from '../../lib/supabase.js';
import { renderProjectBar } from './project.js';
import { attachMentionPicker, extractMentionIds, renderMentionsHtml, memberLabel } from '../../lib/mentions.js';

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
  // Overlapping renders (fast navigation, React StrictMode) must not each create an editor.
  const renderToken = Symbol('editor-render');
  container.__renderToken = renderToken;
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

  const owningProjectId = buildProjectIndex(workspacePages || []).get(page.id) || null;
  const owningProject = owningProjectId ? (workspacePages || []).find((candidate) => candidate.id === owningProjectId) : null;
  setBreadcrumb(owningProject && owningProject.id !== page.id ? `${owningProject.title || 'Project'} / ${page.title || 'Untitled'}` : (page.title || 'Untitled'));

  const draft = readLocalDraft(page.id);
  const contentHtml = cleanBlockContent(draft ? draft.html : page.content?.html || '');
  const safeTitle = escapeComment((draft ? draft.title : page.title) || 'Untitled');
  const safeCoverUrl = /^https?:\/\//i.test(page.cover_url || '') ? escapeComment(page.cover_url) : '';

  if (container.__renderToken !== renderToken) return;
  container.__notionEditor?.destroy();
  container.__notionEditor = null;

  container.innerHTML = `
    <div class="editor-layout flex-1 bg-surface overflow-y-auto relative">
      <div class="max-w-3xl mx-auto pt-12 pb-16 px-12">
        ${owningProject ? renderProjectBar({ project: owningProject, activeTab: owningProject.id === page.id ? 'plan' : 'pages' }) : ''}
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
          <button id="editor-change-icon" type="button" class="page-icon-btn" title="Change icon" aria-label="Change page icon">${escapeComment(page.icon || '📄')}</button>
          <h1 id="editor-title" class="text-4xl font-extrabold tracking-tight text-on-surface mb-2 outline-none focus:ring-0" contenteditable="true">${safeTitle
    }</h1>
          <div class="flex gap-4 text-sm text-on-surface-variant/60">
            <span class="flex items-center gap-1">
              <span class="material-symbols-outlined text-[14px]">history</span>
              Edited ${timeAgo(page.updated_at)}
            </span>
            <span id="editor-live-badge" class="editor-live-badge" hidden aria-live="polite"></span>
            <span id="editor-save-status" class="flex items-center gap-1 text-primary" aria-live="polite">
              <span class="material-symbols-outlined text-[14px]">${draft ? 'cloud_off' : 'cloud_done'}</span>
              ${draft ? 'Local draft recovered' : 'Saved'}
            </span>
          </div>
          <div class="page-actions" role="toolbar" aria-label="Page actions">
            <button type="button" id="page-share-btn"><span class="material-symbols-outlined">ios_share</span>Share</button>
            <button type="button" id="page-history-btn"><span class="material-symbols-outlined">history</span>History</button>
            <div class="page-menu-wrap">
              <button type="button" id="page-ai-btn" aria-haspopup="menu" aria-expanded="false"><span class="material-symbols-outlined">auto_awesome</span>Ask AI</button>
              <div class="page-menu" role="menu" hidden data-menu="ai">
                <button type="button" role="menuitem" data-page-ai="summarize"><span class="material-symbols-outlined">summarize</span>Summarize this page</button>
                <button type="button" role="menuitem" data-page-ai="tasks"><span class="material-symbols-outlined">add_task</span>Turn this page into tasks</button>
                <button type="button" role="menuitem" data-page-ai="status"><span class="material-symbols-outlined">campaign</span>Write a status update</button>
                <button type="button" role="menuitem" data-page-ai="improve"><span class="material-symbols-outlined">edit_note</span>Suggest improvements</button>
                <button type="button" role="menuitem" data-page-ai="ask"><span class="material-symbols-outlined">chat</span>Ask a question about it…</button>
              </div>
            </div>
            <div class="page-menu-wrap">
              <button type="button" id="page-more-btn" aria-haspopup="menu" aria-expanded="false" aria-label="More page actions"><span class="material-symbols-outlined">more_horiz</span></button>
              <div class="page-menu" role="menu" hidden data-menu="more">
                <button type="button" role="menuitem" id="editor-favorite-page"><span class="material-symbols-outlined">${page.is_favorite ? 'star' : 'star_outline'}</span>${page.is_favorite ? 'Favorited' : 'Favorite'}</button>
                <button type="button" role="menuitem" id="editor-copy-link"><span class="material-symbols-outlined">link</span>Copy link</button>
                <button type="button" role="menuitem" id="editor-duplicate-page"><span class="material-symbols-outlined">content_copy</span>Duplicate</button>
                <button type="button" role="menuitem" id="editor-move-page"><span class="material-symbols-outlined">drive_file_move</span>Move to…</button>
                <button type="button" role="menuitem" id="page-save-template"><span class="material-symbols-outlined">bookmark_add</span>Save as team template</button>
                <hr />
                <button type="button" role="menuitem" id="editor-export-markdown"><span class="material-symbols-outlined">download</span>Export as Markdown</button>
                <button type="button" role="menuitem" id="editor-import-markdown"><span class="material-symbols-outlined">upload</span>Import Markdown</button>
                <hr />
                <button type="button" role="menuitem" id="editor-archive-page"><span class="material-symbols-outlined">archive</span>Archive</button>
                <button type="button" role="menuitem" id="editor-delete-page" class="is-danger"><span class="material-symbols-outlined">delete</span>Delete</button>
              </div>
            </div>
            <input type="file" id="editor-import-input" accept=".md,.markdown,.txt,text/markdown,text/plain" hidden />
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
          <span class="editor-block-hint text-xs text-on-surface-variant opacity-70">Select text to format or ask AI · Type / to add a block</span>
        </div>

        <section class="editor-related" aria-label="Tasks and links">
          <div class="editor-related-head">
            <h2><span class="material-symbols-outlined">task_alt</span> Tasks on this page <small>${(linkedTasks || []).length}</small></h2>
            <div class="editor-related-actions">
              <button id="editor-add-task" type="button"><span class="material-symbols-outlined">add_task</span> Add task</button>
              <button id="editor-link-page" type="button"><span class="material-symbols-outlined">link</span> Link a page</button>
            </div>
          </div>
          ${(linkedTasks || []).length ? `<ul class="editor-related-list">${linkedTasks.map((task) => `
            <li>
              <button type="button" class="editor-linked-task-toggle" data-task-id="${escapeComment(task.id)}" data-completed="${task.status === 'done' || task.completed ? 'true' : 'false'}" aria-label="${task.status === 'done' || task.completed ? 'Mark as not done' : 'Mark as done'}: ${escapeComment(task.title)}">
                <span class="material-symbols-outlined">${task.status === 'done' || task.completed ? 'check_circle' : 'radio_button_unchecked'}</span>
              </button>
              <a href="#kanban?task=${encodeURIComponent(task.id)}" class="${task.status === 'done' || task.completed ? 'is-done' : ''}">${escapeComment(task.title)}</a>
              ${task.assignee?.name ? `<span class="editor-related-meta">${escapeComment(task.assignee.name)}</span>` : ''}
              ${task.due_date ? `<span class="editor-related-meta">Due ${escapeComment(task.due_date)}</span>` : ''}
            </li>`).join('')}</ul>` : '<p class="editor-related-empty">No tasks yet. Add one to assign work to a teammate from this page.</p>'}
          ${backlinks.length ? `
            <h3 class="editor-related-subhead">Linked from</h3>
            <ul class="editor-related-list">${backlinks.map((candidate) => `<li><span>${escapeComment(candidate.icon || '📄')}</span><a href="#editor/${escapeComment(candidate.id)}">${escapeComment(candidate.title || 'Untitled')}</a></li>`).join('')}</ul>` : ''}
        </section>
      </div>
      <aside id="editor-comments" class="editor-comments-panel" aria-label="Page discussion">
        <div class="editor-comments-heading">
          <div>
            <h2>Discussion</h2>
            <p>Ask questions, give feedback, and @mention teammates.</p>
          </div>
          <span class="material-symbols-outlined" aria-hidden="true">forum</span>
        </div>
        <div class="editor-comments-list"><p class="editor-comments-empty">Loading comments…</p></div>
      </aside>
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
        const { data: newComment, error } = await postComment(content);
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
      onAskAI: (text) => triggerAIPanel(`Improve or rewrite this block, or turn it into a better structure:\n"${text}"`),
      extraCommands: [
        { id: 'mention', label: 'Mention a person', icon: 'alternate_email', desc: 'Notify a teammate', keywords: 'at person user notify', run: ({ quill, index }) => { mentions.showOnly('person'); quill.insertText(index, '@', 'user'); quill.setSelection(index + 1, 0, 'silent'); } },
        { id: 'date', label: 'Date', icon: 'event', desc: 'Insert a date like Tomorrow', keywords: 'today tomorrow day when reminder', run: ({ quill, index }) => { mentions.showOnly('date'); quill.insertText(index, '@', 'user'); quill.setSelection(index + 1, 0, 'silent'); } },
        { id: 'page-link', label: 'Link to page', icon: 'link', desc: 'Link another page or project', keywords: 'page reference', run: () => insertBlock('page-link') },
        { id: 'subpage', label: 'Sub-page', icon: 'note_add', desc: 'Create a page inside this one', keywords: 'page child nested new', run: () => insertBlock('page') },
        { id: 'web-link', label: 'Web link', icon: 'public', desc: 'Paste a URL', keywords: 'url website http', run: () => insertBlock('link') },
        { id: 'task', label: 'Task', icon: 'add_task', desc: 'Create a task linked to this page', keywords: 'todo assign kanban', run: () => container.querySelector('#editor-add-task')?.click() },
        { id: 'ai', label: 'Ask AI to write', icon: 'auto_awesome', desc: 'Draft content with AI', keywords: 'ai generate write draft', run: () => triggerAIPanel() }
      ]
    });
    container.__notionEditor = notionEditor;
    // "@" in the page text: mention people (notifies them), link pages, insert dates.
    const mentions = attachEditorMentions(notionEditor.quill, canvasEl, {
      getPeople: () => commentMembers
        .filter((member) => member.user_id !== AppState.user?.id)
        .map((member) => ({ id: member.user_id, label: memberLabel(member), hint: member.user?.email || '' })),
      getPages: () => (workspacePages || []).filter((candidate) => candidate.id !== page.id && !candidate.archived_at)
        .map((candidate) => ({ id: candidate.id, label: candidate.title || 'Untitled', icon: candidate.page_type === 'project' ? '📁' : candidate.icon || '📄' })),
      onPeopleMentioned: async (userIds) => {
        const { error: mentionError } = await supabase.rpc('notify_page_mentions', { target_page: page.id, user_ids: userIds });
        if (!mentionError) showToast('They’ll get a notification', 'success');
      }
    });
    // Live co-editing: everyone with this page open edits the same document.
    const liveBadge = container.querySelector('#editor-live-badge');
    const live = startLiveCollaboration({
      quill: notionEditor.quill,
      pageId: page.id,
      user: { id: AppState.user?.id, name: AppState.profile?.name || AppState.user?.email?.split('@')[0] || 'Teammate' },
      onPeersChange: (peers) => {
        if (!liveBadge) return;
        liveBadge.hidden = peers.length === 0;
        liveBadge.innerHTML = peers.length
          ? `<span class="live-dot"></span>Live · ${peers.slice(0, 3).map((peer) => `<b style="color:${escapeComment(peer.color)}">${escapeComment(peer.name)}</b>`).join(', ')}${peers.length > 3 ? ` +${peers.length - 3}` : ''} ${peers.length === 1 ? 'is' : 'are'} editing`
          : '';
      }
    });
    container.__liveCollab = live;
    const originalDestroy = notionEditor.destroy;
    notionEditor.destroy = () => { live.stop(); container.__liveCollab = null; mentions.destroy(); originalDestroy(); };
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
    notionEditor?.openBlockMenuAtEnd();
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
      const target = await pickPage(candidates);
      if (!target) return;
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
    const { data: members } = await getWorkspaceMembers(AppState.workspace.id);
    const draft = await requestNewTask({ members: members || [], heading: `New task on “${page.title || 'Untitled'}”` });
    if (!draft) return;
    const { title, ...options } = draft;
    const { data: task, error: taskError } = await createTask(title, { ...options, workspaceId: AppState.workspace.id, pageId: page.id });
    if (taskError) return showToast(`Could not create task: ${taskError.message}`, 'error');
    showToast(`Task “${task?.title || title}” added to this page`, 'success');
    await renderEditor(container, route);
    container.querySelector('.editor-related')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  });

  container.querySelector('#editor-link-page')?.addEventListener('click', async () => {
    const candidates = (workspacePages || []).filter((candidate) => candidate.id !== page.id && !candidate.archived_at);
    if (!candidates.length) return showToast('Create another page before linking it', 'error');
    const target = await pickPage(candidates);
    if (!target) return;
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
    const choice = await requestChoice({
      title: `Move “${page.title || 'Untitled'}” to…`,
      placeholder: 'Search pages and projects…',
      items: [{ id: '', label: 'Top level (no parent)', icon: '⬆️' }, ...candidates.map((candidate) => ({ id: candidate.id, label: candidate.title || 'Untitled', icon: candidate.page_type === 'project' ? '📁' : candidate.icon || '📄', hint: candidate.page_type === 'project' ? 'Project' : '' }))]
    });
    if (!choice) return;
    const parent = choice.id ? candidates.find((candidate) => candidate.id === choice.id) : null;
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

  let commentMembers = [];
  const membersReady = AppState.workspace?.id
    ? getWorkspaceMembers(AppState.workspace.id).then(({ data }) => { commentMembers = data || []; }).catch(() => {})
    : Promise.resolve();

  const postComment = async (content, parentId = null) => {
    const mentions = extractMentionIds(content, commentMembers, AppState.user?.id);
    const result = await createComment(page.id, content, parentId, mentions);
    if (!result.error && mentions.length) {
      showToast(`Notified ${mentions.map((id) => memberLabel(commentMembers.find((member) => member.user_id === id))).join(', ')}`, 'success');
    }
    return result;
  };

  // ---------- Page toolbar: menus, share, history, templates, AI ----------
  const closeMenus = () => container.querySelectorAll('.page-menu').forEach((menu) => {
    menu.hidden = true;
    menu.previousElementSibling?.setAttribute('aria-expanded', 'false');
  });
  container.querySelectorAll('#page-ai-btn, #page-more-btn').forEach((button) => button.addEventListener('click', (event) => {
    event.stopPropagation();
    const menu = button.nextElementSibling;
    const willOpen = menu.hidden;
    closeMenus();
    menu.hidden = !willOpen;
    button.setAttribute('aria-expanded', String(willOpen));
    if (willOpen) menu.querySelector('button')?.focus();
  }));
  container.querySelectorAll('.page-menu').forEach((menu) => {
    menu.addEventListener('click', (event) => { if (event.target.closest('button')) closeMenus(); });
    menu.addEventListener('keydown', (event) => {
      const items = [...menu.querySelectorAll('button')];
      const index = items.indexOf(document.activeElement);
      if (event.key === 'Escape') { closeMenus(); menu.previousElementSibling?.focus(); }
      if (event.key === 'ArrowDown') { event.preventDefault(); items[(index + 1) % items.length]?.focus(); }
      if (event.key === 'ArrowUp') { event.preventDefault(); items[(index - 1 + items.length) % items.length]?.focus(); }
    });
  });
  if (!container.__pageMenuCloser) {
    container.__pageMenuCloser = (event) => {
      if (!event.target.closest('.page-menu-wrap')) container.querySelectorAll('.page-menu').forEach((menu) => { menu.hidden = true; });
    };
    document.addEventListener('click', container.__pageMenuCloser);
  }

  container.querySelector('#page-share-btn')?.addEventListener('click', () => openShareDialog(page));
  container.querySelector('#page-history-btn')?.addEventListener('click', () => openHistory(page, async () => renderEditor(container, route)));
  container.querySelector('#page-save-template')?.addEventListener('click', async () => {
    const isProjectPage = page.page_type === 'project';
    let projectTasks = [];
    if (isProjectPage) {
      const { data: allTasks } = await getTasks({ workspaceId: AppState.workspace?.id });
      projectTasks = tasksForProject(allTasks || [], workspacePages || [], page.id);
    }
    await saveAsTemplate({ ...page, content: { ...(page.content || {}), html: notionEditor ? cleanBlockContent(notionEditor.getHtml()) : page.content?.html || '' } }, { isProject: isProjectPage, tasks: projectTasks });
  });
  container.querySelectorAll('[data-page-ai]').forEach((button) => button.addEventListener('click', async () => {
    await saveNow?.();
    const title = page.title || 'Untitled';
    const prompts = {
      summarize: `Summarize the page “${title}” in a few bullet points: key points, decisions, and open questions.`,
      tasks: `Read the page “${title}” and turn its action items into tasks${owningProject ? ` in the project “${owningProject.title}”` : ''}. Use owners and due dates mentioned in the text when they match team members; otherwise leave them empty. Propose the tasks.`,
      status: `Write a short status update about “${title}” (what is done, what is next, any blockers) and propose posting it as a comment on that page.`,
      improve: `Suggest concrete improvements to the page “${title}”: missing sections, unclear parts, and better structure. If useful, propose adding the missing sections to the page.`
    };
    let prompt = prompts[button.dataset.pageAi];
    if (button.dataset.pageAi === 'ask') {
      const question = await requestInput(`What do you want to know about “${title}”?`, '');
      if (!question?.trim()) return;
      prompt = `About the page “${title}”: ${question.trim()}`;
    }
    try { sessionStorage.setItem('motion-ai-pending', JSON.stringify({ prompt, pageId: page.id })); } catch { /* ignore */ }
    window.location.hash = 'ai-chat?new=1';
  }));

  async function loadComments() {
    const panel = container.querySelector('#editor-comments');
    const list = panel?.querySelector('.editor-comments-list');
    if (!list) return;

    const draftText = list.querySelector('#editor-comment-form textarea')?.value || '';
    const [{ data: comments, error }] = await Promise.all([getComments(page.id), membersReady]);
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
    const renderThread = (comment, depth = 0) => `${renderComment(comment, AppState.user?.id, depth, commentMembers)}${(childrenByParent.get(comment.id) || []).map((child) => renderThread(child, Math.min(depth + 1, 3))).join('')}`;
    const rootComments = childrenByParent.get(null) || comments.filter((comment) => !comment.parent_id);
    const isResolvedThread = (comment) => String(comment.content || '').startsWith('[RESOLVED] ');
    const openCount = rootComments.filter((comment) => !isResolvedThread(comment)).length;
    const resolvedCount = rootComments.length - openCount;
    const filter = container.__commentFilter || 'open';
    const shownRoots = rootComments.filter((comment) => filter === 'all' || (filter === 'open' ? !isResolvedThread(comment) : isResolvedThread(comment)));
    const filterBar = rootComments.length ? `<div class="comment-filter" role="tablist" aria-label="Show threads">
        ${[['open', `Open ${openCount}`], ['resolved', `Resolved ${resolvedCount}`], ['all', 'All']].map(([value, label]) => `<button type="button" role="tab" data-comment-filter="${value}" aria-selected="${filter === value}" class="${filter === value ? 'is-active' : ''}">${label}</button>`).join('')}
        ${openCount > 1 ? '<button type="button" class="comment-next" data-comment-next title="Jump to the next open thread"><span class="material-symbols-outlined">south</span>Next open</button>' : ''}
      </div>` : '';
    const emptyText = !comments.length
      ? 'No comments yet. Start a conversation — select text in the page to comment on it, or write below.'
      : filter === 'open' ? 'No open threads. Everything is resolved 🎉' : 'Nothing here.';

    list.innerHTML = `
      ${filterBar}
      ${shownRoots.length ? shownRoots.map((comment) => renderThread(comment)).join('') : `<p class="editor-comments-empty">${emptyText}</p>`}
      <form class="editor-comment-form" id="editor-comment-form">
        <textarea name="content" rows="3" placeholder="Write a comment… Type @ to mention a teammate." required></textarea>
        <div class="editor-comment-form-row">
          <small>Ctrl/⌘ + Enter to post</small>
          <button type="submit" class="modal-btn-primary">
            <span class="material-symbols-outlined text-sm">send</span>
            Comment
          </button>
        </div>
      </form>
    `;

    list.querySelectorAll('[data-comment-filter]').forEach((button) => button.addEventListener('click', () => {
      container.__commentFilter = button.dataset.commentFilter;
      loadComments();
    }));
    list.querySelector('[data-comment-next]')?.addEventListener('click', () => {
      const openThreads = [...list.querySelectorAll('.editor-comment:not(.comment-resolved)')].filter((article) => article.style.marginLeft === '0rem' || !article.style.marginLeft);
      if (!openThreads.length) return;
      container.__commentCursor = ((container.__commentCursor ?? -1) + 1) % openThreads.length;
      const target = openThreads[container.__commentCursor];
      target.scrollIntoView({ behavior: 'smooth', block: 'center' });
      target.classList.add('comment-highlight-pulse');
      window.setTimeout(() => target.classList.remove('comment-highlight-pulse'), 1600);
      const mark = container.querySelector(`.motion-comment-highlight[data-comment-id="${target.dataset.commentId}"]`);
      mark?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });

    const mainTextarea = list.querySelector('#editor-comment-form textarea');
    if (mainTextarea) {
      mainTextarea.value = draftText;
      attachMentionPicker(mainTextarea, () => commentMembers);
      mainTextarea.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
          event.preventDefault();
          event.currentTarget.form?.requestSubmit();
        }
      });
    }

    list.querySelector('#editor-comment-form')?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const textarea = form.elements.content;
      const content = textarea.value.trim();
      if (!content) return;
      const button = form.querySelector('button');
      button.disabled = true;
      const { error: createError } = await postComment(content);
      if (createError) {
        button.disabled = false;
        showToast(`Could not post comment: ${createError.message}`, 'error');
        return;
      }
      textarea.value = '';
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
      button.addEventListener('click', () => {
        const article = button.closest('.editor-comment');
        const existing = list.querySelector('.editor-reply-form');
        if (existing) {
          const sameThread = existing.dataset.parent === button.dataset.commentReply;
          existing.remove();
          if (sameThread) return;
        }
        const form = document.createElement('form');
        form.className = 'editor-comment-form editor-reply-form';
        form.dataset.parent = button.dataset.commentReply;
        form.style.marginLeft = article?.style.marginLeft || '0';
        form.innerHTML = `
          <textarea name="content" rows="2" placeholder="Reply… Type @ to mention someone." required></textarea>
          <div class="editor-comment-form-row">
            <button type="button" class="modal-btn-secondary" data-cancel>Cancel</button>
            <button type="submit" class="modal-btn-primary">Reply</button>
          </div>`;
        article?.after(form);
        const replyBox = form.elements.content;
        attachMentionPicker(replyBox, () => commentMembers);
        const author = article?.querySelector('.editor-comment-meta strong')?.textContent?.trim();
        const authorMember = commentMembers.find((member) => memberLabel(member) === author && member.user_id !== AppState.user?.id);
        if (authorMember) replyBox.value = `@${memberLabel(authorMember)} `;
        replyBox.focus();
        replyBox.setSelectionRange(replyBox.value.length, replyBox.value.length);
        form.querySelector('[data-cancel]').addEventListener('click', () => form.remove());
        replyBox.addEventListener('keydown', (event) => {
          if (event.key === 'Escape') form.remove();
          if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); form.requestSubmit(); }
        });
        form.addEventListener('submit', async (event) => {
          event.preventDefault();
          const content = replyBox.value.trim();
          if (!content) return;
          const submit = form.querySelector('[type=submit]');
          submit.disabled = true;
          const { error: replyError } = await postComment(content, button.dataset.commentReply);
          submit.disabled = false;
          if (replyError) return showToast(`Could not add reply: ${replyError.message}`, 'error');
          await loadComments();
        });
      });
    });
  }

  const handleRemoteComments = (event) => {
    if (event.detail && event.detail !== page.id) return;
    if (!container.isConnected) {
      window.removeEventListener('motion:comments-changed', handleRemoteComments);
      return;
    }
    // Don't wipe a reply someone is in the middle of writing.
    if (container.querySelector('.editor-reply-form textarea')?.value.trim()) return;
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
    // With live co-editing, teammates' changes already arrived; don't reload the page.
    if (container.__liveCollab?.peerCount() > 0) return;
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

async function pickPage(candidates) {
  const choice = await requestChoice({
    title: 'Link to a page',
    placeholder: 'Search pages…',
    items: candidates.map((candidate) => ({ id: candidate.id, label: candidate.title || 'Untitled', icon: candidate.icon || '📄', hint: candidate.updated_at ? `Edited ${timeAgo(candidate.updated_at)}` : '' }))
  });
  return choice ? candidates.find((candidate) => candidate.id === choice.id) : null;
}

function renderComment(comment, currentUserId, depth = 0, members = []) {
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
      <p>${renderMentionsHtml(displayContent, members, Array.isArray(comment.mentions) ? comment.mentions : null)}</p>
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
