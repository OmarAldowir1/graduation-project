import { supabase } from './supabase.js';
import { updateTask } from './queries.js';
import { escapeHtml as esc } from './sanitize.js';
import { AppState, showToast } from '../legacy/app.js';

let closeActiveTask = null;

export function openTaskDetails(task, members = [], onSaved = () => {}) {
  closeActiveTask?.();
  const details = task.details || {};
  const checklist = Array.isArray(details.checklist) ? details.checklist.map(item => ({ id: item.id || crypto.randomUUID(), text: String(item.text || ''), done: Boolean(item.done) })) : [];
  const backdrop = document.createElement('div');
  backdrop.className = 'task-detail-backdrop';
  backdrop.innerHTML = `<section class="task-detail-panel" role="dialog" aria-modal="true" aria-label="Task details">
    <header><div><small>TASK DETAILS</small><h2>Instructions &amp; progress</h2></div><button type="button" data-close aria-label="Close task details">×</button></header>
    <form class="task-detail-form">
      <label>Title<input name="title" value="${esc(task.title || '')}" required maxlength="500" /></label>
      <label>Description<textarea name="description" rows="5" placeholder="Explain what needs to be done, the expected result, and any important instructions.">${esc(details.description || '')}</textarea></label>
      <div class="task-detail-fields">
        <label>Status<select name="status">${['todo','in_progress','done'].map(value => `<option value="${value}" ${task.status === value ? 'selected' : ''}>${{todo:'To do',in_progress:'In progress',done:'Done'}[value]}</option>`).join('')}</select></label>
        <label>Priority<select name="priority">${['low','medium','high','urgent'].map(value => `<option ${task.priority === value ? 'selected' : ''}>${value}</option>`).join('')}</select></label>
        <label>Due date<input name="due_date" type="date" value="${esc(task.due_date || '')}" /></label>
        <label>Assignee<select name="assignee_id"><option value="">Unassigned</option>${members.map(member => `<option value="${esc(member.user_id)}" ${task.assignee_id === member.user_id ? 'selected' : ''}>${esc(member.user?.name || member.user?.email || 'Member')}</option>`).join('')}${task.assignee_id && !members.some(member => member.user_id === task.assignee_id) ? `<option value="${esc(task.assignee_id)}" selected>${esc(task.assignee?.name || 'Current assignee')}</option>` : ''}</select></label>
      </div>
      <label>Tags<input name="tags" value="${esc((task.tags || []).join(', '))}" placeholder="Separate tags with commas" /></label>
      <section class="task-detail-checklist"><h3>Checklist <small data-progress></small></h3><div data-checklist></div><button type="button" data-add-step>+ Add a step</button></section>
      <label>Reference links<textarea name="links" rows="2" placeholder="Paste one https:// URL per line">${esc((Array.isArray(details.links) ? details.links : []).join('\n'))}</textarea></label>
      <div class="task-detail-references">${(Array.isArray(details.links) ? details.links : []).filter(url => /^https?:\/\//i.test(url)).map(url => `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(url)}</a>`).join('')}${task.page_id ? `<a href="#editor/${esc(task.page_id)}" data-related-page>Open related page →</a>` : ''}</div>
      <p data-save-status role="status"></p><button type="submit" class="modal-btn-primary">Save task</button>
    </form>
    <section class="task-detail-discussion"><h3>Discussion</h3><div data-comments>Loading comments…</div><form data-comment-form><label>Add a comment<textarea name="comment" rows="2" required placeholder="Ask a question or share a progress update."></textarea></label><button class="modal-btn-primary" type="submit">Post comment</button></form></section>
  </section>`;
  const oldFocus = document.activeElement;
  const panel = backdrop.querySelector('.task-detail-panel');
  const form = backdrop.querySelector('.task-detail-form');
  const close = () => { backdrop.remove(); window.removeEventListener('hashchange', close); closeActiveTask = null; if(oldFocus?.isConnected) oldFocus.focus(); };
  closeActiveTask = close;
  backdrop.querySelector('[data-close]').addEventListener('click', close);
  backdrop.addEventListener('click', event => { if(event.target === backdrop) close(); });
  backdrop.addEventListener('keydown', event => {
    if(event.key === 'Escape') { event.stopPropagation(); close(); }
    if(event.key === 'Tab') {
      const controls = [...panel.querySelectorAll('button, input, textarea, select, a[href]')].filter(el => !el.disabled);
      const first = controls[0], last = controls.at(-1);
      if(event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if(!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
  });
  window.addEventListener('hashchange', close);
  function renderChecklist() {
    backdrop.querySelector('[data-progress]').textContent = `${checklist.filter(item => item.done).length}/${checklist.length}`;
    backdrop.querySelector('[data-checklist]').innerHTML = checklist.map(item => `<div class="task-detail-step" data-step="${esc(item.id)}"><input type="checkbox" ${item.done ? 'checked' : ''} aria-label="Complete checklist step" /><input type="text" value="${esc(item.text)}" aria-label="Checklist step" placeholder="Describe this step" /><button type="button" data-remove aria-label="Remove checklist step">×</button></div>`).join('');
  }
  backdrop.querySelector('[data-add-step]').addEventListener('click', () => { checklist.push({id:crypto.randomUUID(),text:'',done:false}); renderChecklist(); backdrop.querySelector('[data-checklist] > div:last-child input[type=text]').focus(); });
  backdrop.querySelector('[data-checklist]').addEventListener('input', event => {
    const row = event.target.closest('[data-step]');
    const item = checklist.find(item => item.id === row?.dataset.step);
    if(!item) return;
    if(event.target.type === 'checkbox') item.done = event.target.checked;
    else item.text = event.target.value;
    backdrop.querySelector('[data-progress]').textContent = `${checklist.filter(item => item.done).length}/${checklist.length}`;
  });
  backdrop.querySelector('[data-checklist]').addEventListener('click', event => {
    if(!event.target.matches('[data-remove]')) return;
    const index = checklist.findIndex(item => item.id === event.target.closest('[data-step]').dataset.step);
    if(index >= 0) checklist.splice(index,1);
    renderChecklist();
  });
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const fields = form.elements;
    const links = fields.links.value.split('\n').map(value => value.trim()).filter(Boolean);
    const status = form.querySelector('[data-save-status]');
    if(!fields.title.value.trim()) { status.textContent = 'Enter a task title.'; return; }
    if(links.some(url => !/^https?:\/\/[^\s]+$/i.test(url))) { status.textContent = 'Reference links must start with http:// or https://.'; return; }
    const submit = form.querySelector('button[type=submit]');
    submit.disabled = true; status.textContent = 'Saving…';
    const {error} = await updateTask(task.id, {
      title:fields.title.value.trim(), status:fields.status.value, priority:fields.priority.value,
      due_date:fields.due_date.value || null, assignee_id:fields.assignee_id.value || null,
      tags:fields.tags.value.split(',').map(tag => tag.trim()).filter(Boolean).slice(0,10),
      details:{...details,description:fields.description.value,checklist:checklist.filter(item => item.text.trim()),links}
    });
    submit.disabled = false;
    if(error) { status.textContent = `Could not save task: ${error.message}`; return; }
    showToast('Task details saved'); close(); await onSaved();
  });
  async function loadComments() {
    const {data,error} = await supabase.from('task_comments').select('*, author:users(name)').eq('task_id',task.id).order('created_at');
    if(!backdrop.isConnected) return;
    backdrop.querySelector('[data-comments]').innerHTML = error ? `<p>${esc(error.message)}</p>` : data?.length ? data.map(comment => `<article><strong>${esc(comment.author?.name || 'Workspace member')}</strong><time>${esc(new Date(comment.created_at).toLocaleString())}</time><p>${esc(comment.content)}</p></article>`).join('') : '<p>No comments yet.</p>';
  }
  backdrop.querySelector('[data-comment-form]').addEventListener('submit', async event => {
    event.preventDefault();
    const commentForm = event.currentTarget;
    const content = commentForm.elements.comment.value.trim();
    if(!content) return;
    const button = commentForm.querySelector('button'); button.disabled = true;
    const {error} = await supabase.from('task_comments').insert({task_id:task.id,user_id:AppState.user.id,content});
    button.disabled = false;
    if(error) { showToast(`Could not post comment: ${error.message}`,'error'); return; }
    commentForm.reset(); await loadComments();
  });
  document.body.append(backdrop); renderChecklist(); form.elements.title.focus(); loadComments();
}
