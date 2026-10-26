import { requestInput, requestConfirmation } from "../../lib/dialogs.js";
// ============================================
// MOTION — Kanban Board Page Module (Legacy)
// ============================================

import { AppState, setBreadcrumb, showToast } from '../app.js';
import { getTasks, createTask, updateTask, toggleTask, deleteTask, getWorkspaceMembers } from '../../lib/queries.js';
import { escapeHtml } from '../../lib/sanitize.js';
import { openTaskDetails } from '../../lib/taskDetails.js';

export async function renderKanban(container, route) {
  setBreadcrumb('Kanban');

  const [{ data: allTasks, error }, membersResult] = await Promise.all([
    getTasks({ workspaceId: AppState.workspace?.id }),
    AppState.workspace?.id ? getWorkspaceMembers(AppState.workspace.id) : Promise.resolve({ data: [] })
  ]);
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
  const memberByEmail = new Map(members.map((member) => [String(member.user?.email || '').toLowerCase(), member.user_id]));
  const resolveAssignee = (value, currentId = null) => {
    const normalized = value.trim().toLowerCase();
    if (!normalized) return null;
    const exact = memberByEmail.get(normalized);
    if (exact) return exact;
    const matchingMember = members.find((member) => member.user_id === currentId);
    if (matchingMember && normalized === String(matchingMember.user?.name || '').toLowerCase()) return currentId;
    return undefined;
  };

  const columnConfig = {
    todo: { label: 'To Do', icon: 'radio_button_unchecked', description: 'Ready to pick up' },
    in_progress: { label: 'In Progress', icon: 'pending', description: 'Currently moving' },
    done: { label: 'Done', icon: 'check_circle', description: 'Finished work' }
  };
  const overdueCount = allTasks.filter((task) => task.due_date && task.status !== 'done' && new Date(`${task.due_date}T23:59:59`) < new Date()).length;

  container.innerHTML = `
    <section class="motion-kanban">
      <header class="motion-kanban-header">
        <div>
          <div class="motion-kanban-eyebrow"><span class="material-symbols-outlined">view_kanban</span> WORKSPACE BOARD</div>
          <h2>Stay on top of every task.</h2>
          <p>Plan what’s next, keep work moving, and see what’s done.</p>
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
      const status = btn.dataset.status;
      const title = await requestInput('Task title:');
      if (!title) return;
      const dueDateInput = await requestInput('Due date (YYYY-MM-DD, optional):', '');
      if (dueDateInput === null) return;
      const dueDate = dueDateInput.trim();
      if (dueDate && !/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) {
        showToast('Use the date format YYYY-MM-DD', 'error');
        return;
      }
      const tags = (await requestInput('Tags (comma separated, optional):', '') || '').split(',').map((tag) => tag.trim()).filter(Boolean).slice(0, 5);
      const assigneeInput = members.length ? await requestInput(`Assignee email (optional):\n${members.map((member) => member.user?.email).filter(Boolean).join('\n')}`, '') : '';
      if (assigneeInput === null) return;
      const assigneeId = assigneeInput ? resolveAssignee(assigneeInput) : null;
      if (assigneeInput && assigneeId === undefined) {
        showToast('Choose an email from the workspace member list', 'error');
        return;
      }
      const { data: task, error } = await createTask(title, { workspaceId: AppState.workspace?.id, status, dueDate, tags, assigneeId, sortOrder: Date.now() });
      if (error) {
        showToast('Failed to create task: ' + error.message, 'error');
        return;
      }
      showToast('Task created!', 'success');
      await renderKanban(container);
      openTaskDetails(task, members, () => renderKanban(container));
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
  };
  kanbanSearch?.addEventListener('input', applyTaskFilter);
  kanbanPriority?.addEventListener('change', applyTaskFilter);
  kanbanAssignee?.addEventListener('change', applyTaskFilter);
  kanbanSort?.addEventListener('change', applyTaskFilter);
  container.querySelector('#kanban-overdue-filter')?.addEventListener('change', applyTaskFilter);
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
        `DESCRIPTION:${escapeIcs(`Motion task • ${task.status || 'todo'}`)}`,
        'END:VEVENT'
      ].join('\r\n');
    });
    const calendar = `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Motion//Workspace//EN\r\n${events.join('\r\n')}\r\nEND:VCALENDAR\r\n`;
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
    if(task) openTaskDetails(task, members, () => renderKanban(container));
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
