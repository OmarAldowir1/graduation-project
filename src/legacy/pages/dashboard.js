import { requestInput } from "../../lib/dialogs.js";
// ============================================
// MOTION — Dashboard Page Module (Legacy)
// ============================================

import { AppState, setBreadcrumb, showToast } from '../app.js';
import { getRecentPages, getTasks, getTaskCounts, createTask, toggleTask, timeAgo } from '../../lib/queries.js';
import { escapeHtml } from '../../lib/sanitize.js';

export async function renderDashboard(container) {
  setBreadcrumb('Dashboard');

  const [pagesResult, tasksResult, countsResult] = await Promise.all([
    getRecentPages(4, AppState.workspace?.id),
    getTasks({ limit: 5, workspaceId: AppState.workspace?.id }),
    getTaskCounts(AppState.workspace?.id)
  ]);

  const loadError = pagesResult.error || tasksResult.error || countsResult.error;
  if (loadError) {
    container.innerHTML = `<div class="error-state m-8"><span class="material-symbols-outlined">error</span><h3>Failed to load dashboard</h3><p>${escapeHtml(loadError.message || 'Please try again.')}</p><button id="dashboard-retry" class="mt-4 px-4 py-2 bg-primary text-on-primary rounded-lg text-sm font-semibold" type="button">Retry</button></div>`;
    container.querySelector('#dashboard-retry')?.addEventListener('click', async () => renderDashboard(container));
    return;
  }

  const pages = pagesResult.data || [];
  const tasks = tasksResult.data || [];
  const counts = countsResult.data || { total: 0, todo: 0, in_progress: 0, done: 0, overdue: 0 };
  const userName = AppState.profile?.name || AppState.user?.email?.split('@')[0] || 'there';
  const safeUserName = escapeHtml(userName);
  const pending = counts.todo + counts.in_progress;

  // Calculate real checklist progress
  const hasPages = pages.length > 0;
  const hasTasks = counts.total > 0;
  const hasWorkspace = !!AppState.workspace;
  const checkItems = [hasWorkspace, hasPages, hasTasks];
  const completedItems = checkItems.filter(Boolean).length;
  const progressPct = Math.round((completedItems / checkItems.length) * 100);

  container.innerHTML = `
    <div class="p-8 max-w-7xl mx-auto w-full">
      <section class="mb-12">
        <h2 class="text-3xl font-extrabold tracking-tighter text-[#2d3433] dark:text-stone-100 mb-2 font-headline">Welcome back, ${safeUserName}.</h2>
        <p class="text-on-surface-variant body-lg">Your workspace is harmonized and ready for your next move.</p>
      </section>

      <div class="grid grid-cols-1 md:grid-cols-12 gap-6">

        <div class="md:col-span-4 bg-surface-container-lowest rounded-xl p-6 shadow-sm flex flex-col">
          <div class="flex items-center gap-2 mb-6">
            <span class="material-symbols-outlined text-primary">task_alt</span>
            <h3 class="font-bold tracking-tight text-on-surface">Getting Started</h3>
          </div>
          <ul class="space-y-4" id="checklist">
            <li class="flex items-start gap-3 group ${hasPages ? 'cursor-default' : 'cursor-pointer'}" ${!hasPages ? 'id="checklist-create-page"' : ''}>
              <div class="w-5 h-5 rounded ${hasPages ? 'bg-primary' : 'border-2 border-primary/20 group-hover:border-primary'} flex items-center justify-center mt-0.5">
                ${hasPages ? '<span class="material-symbols-outlined text-white text-[12px] font-bold">check</span>' : ''}
              </div>
              <div>
                <p class="text-sm font-medium ${hasPages ? 'text-on-surface-variant line-through' : 'text-on-surface'}">Create your first page</p>
                <p class="text-xs text-on-surface-variant">${hasPages ? 'Great! You have pages.' : 'Organize ideas into meaningful documents.'}</p>
              </div>
            </li>
            <li class="flex items-start gap-3 group cursor-default">
              <div class="w-5 h-5 rounded ${hasWorkspace ? 'bg-primary' : 'border-2 border-primary/20'} flex items-center justify-center mt-0.5">
                ${hasWorkspace ? '<span class="material-symbols-outlined text-white text-[12px] font-bold">check</span>' : ''}
              </div>
              <div>
                <p class="text-sm font-medium ${hasWorkspace ? 'text-on-surface-variant line-through' : 'text-on-surface'}">Setup workspace identity</p>
                <p class="text-xs text-on-surface-variant">${hasWorkspace ? 'Workspace created automatically.' : 'Create your workspace.'}</p>
              </div>
            </li>
            <li class="flex items-start gap-3 group ${hasTasks ? 'cursor-default' : 'cursor-pointer'}" ${!hasTasks ? 'id="checklist-create-task"' : ''}>
              <div class="w-5 h-5 rounded ${hasTasks ? 'bg-primary' : 'border-2 border-primary/20 group-hover:border-primary'} flex items-center justify-center mt-0.5">
                ${hasTasks ? '<span class="material-symbols-outlined text-white text-[12px] font-bold">check</span>' : ''}
              </div>
              <div>
                <p class="text-sm font-medium ${hasTasks ? 'text-on-surface-variant line-through' : 'text-on-surface'}">Add your first task</p>
                <p class="text-xs text-on-surface-variant">${hasTasks ? 'You\'re on track!' : 'Start tracking your workflow.'}</p>
              </div>
            </li>
          </ul>
          <div class="mt-auto pt-8">
            <div class="w-full bg-surface-container rounded-full h-1.5 mb-2">
              <div class="bg-primary h-1.5 rounded-full transition-all duration-500" style="width: ${progressPct}%"></div>
            </div>
            <p class="text-[10px] uppercase tracking-widest font-bold text-on-surface-variant">${progressPct}% PROGRESS</p>
          </div>
        </div>

        <div class="md:col-span-8">
          <div class="flex justify-between items-end mb-4">
            <h3 class="font-bold tracking-tight text-on-surface px-2">Recent Pages</h3>
            <button class="text-xs font-bold text-primary hover:underline" onclick="window.location.hash='notes'">View all</button>
          </div>
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-4" id="recent-pages-grid">
            ${
              pages.length === 0
                ? `
              <div class="col-span-2 empty-state">
                <span class="material-symbols-outlined">description</span>
                <h3>No pages yet</h3>
                <p>Create your first page to get started.</p>
                <button class="mt-4 px-5 py-2 bg-primary text-on-primary rounded-lg font-semibold text-sm hover:opacity-90 transition-opacity" id="dashboard-create-page-btn">
                  <span class="material-symbols-outlined text-sm" style="vertical-align: -3px;">add</span>
                  Create Page
                </button>
              </div>
            `
                : pages
                    .map(
                      (page) => `
              <div class="group bg-surface-container-lowest rounded-xl overflow-hidden shadow-sm hover:shadow-md transition-all duration-300 cursor-pointer" onclick="window.location.hash='editor/${page.id}'">
                <div class="h-32 bg-surface-container overflow-hidden flex items-center justify-center">
                  <span class="text-4xl">${escapeHtml(page.icon || '📄')}</span>
                </div>
                <div class="p-4">
                  <div class="flex items-center justify-between mb-2">
                    <span class="text-[10px] font-bold text-tertiary uppercase tracking-wider">${escapeHtml(page.page_type || 'Note')}</span>
                    <span class="material-symbols-outlined text-sm text-on-surface-variant opacity-0 group-hover:opacity-100 transition-opacity">more_horiz</span>
                  </div>
                  <h4 class="font-semibold text-on-surface mb-1">${escapeHtml(page.title || 'Untitled')}</h4>
                  <p class="text-xs text-on-surface-variant">${timeAgo(page.updated_at)}</p>
                </div>
              </div>
            `
                    )
                    .join('')
            }
          </div>
        </div>

        <div class="md:col-span-12 bg-surface-container-low/50 rounded-xl p-8 border border-outline-variant/10">
          <div class="flex flex-col md:flex-row md:items-center justify-between gap-6">
            <div>
              <h3 class="text-xl font-bold tracking-tight text-on-surface mb-1">Active Tasks</h3>
              <p class="text-sm text-on-surface-variant">
                ${
                  pending > 0
                    ? `You have ${pending} task${pending > 1 ? 's' : ''} requiring attention.`
                    : 'All caught up! No pending tasks.'
                }
              </p>
            </div>
            <div class="flex flex-wrap items-center justify-end gap-4">
              <button id="dashboard-add-task" class="px-4 py-2.5 bg-primary text-on-primary rounded-lg text-sm font-semibold flex items-center gap-2 hover:bg-primary-dim transition-colors" type="button">
                <span class="material-symbols-outlined text-base">add_task</span>
                Add task
              </button>
              <div class="flex flex-col items-center justify-center p-4 bg-surface-container-lowest rounded-lg w-24">
                <span class="text-2xl font-bold text-on-surface">${String(counts.total).padStart(2, '0')}</span>
                <span class="text-[10px] font-bold text-on-surface-variant uppercase">Total</span>
              </div>
              <div class="flex flex-col items-center justify-center p-4 bg-primary text-on-primary rounded-lg w-24 shadow-lg shadow-primary/20">
                <span class="text-2xl font-bold">${String(pending).padStart(2, '0')}</span>
                <span class="text-[10px] font-bold uppercase">Pending</span>
              </div>
              <div class="flex flex-col items-center justify-center p-4 bg-surface-container-lowest rounded-lg w-24">
                <span class="text-2xl font-bold text-tertiary">${String(counts.done).padStart(2, '0')}</span>
                <span class="text-[10px] font-bold text-on-surface-variant uppercase">Done</span>
              </div>
              <div class="flex flex-col items-center justify-center p-4 bg-error-container/40 rounded-lg w-24">
                <span class="text-2xl font-bold text-error">${String(counts.overdue || 0).padStart(2, '0')}</span>
                <span class="text-[10px] font-bold text-error uppercase">Overdue</span>
              </div>
            </div>
          </div>

          <div class="mt-8 space-y-3" id="task-list">
            ${
              tasks.length === 0
                ? `
              <div class="text-center py-6 text-on-surface-variant text-sm">
                No tasks yet.
                <button class="text-primary font-semibold hover:underline ml-1" onclick="window.location.hash='kanban'">Head to the Kanban board</button>
                to create some!
              </div>
            `
                : tasks
                    .slice(0, 4)
                    .map(
                      (task) => `
              <div class="flex items-center justify-between p-3 bg-white/40 dark:bg-stone-800/40 hover:bg-white dark:hover:bg-stone-800 rounded-lg transition-colors cursor-pointer group" data-task-id="${task.id}" data-dash-task>
                <div class="flex items-center gap-4">
                  <button type="button" class="dashboard-task-toggle w-6 h-6 rounded-full flex items-center justify-center border ${task.completed ? 'bg-primary border-primary text-on-primary' : 'border-outline-variant text-transparent hover:text-primary'}" data-task-id="${task.id}" data-completed="${task.completed}" aria-label="${escapeHtml(`${task.completed ? 'Reopen' : 'Complete'} ${task.title || 'task'}`)}">
                    <span class="material-symbols-outlined text-sm">check</span>
                  </button>
                  <button type="button" class="text-left text-sm font-medium text-on-surface hover:underline ${task.completed ? 'line-through opacity-50' : ''}" aria-label="Open task ${escapeHtml(task.title || 'Untitled task')}">${escapeHtml(task.title || 'Untitled task')}</button>
                </div>
                <div class="flex items-center gap-4">
                  <span class="text-xs font-bold text-on-surface-variant">${
                    task.due_date
                      ? new Date(task.due_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
                      : task.status?.toUpperCase().replace('_', ' ')
                  }</span>
                  <span class="material-symbols-outlined text-on-surface-variant group-hover:text-primary transition-colors">chevron_right</span>
                </div>
              </div>
            `
                    )
                    .join('')
            }
          </div>
        </div>
      </div>
    </div>
  `;

  // Bind: checklist item → navigate to create page
  container.querySelector('#checklist-create-page')?.addEventListener('click', async () => {
    document.getElementById('btn-new-page')?.click();
  });

  // Bind: checklist item → navigate to kanban
  container.querySelector('#checklist-create-task')?.addEventListener('click', async () => {
    window.location.hash = 'kanban';
  });

  // Bind: empty state create page button
  container.querySelector('#dashboard-create-page-btn')?.addEventListener('click', async () => {
    document.getElementById('btn-new-page')?.click();
  });

  container.querySelector('#dashboard-add-task')?.addEventListener('click', async () => {
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
    const { data: task, error: taskError } = await createTask(title.trim(), { workspaceId: AppState.workspace?.id, priority, dueDate });
    if (taskError) {
      showToast(`Could not create task: ${taskError.message}`, 'error');
      return;
    }
    showToast('Task added', 'success');
    window.location.hash = `kanban?task=${encodeURIComponent(task.id)}`;
  });

  // Bind: task click → navigate to kanban
  container.querySelectorAll('[data-dash-task]').forEach((el) => {
    el.addEventListener('click', async () => {
      window.location.hash = `kanban?task=${encodeURIComponent(el.dataset.taskId || '')}`;
    });
  });

  container.querySelectorAll('.dashboard-task-toggle').forEach((button) => {
    button.addEventListener('click', async (event) => {
      event.stopPropagation();
      const { error: toggleError } = await toggleTask(button.dataset.taskId, button.dataset.completed !== 'true');
      if (toggleError) {
        showToast(`Could not update task: ${toggleError.message}`, 'error');
        return;
      }
      renderDashboard(container);
    });
  });
}
