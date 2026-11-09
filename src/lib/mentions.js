// @mentions for page comments and task discussions.
// Mentions are stored as plain "@Name" text plus a list of user ids. The ids are
// recomputed from the final text at submit time, so deleting "@Name" from the
// draft also removes the mention.

export function memberLabel(member) {
  const user = member?.user || {};
  return String(user.name || '').trim() || String(user.email || '').split('@')[0] || 'Member';
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Longest names first, so "@Ann Lee" wins over "@Ann".
function sortedMembers(members) {
  return [...(members || [])]
    .filter((member) => member?.user_id)
    .sort((a, b) => memberLabel(b).length - memberLabel(a).length);
}

function mentionPattern(label) {
  return new RegExp(`(^|[^\\w@])@${escapeRegExp(label)}(?![\\w])`, 'i');
}

export function extractMentionIds(text, members, excludeUserId = null) {
  const source = String(text || '');
  if (!source.includes('@')) return [];
  const ids = new Set();
  let remaining = source;
  for (const member of sortedMembers(members)) {
    const pattern = mentionPattern(memberLabel(member));
    if (pattern.test(remaining)) {
      if (member.user_id !== excludeUserId) ids.add(member.user_id);
      remaining = remaining.replace(new RegExp(pattern.source, 'gi'), '$1');
    }
  }
  return [...ids];
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Escaped HTML with "@Name" wrapped in a highlight for mentioned members.
export function renderMentionsHtml(text, members, mentionIds = null) {
  let html = escapeHtml(text);
  const wanted = mentionIds ? new Set(mentionIds) : null;
  for (const member of sortedMembers(members)) {
    if (wanted && !wanted.has(member.user_id)) continue;
    const label = escapeHtml(memberLabel(member));
    const pattern = new RegExp(`(^|[^\\w@&;>])@${escapeRegExp(label)}(?![\\w])`, 'gi');
    html = html.replace(pattern, (_match, lead) => `${lead}<span class="mention-chip">@${label}</span>`);
  }
  return html;
}

// Shows a member list under a textarea while the user types "@...".
export function attachMentionPicker(textarea, getMembers) {
  if (!textarea || textarea.dataset.mentionPicker) return () => {};
  textarea.dataset.mentionPicker = 'on';
  // Lives on <body> with fixed positioning so scrolling panels and modals can't clip it.
  const list = document.createElement('div');
  list.className = 'mention-picker';
  list.setAttribute('role', 'listbox');
  list.hidden = true;
  document.body.append(list);
  const place = () => {
    const rect = textarea.getBoundingClientRect();
    const height = Math.min(list.scrollHeight || 240, 240);
    const below = window.innerHeight - rect.bottom;
    list.style.left = `${Math.max(8, rect.left)}px`;
    list.style.width = `${Math.min(rect.width, window.innerWidth - 16)}px`;
    list.style.top = below >= height + 8 || below > rect.top ? `${rect.bottom + 4}px` : `${Math.max(8, rect.top - height - 4)}px`;
  };
  let options = [];
  let active = 0;
  let start = -1;

  const close = () => { list.hidden = true; options = []; start = -1; textarea.removeAttribute('aria-activedescendant'); };

  const choose = (member) => {
    const label = memberLabel(member);
    const before = textarea.value.slice(0, start);
    const after = textarea.value.slice(textarea.selectionStart);
    textarea.value = `${before}@${label} ${after}`;
    const caret = before.length + label.length + 2;
    textarea.setSelectionRange(caret, caret);
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    close();
    textarea.focus();
  };

  const render = () => {
    list.innerHTML = options.map((member, index) => {
      const user = member.user || {};
      const avatar = /^https?:\/\//i.test(user.avatar_url || '')
        ? `<img src="${escapeHtml(user.avatar_url)}" alt="" />`
        : `<span>${escapeHtml(memberLabel(member).slice(0, 1).toUpperCase())}</span>`;
      return `<button type="button" role="option" id="mention-opt-${index}" aria-selected="${index === active}" class="${index === active ? 'is-active' : ''}" data-index="${index}">${avatar}<strong>${escapeHtml(memberLabel(member))}</strong>${user.email ? `<small>${escapeHtml(user.email)}</small>` : ''}</button>`;
    }).join('');
    textarea.setAttribute('aria-activedescendant', `mention-opt-${active}`);
  };

  const update = () => {
    const caret = textarea.selectionStart;
    const upto = textarea.value.slice(0, caret);
    const match = /(^|\s)@([^\s@]{0,30})$/.exec(upto);
    if (!match) return close();
    start = caret - match[2].length - 1;
    const query = match[2].toLowerCase();
    options = (getMembers() || [])
      .filter((member) => member?.user_id)
      .filter((member) => memberLabel(member).toLowerCase().includes(query) || String(member.user?.email || '').toLowerCase().startsWith(query))
      .slice(0, 6);
    if (!options.length) return close();
    active = Math.min(active, options.length - 1);
    list.hidden = false;
    render();
    place();
  };

  const onKeyDown = (event) => {
    if (list.hidden) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      active = (active + (event.key === 'ArrowDown' ? 1 : options.length - 1)) % options.length;
      render();
    } else if (event.key === 'Enter' || event.key === 'Tab') {
      event.preventDefault();
      choose(options[active]);
    } else if (event.key === 'Escape') {
      event.stopPropagation();
      close();
    }
  };

  const onMouseDown = (event) => {
    const button = event.target.closest('button[data-index]');
    if (!button) return;
    event.preventDefault();
    choose(options[Number(button.dataset.index)]);
  };

  textarea.addEventListener('input', update);
  textarea.addEventListener('click', update);
  textarea.addEventListener('keydown', onKeyDown);
  textarea.addEventListener('blur', () => setTimeout(close, 120));
  list.addEventListener('mousedown', onMouseDown);
  // Remove the floating list once the textarea leaves the page.
  const watcher = new MutationObserver(() => { if (!textarea.isConnected) { list.remove(); watcher.disconnect(); } });
  watcher.observe(document.body, { childList: true, subtree: true });
  return () => { list.remove(); watcher.disconnect(); delete textarea.dataset.mentionPicker; };
}
