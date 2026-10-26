import { showToast } from '../legacy/app.js';
import { updatePage } from './queries.js';

let activeEditorInstance = null;
const listeners = new Set();

export function registerActiveEditor(instance) {
  activeEditorInstance = instance;
  notifyListeners();
}

export function unregisterActiveEditor(instance) {
  if (activeEditorInstance === instance) {
    activeEditorInstance = null;
    notifyListeners();
  }
}

export function getActiveEditor() {
  return activeEditorInstance;
}

export function subscribeToActiveEditor(callback) {
  listeners.add(callback);
  callback(activeEditorInstance);
  return () => listeners.delete(callback);
}

function notifyListeners() {
  for (const listener of listeners) {
    try {
      listener(activeEditorInstance);
    } catch (e) {
      console.error('Editor subscriber error:', e);
    }
  }
}

/**
 * Converts AI Markdown text into clean HTML blocks suitable for Quill / Notion editor
 */
export function markdownToEditorHtml(markdown) {
  if (!markdown) return '';

  const lines = markdown.split('\n');
  const blocks = [];
  let currentList = null;
  let inCodeBlock = false;
  let codeBuffer = [];
  let codeLang = '';
  let inTable = false;
  let tableRows = [];

  function flushList() {
    if (currentList) {
      const tag = currentList.type;
      const items = currentList.items.map((it) => `<li>${formatInline(it)}</li>`).join('');
      blocks.push(`<${tag}>${items}</${tag}>`);
      currentList = null;
    }
  }

  function flushTable() {
    if (inTable && tableRows.length) {
      const header = tableRows[0];
      const rows = tableRows.slice(1).filter((r) => !r.every((c) => /^-+$/.test(c.trim())));
      const thead = `<thead><tr>${header.map((c) => `<th>${formatInline(c.trim())}</th>`).join('')}</tr></thead>`;
      const tbody = `<tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${formatInline(c.trim())}</td>`).join('')}</tr>`).join('')}</tbody>`;
      blocks.push(`<table class="editor-simple-table">${thead}${tbody}</table>`);
      tableRows = [];
      inTable = false;
    }
  }

  function flushCode() {
    if (inCodeBlock) {
      const code = escapeHtml(codeBuffer.join('\n'));
      blocks.push(`<pre class="notion-code-block"><code>${code}</code></pre>`);
      codeBuffer = [];
      inCodeBlock = false;
      codeLang = '';
    }
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Code blocks
    if (trimmed.startsWith('```')) {
      if (inCodeBlock) {
        flushCode();
      } else {
        flushList();
        flushTable();
        inCodeBlock = true;
        codeLang = trimmed.slice(3).trim();
      }
      continue;
    }

    if (inCodeBlock) {
      codeBuffer.push(line);
      continue;
    }

    // Tables
    if (trimmed.startsWith('|') && trimmed.endsWith('|')) {
      flushList();
      inTable = true;
      const cells = trimmed
        .slice(1, -1)
        .split('|')
        .map((c) => c.trim());
      tableRows.push(cells);
      continue;
    } else if (inTable) {
      flushTable();
    }

    // Headings
    if (trimmed.startsWith('# ')) {
      flushList();
      blocks.push(`<h1>${formatInline(trimmed.slice(2))}</h1>`);
      continue;
    }
    if (trimmed.startsWith('## ')) {
      flushList();
      blocks.push(`<h2>${formatInline(trimmed.slice(3))}</h2>`);
      continue;
    }
    if (trimmed.startsWith('### ')) {
      flushList();
      blocks.push(`<h3>${formatInline(trimmed.slice(4))}</h3>`);
      continue;
    }
    if (trimmed.startsWith('#### ')) {
      flushList();
      blocks.push(`<h4>${formatInline(trimmed.slice(5))}</h4>`);
      continue;
    }

    // Blockquotes & Callouts
    if (trimmed.startsWith('> [!NOTE]') || trimmed.startsWith('> [!TIP]') || trimmed.startsWith('> [!IMPORTANT]')) {
      flushList();
      const text = trimmed.replace(/^>\s*\[![A-Z]+\]\s*/, '');
      blocks.push(`<aside class="editor-callout"><span class="editor-callout-icon">💡</span><div class="editor-callout-text">${formatInline(text)}</div></aside>`);
      continue;
    }
    if (trimmed.startsWith('> ')) {
      flushList();
      blocks.push(`<blockquote>${formatInline(trimmed.slice(2))}</blockquote>`);
      continue;
    }

    // Checklists / To-dos
    if (/^-\s*\[([ xX])\]\s+(.*)/.test(trimmed)) {
      flushList();
      const match = trimmed.match(/^-\s*\[([ xX])\]\s+(.*)/);
      const isChecked = match[1].toLowerCase() === 'x';
      const text = match[2];
      blocks.push(`<ul class="editor-todo-list"><li><label><input type="checkbox" ${isChecked ? 'checked' : ''} /> <span>${formatInline(text)}</span></label></li></ul>`);
      continue;
    }

    // Unordered lists
    if (trimmed.startsWith('- ') || trimmed.startsWith('* ') || trimmed.startsWith('• ')) {
      const itemText = trimmed.replace(/^[-*•]\s+/, '');
      if (!currentList || currentList.type !== 'ul') {
        flushList();
        currentList = { type: 'ul', items: [] };
      }
      currentList.items.push(itemText);
      continue;
    }

    // Ordered lists
    if (/^\d+\.\s+/.test(trimmed)) {
      const itemText = trimmed.replace(/^\d+\.\s+/, '');
      if (!currentList || currentList.type !== 'ol') {
        flushList();
        currentList = { type: 'ol', items: [] };
      }
      currentList.items.push(itemText);
      continue;
    }

    // Non-list line
    flushList();

    // Dividers
    if (/^---+$|^===+$|^\*\*\*+$/.test(trimmed)) {
      blocks.push('<hr class="motion-divider" />');
      continue;
    }

    // Blank line
    if (!trimmed) {
      continue;
    }

    // Regular paragraph
    blocks.push(`<p>${formatInline(line)}</p>`);
  }

  flushList();
  flushTable();
  flushCode();

  return blocks.join('\n');
}

function formatInline(str) {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
    .replace(/`([^`]+)`/g, '<code class="bg-surface-container-high px-1 rounded text-primary">$1</code>');
}

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Apply AI generated content to active page
 */
export async function applyAIToPage({ html, title, mode = 'append' }) {
  const editor = getActiveEditor();
  if (!editor) {
    throw new Error('No active page editor found. Please open a page first.');
  }

  if (mode === 'replace') {
    await editor.replaceContent({ html, title });
    showToast('Page content successfully replaced with AI draft!', 'success');
  } else if (mode === 'prepend') {
    await editor.insertContent(html, 'start');
    showToast('AI content inserted at the top of the page!', 'success');
  } else {
    await editor.insertContent(html, 'end');
    showToast('AI content inserted into page!', 'success');
  }
}
