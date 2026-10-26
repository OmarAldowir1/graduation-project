import { requestInput } from '../../lib/dialogs.js';
import { AppState, setBreadcrumb, showToast } from '../app.js';
import { getRecentPages, getTasks, getTaskCounts, createTask, toggleTask, timeAgo } from '../../lib/queries.js';
import { escapeHtml } from '../../lib/sanitize.js';

export async function renderDashboard(container) {
  setBreadcrumb('Home');

  const [pagesResult, tasksResult, countsResult] = await Promise.all([
    getRecentPages(4, AppState.workspace?.id),
    getTasks({ limit: 5, workspaceId: AppState.workspace?.id }),
    getTaskCounts(AppState.workspace?.id)
  ]);

  const loadError = pagesResult.error || tasksResult.error || countsResult.error;
  if (loadError) {
    container.innerHTML = `<div class="error-state m-8"><span class="material-symbols-outlined">error</span><h3>Failed to load dashboard</h3><p>${escapeHtml(loadError.message || 'Please try again.')}</p><button id="dashboard-retry" class="mt-4 px-4 py-2 bg-primary text-on-primary rounded-lg text-sm font-semibold" type="button">Retry</button></div>`;
    container.querySelector('#dashboard-retry')?.addEventListener('click', () => renderDashboard(container));
    return;
  }

  const pages = pagesResult.data || [];
  const tasks = tasksResult.data || [];
  const counts = countsResult.data || { total: 0, todo: 0, in_progress: 0, done: 0, overdue: 0 };
  const safeName = escapeHtml(AppState.profile?.name || AppState.user?.email?.split('@')[0] || 'there');
  const pending = counts.todo + counts.in_progress;
  const today = new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'long', day: 'numeric' }).format(new Date());
  const completedItems = [Boolean(AppState.workspace), pages.length > 0, counts.total > 0].filter(Boolean).length;
  const progressPct = Math.round((completedItems / 3) * 100);
  const pageCards = pages.map((page) => `
    <a class="motion-page-card" href="#editor/${escapeHtml(page.id)}" aria-label="Open page ${escapeHtml(page.title || 'Untitled')}">
      <span class="motion-page-icon" aria-hidden="true">${escapeHtml(page.icon || '📄')}</span>
      <span class="motion-page-copy">
        <span class="motion-page-type">${escapeHtml(page.page_type || 'note')}</span>
        <strong>${escapeHtml(page.title || 'Untitled')}</strong>
        <small>Edited ${escapeHtml(timeAgo(page.updated_at))}</small>
      </span>
      <span class="material-symbols-outlined motion-page-arrow" aria-hidden="true">arrow_outward</span>
    </a>
  `).join('');

  const taskRows = tasks.slice(0, 4).map((task) => `
    <div class="motion-task-row" data-dash-task data-task-id="${escapeHtml(task.id)}">
      <button type="button" class="dashboard-task-toggle motion-task-check ${task.completed ? 'is-done' : ''}" data-task-id="${escapeHtml(task.id)}" data-completed="${Boolean(task.completed)}" aria-label="${escapeHtml(`${task.completed ? 'Reopen' : 'Complete'} ${task.title || 'task'}`)}">
        <span class="material-symbols-outlined" aria-hidden="true">check</span>
      </button>
      <button type="button" class="motion-task-title ${task.completed ? 'is-done' : ''}" aria-label="Open task ${escapeHtml(task.title || 'Untitled task')}">${escapeHtml(task.title || 'Untitled task')}</button>
      <span class="motion-task-date">${task.due_date ? escapeHtml(new Date(task.due_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })) : escapeHtml((task.status || 'todo').replace('_', ' '))}</span>
    </div>
  `).join('');

  container.innerHTML = `
    <div class="motion-dashboard">
      <section class="motion-hero" aria-labelledby="motion-hero-title">
        <div class="motion-hero-content">
          <p class="motion-eyebrow"><span class="motion-live-dot"></span> ${escapeHtml(today)} · ${escapeHtml(AppState.workspace?.name || 'My Workspace')}</p>
          <h1 id="motion-hero-title">Your work, <em>in motion.</em></h1>
          <p class="motion-hero-greeting">Welcome back, ${safeName}. ${pending ? `You have ${pending} task${pending === 1 ? '' : 's'} ready for your attention.` : 'Everything is caught up. Make space for your next idea.'}</p>
          <div class="motion-hero-actions">
            <button id="dashboard-hero-new-page" class="motion-hero-primary" type="button"><span class="material-symbols-outlined" aria-hidden="true">add</span> New page</button>
            <button id="dashboard-hero-new-task" class="motion-hero-secondary" type="button"><span class="material-symbols-outlined" aria-hidden="true">add_task</span> Add task</button>
          </div>
        </div>
        <div class="motion-hero-art" aria-hidden="true">
          <div class="motion-art-orbit motion-art-orbit-one"></div>
          <div class="motion-art-orbit motion-art-orbit-two"></div>
          <div class="motion-art-card motion-art-card-back"><span class="material-symbols-outlined">view_kanban</span><span>Plan</span></div>
          <div class="motion-art-card motion-art-card-front"><span class="material-symbols-outlined">auto_awesome</span><span>Create<br><strong>your next thing.</strong></span></div>
        </div>
      </section>

      <section class="motion-stats" aria-label="Workspace overview">
        <div class="motion-stat"><span class="motion-stat-icon violet material-symbols-outlined" aria-hidden="true">description</span><div><strong>${pages.length}</strong><span>Recent pages</span></div></div>
        <div class="motion-stat"><span class="motion-stat-icon amber material-symbols-outlined" aria-hidden="true">pending_actions</span><div><strong>${pending}</strong><span>Open tasks</span></div></div>
        <div class="motion-stat"><span class="motion-stat-icon green material-symbols-outlined" aria-hidden="true">task_alt</span><div><strong>${counts.done}</strong><span>Completed</span></div></div>
        <div class="motion-stat"><span class="motion-stat-icon blue material-symbols-outlined" aria-hidden="true">all_inclusive</span><div><strong>${counts.total}</strong><span>All tasks</span></div></div>
      </section>

      <div class="motion-dashboard-grid">
        <section class="motion-dashboard-section motion-pages-section" aria-labelledby="motion-pages-title">
          <div class="motion-section-heading"><div><p class="motion-section-kicker">YOUR SPACE</p><h2 id="motion-pages-title">Pick up where you left off</h2></div><a href="#notes">View all pages <span class="material-symbols-outlined" aria-hidden="true">arrow_forward</span></a></div>
          <div class="motion-page-list">
            ${pageCards || `<div class="motion-empty-card"><span class="material-symbols-outlined" aria-hidden="true">note_add</span><strong>Start with a blank page</strong><p>Capture an idea, build a plan, or keep a note.</p><button id="dashboard-create-page-btn" type="button">Create your first page</button></div>`}
          </div>
        </section>

        <section class="motion-dashboard-section motion-focus-section" aria-labelledby="motion-focus-title">
          <div class="motion-section-heading"><div><p class="motion-section-kicker">STAY ON TRACK</p><h2 id="motion-focus-title">Your focus</h2></div><a href="#kanban">Open board <span class="material-symbols-outlined" aria-hidden="true">arrow_forward</span></a></div>
          <div class="motion-focus-card">
            <div class="motion-focus-top"><span class="motion-focus-symbol material-symbols-outlined" aria-hidden="true">${pending ? 'bolt' : 'celebration'}</span><span class="motion-focus-label">${pending ? 'IN PROGRESS' : 'ALL CLEAR'}</span></div>
            <strong>${pending ? `${pending} task${pending === 1 ? '' : 's'} on your list` : 'A fresh start looks good on you.'}</strong>
            <p>${pending ? 'Small steps become meaningful progress. Keep the momentum going.' : 'Your open tasks are done. Add a new one whenever inspiration strikes.'}</p>
            <button id="dashboard-add-task" type="button"><span class="material-symbols-outlined" aria-hidden="true">add</span> Add a task</button>
          </div>
          <div class="motion-task-list">
            ${taskRows || `<p class="motion-empty-tasks">No tasks yet. <a href="#kanban">Explore your board</a></p>`}
          </div>
        </section>
      </div>

      ${progressPct < 100 ? `<section class="motion-setup-card"><div><p class="motion-section-kicker">GETTING STARTED</p><h2>Make Motion yours</h2><p>${completedItems} of 3 essentials complete</p></div><div class="motion-setup-progress"><span style="width:${progressPct}%"></span></div>${pages.length ? '' : '<button id="checklist-create-page" type="button">Create your first page</button>'}${counts.total ? '' : '<button id="checklist-create-task" type="button">Add your first task</button>'}</section>` : ''}
    </div>
  `;

  const openNewPage = () => window.dispatchEvent(new CustomEvent('motion:open-new-page'));
  const addTask = async () => {
    const title = await requestInput('Task title:');
    if (!title?.trim()) return;
    const priorityInput = await requestInput('Priority: low, medium, high, or urgent', 'medium');
    if (priorityInput === null) return;
    const priority = ['low', 'medium', 'high', 'urgent'].includes(priorityInput.trim().toLowerCase())
      ? priorityInput.trim().toLowerCase()
      : 'medium';
    const dueDateInput = await requestInput('Due date (YYYY-MM-DD, optional):', '');
    if (dueDateInput === null) return;
    const dueDate = dueDateInput.trim();
    if (dueDate && !/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) {
      showToast('Use the date format YYYY-MM-DD', 'error');
      return;
    }
    const { data: task, error } = await createTask(title.trim(), { workspaceId: AppState.workspace?.id, priority, dueDate });
    if (error) return showToast(`Could not create task: ${error.message}`, 'error');
    showToast('Task added', 'success');
    window.location.hash = `kanban?task=${encodeURIComponent(task.id)}`;
  };

  ['dashboard-hero-new-page', 'dashboard-create-page-btn', 'checklist-create-page'].forEach((id) => {
    container.querySelector(`#${id}`)?.addEventListener('click', openNewPage);
  });
  ['dashboard-hero-new-task', 'dashboard-add-task'].forEach((id) => {
    container.querySelector(`#${id}`)?.addEventListener('click', addTask);
  });
  container.querySelector('#checklist-create-task')?.addEventListener('click', () => { window.location.hash = 'kanban'; });
  container.querySelectorAll('[data-dash-task]').forEach((row) => {
    row.addEventListener('click', () => { window.location.hash = `kanban?task=${encodeURIComponent(row.dataset.taskId || '')}`; });
  });
  container.querySelectorAll('.dashboard-task-toggle').forEach((button) => {
    button.addEventListener('click', async (event) => {
      event.stopPropagation();
      const { error } = await toggleTask(button.dataset.taskId, button.dataset.completed !== 'true');
      if (error) return showToast(`Could not update task: ${error.message}`, 'error');
      renderDashboard(container);
    });
  });
}
