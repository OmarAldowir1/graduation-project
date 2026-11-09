// Small, safe Markdown → editor HTML converter for AI-written content.
// Everything is escaped; only a fixed set of tags is produced.
function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
}

function inline(text) {
  return escapeHtml(text)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>');
}

export function markdownToHtml(markdown = '') {
  const lines = String(markdown).replace(/\r/g, '').split('\n');
  const out = [];
  let list = null;
  let code = null;
  const closeList = () => { if (list) { out.push(`</${list}>`); list = null; } };
  for (const line of lines) {
    if (code !== null) {
      if (/^```/.test(line)) { out.push(`<pre><code>${escapeHtml(code.join('\n'))}</code></pre>`); code = null; } else code.push(line);
      continue;
    }
    if (/^```/.test(line)) { closeList(); code = []; continue; }
    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    const todo = /^\s*[-*]\s+\[( |x|X)\]\s+(.*)$/.exec(line);
    const bullet = /^\s*[-*]\s+(.*)$/.exec(line);
    const numbered = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (heading) { closeList(); out.push(`<h${heading[1].length}>${inline(heading[2])}</h${heading[1].length}>`); }
    else if (todo) {
      if (list !== 'ul class="editor-todo-list"') { closeList(); out.push('<ul class="editor-todo-list">'); list = 'ul class="editor-todo-list"'; }
      out.push(`<li><label><input type="checkbox" ${todo[1].trim() ? 'checked' : ''} /> <span>${inline(todo[2])}</span></label></li>`);
    } else if (bullet) {
      if (list !== 'ul') { closeList(); out.push('<ul>'); list = 'ul'; }
      out.push(`<li>${inline(bullet[1])}</li>`);
    } else if (numbered) {
      if (list !== 'ol') { closeList(); out.push('<ol>'); list = 'ol'; }
      out.push(`<li>${inline(numbered[1])}</li>`);
    } else if (/^\s*>\s?/.test(line)) { closeList(); out.push(`<blockquote>${inline(line.replace(/^\s*>\s?/, ''))}</blockquote>`); }
    else if (/^\s*(---|\*\*\*)\s*$/.test(line)) { closeList(); out.push('<hr />'); }
    else if (line.trim()) { closeList(); out.push(`<p>${inline(line)}</p>`); }
    else closeList();
  }
  if (code !== null) out.push(`<pre><code>${escapeHtml(code.join('\n'))}</code></pre>`);
  closeList();
  return out.join('').replace(/<\/ul class="editor-todo-list">/g, '</ul>');
}
