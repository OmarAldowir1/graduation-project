export function escapeHtml(value = '') {
  return String(value).replace(/[&<>'"]/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    "'": '&#39;',
    '"': '&quot;'
  })[character]);
}

export function sanitizeHtml(value = '') {
  const template = document.createElement('template');
  template.innerHTML = String(value);

  template.content.querySelectorAll('script, iframe, object, embed, style, link').forEach((element) => element.remove());
  template.content.querySelectorAll('*').forEach((element) => {
    [...element.attributes].forEach((attribute) => {
      const name = attribute.name.toLowerCase();
      const content = attribute.value.trim().toLowerCase();
      if (name.startsWith('on') || ((name === 'href' || name === 'src' || name === 'action') && /^(javascript:|vbscript:|data:text\/html)/i.test(content))) {
        element.removeAttribute(attribute.name);
      }
    });
  });

  return template.innerHTML;
}
