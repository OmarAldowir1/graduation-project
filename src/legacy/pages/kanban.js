import { requestConfirmation } from "../../lib/dialogs.js";
// ============================================
// MOTION — Kanban Board Page Module (Legacy)
// ============================================

import { AppState, setBreadcrumb, showToast } from '../app.js';
import { getTasks, createTask, updateTask, toggleTask, deleteTask, getWorkspaceMembers } from '../../lib/queries.js';
import { escapeHtml } from '../../lib/sanitize.js';
import { openTaskDetails, requestNewTask } from '../../lib/taskDetails.js';
import { tasksForProject, buildProjectIndex } from '../../lib/projects.js';
import { renderListView, renderCalendarView, renderTimelineView } from '../../lib/taskViews.js';
import { loadTaskFields, openFieldManager } from '../../lib/taskFields.js';
import { getPages } from '../../lib/queries.js';

const VIEW_KEY = 'motion-task-view';
function readView() {
  try { return localStorage.getItem(VIEW_KEY) || 'board'; } catch { return 'board'; }
}
function saveView(view) {
  try { localStorage.setItem(VIEW_KEY, view); } catch { /* private mode */ }
}

// scope: { projectId, project, pages } shows only that project's tasks and is
// remembered on the container so self-refreshes keep it.
export async function renderKanban(container, route) {
  const scope = route?.scope !== undefined ? route.scope : container.__kanbanScope || null;
  container.__kanbanScope = scope;
  if (route && route.scope === undefined && route.query) container.__kanbanQuery = route.query;
  const query = route?.query || container.__kanbanQuery || null;
  if (!scope) setBreadcrumb('All tasks');

  const [{ data: workspaceTasks, error }, membersResult] = await Promise.all([
    getTasks({ workspaceId: AppState.workspace?.id }),
    AppState.workspace?.id ? getWorkspaceMembers(AppState.workspace.id) : Promise.resolve({ data: [] })
  ]);
  const allTasks = scope?.projectId ? tasksForProject(workspaceTasks || [], scope.pages || [], scope.projectId) : (workspaceTasks || []);
  const [customFields, workspacePagesResult] = await Promise.all([
    loadTaskFields(AppState.workspace?.id),
    scope ? Promise.resolve({ data: scope.pages || [] }) : (AppState.workspace?.id ? getPages(AppState.workspace.id) : Promise.resolve({ data: [] }))
  ]);
  // Project names for the List view (only on the all-tasks board).
  const projectNames = new Map();
  if (!scope) {
    const pagesForIndex = workspacePagesResult.data || [];
    const index = buildProjectIndex(pagesForIndex);
    const titles = new Map(pagesForIndex.map((page) => [page.id, page.title || 'Untitled']));
    for (const task of allTasks) {
      const projectId = index.get(task.page_id);
      if (projectId) projectNames.set(task.id, titles.get(projectId));
    }
  }
  let currentView = readView();
  let listSort = { key: 'due', dir: 1 };
  let calendarMonth = new Date();
  if (error) {
    container.innerHTML = `<div class="error-state m-8"><span class="material-symbols-outlined">error</span><h3>Failed to load tasks</h3><p>${escapeHtml(error.message || 'Please try again.')}</p></div>`;
    return;
  }

  const columns = {
    todo: allTasks.filter((t) => t.status === 'todo'),
    in_progress: allTasks.filter((t) => t.status === 'in_progress'),
    done: allTasks.filter((t) => t.status === 'done')
  };
  const members = membersResult.data || [];

  const columnConfig = {
    todo: { label: 'To Do', icon: 'radio_button_unchecked', description: 'Ready to pick up' },
    in_progress: { label: 'In Progress', icon: 'pending', description: 'Currently moving' },
    done: { label: 'Done', icon: 'check_circle', description: 'Finished work' }
  };
  const overdueCount = allTasks.filter((task) => task.due_date && task.status !== 'done' && new Date(`${task.due_date}T23:59:59`) < new Date()).length;

  container.innerHTML = `
    <section class="motion-kanban">
      <header class="motion-kanban-header" ${scope ? 'hidden' : ''}>
        <div>
          <div class="motion-kanban-eyebrow"><span class="material-symbols-outlined">view_kanban</span> ${query?.get('assignee') === 'mine' ? 'MY TASKS' : 'ALL TASKS'}</div>
          <h2>${query?.get('assignee') === 'mine' ? 'Work assigned to you.' : 'Every task across your team.'}</h2>
          <p>${query?.get('assignee') === 'mine' ? 'Everything you own, across all projects.' : 'Tasks from every project. Open a project to see just its board.'}</p>
        </div>
        <button class="motion-kanban-primary btn-add-task" data-status="todo" type="button"><span class="material-symbols-outlined">add</span> New task</button>
      </header>

      <div class="motion-kanban-overview" aria-label="Board overview">
        <div><span class="motion-kanban-overview-icon total material-symbols-outlined">layers</span><span><strong>${allTasks.length}</strong><small>Total tasks</small></span></div>
        <div><span class="motion-kanban-overview-icon active material-symbols-outlined">pending</span><span><strong>${columns.in_progress.length}</strong><small>In progress</small></span></div>
        <div><span class="motion-kanban-overview-icon complete material-symbols-outlined">check_circle</span><span><strong>${columns.done.length}</strong><small>Completed</small></span></div>
        <div><span class="motion-kanban-overview-icon overdue material-symbols-outlined">schedule</span><span><strong>${overdueCount}</strong><small>Overdue</small></span></div>
      </div>

      <div class="motion-kanban-toolbar">
        <label class="motion-kanban-search"><span class="material-symbols-outlined">search</span><input id="kanban-search" type="search" placeholder="Search tasks and tags" aria-label="Search tasks and tags" /></label>
        <div class="motion-kanban-filters">
          <select id="kanban-priority-filter" aria-label="Filter by priority">
            <option value="all">All priorities</option>
            <option value="urgent">Urgent</option>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </select>
          <select id="kanban-sort" aria-label="Sort tasks">
            <option value="manual">Manual order</option>
            <option value="due">Due date</option>
            <option value="priority">Priority</option>
            <option value="title">Title A–Z</option>
          </select>
          ${members.length ? `<select id="kanban-assignee-filter" aria-label="Filter by assignee">
            <option value="all">All assignees</option>
            <option value="mine">My tasks</option>
            ${members.map((member) => `<option value="${member.user_id}">${escapeHtml(member.user?.name || member.user?.email || 'Member')}</option>`).join('')}
          </select>` : ''}
          <label class="motion-kanban-overdue"><input id="kanban-overdue-filter" type="checkbox" /> Overdue only</label>
        </div>
      </div>
      <div class="task-view-bar">
        <div class="task-view-switch" role="tablist" aria-label="Task view">
          ${[['board', 'view_kanban', 'Board'], ['list', 'table_rows', 'List'], ['calendar', 'calendar_month', 'Calendar'], ['timeline', 'view_timeline', 'Timeline']].map(([id, icon, label]) => `<button type="button" role="tab" data-view="${id}" aria-selected="false"><span class="material-symbols-outlined">${icon}</span>${label}</button>`).join('')}
        </div>
        <button type="button" class="task-fields-btn" id="kanban-manage-fields"><span class="material-symbols-outlined">tune</span> Fields${customFields.length ? ` · ${customFields.length}` : ''}</button>
      </div>
      <div class="motion-kanban-subbar"><p id="kanban-filter-summary" role="status">Showing all ${allTasks.length} tasks</p><button id="kanban-clear-filters" type="button" hidden>Clear filters</button><button id="btn-export-calendar" type="button"><span class="material-symbols-outlined">event</span> Export calendar</button></div>
      <nav class="motion-kanban-lane-nav" aria-label="Jump to board column">${Object.entries(columnConfig).map(([status, config]) => `<button type="button" data-jump="${status}">${config.label} <span data-nav-count="${status}">${columns[status].length}</span></button>`).join('')}</nav>

      <div class="motion-kanban-scroll" id="kanban-scroll">
      <div class="motion-kanban-columns" id="kanban-columns">
        ${Object.entries(columns)
          .map(
            ([status, tasks]) => `
          <div class="motion-kanban-column" data-column="${status}">
            <div class="motion-kanban-column-header"><span class="motion-kanban-column-icon ${status} material-symbols-outlined">${columnConfig[status].icon}</span><div><h3>${columnConfig[status].label} <span data-count="${status}">${tasks.length}</span></h3><p>${columnConfig[status].description}</p></div></div>
            <div class="motion-kanban-cards" data-cards="${status}">
              ${tasks.length === 0 ? `<div class="motion-kanban-empty"><span class="material-symbols-outlined">${columnConfig[status].icon}</span><strong>Nothing here yet</strong><p>${status === 'todo' ? 'Add a task to get started.' : status === 'in_progress' ? 'Move a task here when you begin.' : 'Finished tasks will appear here.'}</p></div>` : tasks.map((t) => renderTaskCard(t)).join('')}
              <div class="motion-kanban-no-match" hidden>No tasks match your filters.</div>
            </div>
            <button class="motion-kanban-add btn-add-task" data-status="${status}" type="button"><span class="material-symbols-outlined">add</span> Add task</button>
          </div>
        `
          )
          .join('')}
      </div>
      </div>
      <div class="task-altview" hidden></div>
    </section>
  `;

  const focusedTaskId = route?.query?.get('task');
  if (focusedTaskId) {
    const focusedCard = [...container.querySelectorAll('.task-card')].find((card) => card.dataset.taskId === focusedTaskId);
    if (focusedCard) {
      focusedCard.classList.add('ring-2', 'ring-primary', 'ring-offset-2');
      focusedCard.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
      window.setTimeout(() => focusedCard.classList.remove('ring-2', 'ring-primary', 'ring-offset-2'), 2600);
    }
  }

  container.querySelectorAll('.btn-add-task').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const draft = await requestNewTask({ members, status: btn.dataset.status, heading: `New task · ${columnConfig[btn.dataset.status]?.label || 'To Do'}` });
      if (!draft) return;
      const { title, ...options } = draft;
      const { error } = await createTask(title, { workspaceId: AppState.workspace?.id, ...options, pageId: scope?.projectId || null, sortOrder: Date.now() });
      if (error) {
        showToast('Failed to create task: ' + error.message, 'error');
        return;
      }
      showToast(`Task “${title}” created`, 'success');
      await renderKanban(container);
    });
  });

  const kanbanSearch = container.querySelector('#kanban-search');
  const kanbanPriority = container.querySelector('#kanban-priority-filter');
  const kanbanAssignee = container.querySelector('#kanban-assignee-filter');
  const kanbanSort = container.querySelector('#kanban-sort');
  const applyTaskFilter = () => {
    const term = kanbanSearch?.value.trim().toLowerCase() || '';
    const priority = kanbanPriority?.value || 'all';
    const overdueOnly = Boolean(container.querySelector('#kanban-overdue-filter')?.checked);
    const assignee = kanbanAssignee?.value || 'all';
    const sort = kanbanSort?.value || 'manual';
    const priorityRank = { urgent: 0, high: 1, medium: 2, low: 3 };
    container.querySelectorAll('.task-card').forEach((card) => {
      const matchesText = !term || card.dataset.taskTitle.includes(term) || card.dataset.taskTags.includes(term);
      const matchesPriority = priority === 'all' || card.dataset.taskPriority === priority;
      const matchesOverdue = !overdueOnly || card.dataset.taskOverdue === 'true';
      const matchesAssignee = assignee === 'all' || (assignee === 'mine' ? card.dataset.taskAssignee === AppState.user?.id : card.dataset.taskAssignee === assignee);
      card.hidden = !(matchesText && matchesPriority && matchesOverdue && matchesAssignee);
    });
    let visibleTotal = 0;
    container.querySelectorAll('[data-cards]').forEach((cards) => {
      if (sort !== 'manual') {
        const taskCards = [...cards.querySelectorAll('.task-card')];
        taskCards.sort((left, right) => {
          if (sort === 'title') return left.dataset.taskTitle.localeCompare(right.dataset.taskTitle);
          if (sort === 'priority') return (priorityRank[left.dataset.taskPriority] ?? 9) - (priorityRank[right.dataset.taskPriority] ?? 9);
          return (left.dataset.taskDue || '9999-12-31').localeCompare(right.dataset.taskDue || '9999-12-31');
        });
        taskCards.forEach((card) => cards.appendChild(card));
      }
      const visibleCount = [...cards.querySelectorAll('.task-card')].filter((card) => !card.hidden).length;
      visibleTotal += visibleCount;
      const count = container.querySelector(`[data-count="${cards.dataset.cards}"]`);
      if (count) count.textContent = visibleCount;
      const navCount = container.querySelector(`[data-nav-count="${cards.dataset.cards}"]`);
      if (navCount) navCount.textContent = visibleCount;
      const noMatch = cards.querySelector('.motion-kanban-no-match');
      if (noMatch) noMatch.hidden = visibleCount !== 0 || !cards.querySelector('.task-card');
    });
    const filtered = Boolean(term || priority !== 'all' || overdueOnly || assignee !== 'all');
    const summary = container.querySelector('#kanban-filter-summary');
    if (summary) summary.textContent = filtered ? `Showing ${visibleTotal} of ${allTasks.length} tasks` : `Showing all ${allTasks.length} tasks`;
    const clear = container.querySelector('#kanban-clear-filters');
    if (clear) clear.hidden = !filtered;
    renderAltView();
  };

  // ---------- List / Calendar / Timeline ----------
  const altView = container.querySelector('.task-altview');
  const boardParts = [container.querySelector('#kanban-scroll'), container.querySelector('.motion-kanban-lane-nav')];
  function visibleTasks() {
    const visibleIds = new Set([...container.querySelectorAll('.task-card')].filter((card) => !card.hidden).map((card) => card.dataset.taskId));
    return allTasks.filter((task) => visibleIds.has(task.id));
  }
  function renderAltView() {
    if (!altView) return;
    container.querySelectorAll('[data-view]').forEach((button) => {
      const active = button.dataset.view === currentView;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-selected', String(active));
    });
    const isBoard = currentView === 'board';
    boardParts.forEach((part) => { if (part) part.style.display = isBoard ? '' : 'none'; });
    altView.hidden = isBoard;
    if (isBoard) return;
    const tasks = visibleTasks();
    altView.innerHTML = currentView === 'list'
      ? renderListView(tasks, { fields: customFields, projectNames, sort: listSort })
      : currentView === 'calendar'
        ? renderCalendarView(tasks, { month: calendarMonth })
        : renderTimelineView(tasks);
  }
  altView?.addEventListener('click', (event) => {
    const open = event.target.closest('[data-open-task]');
    if (open) {
      const task = allTasks.find((item) => item.id === open.dataset.openTask);
      if (task) openTaskDetails(task, members, () => renderKanban(container));
      return;
    }
    const sortButton = event.target.closest('[data-sort]');
    if (sortButton) {
      listSort = { key: sortButton.dataset.sort, dir: listSort.key === sortButton.dataset.sort ? -listSort.dir : 1 };
      renderAltView();
      return;
    }
    const nav = event.target.closest('[data-cal-nav]');
    if (nav) {
      const step = Number(nav.dataset.calNav);
      calendarMonth = step === 0 ? new Date() : new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() + step, 1);
      renderAltView();
      return;
    }
    const more = event.target.closest('[data-day-more]');
    if (more) {
      currentView = 'list';
      saveView('list');
      listSort = { key: 'due', dir: 1 };
      renderAltView();
    }
  });
  altView?.addEventListener('change', async (event) => {
    const select = event.target.closest('[data-status-for]');
    if (!select) return;
    const { error: statusError } = await updateTask(select.dataset.statusFor, { status: select.value, completed: select.value === 'done' });
    if (statusError) return showToast(`Could not update task: ${statusError.message}`, 'error');
    showToast('Status updated', 'success');
    renderKanban(container);
  });
  // Calendar: drag a task onto another day to reschedule it.
  altView?.addEventListener('dragstart', (event) => {
    const item = event.target.closest('[data-drag-task]');
    if (item) event.dataTransfer.setData('text/motion-task', item.dataset.dragTask);
  });
  altView?.addEventListener('dragover', (event) => {
    const day = event.target.closest('[data-drop-date]');
    if (day) { event.preventDefault(); day.classList.add('is-drop'); }
  });
  altView?.addEventListener('dragleave', (event) => event.target.closest('[data-drop-date]')?.classList.remove('is-drop'));
  altView?.addEventListener('drop', async (event) => {
    const day = event.target.closest('[data-drop-date]');
    const taskId = event.dataTransfer.getData('text/motion-task');
    if (!day || !taskId) return;
    event.preventDefault();
    const { error: dateError } = await updateTask(taskId, { due_date: day.dataset.dropDate });
    if (dateError) return showToast(`Could not reschedule: ${dateError.message}`, 'error');
    showToast(`Due date moved to ${day.dataset.dropDate}`, 'success');
    renderKanban(container);
  });
  container.querySelectorAll('[data-view]').forEach((button) => button.addEventListener('click', () => {
    currentView = button.dataset.view;
    saveView(currentView);
    renderAltView();
  }));
  container.querySelector('#kanban-manage-fields')?.addEventListener('click', async () => {
    try {
      await openFieldManager(AppState.workspace?.id, () => renderKanban(container));
    } catch (fieldError) {
      showToast(fieldError.message || 'Could not update fields', 'error');
    }
  });
  kanbanSearch?.addEventListener('input', applyTaskFilter);
  kanbanPriority?.addEventListener('change', applyTaskFilter);
  kanbanAssignee?.addEventListener('change', applyTaskFilter);
  if (query?.get('assignee') === 'mine' && kanbanAssignee) {
    kanbanAssignee.value = 'mine';
    applyTaskFilter();
  }
  kanbanSort?.addEventListener('change', applyTaskFilter);
  container.querySelector('#kanban-overdue-filter')?.addEventListener('change', applyTaskFilter);
  applyTaskFilter();
  container.querySelector('#kanban-clear-filters')?.addEventListener('click', () => {
    kanbanSearch.value = '';
    kanbanPriority.value = 'all';
    if (kanbanAssignee) kanbanAssignee.value = 'all';
    container.querySelector('#kanban-overdue-filter').checked = false;
    applyTaskFilter();
    kanbanSearch.focus();
  });
  container.querySelectorAll('[data-jump]').forEach((button) => button.addEventListener('click', () => {
    container.querySelector(`[data-column="${button.dataset.jump}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'start' });
  }));

  container.querySelector('#btn-export-calendar')?.addEventListener('click', async () => {
    const datedTasks = allTasks.filter((task) => task.due_date);
    if (!datedTasks.length) {
      showToast('Add due dates to tasks before exporting a calendar', 'error');
      return;
    }
    const escapeIcs = (value) => String(value || '').replace(/[\\;,]/g, (character) => `\\${character}`).replace(/\n/g, '\\n');
    const toDateStamp = (value) => new Date(`${value}T00:00:00`).toISOString().slice(0, 10).replace(/-/g, '');
    const toEndDateStamp = (value) => {
      const date = new Date(`${value}T00:00:00`);
      date.setDate(date.getDate() + 1);
      return date.toISOString().slice(0, 10).replace(/-/g, '');
    };
    const events = datedTasks.map((task) => {
      const date = toDateStamp(task.due_date);
      return [
        'BEGIN:VEVENT',
        `UID:${task.id}@motion`,
        `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')}`,
        `DTSTART;VALUE=DATE:${date}`,
        `DTEND;VALUE=DATE:${toEndDateStamp(task.due_date)}`,
        `SUMMARY:${escapeIcs(task.title)}`,
        `DESCRIPTION:${escapeIcs(`Groupify task • ${task.status || 'todo'}`)}`,
        'END:VEVENT'
      ].join('\r\n');
    });
    const calendar = `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Groupify//Workspace//EN\r\n${events.join('\r\n')}\r\nEND:VCALENDAR\r\n`;
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob([calendar], { type: 'text/calendar;charset=utf-8' }));
    link.download = 'motion-tasks.ics';
    link.click();
    URL.revokeObjectURL(link.href);
    showToast(`${datedTasks.length} task${datedTasks.length === 1 ? '' : 's'} exported`, 'success');
  });

  container.querySelectorAll('.task-toggle').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const taskId = btn.dataset.taskId;
      const completed = btn.dataset.completed === 'true';
      const { error } = await toggleTask(taskId, !completed);
      if (error) return showToast(`Could not update task: ${error.message}`, 'error');
      renderKanban(container);
    });
  });

  container.querySelectorAll('.task-move').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const taskId = btn.dataset.taskId;
      const newStatus = btn.dataset.moveTo;
      const { error } = await updateTask(taskId, { status: newStatus, sort_order: Date.now() });
      if (error) return showToast(`Could not move task: ${error.message}`, 'error');
      showToast('Task moved!', 'success');
      renderKanban(container);
    });
  });

  container.querySelectorAll(".task-edit, .task-open-details").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      const task = allTasks.find(item => item.id === button.dataset.taskId);
      if(task) openTaskDetails(task, members, () => renderKanban(container));
    });
  });
  container.querySelectorAll(".task-card").forEach((card) => {
    card.addEventListener("click", (event) => {
      if(event.target.closest("button, a")) return;
      const task = allTasks.find(item => item.id === card.dataset.taskId);
      if(task) openTaskDetails(task, members, () => renderKanban(container));
    });
  });
  if(focusedTaskId) {
    const task = allTasks.find(item => item.id === focusedTaskId);
    // Only if the user is still on the board (the data may arrive after they navigated away).
    const stillHere = container.isConnected && window.location.hash.includes(`task=${focusedTaskId}`);
    if(task && stillHere) openTaskDetails(task, members, () => renderKanban(container));
  }

  container.querySelectorAll('.task-delete').forEach((btn) => {
    btn.addEventListener('click', async (event) => {
      event.stopPropagation();
      if (!await requestConfirmation('Delete this task?')) return;
      const { error: deleteError } = await deleteTask(btn.dataset.taskId);
      if (deleteError) {
        showToast('Failed to delete task: ' + deleteError.message, 'error');
        return;
      }
      showToast('Task deleted', 'success');
      renderKanban(container);
    });
  });

  container.querySelectorAll('.task-open-page').forEach((btn) => {
    btn.addEventListener('click', async (event) => {
      event.stopPropagation();
      window.location.hash = `editor/${btn.dataset.pageId}`;
    });
  });

  let draggedTaskId = null;
  container.querySelectorAll('[data-task-id].task-card').forEach((card) => {
    card.addEventListener('dragstart', async (event) => {
      draggedTaskId = card.dataset.taskId;
      card.classList.add('is-dragging');
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', draggedTaskId);
    });

    card.addEventListener('dragend', async () => {
      draggedTaskId = null;
      card.classList.remove('is-dragging');
      container.querySelectorAll('[data-cards]').forEach((target) => target.classList.remove('is-drop-target'));
    });
  });

  container.querySelectorAll('[data-cards]').forEach((target) => {
    target.addEventListener('dragover', async (event) => {
      if (!draggedTaskId) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
      target.classList.add('is-drop-target');
    });

    target.addEventListener('dragleave', async (event) => {
      if (!target.contains(event.relatedTarget)) target.classList.remove('is-drop-target');
    });

    target.addEventListener('drop', async (event) => {
      event.preventDefault();
      target.classList.remove('is-drop-target');
      const taskId = event.dataTransfer.getData('text/plain') || draggedTaskId;
      const newStatus = target.dataset.cards;
      if (!taskId || !newStatus) return;

      const { error: updateError } = await updateTask(taskId, { status: newStatus, sort_order: Date.now() });
      if (updateError) {
        showToast('Failed to move task: ' + updateError.message, 'error');
        return;
      }
      showToast('Task moved!', 'success');
      renderKanban(container);
    });
  });
}

function renderTaskCard(task) {
  const isDone = task.status === 'done';
  const isOverdue = Boolean(task.due_date && !isDone && new Date(`${task.due_date}T23:59:59`) < new Date());
  const nextStatus = task.status === 'todo' ? 'in_progress' : task.status === 'in_progress' ? 'done' : 'todo';
  const nextLabel = task.status === 'todo' ? 'Start' : task.status === 'in_progress' ? 'Complete' : 'Reopen';
  const priority = ['urgent', 'high', 'medium', 'low'].includes(task.priority) ? task.priority : 'medium';
  const safeTitle = escapeHtml(task.title || 'Untitled task');
  const safeAssigneeName = escapeHtml(task.assignee?.name || '');
  const safeAssigneeAvatar = /^https?:\/\//i.test(task.assignee?.avatar_url || '') ? escapeHtml(task.assignee.avatar_url) : '';
  const dueLabel = task.due_date ? new Date(`${task.due_date}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '';
  const checklist = task.details?.checklist;

  return `
    <article class="task-card motion-kanban-card" draggable="true" data-task-id="${task.id}" data-task-title="${escapeHtml(String(task.title || '').toLowerCase())}" data-task-tags="${escapeHtml((task.tags || []).join(' ').toLowerCase())}" data-task-priority="${priority}" data-task-due="${task.due_date || ''}" data-task-overdue="${isOverdue}" data-task-assignee="${task.assignee_id || ''}" aria-label="Task ${safeTitle}; drag to move">
      <div class="motion-kanban-card-top"><span class="motion-kanban-priority ${priority}"><span class="material-symbols-outlined">flag</span>${priority}</span><span class="motion-kanban-grip material-symbols-outlined" aria-hidden="true">drag_indicator</span></div>
      <h4 class="${isDone ? 'is-done' : ''}"><button type="button" class="task-open-details" data-task-id="${task.id}" aria-label="Open task ${safeTitle}">${safeTitle}</button></h4>
      ${task.details?.description ? `<p class="motion-kanban-description">${escapeHtml(task.details.description.slice(0, 100))}</p>` : ''}
      ${task.tags?.length ? `<div class="motion-kanban-tags">${task.tags.slice(0, 3).map((tag) => `<span>${escapeHtml(tag)}</span>`).join('')}</div>` : ''}
      <div class="motion-kanban-meta">
        ${task.due_date ? `<span class="motion-kanban-due ${isOverdue ? 'is-overdue' : ''}"><span class="material-symbols-outlined">event</span>${isOverdue ? 'Overdue · ' : ''}${dueLabel}</span>` : '<span class="motion-kanban-due muted"><span class="material-symbols-outlined">event</span>No due date</span>'}
        ${checklist?.length ? `<span><span class="material-symbols-outlined">checklist</span>${checklist.filter((item) => item.done).length}/${checklist.length}</span>` : ''}
        ${safeAssigneeAvatar ? `<img class="motion-kanban-avatar" src="${safeAssigneeAvatar}" alt="${safeAssigneeName}" title="${safeAssigneeName}" />` : task.assignee?.name ? `<span class="motion-kanban-avatar initials" title="${safeAssigneeName}">${escapeHtml(task.assignee.name.split(' ').map((word) => word[0]).join('').slice(0, 2).toUpperCase())}</span>` : ''}
      </div>
      <div class="motion-kanban-card-actions"><button class="task-move" data-task-id="${task.id}" data-move-to="${nextStatus}" type="button"><span class="material-symbols-outlined">${isDone ? 'restart_alt' : 'arrow_forward'}</span>${nextLabel}</button><button class="task-edit" data-task-id="${task.id}" type="button" aria-label="Edit ${safeTitle}"><span class="material-symbols-outlined">edit</span></button><button class="task-delete" data-task-id="${task.id}" type="button" aria-label="Delete ${safeTitle}"><span class="material-symbols-outlined">delete</span></button></div>
      ${task.page_id ? `<button type="button" class="task-open-page" data-page-id="${escapeHtml(task.page_id)}"><span class="material-symbols-outlined">description</span> Open linked page</button>` : ''}
      ${isDone ? '<span class="motion-kanban-done-mark material-symbols-outlined" aria-hidden="true">check_circle</span>' : ''}
    </article>
  `;
}
