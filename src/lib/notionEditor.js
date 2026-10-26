import Quill from 'quill';
import 'quill/dist/quill.core.css';
import { executeAIAction } from './editorAI.js';

// ============================================
// Custom Blots for Notion-like Rich Text
// ============================================

const BlockEmbed = Quill.import('blots/block/embed');
class DividerBlot extends BlockEmbed {
  static blotName = 'divider';
  static tagName = 'hr';
  static className = 'motion-divider';
}
Quill.register(DividerBlot, true);

const Inline = Quill.import('blots/inline');
class CommentBlot extends Inline {
  static blotName = 'comment';
  static tagName = 'mark';
  static className = 'motion-comment-highlight';
  static create(value) {
    const node = super.create();
    node.setAttribute('data-comment-id', value);
    node.title = 'Click to view comment';
    return node;
  }
  static formats(node) {
    return node.getAttribute('data-comment-id');
  }
}
Quill.register(CommentBlot, true);

// ============================================
// Notion Table, Callout & Toggle Blots
// ============================================

class TableBlot extends BlockEmbed {
  static blotName = 'table-block';
  static tagName = 'div';
  static className = 'notion-table-block';

  static create(value) {
    const node = super.create();
    node.setAttribute('contenteditable', 'false');
    let tableHtml = '';
    if (typeof value === 'string' && value.includes('<table')) {
      tableHtml = value;
    } else if (typeof value === 'object' && value?.html) {
      tableHtml = value.html;
    } else {
      tableHtml = `
        <table class="editor-simple-table">
          <thead>
            <tr>
              <th>Column 1</th>
              <th>Column 2</th>
              <th>Column 3</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Item 1</td>
              <td>Item 2</td>
              <td>Item 3</td>
            </tr>
            <tr>
              <td>Item 4</td>
              <td>Item 5</td>
              <td>Item 6</td>
            </tr>
          </tbody>
        </table>
      `;
    }

    node.innerHTML = `
      <div class="notion-table-inner" contenteditable="true">
        ${tableHtml}
      </div>
      <div class="notion-table-toolbar" contenteditable="false">
        <button type="button" class="notion-table-btn" data-table-action="add-row">
          <span class="material-symbols-outlined text-[14px]">add</span> Row
        </button>
        <button type="button" class="notion-table-btn" data-table-action="add-col">
          <span class="material-symbols-outlined text-[14px]">add</span> Column
        </button>
        <button type="button" class="notion-table-btn" data-table-action="del-row">
          <span class="material-symbols-outlined text-[14px]">remove</span> Row
        </button>
        <button type="button" class="notion-table-btn" data-table-action="del-col">
          <span class="material-symbols-outlined text-[14px]">remove</span> Column
        </button>
      </div>
    `;
    return node;
  }

  static value(node) {
    const table = node.querySelector('table');
    return table ? table.outerHTML : node.innerHTML;
  }
}
Quill.register(TableBlot, true);

class CalloutBlot extends BlockEmbed {
  static blotName = 'callout-block';
  static tagName = 'div';
  static className = 'editor-callout-wrapper';

  static create(value) {
    const node = super.create();
    node.setAttribute('contenteditable', 'false');
    const content = typeof value === 'string' ? value : (value?.text || 'Type your callout here...');
    node.innerHTML = `
      <aside class="editor-callout">
        <span class="editor-callout-icon" contenteditable="false">💡</span>
        <div class="editor-callout-text" contenteditable="true">${content}</div>
      </aside>
    `;
    return node;
  }

  static value(node) {
    const aside = node.querySelector('.editor-callout');
    return aside ? aside.outerHTML : node.innerHTML;
  }
}
Quill.register(CalloutBlot, true);

class ToggleBlot extends BlockEmbed {
  static blotName = 'toggle-block';
  static tagName = 'div';
  static className = 'editor-toggle-wrapper';

  static create(value) {
    const node = super.create();
    node.setAttribute('contenteditable', 'false');
    let summary = 'Toggle heading';
    let body = 'Toggle details content...';
    if (typeof value === 'object' && value) {
      summary = value.summary || summary;
      body = value.body || body;
    } else if (typeof value === 'string' && value) {
      summary = value;
    }
    node.innerHTML = `
      <details class="editor-toggle" open>
        <summary contenteditable="true">${summary}</summary>
        <div class="editor-toggle-content" contenteditable="true">${body}</div>
      </details>
    `;
    return node;
  }

  static value(node) {
    const toggle = node.querySelector('.editor-toggle');
    return toggle ? toggle.outerHTML : node.innerHTML;
  }
}
Quill.register(ToggleBlot, true);

// ============================================
// Notion Palette Colors
// ============================================

export const NOTION_COLORS = {
  text: [
    { label: 'Default', value: '' },
    { label: 'Gray', value: '#787774' },
    { label: 'Brown', value: '#9f6b53' },
    { label: 'Orange', value: '#d9730d' },
    { label: 'Yellow', value: '#cb912f' },
    { label: 'Green', value: '#448361' },
    { label: 'Blue', value: '#337ea9' },
    { label: 'Purple', value: '#9065b0' },
    { label: 'Pink', value: '#c14c8a' },
    { label: 'Red', value: '#d44c47' }
  ],
  background: [
    { label: 'Default', value: '' },
    { label: 'Gray', value: 'rgba(120, 119, 116, 0.2)' },
    { label: 'Brown', value: 'rgba(159, 107, 83, 0.2)' },
    { label: 'Orange', value: 'rgba(217, 115, 13, 0.2)' },
    { label: 'Yellow', value: 'rgba(203, 145, 47, 0.2)' },
    { label: 'Green', value: 'rgba(68, 131, 97, 0.2)' },
    { label: 'Blue', value: 'rgba(51, 126, 169, 0.2)' },
    { label: 'Purple', value: 'rgba(144, 101, 176, 0.2)' },
    { label: 'Pink', value: 'rgba(193, 76, 138, 0.2)' },
    { label: 'Red', value: 'rgba(212, 76, 71, 0.2)' }
  ]
};

// ============================================
// Main Notion Editor Factory
// ============================================

export function createNotionEditor({
  container,
  initialHtml = '',
  onChange = () => { },
  onAddComment = async () => { },
  onCommentClick = () => { },
  onOpenContextMenu = () => { }
}) {
  // Clear any existing contents in container
  container.innerHTML = '';
  container.classList.add('notion-editor-root');

  // Quill mount point
  const quillMount = document.createElement('div');
  quillMount.className = 'notion-quill-mount';
  container.appendChild(quillMount);

  // Initialize Quill 2
  const quill = new Quill(quillMount, {
    modules: {
      toolbar: false,
      history: {
        delay: 1000,
        maxStack: 100,
        userOnly: true
      }
    },
    placeholder: "Type '/' for commands, or select text for styling...",
    theme: 'bubble'
  });

  // Custom clipboard matchers for tables, callouts, and toggles
  const Delta = Quill.import('delta');
  quill.clipboard.addMatcher('table', (node) => {
    return new Delta().insert({ 'table-block': node.outerHTML });
  });
  quill.clipboard.addMatcher('aside', (node) => {
    const text = node.querySelector('.editor-callout-text')?.innerHTML || node.innerHTML;
    return new Delta().insert({ 'callout-block': text });
  });
  quill.clipboard.addMatcher('details', (node) => {
    const summary = node.querySelector('summary')?.innerHTML || 'Toggle details';
    const body = node.querySelector('.editor-toggle-content')?.innerHTML || node.querySelector('p')?.innerHTML || '';
    return new Delta().insert({ 'toggle-block': { summary, body } });
  });

  // Set initial content
  if (initialHtml) {
    quill.clipboard.dangerouslyPasteHTML(initialHtml);
  }

  // Floating selection toolbar
  const selectionToolbar = createSelectionToolbar(quill, container, {
    onAddComment,
    onCommentClick
  });

  // Slash command menu
  const slashMenu = createSlashMenu(quill, container);

  // AI preview overlay
  const aiOverlay = createAIOverlay(quill, container);

  // Table, checklist, and tab navigation interactions
  setupEditorInteractions(quill, () => onChange(quill.root.innerHTML));

  // Notion block hover & drag handle gutter (with drag_indicator & add button)
  const blockGutter = createBlockGutterManager(quill, container, {
    onOpenContextMenu
  });

  // Comment click delegation
  quill.root.addEventListener('click', (e) => {
    const commentMark = e.target.closest('.motion-comment-highlight');
    if (commentMark) {
      const commentId = commentMark.getAttribute('data-comment-id');
      if (commentId) {
        onCommentClick(commentId);
      }
    }
  });

  // Editor change listener
  quill.on('text-change', (delta, oldDelta, source) => {
    if (source === 'user') {
      onChange(quill.root.innerHTML);
    }
  });

  container.addEventListener('notion:change', () => {
    onChange(quill.root.innerHTML);
  });

  return {
    quill,
    getHtml: () => quill.root.innerHTML,
    setHtml: (html) => {
      quill.clipboard.dangerouslyPasteHTML(html || '');
    },
    destroy: () => {
      selectionToolbar.destroy();
      slashMenu.destroy();
      aiOverlay.destroy();
      blockGutter.destroy();
      container.innerHTML = '';
    }
  };
}

// ============================================
// 1. Selection Floating Toolbar
// ============================================

function createSelectionToolbar(quill, container, { onAddComment }) {
  const toolbar = document.createElement('div');
  toolbar.className = 'motion-selection-toolbar';
  toolbar.hidden = true;
  document.body.appendChild(toolbar);

  let currentRange = null;
  let activeDropdown = null;

  // Prevent mousedown from stealing focus from Quill
  toolbar.addEventListener('mousedown', (e) => {
    if (e.target.tagName !== 'INPUT' && e.target.tagName !== 'TEXTAREA') {
      e.preventDefault();
    }
  });

  // Build toolbar structure
  toolbar.innerHTML = `
    <div class="mst-group mst-block-type-group">
      <button type="button" class="mst-btn mst-dropdown-trigger" data-action="block-type" title="Turn into...">
        <span class="mst-block-label">Normal text</span>
        <span class="material-symbols-outlined text-xs">arrow_drop_down</span>
      </button>
      <div class="mst-menu mst-block-menu" hidden>
        <button type="button" data-block="p"><span class="material-symbols-outlined">text_fields</span> Text</button>
        <button type="button" data-block="h1"><span class="mst-icon-text">H1</span> Heading 1</button>
        <button type="button" data-block="h2"><span class="mst-icon-text">H2</span> Heading 2</button>
        <button type="button" data-block="h3"><span class="mst-icon-text">H3</span> Heading 3</button>
        <button type="button" data-block="bullet"><span class="material-symbols-outlined">format_list_bulleted</span> Bulleted list</button>
        <button type="button" data-block="ordered"><span class="material-symbols-outlined">format_list_numbered</span> Numbered list</button>
        <button type="button" data-block="check"><span class="material-symbols-outlined">check_box</span> To-do list</button>
        <button type="button" data-block="blockquote"><span class="material-symbols-outlined">format_quote</span> Quote</button>
        <button type="button" data-block="code-block"><span class="material-symbols-outlined">code</span> Code block</button>
      </div>
    </div>

    <div class="mst-divider"></div>

    <div class="mst-group mst-format-group">
      <!-- Color Picker -->
      <button type="button" class="mst-btn mst-btn-color" data-action="color" title="Text color & background">
        <span class="mst-color-icon">A</span>
      </button>
      <div class="mst-menu mst-color-picker" hidden>
        <div class="mst-color-header">Text color</div>
        <div class="mst-color-grid mst-text-colors">
          ${NOTION_COLORS.text.map(c => `
            <button type="button" data-color="${c.value}" class="mst-color-swatch" title="${c.label}">
              <span class="mst-color-preview" style="color:${c.value || 'inherit'}">A</span>
              <span class="mst-color-name">${c.label}</span>
            </button>
          `).join('')}
        </div>
        <div class="mst-color-header">Background color</div>
        <div class="mst-color-grid mst-bg-colors">
          ${NOTION_COLORS.background.map(c => `
            <button type="button" data-bg="${c.value}" class="mst-color-swatch" title="${c.label}">
              <span class="mst-color-bg-preview" style="background:${c.value || 'transparent'}"></span>
              <span class="mst-color-name">${c.label}</span>
            </button>
          `).join('')}
        </div>
      </div>

      <!-- Basic Formatting -->
      <button type="button" class="mst-btn" data-action="bold" title="Bold (Ctrl+B)">
        <span class="mst-icon-bold">B</span>
      </button>
      <button type="button" class="mst-btn" data-action="italic" title="Italic (Ctrl+I)">
        <span class="mst-icon-italic">i</span>
      </button>
      <button type="button" class="mst-btn" data-action="underline" title="Underline (Ctrl+U)">
        <span class="mst-icon-underline">U</span>
      </button>
      <button type="button" class="mst-btn" data-action="strike" title="Strikethrough">
        <span class="mst-icon-strike">S</span>
      </button>
      <button type="button" class="mst-btn" data-action="code" title="Inline code">
        <span class="material-symbols-outlined text-sm">code</span>
      </button>
      <button type="button" class="mst-btn" data-action="clean" title="Clear formatting">
        <span class="material-symbols-outlined text-sm">format_clear</span>
      </button>
    </div>

    <div class="mst-divider"></div>

    <div class="mst-group">
      <!-- Link -->
      <button type="button" class="mst-btn" data-action="link" title="Link (Ctrl+K)">
        <span class="material-symbols-outlined text-sm">link</span>
      </button>
      <div class="mst-menu mst-link-popover" hidden>
        <div class="mst-link-row">
          <input type="url" class="mst-link-input" placeholder="Paste link URL (https://...)" />
          <button type="button" class="mst-link-apply modal-btn-primary">Apply</button>
          <button type="button" class="mst-link-remove" title="Remove link"><span class="material-symbols-outlined text-sm">link_off</span></button>
        </div>
      </div>

      <!-- Comment -->
      <button type="button" class="mst-btn mst-btn-text" data-action="comment" title="Add comment">
        <span class="material-symbols-outlined text-sm">chat_bubble_outline</span>
        <span>Comment</span>
      </button>
      <div class="mst-menu mst-comment-popover" hidden>
        <textarea class="mst-comment-textarea" placeholder="Add a comment on this text..." rows="2"></textarea>
        <div class="mst-popover-actions">
          <button type="button" class="mst-popover-cancel">Cancel</button>
          <button type="button" class="mst-popover-submit modal-btn-primary">Comment</button>
        </div>
      </div>
    </div>

    <div class="mst-divider"></div>

    <div class="mst-group">
      <!-- AI / Skills Actions -->
      <button type="button" class="mst-btn mst-btn-ai" data-action="ai-menu" title="AI Writing Actions">
        <span class="material-symbols-outlined text-sm text-primary">auto_awesome</span>
        <span>Skills</span>
      </button>
      <div class="mst-menu mst-ai-menu" hidden>
        <div class="mst-menu-title">AI Writing Assistant</div>
        <button type="button" data-ai="improve"><span class="material-symbols-outlined">auto_fix_high</span> Improve writing</button>
        <button type="button" data-ai="proofread"><span class="material-symbols-outlined">spellcheck</span> Proofread &amp; fix typos</button>
        <button type="button" data-ai="rewrite"><span class="material-symbols-outlined">refresh</span> Rewrite differently</button>
        <button type="button" data-ai="summarize"><span class="material-symbols-outlined">summarize</span> Summarize</button>
        <button type="button" data-ai="explain"><span class="material-symbols-outlined">help_outline</span> Explain this</button>
        <div class="mst-menu-divider"></div>
        <div class="mst-menu-subtitle">Translate</div>
        <button type="button" data-ai="translate" data-lang="Arabic"><span class="material-symbols-outlined">translate</span> To Arabic</button>
        <button type="button" data-ai="translate" data-lang="English"><span class="material-symbols-outlined">translate</span> To English</button>
        <div class="mst-menu-divider"></div>
        <div class="mst-menu-subtitle">Change tone</div>
        <button type="button" data-ai="tone" data-tone="Professional"><span class="material-symbols-outlined">business_center</span> Professional</button>
        <button type="button" data-ai="tone" data-tone="Casual"><span class="material-symbols-outlined">sentiment_satisfied</span> Casual &amp; friendly</button>
        <button type="button" data-ai="tone" data-tone="Direct"><span class="material-symbols-outlined">bolt</span> Direct &amp; concise</button>
      </div>
    </div>
  `;

  function closeAllMenus() {
    toolbar.querySelectorAll('.mst-menu').forEach(m => {
      m.hidden = true;
      m.classList.remove('is-open');
    });
    toolbar.querySelectorAll('.mst-btn').forEach(b => {
      b.classList.remove('active-menu-btn');
    });
    activeDropdown = null;
  }

  function toggleMenu(menuSelector, triggerBtn = null) {
    const targetMenu = toolbar.querySelector(menuSelector);
    if (!targetMenu) return;
    const isCurrentlyOpen = !targetMenu.hidden && targetMenu.classList.contains('is-open');
    closeAllMenus();
    if (!isCurrentlyOpen) {
      targetMenu.hidden = false;
      targetMenu.classList.add('is-open');
      if (triggerBtn) triggerBtn.classList.add('active-menu-btn');
      activeDropdown = targetMenu;
      // Focus first input if any
      const input = targetMenu.querySelector('input, textarea');
      if (input) {
        window.setTimeout(() => input.focus(), 50);
      }
    }
  }

  function updateToolbarPosition() {
    if (!currentRange || currentRange.length === 0) {
      toolbar.hidden = true;
      closeAllMenus();
      return;
    }

    const bounds = quill.getBounds(currentRange.index, currentRange.length);
    if (!bounds) return;

    const quillRect = quill.root.getBoundingClientRect();
    const toolbarWidth = toolbar.offsetWidth || 480;
    const toolbarHeight = toolbar.offsetHeight || 44;

    // Center above selection
    let left = quillRect.left + bounds.left + (bounds.width / 2) - (toolbarWidth / 2);
    let top = quillRect.top + bounds.top - toolbarHeight - 10;

    // Viewport clamping
    const minLeft = 12;
    const maxLeft = window.innerWidth - toolbarWidth - 12;
    left = Math.max(minLeft, Math.min(left, maxLeft));

    // If too close to viewport top, show below selection
    if (top < 12) {
      top = quillRect.top + bounds.bottom + 10;
    }

    toolbar.style.left = `${Math.round(left)}px`;
    toolbar.style.top = `${Math.round(top)}px`;
    toolbar.hidden = false;

    updateActiveState();
  }

  function updateActiveState() {
    if (!currentRange) return;
    const formats = quill.getFormat(currentRange.index, currentRange.length);

    // Active block label
    const blockLabel = toolbar.querySelector('.mst-block-label');
    if (formats.header === 1) blockLabel.textContent = 'Heading 1';
    else if (formats.header === 2) blockLabel.textContent = 'Heading 2';
    else if (formats.header === 3) blockLabel.textContent = 'Heading 3';
    else if (formats.list === 'bullet') blockLabel.textContent = 'Bulleted list';
    else if (formats.list === 'ordered') blockLabel.textContent = 'Numbered list';
    else if (formats.list === 'check') blockLabel.textContent = 'To-do list';
    else if (formats.blockquote) blockLabel.textContent = 'Quote';
    else if (formats['code-block']) blockLabel.textContent = 'Code block';
    else blockLabel.textContent = 'Normal text';

    // Toggle active classes on inline format buttons
    toolbar.querySelector('[data-action="bold"]')?.classList.toggle('active', Boolean(formats.bold));
    toolbar.querySelector('[data-action="italic"]')?.classList.toggle('active', Boolean(formats.italic));
    toolbar.querySelector('[data-action="underline"]')?.classList.toggle('active', Boolean(formats.underline));
    toolbar.querySelector('[data-action="strike"]')?.classList.toggle('active', Boolean(formats.strike));
    toolbar.querySelector('[data-action="code"]')?.classList.toggle('active', Boolean(formats.code));
    toolbar.querySelector('[data-action="link"]')?.classList.toggle('active', Boolean(formats.link));

    // Color indicator
    const colorBtn = toolbar.querySelector('.mst-btn-color');
    if (colorBtn) {
      colorBtn.style.color = formats.color || '';
    }
  }

  // Quill selection change
  quill.on('selection-change', (range) => {
    if (!range || range.length === 0) {
      // If user is typing in a popover input inside toolbar, don't close
      if (toolbar.contains(document.activeElement)) {
        return;
      }
      toolbar.hidden = true;
      currentRange = null;
      closeAllMenus();
      return;
    }

    currentRange = { index: range.index, length: range.length };
    updateToolbarPosition();
  });

  // Window scroll & resize
  window.addEventListener('scroll', () => {
    if (currentRange && !toolbar.hidden && !activeDropdown) {
      updateToolbarPosition();
    }
  }, { passive: true });

  window.addEventListener('resize', () => {
    if (currentRange && !toolbar.hidden) {
      updateToolbarPosition();
    }
  }, { passive: true });

  // Click outside to close menus
  document.addEventListener('pointerdown', (e) => {
    if (!toolbar.contains(e.target)) {
      closeAllMenus();
    }
  });

  // Action clicks
  toolbar.addEventListener('click', async (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;

    const action = btn.dataset.action;
    const formats = currentRange ? quill.getFormat(currentRange.index, currentRange.length) : {};

    if (action === 'block-type') {
      toggleMenu('.mst-block-menu', btn);
      return;
    }
    if (action === 'color') {
      toggleMenu('.mst-color-picker', btn);
      return;
    }
    if (action === 'link') {
      const linkPopover = toolbar.querySelector('.mst-link-popover');
      const input = linkPopover.querySelector('.mst-link-input');
      input.value = formats.link || '';
      toggleMenu('.mst-link-popover', btn);
      return;
    }
    if (action === 'comment') {
      toggleMenu('.mst-comment-popover', btn);
      return;
    }
    if (action === 'ai-menu') {
      toggleMenu('.mst-ai-menu', btn);
      return;
    }

    // Block type selections
    if (btn.dataset.block) {
      const type = btn.dataset.block;
      closeAllMenus();
      if (!currentRange) return;

      if (type === 'p') {
        quill.formatLine(currentRange.index, currentRange.length, {
          header: false,
          list: false,
          blockquote: false,
          'code-block': false
        });
      } else if (type === 'h1') {
        quill.formatLine(currentRange.index, currentRange.length, 'header', 1);
      } else if (type === 'h2') {
        quill.formatLine(currentRange.index, currentRange.length, 'header', 2);
      } else if (type === 'h3') {
        quill.formatLine(currentRange.index, currentRange.length, 'header', 3);
      } else if (type === 'bullet') {
        quill.formatLine(currentRange.index, currentRange.length, 'list', 'bullet');
      } else if (type === 'ordered') {
        quill.formatLine(currentRange.index, currentRange.length, 'list', 'ordered');
      } else if (type === 'check') {
        quill.formatLine(currentRange.index, currentRange.length, 'list', 'check');
      } else if (type === 'blockquote') {
        quill.formatLine(currentRange.index, currentRange.length, 'blockquote', true);
      } else if (type === 'code-block') {
        quill.formatLine(currentRange.index, currentRange.length, 'code-block', true);
      }
      updateActiveState();
      return;
    }

    // Text & background color
    if (btn.dataset.color !== undefined) {
      closeAllMenus();
      if (currentRange) {
        quill.formatText(currentRange.index, currentRange.length, 'color', btn.dataset.color || false);
        updateActiveState();
      }
      return;
    }
    if (btn.dataset.bg !== undefined) {
      closeAllMenus();
      if (currentRange) {
        quill.formatText(currentRange.index, currentRange.length, 'background', btn.dataset.bg || false);
        updateActiveState();
      }
      return;
    }

    // Inline formatting toggles
    if (action === 'bold') {
      quill.formatText(currentRange.index, currentRange.length, 'bold', !formats.bold);
      updateActiveState();
      return;
    }
    if (action === 'italic') {
      quill.formatText(currentRange.index, currentRange.length, 'italic', !formats.italic);
      updateActiveState();
      return;
    }
    if (action === 'underline') {
      quill.formatText(currentRange.index, currentRange.length, 'underline', !formats.underline);
      updateActiveState();
      return;
    }
    if (action === 'strike') {
      quill.formatText(currentRange.index, currentRange.length, 'strike', !formats.strike);
      updateActiveState();
      return;
    }
    if (action === 'code') {
      quill.formatText(currentRange.index, currentRange.length, 'code', !formats.code);
      updateActiveState();
      return;
    }
    if (action === 'clean') {
      quill.removeFormat(currentRange.index, currentRange.length);
      updateActiveState();
      return;
    }

    // Apply Link
    if (btn.classList.contains('mst-link-apply')) {
      const input = toolbar.querySelector('.mst-link-input');
      let url = input.value.trim();
      if (url && !/^https?:\/\//i.test(url) && !url.startsWith('#') && !url.startsWith('/')) {
        url = `https://${url}`;
      }
      closeAllMenus();
      if (currentRange) {
        quill.formatText(currentRange.index, currentRange.length, 'link', url || false);
        updateActiveState();
      }
      return;
    }
    if (btn.classList.contains('mst-link-remove')) {
      closeAllMenus();
      if (currentRange) {
        quill.formatText(currentRange.index, currentRange.length, 'link', false);
        updateActiveState();
      }
      return;
    }

    // Submit Comment
    if (btn.classList.contains('mst-popover-submit')) {
      const textarea = toolbar.querySelector('.mst-comment-textarea');
      const commentContent = textarea.value.trim();
      if (!commentContent || !currentRange) return;

      const selectedText = quill.getText(currentRange.index, currentRange.length);
      const savedRange = { ...currentRange };

      closeAllMenus();
      textarea.value = '';

      const commentId = await onAddComment({
        selectedText,
        content: commentContent,
        range: savedRange
      });

      if (commentId) {
        quill.formatText(savedRange.index, savedRange.length, 'comment', commentId);
      }
      return;
    }
    if (btn.classList.contains('mst-popover-cancel')) {
      closeAllMenus();
      return;
    }

    // Trigger AI Actions
    if (btn.dataset.ai) {
      const aiAction = btn.dataset.ai;
      const tone = btn.dataset.tone;
      const language = btn.dataset.lang;
      closeAllMenus();
      toolbar.hidden = true;

      if (!currentRange) return;
      const selectedText = quill.getText(currentRange.index, currentRange.length);
      const targetRange = { ...currentRange };

      // Dispatch event to show AI preview overlay
      container.dispatchEvent(new CustomEvent('notion:ai-trigger', {
        detail: {
          action: aiAction,
          tone,
          language,
          text: selectedText,
          range: targetRange
        }
      }));
    }
  });

  return {
    destroy: () => {
      toolbar.remove();
    }
  };
}

// ============================================
// 2. Slash Command Menu
// ============================================

const SLASH_COMMANDS = [
  { id: 'p', label: 'Text', desc: 'Start writing with plain text', icon: 'text_fields' },
  { id: 'h1', label: 'Heading 1', desc: 'Large section heading', icon: 'format_h1' },
  { id: 'h2', label: 'Heading 2', desc: 'Medium section heading', icon: 'format_h2' },
  { id: 'h3', label: 'Heading 3', desc: 'Small section heading', icon: 'format_h3' },
  { id: 'table', label: 'Table', desc: 'Insert a 3x3 table with editable cells', icon: 'table_chart' },
  { id: 'bullet', label: 'Bulleted list', desc: 'Create a simple bulleted list', icon: 'format_list_bulleted' },
  { id: 'ordered', label: 'Numbered list', desc: 'Create a list with numbering', icon: 'format_list_numbered' },
  { id: 'check', label: 'To-do list', desc: 'Track tasks with a to-do list', icon: 'check_box' },
  { id: 'blockquote', label: 'Quote', desc: 'Capture a quote or citation', icon: 'format_quote' },
  { id: 'callout', label: 'Callout', desc: 'Highlight note or tip with an icon', icon: 'lightbulb' },
  { id: 'toggle', label: 'Toggle list', desc: 'Expandable details block', icon: 'arrow_right' },
  { id: 'code-block', label: 'Code', desc: 'Capture a code snippet', icon: 'code' },
  { id: 'divider', label: 'Divider', desc: 'Visually divide blocks', icon: 'horizontal_rule' }
];

function createSlashMenu(quill, container) {
  const menu = document.createElement('div');
  menu.className = 'motion-slash-menu';
  menu.hidden = true;
  document.body.appendChild(menu);

  let activeIndex = 0;
  let filteredCommands = [...SLASH_COMMANDS];
  let slashPosition = null;

  function renderCommands() {
    menu.innerHTML = `
      <div class="msm-header">Basic blocks</div>
      <div class="msm-list">
        ${filteredCommands.length ? filteredCommands.map((cmd, idx) => `
          <button type="button" class="msm-item ${idx === activeIndex ? 'active' : ''}" data-cmd="${cmd.id}">
            <span class="material-symbols-outlined msm-icon">${cmd.icon}</span>
            <div class="msm-content">
              <strong>${cmd.label}</strong>
              <small>${cmd.desc}</small>
            </div>
          </button>
        `).join('') : '<div class="msm-empty">No matching commands</div>'}
      </div>
    `;
  }

  function openMenu(atIndex) {
    slashPosition = atIndex;
    activeIndex = 0;
    filteredCommands = [...SLASH_COMMANDS];
    renderCommands();

    const bounds = quill.getBounds(atIndex);
    const quillRect = quill.root.getBoundingClientRect();

    let left = quillRect.left + bounds.left;
    let top = quillRect.top + bounds.bottom + 8;

    const menuWidth = 320;
    const menuHeight = 300;

    // Viewport clamping
    if (left + menuWidth > window.innerWidth - 12) {
      left = window.innerWidth - menuWidth - 12;
    }
    if (top + menuHeight > window.innerHeight - 12) {
      top = quillRect.top + bounds.top - menuHeight - 8;
    }

    menu.style.left = `${Math.max(12, Math.round(left))}px`;
    menu.style.top = `${Math.max(12, Math.round(top))}px`;
    menu.hidden = false;
  }

  function closeMenu() {
    menu.hidden = true;
    slashPosition = null;
  }

  function executeCommand(cmdId) {
    if (slashPosition === null) return;
    const sel = quill.getSelection();
    const currentIndex = sel ? sel.index : slashPosition + 1;

    // Delete the slash and query text
    const deleteLength = Math.max(1, currentIndex - slashPosition);
    quill.deleteText(slashPosition, deleteLength);

    closeMenu();

    // Apply format
    if (cmdId === 'p') {
      quill.formatLine(slashPosition, 1, {
        header: false,
        list: false,
        blockquote: false,
        'code-block': false
      });
    } else if (cmdId === 'h1') {
      quill.formatLine(slashPosition, 1, 'header', 1);
    } else if (cmdId === 'h2') {
      quill.formatLine(slashPosition, 1, 'header', 2);
    } else if (cmdId === 'h3') {
      quill.formatLine(slashPosition, 1, 'header', 3);
    } else if (cmdId === 'table') {
      quill.insertEmbed(slashPosition, 'table-block', true);
      quill.insertText(slashPosition + 1, '\n');
      quill.setSelection(slashPosition + 2, 0);
    } else if (cmdId === 'bullet') {
      quill.formatLine(slashPosition, 1, 'list', 'bullet');
    } else if (cmdId === 'ordered') {
      quill.formatLine(slashPosition, 1, 'list', 'ordered');
    } else if (cmdId === 'check') {
      quill.formatLine(slashPosition, 1, 'list', 'check');
    } else if (cmdId === 'blockquote') {
      quill.formatLine(slashPosition, 1, 'blockquote', true);
    } else if (cmdId === 'callout') {
      quill.insertEmbed(slashPosition, 'callout-block', 'Highlight important information here...');
      quill.insertText(slashPosition + 1, '\n');
      quill.setSelection(slashPosition + 2, 0);
    } else if (cmdId === 'toggle') {
      quill.insertEmbed(slashPosition, 'toggle-block', { summary: 'Toggle heading', body: 'Hidden content here...' });
      quill.insertText(slashPosition + 1, '\n');
      quill.setSelection(slashPosition + 2, 0);
    } else if (cmdId === 'code-block') {
      quill.formatLine(slashPosition, 1, 'code-block', true);
    } else if (cmdId === 'divider') {
      quill.insertEmbed(slashPosition, 'divider', true);
      quill.insertText(slashPosition + 1, '\n');
      quill.setSelection(slashPosition + 2, 0);
    }

    quill.focus();
  }

  // Keyboard navigation & query filtering
  quill.root.addEventListener('keydown', (e) => {
    if (menu.hidden) {
      if (e.key === '/') {
        window.setTimeout(() => {
          const sel = quill.getSelection();
          if (!sel) return;
          // Check preceding character
          const textBefore = quill.getText(Math.max(0, sel.index - 2), 2);
          if (sel.index === 1 || textBefore.startsWith('\n') || textBefore.startsWith(' ') || textBefore === '/') {
            openMenu(sel.index - 1);
          }
        }, 10);
      }
      return;
    }

    // When menu is open:
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (filteredCommands.length > 0) {
        activeIndex = (activeIndex + 1) % filteredCommands.length;
        renderCommands();
      }
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (filteredCommands.length > 0) {
        activeIndex = (activeIndex - 1 + filteredCommands.length) % filteredCommands.length;
        renderCommands();
      }
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      if (filteredCommands[activeIndex]) {
        executeCommand(filteredCommands[activeIndex].id);
      }
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      closeMenu();
      return;
    }
  });

  quill.on('text-change', () => {
    if (menu.hidden || slashPosition === null) return;
    const sel = quill.getSelection();
    if (!sel || sel.index < slashPosition) {
      closeMenu();
      return;
    }

    const query = quill.getText(slashPosition + 1, sel.index - slashPosition - 1).trim().toLowerCase();
    if (query.includes(' ') || query.includes('\n')) {
      closeMenu();
      return;
    }

    filteredCommands = SLASH_COMMANDS.filter(cmd =>
      cmd.label.toLowerCase().includes(query) || cmd.desc.toLowerCase().includes(query) || cmd.id.toLowerCase().includes(query)
    );
    activeIndex = 0;
    renderCommands();
  });

  menu.addEventListener('mousedown', (e) => {
    e.preventDefault();
    const item = e.target.closest('[data-cmd]');
    if (item) {
      executeCommand(item.dataset.cmd);
    }
  });

  document.addEventListener('pointerdown', (e) => {
    if (!menu.contains(e.target)) {
      closeMenu();
    }
  });

  return {
    destroy: () => menu.remove()
  };
}

// ============================================
// 3. Contextual AI Action Overlay & Preview
// ============================================

function createAIOverlay(quill, container) {
  const overlay = document.createElement('div');
  overlay.className = 'motion-ai-preview-card';
  overlay.hidden = true;
  document.body.appendChild(overlay);

  let pendingRequest = null;
  let activeRange = null;

  container.addEventListener('notion:ai-trigger', async (e) => {
    const { action, tone, language, text, range } = e.detail;
    activeRange = range;

    const bounds = quill.getBounds(range.index, range.length);
    const quillRect = quill.root.getBoundingClientRect();

    let left = quillRect.left + bounds.left;
    let top = quillRect.top + bounds.bottom + 12;

    const width = 440;
    if (left + width > window.innerWidth - 16) {
      left = window.innerWidth - width - 16;
    }

    overlay.style.left = `${Math.max(16, Math.round(left))}px`;
    overlay.style.top = `${Math.round(top)}px`;
    overlay.hidden = false;

    // Show loading state
    overlay.innerHTML = `
      <div class="mapc-header">
        <span class="material-symbols-outlined text-primary">auto_awesome</span>
        <strong>AI Assistant is working...</strong>
        <button type="button" class="mapc-close">×</button>
      </div>
      <div class="mapc-body mapc-loading">
        <div class="loading-spinner"></div>
        <span>Generating thoughtful revision...</span>
      </div>
    `;

    overlay.querySelector('.mapc-close')?.addEventListener('click', () => {
      if (pendingRequest) pendingRequest.abort();
      overlay.hidden = true;
    });

    const abortController = new AbortController();
    pendingRequest = abortController;

    try {
      const resultText = await executeAIAction({
        text,
        action,
        tone,
        language,
        signal: abortController.signal
      });

      overlay.innerHTML = `
        <div class="mapc-header">
          <span class="material-symbols-outlined text-primary">auto_awesome</span>
          <strong>AI Proposal</strong>
          <span class="mapc-badge">${action.toUpperCase()}${language ? `: ${language}` : ''}${tone ? `: ${tone}` : ''}</span>
          <button type="button" class="mapc-close">×</button>
        </div>
        <div class="mapc-body">
          <div class="mapc-preview-text">${escapeHtml(resultText)}</div>
        </div>
        <div class="mapc-footer">
          <button type="button" class="mapc-btn mapc-btn-cancel">Discard</button>
          <button type="button" class="mapc-btn mapc-btn-insert">Insert below</button>
          <button type="button" class="mapc-btn mapc-btn-replace modal-btn-primary">Replace selection</button>
        </div>
      `;

      overlay.querySelector('.mapc-close')?.addEventListener('click', () => {
        overlay.hidden = true;
      });
      overlay.querySelector('.mapc-btn-cancel')?.addEventListener('click', () => {
        overlay.hidden = true;
      });

      overlay.querySelector('.mapc-btn-replace')?.addEventListener('click', () => {
        if (!activeRange) return;
        quill.deleteText(activeRange.index, activeRange.length);
        quill.insertText(activeRange.index, resultText);
        quill.setSelection(activeRange.index + resultText.length, 0);
        overlay.hidden = true;
      });

      overlay.querySelector('.mapc-btn-insert')?.addEventListener('click', () => {
        if (!activeRange) return;
        const insertPos = activeRange.index + activeRange.length;
        quill.insertText(insertPos, `\n${resultText}`);
        quill.setSelection(insertPos + resultText.length + 1, 0);
        overlay.hidden = true;
      });
    } catch (err) {
      if (err.name === 'AbortError') return;
      overlay.innerHTML = `
        <div class="mapc-header">
          <span class="material-symbols-outlined text-error">error</span>
          <strong>AI Generation Error</strong>
          <button type="button" class="mapc-close">×</button>
        </div>
        <div class="mapc-body text-error text-sm">
          ${escapeHtml(err.message || 'Could not complete AI action.')}
        </div>
        <div class="mapc-footer">
          <button type="button" class="mapc-btn mapc-btn-cancel">Close</button>
        </div>
      `;
      overlay.querySelector('.mapc-close')?.addEventListener('click', () => { overlay.hidden = true; });
      overlay.querySelector('.mapc-btn-cancel')?.addEventListener('click', () => { overlay.hidden = true; });
    }
  });

  return {
    destroy: () => overlay.remove()
  };
}

function escapeHtml(text = '') {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ============================================
// 4. Editor Block & Table Interactions
// ============================================

function setupEditorInteractions(quill, onChange) {
  // Table action buttons delegation (Add Row, Add Col, Del Row, Del Col)
  quill.root.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-table-action]');
    if (!btn) return;
    const action = btn.dataset.tableAction;
    const block = btn.closest('.notion-table-block');
    if (!block) return;
    const table = block.querySelector('table');
    if (!table) return;

    if (action === 'add-row') {
      const thead = table.querySelector('thead');
      const tbody = table.querySelector('tbody') || table;
      const colCount = (thead ? thead.querySelectorAll('th, td').length : tbody.querySelector('tr')?.children.length) || 3;
      const tr = document.createElement('tr');
      for (let i = 0; i < colCount; i++) {
        const td = document.createElement('td');
        td.textContent = 'Cell';
        tr.appendChild(td);
      }
      tbody.appendChild(tr);
    } else if (action === 'add-col') {
      const thead = table.querySelector('thead');
      if (thead) {
        const th = document.createElement('th');
        th.textContent = 'Header';
        thead.querySelector('tr')?.appendChild(th);
      }
      const rows = table.querySelectorAll('tbody tr');
      rows.forEach(tr => {
        const td = document.createElement('td');
        td.textContent = 'Cell';
        tr.appendChild(td);
      });
    } else if (action === 'del-row') {
      const rows = table.querySelectorAll('tbody tr');
      if (rows.length > 1) {
        rows[rows.length - 1].remove();
      }
    } else if (action === 'del-col') {
      const allRows = table.querySelectorAll('tr');
      const firstRow = allRows[0];
      if (firstRow && firstRow.children.length > 1) {
        allRows.forEach(tr => {
          if (tr.lastElementChild) tr.lastElementChild.remove();
        });
      }
    }

    onChange();
  });

  // Table cell Tab key navigation and auto-row
  quill.root.addEventListener('keydown', (e) => {
    if (e.key === 'Tab') {
      const cell = e.target.closest('td, th');
      if (cell) {
        const table = cell.closest('table');
        const cells = Array.from(table.querySelectorAll('th, td'));
        const index = cells.indexOf(cell);
        if (index === cells.length - 1 && !e.shiftKey) {
          e.preventDefault();
          const tbody = table.querySelector('tbody') || table;
          const thead = table.querySelector('thead');
          const colCount = (thead ? thead.querySelectorAll('th, td').length : 3);
          const tr = document.createElement('tr');
          for (let i = 0; i < colCount; i++) {
            const td = document.createElement('td');
            td.textContent = '';
            tr.appendChild(td);
          }
          tbody.appendChild(tr);
          onChange();
          setTimeout(() => tr.firstElementChild?.focus(), 10);
        }
      }
    }
  });

  // Checklist interactive toggle
  quill.root.addEventListener('click', (e) => {
    const li = e.target.closest('li[data-list]');
    if (li) {
      const rect = li.getBoundingClientRect();
      if (e.clientX < rect.left + 24) {
        const current = li.getAttribute('data-list');
        li.setAttribute('data-list', current === 'checked' ? 'unchecked' : 'checked');
        quill.update();
        onChange();
      }
    }
  });

  // Input changes inside embedded contenteditable blocks
  quill.root.addEventListener('input', (e) => {
    if (e.target.closest('.notion-table-inner, .editor-callout-text, .editor-toggle')) {
      onChange();
    }
  });
}

// ============================================
// 5. Block Hover Gutter & Drag Reorder Manager
// ============================================

function createBlockGutterManager(quill, container, { onOpenContextMenu = () => {} } = {}) {
  const gutterHandle = document.createElement('div');
  gutterHandle.className = 'notion-block-gutter-handle';
  gutterHandle.hidden = true;
  gutterHandle.innerHTML = `
    <button type="button" class="notion-gutter-btn notion-gutter-add" title="Add block below" aria-label="Add block">
      <span class="material-symbols-outlined text-[18px]">add</span>
    </button>
    <button type="button" class="notion-gutter-btn notion-gutter-drag editor-block-drag-handle" data-block-handle draggable="true" title="Drag to move · Click for block options · Alt+↑/↓ to reorder" aria-label="Move block">
      <span class="material-symbols-outlined text-[18px]">drag_indicator</span>
    </button>
  `;
  container.appendChild(gutterHandle);

  const dropLine = document.createElement('div');
  dropLine.className = 'notion-block-drop-line';
  container.appendChild(dropLine);

  let activeBlock = null;
  let draggedBlock = null;
  let hideTimeout = null;

  function getTopLevelBlock(node) {
    if (!node || node === quill.root) return null;
    let curr = node;
    while (curr && curr.parentElement !== quill.root) {
      curr = curr.parentElement;
    }
    return curr;
  }

  function positionHandle(block) {
    if (!block || !block.isConnected) {
      gutterHandle.hidden = true;
      gutterHandle.classList.remove('is-visible');
      return;
    }
    activeBlock = block;
    const bRect = block.getBoundingClientRect();
    const cRect = container.getBoundingClientRect();

    const top = bRect.top - cRect.top;
    const left = bRect.left - cRect.left - 54;

    gutterHandle.style.top = `${Math.max(0, top + (bRect.height > 36 ? 4 : (bRect.height - 24) / 2))}px`;
    gutterHandle.style.left = `${Math.max(-56, left)}px`;
    gutterHandle.hidden = false;
    gutterHandle.classList.add('is-visible');
  }

  function scheduleHide() {
    clearTimeout(hideTimeout);
    hideTimeout = setTimeout(() => {
      gutterHandle.classList.remove('is-visible');
      gutterHandle.hidden = true;
      activeBlock = null;
    }, 300);
  }

  quill.root.addEventListener('mousemove', (e) => {
    clearTimeout(hideTimeout);
    const block = getTopLevelBlock(e.target);
    if (block) {
      positionHandle(block);
    }
  });

  quill.root.addEventListener('mouseleave', (e) => {
    if (!e.relatedTarget?.closest('.notion-block-gutter-handle')) {
      scheduleHide();
    }
  });

  gutterHandle.addEventListener('mouseenter', () => {
    clearTimeout(hideTimeout);
  });

  gutterHandle.addEventListener('mouseleave', (e) => {
    if (!e.relatedTarget?.closest('.ql-editor')) {
      scheduleHide();
    }
  });

  // Add Button Click (+)
  const addBtn = gutterHandle.querySelector('.notion-gutter-add');
  addBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!activeBlock) return;
    const blot = Quill.find(activeBlock);
    const index = blot ? quill.getIndex(blot) : quill.getLength() - 1;
    const length = blot ? blot.length() : 1;
    const insertPos = index + length;
    quill.insertText(insertPos, '\n');
    quill.setSelection(insertPos + 1, 0);
    quill.focus();
    quill.root.dispatchEvent(new KeyboardEvent('keydown', { key: '/', bubbles: true }));
  });

  // Drag Button (drag_indicator)
  const dragBtn = gutterHandle.querySelector('.notion-gutter-drag');

  dragBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!activeBlock) return;
    const rect = dragBtn.getBoundingClientRect();
    onOpenContextMenu({
      block: activeBlock,
      x: rect.right + 4,
      y: rect.top
    });
  });

  quill.root.addEventListener('contextmenu', (e) => {
    const block = getTopLevelBlock(e.target);
    if (block) {
      e.preventDefault();
      onOpenContextMenu({
        block,
        x: e.clientX,
        y: e.clientY
      });
    }
  });

  dragBtn.addEventListener('dragstart', (e) => {
    if (!activeBlock) return;
    draggedBlock = activeBlock;
    draggedBlock.classList.add('notion-block-is-dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', activeBlock.textContent || '');
  });

  dragBtn.addEventListener('dragend', () => {
    if (draggedBlock) {
      draggedBlock.classList.remove('notion-block-is-dragging');
      draggedBlock = null;
    }
    dropLine.classList.remove('is-active');
  });

  quill.root.addEventListener('dragover', (e) => {
    if (!draggedBlock) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';

    const targetBlock = getTopLevelBlock(e.target);
    if (!targetBlock || targetBlock === draggedBlock) {
      dropLine.classList.remove('is-active');
      return;
    }

    const tRect = targetBlock.getBoundingClientRect();
    const cRect = container.getBoundingClientRect();
    const isAfter = (e.clientY - tRect.top) > (tRect.height / 2);

    const lineTop = isAfter ? (tRect.bottom - cRect.top) : (tRect.top - cRect.top);
    dropLine.style.top = `${lineTop}px`;
    dropLine.style.left = `${tRect.left - cRect.left}px`;
    dropLine.style.width = `${tRect.width}px`;
    dropLine.classList.add('is-active');
  });

  quill.root.addEventListener('drop', (e) => {
    if (!draggedBlock) return;
    e.preventDefault();
    dropLine.classList.remove('is-active');

    const targetBlock = getTopLevelBlock(e.target);
    if (targetBlock && targetBlock !== draggedBlock) {
      const tRect = targetBlock.getBoundingClientRect();
      const isAfter = (e.clientY - tRect.top) > (tRect.height / 2);
      if (isAfter) {
        targetBlock.after(draggedBlock);
      } else {
        targetBlock.before(draggedBlock);
      }
      quill.update();
      container.dispatchEvent(new CustomEvent('notion:change', { bubbles: true }));
    }

    draggedBlock.classList.remove('notion-block-is-dragging');
    draggedBlock = null;
  });

  // Keyboard reordering: Alt + ArrowUp / ArrowDown
  quill.root.addEventListener('keydown', (e) => {
    if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      const sel = quill.getSelection();
      if (!sel) return;
      const [leaf] = quill.getLeaf(sel.index);
      const block = getTopLevelBlock(leaf?.domNode);
      if (!block) return;

      e.preventDefault();
      if (e.key === 'ArrowUp') {
        const prev = block.previousElementSibling;
        if (prev) {
          prev.before(block);
          quill.update();
          container.dispatchEvent(new CustomEvent('notion:change', { bubbles: true }));
        }
      } else if (e.key === 'ArrowDown') {
        const next = block.nextElementSibling;
        if (next) {
          next.after(block);
          quill.update();
          container.dispatchEvent(new CustomEvent('notion:change', { bubbles: true }));
        }
      }
    }
  });

  return {
    destroy: () => {
      gutterHandle.remove();
      dropLine.remove();
    }
  };
}
