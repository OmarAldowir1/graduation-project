// Inline "@" mentions inside page text: people (notifies them), pages (link),
// and dates (a date chip). Registers a Quill inline embed and a caret picker.
import Quill from 'quill';
import { escapeHtml } from './sanitize.js';

const Embed = Quill.import('blots/embed');

function formatDateLabel(key) {
  const [y, m, d] = key.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

class MentionBlot extends Embed {
  static blotName = 'mention';
  static tagName = 'span';
  static className = 'inline-mention';

  static create(value) {
    const node = super.create();
    const kind = ['person', 'page', 'date'].includes(value?.kind) ? value.kind : 'person';
    node.dataset.mentionKind = kind;
    node.dataset.mentionId = String(value?.id || '');
    node.dataset.mentionLabel = String(value?.label || '');
    node.classList.add(`mention-${kind}`);
    if (kind === 'page') node.innerHTML = `<a href="#editor/${escapeHtml(value.id)}">📄 ${escapeHtml(value.label)}</a>`;
    else if (kind === 'date') node.textContent = `📅 ${formatDateLabel(value.id)}`;
    else node.textContent = `@${value?.label || 'someone'}`;
    return node;
  }

  static value(node) {
    return { kind: node.dataset.mentionKind, id: node.dataset.mentionId, label: node.dataset.mentionLabel };
  }
}
Quill.register(MentionBlot, true);

function dateKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function dateOptions() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const add = (days) => new Date(today.getTime() + days * 86400000);
  const options = [
    { label: 'Today', date: today },
    { label: 'Tomorrow', date: add(1) }
  ];
  for (let i = 2; i <= 7; i += 1) {
    const day = add(i);
    options.push({ label: day.toLocaleDateString('en-US', { weekday: 'long' }), date: day });
  }
  const nextMonday = add(((8 - today.getDay()) % 7) || 7);
  if (!options.some((option) => option.date.getTime() === nextMonday.getTime())) options.push({ label: 'Next Monday', date: nextMonday });
  return options.map((option) => ({ kind: 'date', id: dateKey(option.date), label: option.label, hint: formatDateLabel(dateKey(option.date)) }));
}

// Returns { destroy }. getPeople() → [{ id, label, hint }], getPages() → [{ id, label, icon }].
export function attachEditorMentions(quill, container, { getPeople, getPages, onPeopleMentioned }) {
  const menu = document.createElement('div');
  menu.className = 'editor-mention-menu';
  menu.setAttribute('role', 'listbox');
  menu.hidden = true;
  container.style.position = container.style.position || 'relative';
  container.append(menu);
  let start = null;
  let items = [];
  let active = 0;

  const close = () => { menu.hidden = true; start = null; items = []; onlyKind = null; };

  const render = () => {
    const groups = { person: 'People', page: 'Pages', date: 'Dates' };
    let lastKind = null;
    menu.innerHTML = items.map((item, index) => {
      const heading = item.kind !== lastKind ? `<div class="editor-mention-group">${groups[item.kind]}</div>` : '';
      lastKind = item.kind;
      const icon = item.kind === 'person' ? `<span class="task-owner-dot">${escapeHtml(item.label.slice(0, 1).toUpperCase())}</span>` : item.kind === 'page' ? `<span>${escapeHtml(item.icon || '📄')}</span>` : '<span>📅</span>';
      return `${heading}<button type="button" role="option" data-index="${index}" class="${index === active ? 'is-active' : ''}" aria-selected="${index === active}">${icon}<strong>${escapeHtml(item.label)}</strong>${item.hint ? `<small>${escapeHtml(item.hint)}</small>` : ''}</button>`;
    }).join('') || `<p class="editor-mention-empty">${onlyKind === 'person' ? 'No teammates to mention yet — invite people from Team in the sidebar.' : 'No matches'}</p>`;
    menu.querySelector('.is-active')?.scrollIntoView({ block: 'nearest' });
  };

  const position = () => {
    const bounds = quill.getBounds(start);
    const editorRect = quill.root.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();
    menu.style.left = `${Math.max(0, editorRect.left - containerRect.left + bounds.left)}px`;
    menu.style.top = `${editorRect.top - containerRect.top + bounds.bottom + 6}px`;
  };

  let caret = null;
  let onlyKind = null; // set by the "/" Date or Mention commands
  const update = () => {
    if (start === null) return;
    const selection = caret !== null ? { index: caret } : quill.getSelection();
    if (!selection || selection.index <= start || quill.getText(start, 1) !== '@') { close(); return; }
    const query = quill.getText(start + 1, selection.index - start - 1);
    if (query.length > 30 || /\n/.test(query) || /\s{2}/.test(query)) { close(); return; }
    const q = query.trim().toLowerCase();
    const match = (text) => !q || String(text).toLowerCase().includes(q);
    const only = onlyKind;
    items = [
      ...(!only || only === 'person' ? getPeople().filter((person) => match(person.label) || match(person.hint)).slice(0, 5).map((person) => ({ kind: 'person', ...person })) : []),
      ...(!only || only === 'page' ? getPages().filter((page) => match(page.label)).slice(0, 5).map((page) => ({ kind: 'page', ...page })) : []),
      ...(!only || only === 'date' ? dateOptions().filter((date) => match(date.label) || match(date.hint)).slice(0, only ? 9 : q ? 4 : 3) : [])
    ];
    active = Math.min(active, Math.max(0, items.length - 1));
    menu.hidden = false;
    position();
    render();
  };

  const choose = (item) => {
    if (!item || start === null) return;
    const selection = quill.getSelection(true);
    const length = Math.max(1, Math.max(caret ?? 0, selection?.index ?? 0) - start);
    const at = start;
    quill.deleteText(at, length, 'user');
    quill.insertEmbed(at, 'mention', { kind: item.kind, id: item.id, label: item.label }, 'user');
    quill.insertText(at + 1, ' ', 'user');
    quill.setSelection(at + 2, 0, 'silent');
    close();
    if (item.kind === 'person') onPeopleMentioned?.([item.id]);
  };

  let dismissedAt = null;
  // Look at the text just before the caret for "@query" (works for typing, paste and autocorrect).
  // Caret right after the last insert (the reported selection can lag behind).
  const caretAfter = (delta) => {
    let index = 0;
    let found = null;
    for (const op of delta?.ops || []) {
      if (typeof op.retain === 'number') index += op.retain;
      else if (op.insert !== undefined) { index += typeof op.insert === 'string' ? op.insert.length : 1; found = index; }
    }
    return found;
  };
  const onTextChange = (delta, _old, source) => {
    if (source !== 'user') return;
    const fromDelta = caretAfter(delta);
    const selection = fromDelta !== null ? { index: fromDelta } : quill.getSelection();
    caret = selection ? selection.index : null;
    if (!selection) { close(); return; }
    const from = Math.max(0, selection.index - 40);
    const before = quill.getText(from, selection.index - from);
    const match = /(?:^|[\s(])@([^\n@]{0,30})$/.exec(before);
    if (!match || /\s{2}$/.test(match[1])) { close(); return; }
    const at = selection.index - match[1].length - 1;
    if (at === dismissedAt) return;
    if (start !== at) active = 0;
    start = at;
    update();
  };

  const onKeyDown = (event) => {
    if (menu.hidden) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      event.stopPropagation();
      if (!items.length) return;
      active = (active + (event.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length;
      render();
    } else if (event.key === 'Enter' || event.key === 'Tab') {
      if (!items.length) return;
      event.preventDefault();
      event.stopPropagation();
      choose(items[active]);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      dismissedAt = start;
      close();
    }
  };

  const onMouseDown = (event) => {
    const button = event.target.closest('[data-index]');
    if (!button) return;
    event.preventDefault();
    choose(items[Number(button.dataset.index)]);
  };
  const onOutside = (event) => { if (!menu.contains(event.target)) close(); };

  quill.on('text-change', onTextChange);
  quill.root.addEventListener('keydown', onKeyDown, true);
  menu.addEventListener('mousedown', onMouseDown);
  document.addEventListener('pointerdown', onOutside);

  return {
    // The next "@" picker shows only this kind ('person', 'page' or 'date').
    showOnly(kind) { onlyKind = kind; },
    destroy() {
      quill.off('text-change', onTextChange);
      quill.root.removeEventListener('keydown', onKeyDown, true);
      document.removeEventListener('pointerdown', onOutside);
      menu.remove();
    }
  };
}

// Person ids mentioned in saved page HTML (used to notify on save).
export function mentionedPeople(html = '') {
  const ids = new Set();
  const pattern = /data-mention-kind="person"[^>]*data-mention-id="([0-9a-f-]{36})"|data-mention-id="([0-9a-f-]{36})"[^>]*data-mention-kind="person"/g;
  let match;
  while ((match = pattern.exec(html))) ids.add(match[1] || match[2]);
  return [...ids];
}
