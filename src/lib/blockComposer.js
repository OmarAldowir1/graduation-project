import { escapeHtml as esc } from './sanitize.js';

const labels = {text:'Text',heading1:'Heading 1',heading2:'Heading 2',heading3:'Heading 3',bulleted:'Bulleted list',numbered:'Numbered list',todo:'To-do list',toggle:'Toggle',quote:'Quote',callout:'Callout',code:'Code',divider:'Divider',table:'Table',equation:'Equation'};

export function composeBlock(type, initialHtml = '') {
  return new Promise(resolve => {
    const template = document.createElement('template');
    template.innerHTML = initialHtml;
    const checked = [...template.content.querySelectorAll('input[type=checkbox]')].map(input => input.checked);
    const listItems = [...template.content.querySelectorAll('li')];
    const tableRows = [...template.content.querySelectorAll('tr')];
    const initial = listItems.length ? listItems.map(item => item.textContent.trim()).join('\n') : tableRows.length ? tableRows.map(row => [...row.children].map(cell => cell.textContent).join(' | ')).join('\n') : template.content.querySelector('details') ? [...template.content.querySelector('details').children].map(el => el.textContent).join('\n') : template.content.textContent.trim();
    const oldFocus = document.activeElement;
    const overlay = document.createElement('div');
    overlay.className = 'modal-backdrop block-composer-backdrop';
    overlay.innerHTML = `<form class="modal-container block-composer" role="dialog" aria-modal="true" aria-label="Edit ${labels[type] || 'block'}">
      <header class="modal-header"><h3>${initialHtml ? 'Edit' : 'Add'} ${labels[type] || 'block'}</h3><button type="button" data-cancel aria-label="Cancel block editing">×</button></header>
      <div class="modal-body"><p class="block-composer-help">Your block stays in draft until you click Done.</p>
      ${type !== 'divider' ? `<label>Block content<textarea name="text" rows="${type.startsWith('heading') ? 2 : 5}" placeholder="${type === 'table' ? 'Separate columns with | and rows with new lines' : ['bulleted','numbered','todo'].includes(type) ? 'One item per line' : type === 'toggle' ? 'First line: title. Following lines: hidden content.' : 'Write your content here…'}">${esc(initial)}</textarea></label>` : ''}
      <p class="block-composer-help">Preview · ${labels[type]}</p><div class="motion-block-content block-composer-preview" data-preview></div><p data-error role="status"></p></div>
      <footer class="modal-footer"><button type="button" class="modal-btn-secondary" data-cancel>Cancel</button><button type="submit" class="modal-btn-primary">Done</button></footer>
    </form>`;
    const form = overlay.querySelector('form');
    const input = form.elements.text;
    const preview = overlay.querySelector('[data-preview]');
    function html() {
      const value = input?.value || '';
      const lines = value.split('\n').filter(line => line.trim());
      if(type.startsWith('heading')) { const tag = `h${type.at(-1)}`; return `<${tag}>${esc(value.trim())}</${tag}>`; }
      if(type === 'bulleted' || type === 'numbered') { const tag = type === 'numbered' ? 'ol' : 'ul'; return `<${tag}>${lines.map(line => `<li>${esc(line)}</li>`).join('')}</${tag}>`; }
      if(type === 'todo') return `<ul class="editor-todo-list">${lines.map((line,index) => `<li><label><input type="checkbox" ${checked[index] ? 'checked' : ''} /> <span>${esc(line)}</span></label></li>`).join('')}</ul>`;
      if(type === 'toggle') return `<details class="editor-toggle"><summary>${esc(lines[0] || '')}</summary><p>${esc(lines.slice(1).join('\n')).replaceAll('\n','<br>')}</p></details>`;
      if(type === 'quote') return `<blockquote>${esc(value).replaceAll('\n','<br>')}</blockquote>`;
      if(type === 'code') return `<pre><code>${esc(value)}</code></pre>`;
      if(type === 'divider') return '<hr />';
      if(type === 'callout') return `<aside class="editor-callout"><span class="editor-callout-icon">💡</span><span>${esc(value).replaceAll('\n','<br>')}</span></aside>`;
      if(type === 'equation') return `<p class="editor-equation">${esc(value)}</p>`;
      if(type === 'table') return `<table class="editor-simple-table"><tbody>${lines.map((line,index) => `<tr>${line.split('|').map(cell => `<${index ? 'td' : 'th'}>${esc(cell.trim())}</${index ? 'td' : 'th'}>`).join('')}</tr>`).join('')}</tbody></table>`;
      return `<p>${esc(value).replaceAll('\n','<br>')}</p>`;
    }
    const render = () => { preview.innerHTML = html(); };
    const finish = value => { overlay.remove(); if(oldFocus?.isConnected) oldFocus.focus(); resolve(value); };
    overlay.querySelectorAll('[data-cancel]').forEach(button => button.addEventListener('click', () => finish(null)));
    input?.addEventListener('input', render);
    preview.addEventListener('change', event => {
      if(event.target.type === 'checkbox') checked[[...preview.querySelectorAll('input')].indexOf(event.target)] = event.target.checked;
    });
    form.addEventListener('submit', event => { event.preventDefault(); if(type !== 'divider' && !input.value.trim()) { overlay.querySelector('[data-error]').textContent = 'Write some content before clicking Done.'; input.focus(); return; } finish(html()); });
    overlay.addEventListener('keydown', event => {
      if(event.key === 'Escape') { event.stopPropagation(); finish(null); }
      if((event.ctrlKey || event.metaKey) && event.key === 'Enter') { event.preventDefault(); form.requestSubmit(); }
      if(event.key === 'Tab') {
        const controls = [...form.querySelectorAll('button,textarea,input')];
        if(event.shiftKey && document.activeElement === controls[0]) { event.preventDefault(); controls.at(-1).focus(); }
        else if(!event.shiftKey && document.activeElement === controls.at(-1)) { event.preventDefault(); controls[0].focus(); }
      }
    });
    document.body.append(overlay); render(); (input || form.querySelector('button[type=submit]')).focus(); input?.select();
  });
}

export function getBlockType(element) {
  if(element.matches('h1,h2,h3')) return `heading${element.tagName.slice(1)}`;
  if(element.matches('ul')) return element.classList.contains('editor-todo-list') ? 'todo' : 'bulleted';
  if(element.matches('ol')) return 'numbered';
  if(element.matches('details')) return 'toggle';
  if(element.matches('blockquote')) return 'quote';
  if(element.matches('pre')) return 'code';
  if(element.matches('hr')) return 'divider';
  if(element.matches('table')) return 'table';
  if(element.matches('aside')) return 'callout';
  return element.classList.contains('editor-equation') ? 'equation' : 'text';
}
