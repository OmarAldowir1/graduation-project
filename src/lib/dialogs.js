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
