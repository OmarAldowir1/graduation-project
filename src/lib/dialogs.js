// App dialogs also work in browsers that do not implement native prompt/confirm.
function showDialog(message, defaultValue, confirmation) {
  return new Promise((resolve) => {
    const previousFocus = document.activeElement;
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    backdrop.style.zIndex = '1000';
    const dialog = document.createElement('form');
    dialog.className = 'modal-container';
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-label', confirmation ? 'Confirm action' : message);
    const heading = document.createElement('div');
    heading.className = 'modal-header';
    const title = document.createElement('h3');
    title.textContent = confirmation ? 'Confirm action' : 'Enter details';
    heading.append(title);
    const body = document.createElement('div');
    body.className = 'modal-body';
    const label = document.createElement('label');
    label.textContent = message;
    label.style.whiteSpace = 'pre-wrap';
    label.style.display = 'block';
    body.append(label);
    const input = document.createElement('input');
    if (!confirmation) {
      input.className = 'modal-input';
      input.value = defaultValue ?? '';
      input.setAttribute('aria-label', message);
      label.append(input);
    }
    const footer = document.createElement('div');
    footer.className = 'modal-footer';
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'modal-btn-secondary';
    cancel.textContent = 'Cancel';
    const submit = document.createElement('button');
    submit.type = 'submit';
    submit.className = 'modal-btn-primary';
    submit.textContent = confirmation ? 'Confirm' : 'Continue';
    footer.append(cancel, submit);
    dialog.append(heading, body, footer);
    backdrop.append(dialog);
    function finish(value) {
      backdrop.remove();
      if (previousFocus?.isConnected) previousFocus.focus();
      resolve(value);
    }
    cancel.addEventListener('click', () => finish(confirmation ? false : null));
    dialog.addEventListener('submit', (event) => {
      event.preventDefault();
      finish(confirmation ? true : input.value);
    });
    backdrop.addEventListener('click', (event) => {
      if (event.target === backdrop) finish(confirmation ? false : null);
    });
    backdrop.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        finish(confirmation ? false : null);
      }
      if (event.key === 'Tab') {
        const controls = confirmation ? [cancel, submit] : [input, cancel, submit];
        const index = controls.indexOf(document.activeElement);
        if ((event.shiftKey && index === 0) || (!event.shiftKey && index === controls.length - 1)) {
          event.preventDefault();
          controls[event.shiftKey ? controls.length - 1 : 0].focus();
        }
      }
    });
    document.body.append(backdrop);
    (confirmation ? cancel : input).focus();
    if (!confirmation) input.select();
  });
}

export function requestInput(message, defaultValue = '') {
  return showDialog(message, defaultValue, false);
}

export function requestConfirmation(message) {
  return showDialog(message, '', true);
}

function escapeAttr(value) {
  return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Shared modal shell with focus trap, Escape/backdrop to cancel, and focus restore.
function openModal({ label, html, onReady }) {
  return new Promise((resolve) => {
    const previousFocus = document.activeElement;
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    backdrop.style.zIndex = '1000';
    backdrop.innerHTML = html;
    const dialog = backdrop.firstElementChild;
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-label', label);
    let done = false;
    const finish = (value) => {
      if (done) return;
      done = true;
      backdrop.remove();
      if (previousFocus?.isConnected) previousFocus.focus();
      resolve(value);
    };
    backdrop.addEventListener('mousedown', (event) => { if (event.target === backdrop) finish(null); });
    backdrop.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') { event.stopPropagation(); finish(null); }
      if (event.key === 'Tab') {
        const controls = [...dialog.querySelectorAll('button, input, select, textarea, [tabindex="0"]')].filter((el) => !el.disabled && el.offsetParent !== null);
        const first = controls[0];
        const last = controls.at(-1);
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    });
    dialog.querySelector('[data-cancel]')?.addEventListener('click', () => finish(null));
    document.body.append(backdrop);
    onReady(dialog, finish);
  });
}

// A real form instead of a chain of prompts.
// fields: [{ name, label, type: 'text'|'date'|'select'|'textarea', value, options: [{value,label}], required, placeholder, hint, half }]
// Resolves to { name: value } or null when cancelled.
export function requestForm({ title, description = '', submitLabel = 'Save', fields = [] }) {
  const controls = fields.map((field) => {
    const common = `name="${escapeAttr(field.name)}" ${field.required ? 'required' : ''} ${field.placeholder ? `placeholder="${escapeAttr(field.placeholder)}"` : ''}`;
    let control;
    if (field.type === 'select') {
      control = `<select class="modal-input" ${common}>${(field.options || []).map((option) => `<option value="${escapeAttr(option.value)}" ${String(option.value) === String(field.value ?? '') ? 'selected' : ''}>${escapeAttr(option.label)}</option>`).join('')}</select>`;
    } else if (field.type === 'textarea') {
      control = `<textarea class="modal-input" rows="3" ${common}>${escapeAttr(field.value)}</textarea>`;
    } else {
      control = `<input class="modal-input" type="${field.type === 'date' ? 'date' : 'text'}" value="${escapeAttr(field.value)}" ${common} ${field.maxLength ? `maxlength="${field.maxLength}"` : ''} />`;
    }
    return `<label class="modal-field ${field.half ? 'is-half' : ''}"><span>${escapeAttr(field.label)}</span>${control}${field.hint ? `<small>${escapeAttr(field.hint)}</small>` : ''}</label>`;
  }).join('');
  return openModal({
    label: title,
    html: `<form class="modal-container modal-form">
      <div class="modal-header"><h3>${escapeAttr(title)}</h3>${description ? `<p class="modal-description">${escapeAttr(description)}</p>` : ''}</div>
      <div class="modal-body modal-form-grid">${controls}</div>
      <div class="modal-footer"><span class="modal-hint">Enter to save · Esc to cancel</span><button type="button" class="modal-btn-secondary" data-cancel>Cancel</button><button type="submit" class="modal-btn-primary">${escapeAttr(submitLabel)}</button></div>
    </form>`,
    onReady(form, finish) {
      form.addEventListener('submit', (event) => {
        event.preventDefault();
        finish(Object.fromEntries(fields.map((field) => [field.name, String(form.elements[field.name]?.value ?? '').trim()])));
      });
      form.querySelector('textarea')?.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); form.requestSubmit(); }
      });
      const first = form.querySelector('input, select, textarea');
      first?.focus();
      first?.select?.();
    }
  });
}

// Searchable list picker. items: [{ id, label, icon, hint }]. Resolves to the chosen item or null.
export function requestChoice({ title, placeholder = 'Search…', items = [], emptyText = 'Nothing matches your search.' }) {
  return openModal({
    label: title,
    html: `<div class="modal-container modal-choice">
      <div class="modal-header"><h3>${escapeAttr(title)}</h3></div>
      <div class="modal-body">
        <input class="modal-input" type="search" placeholder="${escapeAttr(placeholder)}" aria-label="${escapeAttr(placeholder)}" />
        <div class="modal-choice-list" role="listbox"></div>
      </div>
      <div class="modal-footer"><span class="modal-hint">↑ ↓ to move · Enter to choose</span><button type="button" class="modal-btn-secondary" data-cancel>Cancel</button></div>
    </div>`,
    onReady(dialog, finish) {
      const input = dialog.querySelector('input');
      const list = dialog.querySelector('.modal-choice-list');
      let visible = items;
      let active = 0;
      const render = () => {
        list.innerHTML = visible.length
          ? visible.slice(0, 50).map((item, index) => `<button type="button" role="option" aria-selected="${index === active}" class="modal-choice-item ${index === active ? 'is-active' : ''}" data-index="${index}"><span class="modal-choice-icon">${escapeAttr(item.icon || '📄')}</span><span>${escapeAttr(item.label)}</span>${item.hint ? `<small>${escapeAttr(item.hint)}</small>` : ''}</button>`).join('')
          : `<p class="modal-choice-empty">${escapeAttr(emptyText)}</p>`;
        list.querySelector('.is-active')?.scrollIntoView({ block: 'nearest' });
      };
      input.addEventListener('input', () => {
        const query = input.value.trim().toLowerCase();
        visible = items.filter((item) => item.label.toLowerCase().includes(query));
        active = 0;
        render();
      });
      input.addEventListener('keydown', (event) => {
        if (!visible.length) return;
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault();
          const count = Math.min(visible.length, 50);
          active = (active + (event.key === 'ArrowDown' ? 1 : count - 1)) % count;
          render();
        } else if (event.key === 'Enter') {
          event.preventDefault();
          finish(visible[active]);
        }
      });
      list.addEventListener('click', (event) => {
        const button = event.target.closest('[data-index]');
        if (button) finish(visible[Number(button.dataset.index)]);
      });
      render();
      input.focus();
    }
  });
}
