// Block editing for the page editor (Quill 2):
//  - "/" command menu (works with any keyboard, IME, paste; Enter never adds a stray line)
//  - Markdown shortcuts ("# ", "- ", "[] ", "> ", "```", "---" …)
//  - Block actions menu (drag handle / right-click): Turn into, Duplicate, Move, Copy, Ask AI, Delete
// Every change uses source 'user' so autosave and live co-editing pick it up.
import Quill from 'quill';

const Delta = Quill.import('delta');
const BlockEmbed = Quill.import('blots/block/embed');

const LINE_RESET = { header: false, list: false, blockquote: false, 'code-block': false };

// type → how to apply it to the current line
export const BLOCK_TYPES = {
  text: { label: 'Text', icon: 'notes', line: LINE_RESET },
  h1: { label: 'Heading 1', icon: 'format_h1', line: { ...LINE_RESET, header: 1 } },
  h2: { label: 'Heading 2', icon: 'format_h2', line: { ...LINE_RESET, header: 2 } },
  h3: { label: 'Heading 3', icon: 'format_h3', line: { ...LINE_RESET, header: 3 } },
  bullet: { label: 'Bulleted list', icon: 'format_list_bulleted', line: { ...LINE_RESET, list: 'bullet' } },
  ordered: { label: 'Numbered list', icon: 'format_list_numbered', line: { ...LINE_RESET, list: 'ordered' } },
  todo: { label: 'To-do list', icon: 'check_box', line: { ...LINE_RESET, list: 'unchecked' } },
  quote: { label: 'Quote', icon: 'format_quote', line: { ...LINE_RESET, blockquote: true } },
  code: { label: 'Code', icon: 'code', line: { ...LINE_RESET, 'code-block': true } }
};

const BUILTIN_COMMANDS = [
  { id: 'text', group: 'Basic blocks', desc: 'Plain paragraph', keywords: 'paragraph p plain', hint: '' },
  { id: 'h1', group: 'Basic blocks', desc: 'Big section heading', keywords: 'title header heading1', hint: '#' },
  { id: 'h2', group: 'Basic blocks', desc: 'Medium section heading', keywords: 'subtitle header heading2', hint: '##' },
  { id: 'h3', group: 'Basic blocks', desc: 'Small section heading', keywords: 'header heading3', hint: '###' },
  { id: 'quote', group: 'Basic blocks', desc: 'Capture a quote', keywords: 'blockquote citation', hint: '>' },
  { id: 'bullet', group: 'Lists', desc: 'Simple bulleted list', keywords: 'ul unordered dots', hint: '-' },
  { id: 'ordered', group: 'Lists', desc: 'List with numbers', keywords: 'ol numbered 123', hint: '1.' },
  { id: 'todo', group: 'Lists', desc: 'Track tasks with checkboxes', keywords: 'checkbox check task checklist', hint: '[]' },
  { id: 'callout', group: 'Media & layout', icon: 'lightbulb', label: 'Callout', desc: 'Highlighted note with an icon', keywords: 'note tip info warning' },
  { id: 'toggle', group: 'Media & layout', icon: 'expand_circle_right', label: 'Toggle', desc: 'Collapsible section', keywords: 'collapse details expand' },
  { id: 'table', group: 'Media & layout', icon: 'table_chart', label: 'Table', desc: '3 × 3 table you can edit', keywords: 'grid rows columns' },
  { id: 'code', group: 'Media & layout', desc: 'Code snippet', keywords: 'pre snippet program', hint: '```' },
  { id: 'divider', group: 'Media & layout', icon: 'horizontal_rule', label: 'Divider', desc: 'Line between sections', keywords: 'hr line separator rule', hint: '---' }
].map((command) => ({ ...BLOCK_TYPES[command.id], ...command }));

// Caret position right after the last insert in a change (the editor's reported
// selection can lag behind the change when text arrives in one piece).
function caretAfter(delta) {
  let index = 0;
  let caret = null;
  for (const op of delta?.ops || []) {
    if (typeof op.retain === 'number') index += op.retain;
    else if (op.insert !== undefined) {
      index += typeof op.insert === 'string' ? op.insert.length : 1;
      caret = index;
    }
  }
  return caret;
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

// A page must always end with a text line, otherwise there's nowhere to click and
// keep writing after a divider, table, callout or toggle.
export function ensureTrailingParagraph(quill, source = 'user') {
  const last = quill.scroll.children.tail;
  if (last instanceof BlockEmbed) {
    quill.updateContents(new Delta().retain(quill.getLength()).insert('\n'), source);
  }
}

// Insert a block embed (table, callout, toggle, divider) at the start of the line at `index`.
function insertBlockEmbed(quill, index, name, value) {
  const [line, offset] = quill.getLine(index);
  const lineStart = index - offset;
  const lineEmpty = line && line.length() <= 1;
  if (lineEmpty) {
    quill.insertEmbed(lineStart, name, value, 'user');
    quill.setSelection(lineStart + 1, 0, 'silent');
  } else {
    // Put it on its own line after the current one.
    const after = lineStart + line.length();
    quill.insertEmbed(after, name, value, 'user');
    quill.setSelection(after + 1, 0, 'silent');
  }
  ensureTrailingParagraph(quill);
}

export function applyBlockType(quill, index, type, length = 1) {
  if (BLOCK_TYPES[type]) {
    quill.formatLine(index, Math.max(1, length), BLOCK_TYPES[type].line, 'user');
    return true;
  }
  if (type === 'divider') { insertBlockEmbed(quill, index, 'divider', true); return true; }
  if (type === 'table') { insertBlockEmbed(quill, index, 'table-block', true); return true; }
  if (type === 'callout') { insertBlockEmbed(quill, index, 'callout-block', 'Write something worth noticing…'); return true; }
  if (type === 'toggle') { insertBlockEmbed(quill, index, 'toggle-block', { summary: 'Toggle heading', body: 'Hidden content — click the arrow to show or hide.' }); return true; }
  return false;
}

// ---------------------------------------------------------------------------
// "/" command menu
// ---------------------------------------------------------------------------

export function createSlashMenu(quill, { extraCommands = [] } = {}) {
  const commands = [...BUILTIN_COMMANDS, ...extraCommands.map((command) => ({ group: 'Insert', ...command }))];
  const menu = document.createElement('div');
  menu.className = 'motion-slash-menu';
  menu.setAttribute('role', 'listbox');
  menu.setAttribute('aria-label', 'Insert a block');
  menu.hidden = true;
  document.body.appendChild(menu);

  let slashIndex = null;
  let lastCaret = null;
  let query = '';
  let filtered = commands;
  let active = 0;

  const isOpen = () => !menu.hidden;

  function score(command, q) {
    if (!q) return 1;
    const label = command.label.toLowerCase();
    if (label.startsWith(q)) return 3;
    if (label.includes(q)) return 2;
    if (`${command.keywords || ''} ${command.desc || ''} ${command.id}`.toLowerCase().includes(q)) return 1;
    return 0;
  }

  function render() {
    let lastGroup = null;
    menu.innerHTML = `${filtered.length ? filtered.map((command, index) => {
      const heading = !query && command.group !== lastGroup ? `<div class="msm-header">${escapeHtml(command.group)}</div>` : '';
      lastGroup = command.group;
      return `${heading}<button type="button" role="option" class="msm-item ${index === active ? 'active' : ''}" aria-selected="${index === active}" data-index="${index}">
        <span class="material-symbols-outlined msm-icon">${escapeHtml(command.icon)}</span>
        <span class="msm-content"><strong>${escapeHtml(command.label)}</strong><small>${escapeHtml(command.desc || '')}</small></span>
        ${command.hint ? `<kbd class="msm-hint">${escapeHtml(command.hint)}</kbd>` : ''}
      </button>`;
    }).join('') : `<div class="msm-empty">No blocks match “${escapeHtml(query)}”. Keep typing to write text.</div>`}
    <div class="msm-footer"><span>↑↓ choose</span><span>Enter insert</span><span>Esc close</span></div>`;
    menu.querySelector('.msm-item.active')?.scrollIntoView({ block: 'nearest' });
  }

  function position() {
    const bounds = quill.getBounds(slashIndex);
    if (!bounds) return;
    const rootRect = quill.root.getBoundingClientRect();
    const width = Math.min(330, window.innerWidth - 24);
    const height = Math.min(menu.offsetHeight || 360, 380);
    let left = rootRect.left + bounds.left;
    let top = rootRect.top + bounds.bottom + 6;
    if (left + width > window.innerWidth - 12) left = window.innerWidth - width - 12;
    if (top + height > window.innerHeight - 12) top = Math.max(12, rootRect.top + bounds.top - height - 6);
    menu.style.left = `${Math.max(12, Math.round(left))}px`;
    menu.style.top = `${Math.max(12, Math.round(top))}px`;
  }

  function close() {
    menu.hidden = true;
    slashIndex = null;
    query = '';
  }

  // Re-read the text before the caret and open/filter/close accordingly.
  function refresh(caretHint = null) {
    const current = quill.getSelection();
    if (caretHint === null && (!current || current.length)) { close(); return; }
    const selection = { index: caretHint ?? current.index };
    lastCaret = selection.index;
    const [line, offset] = quill.getLine(selection.index);
    if (!line || line.statics?.blotName === 'code-block') { close(); return; }
    const before = quill.getText(selection.index - offset, offset);
    const match = /(?:^|\s)\/([^/\n]{0,24})$/.exec(before);
    if (!match || /\s{2}/.test(match[1])) { close(); return; }
    const nextSlash = selection.index - match[1].length - 1;
    const nextQuery = match[1].trim().toLowerCase();
    if (nextSlash !== slashIndex || nextQuery !== query) active = 0;
    slashIndex = nextSlash;
    query = nextQuery;
    filtered = commands
      .map((command) => ({ command, rank: score(command, query) }))
      .filter((entry) => entry.rank > 0)
      .sort((a, b) => b.rank - a.rank)
      .map((entry) => entry.command);
    // Too many characters with no match: the user is just writing text.
    if (!filtered.length && query.length > 12) { close(); return; }
    menu.hidden = false;
    render();
    position();
  }

  async function choose(command) {
    if (!command || slashIndex === null) return;
    const selection = quill.getSelection(true);
    const at = slashIndex;
    const end = Math.max(lastCaret ?? 0, selection?.index ?? 0);
    const removeLength = Math.max(1, end - at);
    close();
    if (removeLength) quill.deleteText(at, removeLength, 'user');
    quill.setSelection(at, 0, 'silent');
    if (command.run) {
      await command.run({ quill, index: at });
    } else {
      applyBlockType(quill, at, command.id);
    }
    quill.focus();
  }

  // Capture phase: runs before Quill's own Enter/arrow handling.
  const onKeyDown = (event) => {
    if (!isOpen()) return;
    const stop = () => { event.preventDefault(); event.stopImmediatePropagation(); };
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      stop();
      if (!filtered.length) return;
      active = (active + (event.key === 'ArrowDown' ? 1 : filtered.length - 1)) % filtered.length;
      render();
    } else if (event.key === 'Enter' || event.key === 'Tab') {
      if (!filtered.length) { close(); return; }
      stop();
      choose(filtered[active]);
    } else if (event.key === 'Escape') {
      stop();
      close();
    }
  };
  const onTextChange = (delta, _old, source) => {
    if (source !== 'user') return;
    const caret = caretAfter(delta);
    refresh(caret);
    // Keep the caret in sync if the editor's selection lagged behind.
    if (caret !== null && quill.getSelection()?.index !== caret && !menu.hidden) quill.setSelection(caret, 0, 'silent');
  };
  const onSelectionChange = (range) => { if (!range) window.setTimeout(() => { if (!quill.hasFocus()) close(); }, 150); };
  const onPointerDown = (event) => { if (!menu.contains(event.target)) close(); };

  menu.addEventListener('mousedown', (event) => {
    const item = event.target.closest('[data-index]');
    if (!item) return;
    event.preventDefault();
    choose(filtered[Number(item.dataset.index)]);
  });
  menu.addEventListener('mousemove', (event) => {
    const item = event.target.closest('[data-index]');
    if (item && Number(item.dataset.index) !== active) {
      active = Number(item.dataset.index);
      menu.querySelectorAll('.msm-item').forEach((el) => el.classList.toggle('active', Number(el.dataset.index) === active));
    }
  });
  quill.root.addEventListener('keydown', onKeyDown, true);
  quill.on('text-change', onTextChange);
  quill.on('selection-change', onSelectionChange);
  document.addEventListener('pointerdown', onPointerDown);
  window.addEventListener('resize', close);

  return {
    // Open the menu at `index` (used by the "+" buttons): types a real "/" there.
    openAt(index) {
      quill.focus();
      quill.insertText(index, '/', 'user');
      quill.setSelection(index + 1, 0, 'user');
      refresh();
    },
    refresh,
    destroy() {
      quill.root.removeEventListener('keydown', onKeyDown, true);
      quill.off('text-change', onTextChange);
      quill.off('selection-change', onSelectionChange);
      document.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('resize', close);
      menu.remove();
    }
  };
}

// ---------------------------------------------------------------------------
// Markdown shortcuts at the start of a line
// ---------------------------------------------------------------------------

const SHORTCUTS = [
  { pattern: /^#$/, type: 'h1' },
  { pattern: /^##$/, type: 'h2' },
  { pattern: /^###$/, type: 'h3' },
  { pattern: /^[-*+]$/, type: 'bullet' },
  { pattern: /^1[.)]$/, type: 'ordered' },
  { pattern: /^\[ ?\]$/, type: 'todo' },
  { pattern: /^>$/, type: 'quote' }
];

export function attachMarkdownShortcuts(quill) {
  // Looks at the line text before the caret (works for typing, paste and autocorrect).
  const onTextChange = (delta, _old, source) => {
    if (source !== 'user') return;
    const inserted = delta.ops.filter((op) => typeof op.insert === 'string').map((op) => op.insert).join('');
    if (!/[ `-]$/.test(inserted)) return;
    const caret = caretAfter(delta) ?? quill.getSelection()?.index;
    if (caret === null || caret === undefined) return;
    const [line, offset] = quill.getLine(caret);
    if (!line) return;
    const lineStart = caret - offset;
    const formats = quill.getFormat(lineStart, 1);
    if (formats['code-block']) return;
    const before = quill.getText(lineStart, offset);
    const run = (removeLength, apply) => {
      window.setTimeout(() => {
        quill.deleteText(lineStart, removeLength, 'user');
        apply(lineStart);
      }, 0);
    };
    if (before.endsWith(' ')) {
      const marker = before.slice(0, -1);
      const shortcut = SHORTCUTS.find((item) => item.pattern.test(marker));
      if (shortcut && !formats.list && !formats.header && !formats.blockquote) run(before.length, (at) => applyBlockType(quill, at, shortcut.type));
    } else if (before === '```') {
      run(3, (at) => applyBlockType(quill, at, 'code'));
    } else if (before === '---' && line.length() === 4) {
      run(3, (at) => applyBlockType(quill, at, 'divider'));
    }
  };
  // Enter at the end of a quote or heading starts a normal paragraph (like Notion).
  // Shift+Enter inside a quote still continues it.
  let shiftHeld = false;
  const onKey = (event) => { shiftHeld = event.shiftKey; };
  const onBreak = (delta, _old, source) => {
    if (source !== 'user' || shiftHeld) return;
    const inserted = delta.ops.filter((op) => typeof op.insert === 'string').map((op) => op.insert).join('');
    if (inserted !== '\n') return;
    const caret = caretAfter(delta);
    if (caret === null) return;
    const [line] = quill.getLine(caret);
    if (!line || line.length() > 1) return;
    const formats = quill.getFormat(caret, 1);
    if (formats.blockquote) window.setTimeout(() => quill.formatLine(caret, 1, 'blockquote', false, 'user'), 0);
  };
  quill.root.addEventListener('keydown', onKey, true);
  quill.on('text-change', onTextChange);
  quill.on('text-change', onBreak);
  return {
    destroy: () => {
      quill.off('text-change', onTextChange);
      quill.off('text-change', onBreak);
      quill.root.removeEventListener('keydown', onKey, true);
    }
  };
}

// ---------------------------------------------------------------------------
// Block actions menu (drag handle click / right-click)
// ---------------------------------------------------------------------------

export function createBlockActionsMenu(quill, { onAskAI = null } = {}) {
  const menu = document.createElement('div');
  menu.className = 'motion-block-menu';
  menu.setAttribute('role', 'menu');
  menu.hidden = true;
  document.body.appendChild(menu);
  let target = null; // { index, length, block }

  const close = () => {
    menu.hidden = true;
    target?.block?.classList.remove('block-context-selected');
    target = null;
  };

  const locate = (block) => {
    const blot = Quill.find(block);
    if (!blot || blot === quill) return null;
    return { index: quill.getIndex(blot), length: blot.length(), block };
  };

  const turnIntoTypes = ['text', 'h1', 'h2', 'h3', 'bullet', 'ordered', 'todo', 'quote', 'code'];
  function render(isLineBlock) {
    menu.innerHTML = `
      ${isLineBlock ? `<div class="mbm-label">Turn into</div>
      <div class="mbm-turn">${turnIntoTypes.map((type) => `<button type="button" role="menuitem" data-turn="${type}" title="${BLOCK_TYPES[type].label}"><span class="material-symbols-outlined">${BLOCK_TYPES[type].icon}</span><span>${BLOCK_TYPES[type].label}</span></button>`).join('')}</div>
      <hr />` : ''}
      ${onAskAI ? '<button type="button" role="menuitem" data-act="ai" class="mbm-ai"><span class="material-symbols-outlined">auto_awesome</span>Ask AI about this block</button>' : ''}
      <button type="button" role="menuitem" data-act="duplicate"><span class="material-symbols-outlined">content_copy</span>Duplicate<kbd>Ctrl D</kbd></button>
      <button type="button" role="menuitem" data-act="up"><span class="material-symbols-outlined">arrow_upward</span>Move up<kbd>Alt ↑</kbd></button>
      <button type="button" role="menuitem" data-act="down"><span class="material-symbols-outlined">arrow_downward</span>Move down<kbd>Alt ↓</kbd></button>
      <button type="button" role="menuitem" data-act="copy"><span class="material-symbols-outlined">content_paste</span>Copy text</button>
      <hr />
      <button type="button" role="menuitem" data-act="delete" class="is-danger"><span class="material-symbols-outlined">delete</span>Delete<kbd>Del</kbd></button>`;
  }

  function moveBlock(direction) {
    const blot = Quill.find(target.block);
    const sibling = direction < 0 ? blot.prev : blot.next;
    if (!sibling) return;
    const content = quill.getContents(target.index, target.length);
    quill.deleteText(target.index, target.length, 'user');
    if (direction < 0) {
      const at = quill.getIndex(sibling);
      quill.updateContents(new Delta().retain(at).concat(content), 'user');
      quill.setSelection(at, 0, 'silent');
    } else {
      const at = quill.getIndex(sibling) + sibling.length();
      quill.updateContents(new Delta().retain(at).concat(content), 'user');
      quill.setSelection(at, 0, 'silent');
    }
  }

  menu.addEventListener('mousedown', (event) => event.preventDefault());
  menu.addEventListener('click', async (event) => {
    const button = event.target.closest('button');
    if (!button || !target) return;
    const { index, length, block } = target;
    const type = button.dataset.turn;
    const act = button.dataset.act;
    if (type) {
      quill.formatLine(index, length, BLOCK_TYPES[type].line, 'user');
    } else if (act === 'duplicate') {
      const content = quill.getContents(index, length);
      quill.updateContents(new Delta().retain(index + length).concat(content), 'user');
    } else if (act === 'up' || act === 'down') {
      moveBlock(act === 'up' ? -1 : 1);
    } else if (act === 'copy') {
      try { await navigator.clipboard.writeText(quill.getText(index, length).trim()); } catch { /* clipboard blocked */ }
    } else if (act === 'ai') {
      onAskAI?.((block.textContent || '').trim());
    } else if (act === 'delete') {
      quill.deleteText(index, length, 'user');
    }
    close();
    if (act !== 'ai') quill.focus();
  });
  menu.addEventListener('keydown', (event) => {
    const items = [...menu.querySelectorAll('button')];
    const at = items.indexOf(document.activeElement);
    if (event.key === 'Escape') { event.preventDefault(); close(); quill.focus(); }
    if (event.key === 'ArrowDown' || event.key === 'ArrowRight') { event.preventDefault(); items[(at + 1) % items.length]?.focus(); }
    if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') { event.preventDefault(); items[(at - 1 + items.length) % items.length]?.focus(); }
  });
  const onPointerDown = (event) => { if (!menu.hidden && !menu.contains(event.target)) close(); };
  document.addEventListener('pointerdown', onPointerDown);
  window.addEventListener('scroll', close, true);

  // Ctrl/Cmd + D duplicates the current block.
  const onKeyDown = (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'd') {
      const selection = quill.getSelection();
      if (!selection) return;
      const [line] = quill.getLine(selection.index);
      let blot = line;
      while (blot?.parent && blot.parent !== quill.scroll) blot = blot.parent;
      if (!blot) return;
      event.preventDefault();
      const index = quill.getIndex(blot);
      const length = blot.length();
      quill.updateContents(new Delta().retain(index + length).concat(quill.getContents(index, length)), 'user');
    }
  };
  quill.root.addEventListener('keydown', onKeyDown);

  return {
    open(block, x, y) {
      const found = locate(block);
      if (!found) return;
      close();
      target = found;
      block.classList.add('block-context-selected');
      const isLineBlock = !block.matches('.notion-table-block, .editor-callout-wrapper, .editor-toggle-wrapper, hr, .motion-divider, [contenteditable="false"]');
      render(isLineBlock);
      menu.hidden = false;
      const width = menu.offsetWidth || 260;
      const height = menu.offsetHeight || 360;
      menu.style.left = `${Math.max(8, Math.min(x, window.innerWidth - width - 8))}px`;
      menu.style.top = `${Math.max(8, Math.min(y, window.innerHeight - height - 8))}px`;
      menu.querySelector('button')?.focus({ preventScroll: true });
    },
    close,
    destroy() {
      document.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('scroll', close, true);
      quill.root.removeEventListener('keydown', onKeyDown);
      menu.remove();
    }
  };
}
