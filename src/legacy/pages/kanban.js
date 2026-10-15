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
    todo: { label: 'To Do', color: 'bg-amber-400' },
    in_progress: { label: 'In Progress', color: 'bg-blue-400' },
    done: { label: 'Done', color: 'bg-emerald-400' }
  };

  container.innerHTML = `
    <div class="px-8 pt-8 pb-4">
      <div class="flex items-end justify-between">
        <div>
          <h2 class="text-4xl font-extrabold tracking-tight text-on-surface mb-2">Motion</h2>
          <p class="text-on-surface-variant max-w-lg">Manage project flow and tasks within your workspace.</p>
        </div>
        <div class="flex flex-wrap items-center gap-2">
          <label class="flex items-center gap-2 px-3 py-2 bg-surface-container-low rounded-lg text-sm text-on-surface-variant">
            <span class="material-symbols-outlined text-base">search</span>
            <input id="kanban-search" class="w-36 sm:w-48 bg-transparent border-none outline-none text-on-surface placeholder:text-on-surface-variant/60" type="search" placeholder="Find tasks..." />
          </label>
          <select id="kanban-priority-filter" class="px-3 py-2 bg-surface-container-low rounded-lg border-none outline-none text-sm text-on-surface-variant">
            <option value="all">All priorities</option>
            <option value="urgent">Urgent</option>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </select>
          <select id="kanban-sort" class="px-3 py-2 bg-surface-container-low rounded-lg border-none outline-none text-sm text-on-surface-variant" aria-label="Sort tasks">
            <option value="manual">Manual order</option>
            <option value="due">Due date</option>
            <option value="priority">Priority</option>
            <option value="title">Title A–Z</option>
          </select>
          ${members.length ? `<select id="kanban-assignee-filter" class="px-3 py-2 bg-surface-container-low rounded-lg border-none outline-none text-sm text-on-surface-variant">
            <option value="all">All assignees</option>
            <option value="mine">My tasks</option>
            ${members.map((member) => `<option value="${member.user_id}">${escapeHtml(member.user?.name || member.user?.email || 'Member')}</option>`).join('')}
          </select>` : ''}
          <label class="flex items-center gap-2 px-3 py-2 bg-surface-container-low rounded-lg text-xs text-on-surface-variant whitespace-nowrap">
            <input id="kanban-overdue-filter" type="checkbox" />
            Overdue only
          </label>
          <button id="btn-export-calendar" class="flex items-center gap-2 px-4 py-2 bg-surface-container-high rounded-lg text-sm font-medium text-on-surface-variant hover:bg-surface-container-highest transition-colors">
            <span class="material-symbols-outlined text-lg">event</span>
            Export calendar
          </button>
        </div>
      </div>
    </div>

    <div class="flex-1 overflow-x-auto px-8 pb-8">
      <div class="flex gap-6 h-full min-w-max py-4" id="kanban-columns">
        ${Object.entries(columns)
          .map(
            ([status, tasks]) => `
          <div class="w-80 flex flex-col h-full bg-surface-container-low/50 rounded-xl p-3" data-column="${status}">
            <div class="flex items-center justify-between mb-4 px-1">
              <div class="flex items-center gap-2">
                <span class="w-2 h-2 rounded-full ${columnConfig[status].color}"></span>
                <h3 class="font-bold text-sm uppercase tracking-widest text-on-surface-variant">${columnConfig[status].label}</h3>
                <span class="bg-surface-container-high text-[10px] px-1.5 py-0.5 rounded font-bold" data-count="${status}">${tasks.length}</span>
              </div>
            </div>

            <div class="flex-1 space-y-3 overflow-y-auto pr-1" data-cards="${status}">
              ${tasks.length === 0 ? `<div class="text-center py-8 text-on-surface-variant/40 text-xs">No tasks here yet</div>` : tasks.map((t) => renderTaskCard(t)).join('')}
            </div>

            <button class="mt-3 flex items-center justify-center gap-2 py-2 text-on-surface-variant/60 hover:text-on-surface text-xs font-semibold border-2 border-dashed border-outline-variant/10 rounded-lg transition-colors btn-add-task" data-status="${status}">
              <span class="material-symbols-outlined text-sm">add</span>
              New Task
            </button>
          </div>
        `
          )
          .join('')}
      </div>
    </div>
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
      const count = container.querySelector(`[data-count="${cards.dataset.cards}"]`);
      if (count) count.textContent = visibleCount;
    });
  };
  kanbanSearch?.addEventListener('input', applyTaskFilter);
  kanbanPriority?.addEventListener('change', applyTaskFilter);
  kanbanAssignee?.addEventListener('change', applyTaskFilter);
  kanbanSort?.addEventListener('change', applyTaskFilter);
  container.querySelector('#kanban-overdue-filter')?.addEventListener('change', applyTaskFilter);

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
  const priorityColors = {
    urgent: 'bg-error text-on-error',
    high: 'bg-error-container text-on-error-container',
    medium: 'bg-tertiary-container text-on-tertiary-container',
    low: 'bg-surface-container-highest text-on-surface-variant'
  };

  const tagBadge =
    task.tags?.length > 0
      ? `<span class="text-[10px] px-2 py-0.5 rounded ${priorityColors[task.priority] || priorityColors.medium} font-semibold uppercase tracking-wider">${escapeHtml(task.tags[0])}</span>`
      : task.priority !== 'medium'
        ? `<span class="text-[10px] px-2 py-0.5 rounded ${priorityColors[task.priority]} font-semibold uppercase tracking-wider">${task.priority}</span>`
        : '';

  const isDone = task.status === 'done';
  const isOverdue = Boolean(task.due_date && !isDone && new Date(`${task.due_date}T23:59:59`) < new Date());
  const nextStatus = task.status === 'todo' ? 'in_progress' : task.status === 'in_progress' ? 'done' : 'todo';
  const nextLabel = task.status === 'todo' ? 'Start' : task.status === 'in_progress' ? 'Complete' : 'Reopen';
  const safeTitle = escapeHtml(task.title || 'Untitled task');
  const safeAssigneeName = escapeHtml(task.assignee?.name || '');
  const safeAssigneeAvatar = /^https?:\/\//i.test(task.assignee?.avatar_url || '') ? escapeHtml(task.assignee.avatar_url) : '';

  return `
    <div class="task-card group relative bg-surface-container-lowest p-4 rounded-lg shadow-[0_4px_20px_-10px_rgba(0,0,0,0.05)] border border-transparent hover:border-outline-variant/10 transition-all cursor-grab active:cursor-grabbing ${
      isDone ? 'opacity-60 hover:opacity-100' : ''
    }" draggable="true" data-task-id="${task.id}" data-task-title="${escapeHtml(String(task.title || '').toLowerCase())}" data-task-tags="${escapeHtml((task.tags || []).join(' ').toLowerCase())}" data-task-priority="${task.priority || 'medium'}" data-task-due="${task.due_date || ''}" data-task-overdue="${isOverdue}" data-task-assignee="${task.assignee_id || ''}" aria-label="Drag task ${safeTitle}">
      <div class="absolute top-4 right-3 opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1">
        <button class="task-edit text-[10px] font-semibold px-2 py-0.5 bg-surface-container-high rounded hover:bg-primary hover:text-on-primary transition-colors" data-task-id="${
          task.id
        }" type="button">Edit</button>
        <button class="task-delete text-[10px] font-semibold px-2 py-0.5 bg-surface-container-high rounded hover:bg-error hover:text-on-error transition-colors" data-task-id="${
          task.id
        }" type="button">Delete</button>
        <button class="task-move text-[10px] font-semibold px-2 py-0.5 bg-surface-container-high rounded hover:bg-primary hover:text-on-primary transition-colors" data-task-id="${
          task.id
        }" data-move-to="${nextStatus}">${nextLabel}</button>
      </div>
      ${tagBadge ? `<div class="flex flex-wrap gap-1.5 mb-3">${tagBadge}</div>` : ''}
      <h4 class="text-sm font-semibold text-on-surface leading-snug mb-3 ${
        isDone ? 'line-through decoration-on-surface-variant/30' : ''
      }"><button type="button" class="task-open-details text-left hover:underline" data-task-id="${task.id}" aria-label="Open task ${safeTitle}">${safeTitle}</button></h4>
      ${task.details?.description ? `<p class="task-card-description">${escapeHtml(task.details.description.slice(0, 100))}</p>` : ''}
      ${task.details?.checklist?.length ? `<p class="task-card-description">${task.details.checklist.filter(item => item.done).length}/${task.details.checklist.length} steps complete</p>` : ''}
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-2">
          ${
            safeAssigneeAvatar
              ? `<img class="w-6 h-6 rounded-full border-2 border-surface-container-lowest" src="${safeAssigneeAvatar}" alt="${safeAssigneeName}" />`
              : task.assignee?.name
                ? `<div class="w-6 h-6 rounded-full bg-secondary-fixed flex items-center justify-center text-[10px] font-bold">${safeAssigneeName
                    .split(' ')
                    .map((w) => w[0])
                    .join('')
                    .toUpperCase()}</div>`
                : ''
          }
        </div>
        ${
          isDone
            ? '<span class="material-symbols-outlined text-primary-fixed-dim text-lg">check_circle</span>'
            : task.due_date
              ? `<span class="text-[10px] font-bold ${isOverdue ? 'text-error' : 'text-on-surface-variant'}">${isOverdue ? 'Overdue · ' : ''}${new Date(task.due_date).toLocaleDateString('en-US', {
                  month: 'short',
                  day: 'numeric'
                })}</span>`
              : ''
        }
      </div>
      ${task.page_id ? `<button type="button" class="task-open-page mt-3 text-[11px] font-semibold text-primary hover:underline" data-page-id="${escapeHtml(task.page_id)}"><span class="material-symbols-outlined text-xs align-middle">description</span> Open linked page</button>` : ''}
    </div>
  `;
}
