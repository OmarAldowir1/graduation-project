import { requestInput, requestConfirmation } from "../../lib/dialogs.js";
// ============================================
// MOTION — Database Table Page Module (Legacy)
// ============================================

import { AppState, setBreadcrumb, showToast } from '../app.js';
import { getPages, createPage, updatePage, togglePageFavorite, archivePage, deletePage, timeAgo } from '../../lib/queries.js';
import { escapeHtml } from '../../lib/sanitize.js';

export async function renderDatabase(container) {
  setBreadcrumb('Database');

  const workspaceId = AppState.workspace?.id;
  if (!workspaceId) {
    container.innerHTML = `<div class="empty-state" style="min-height:60vh;"><span class="material-symbols-outlined">folder_off</span><h3>No workspace</h3><p>Create a workspace first.</p></div>`;
    return;
  }

  const { data: pages, error } = await getPages(workspaceId);
  if (error) {
    container.innerHTML = `<div class="error-state m-8"><span class="material-symbols-outlined">error</span><h3>Failed to load data</h3><p>${escapeHtml(error.message || 'Please try again.')}</p></div>`;
    return;
  }

  const userName = AppState.profile?.name || 'You';
  const userInitials = userName
    .split(' ')
    .map((w) => w[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);

  container.innerHTML = `
    <div class="flex-1 p-8 max-w-7xl mx-auto w-full">
      <div class="mb-8">
        <div class="flex justify-between items-end mb-6">
          <div>
            <h2 class="text-3xl font-extrabold tracking-tight text-on-surface mb-2">Project Database</h2>
            <p class="text-on-surface-variant">Manage and curate your organizational assets across all active workstreams.</p>
          </div>
          <div class="flex flex-wrap gap-2">
            <button id="btn-export-csv" class="px-4 py-2.5 bg-surface-container-high text-on-surface rounded-lg font-semibold flex items-center gap-2 transition-colors hover:bg-surface-container-highest">
              <span class="material-symbols-outlined text-sm">download</span>
              Export CSV
            </button>
            <button id="btn-import-csv" class="px-4 py-2.5 bg-surface-container-high text-on-surface rounded-lg font-semibold flex items-center gap-2 transition-colors hover:bg-surface-container-highest">
              <span class="material-symbols-outlined text-sm">upload_file</span>
              Import CSV
            </button>
            <input id="db-import-input" type="file" accept=".csv,text/csv" hidden />
            <button id="btn-new-row" class="px-5 py-2.5 bg-primary text-on-primary rounded-lg font-semibold flex items-center gap-2 transition-transform active:scale-95">
              <span class="material-symbols-outlined">add</span>
              New Row
            </button>
          </div>
        </div>
        <div class="flex items-center justify-between gap-4 p-2 bg-surface-container-low rounded-xl">
          <div class="flex flex-wrap items-center gap-2 w-full">
            <label class="flex items-center gap-2 px-3 py-1.5 bg-surface-container-high/60 rounded-lg text-sm text-on-surface-variant flex-1 min-w-[12rem]">
              <span class="material-symbols-outlined text-base">search</span>
              <input id="db-search" class="min-w-0 flex-1 bg-transparent border-none outline-none text-on-surface placeholder:text-on-surface-variant/60" placeholder="Find pages..." type="search" />
            </label>
            <select id="db-type-filter" class="px-3 py-1.5 bg-surface-container-high/60 rounded-lg border-none outline-none text-sm text-on-surface-variant">
              <option value="all">All types</option>
              <option value="note">Notes</option>
              <option value="document">Documents</option>
              <option value="database">Databases</option>
              <option value="kanban">Kanban</option>
            </select>
            <select id="db-status-filter" class="px-3 py-1.5 bg-surface-container-high/60 rounded-lg border-none outline-none text-sm text-on-surface-variant">
              <option value="all">All statuses</option>
              <option value="idea">Idea</option>
              <option value="active">Active</option>
              <option value="blocked">Blocked</option>
              <option value="done">Done</option>
            </select>
            <select id="db-priority-filter" class="px-3 py-1.5 bg-surface-container-high/60 rounded-lg border-none outline-none text-sm text-on-surface-variant">
              <option value="all">All priorities</option>
              <option value="urgent">Urgent</option>
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
            </select>
            <label class="flex items-center gap-2 px-2 text-xs text-on-surface-variant whitespace-nowrap">
              <input id="db-favorites-only" type="checkbox" />
              Favorites
            </label>
            <select id="db-sort" class="px-3 py-1.5 bg-surface-container-high/60 rounded-lg border-none outline-none text-sm text-on-surface-variant" aria-label="Sort database">
              <option value="updated-desc">Recently updated</option>
              <option value="updated-asc">Oldest updated</option>
              <option value="name-asc">Name A–Z</option>
              <option value="name-desc">Name Z–A</option>
            </select>
          </div>
        </div>
      </div>

      <div class="bg-surface-container-lowest rounded-xl overflow-x-auto">
        <table class="w-full text-left border-collapse">
          <thead>
            <tr class="bg-surface-container-low/50">
              <th class="px-6 py-4 text-xs font-bold uppercase tracking-widest text-on-surface-variant border-none">Name</th>
              <th class="px-6 py-4 text-xs font-bold uppercase tracking-widest text-on-surface-variant border-none">Type</th>
              <th class="px-6 py-4 text-xs font-bold uppercase tracking-widest text-on-surface-variant border-none">Status</th>
              <th class="px-6 py-4 text-xs font-bold uppercase tracking-widest text-on-surface-variant border-none">Tags</th>
              <th class="px-6 py-4 text-xs font-bold uppercase tracking-widest text-on-surface-variant border-none">Priority</th>
              <th class="px-6 py-4 text-xs font-bold uppercase tracking-widest text-on-surface-variant border-none">Updated</th>
              <th class="px-6 py-4 text-xs font-bold uppercase tracking-widest text-on-surface-variant border-none">Owner</th>
              <th class="px-6 py-4 w-10"></th>
            </tr>
          </thead>
          <tbody id="db-table-body">
            ${
              pages.length === 0
                ? `
              <tr>
                <td colspan="8" class="px-6 py-12 text-center text-on-surface-variant text-sm">
                  <div class="empty-state">
                    <span class="material-symbols-outlined">table_chart</span>
                    <h3>No data yet</h3>
                    <p>Add your first row to start building your database.</p>
                  </div>
                </td>
              </tr>
            `
                : pages
                    .map(
                      (page) => {
                        const properties = getPageProperties(page);
                        return `
              <tr class="hover:bg-surface-container-low transition-colors group cursor-pointer" data-page-id="${page.id}" data-page-title="${escapeHtml(String(page.title || '').toLowerCase())}" data-page-type="${escapeHtml(page.page_type || 'note')}" data-page-status="${escapeHtml(properties.status)}" data-page-tags="${escapeHtml(properties.tags.join(' ').toLowerCase())}" data-page-priority="${escapeHtml(properties.priority)}" data-page-favorite="${page.is_favorite ? 'true' : 'false'}" data-page-updated="${page.updated_at || ''}">
                <td class="px-6 py-4">
                  <div class="flex items-center gap-3">
                    <span class="material-symbols-outlined text-on-surface-variant">${page.is_favorite ? 'star' : 'description'}</span>
                    <span class="font-semibold text-on-surface">${escapeHtml(page.title || 'Untitled')}</span>
                  </div>
                </td>
                <td class="px-6 py-4">
                  <span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-tertiary-container text-on-tertiary-container">
                    ${escapeHtml(page.page_type || 'Note')}
                  </span>
                </td>
                <td class="px-6 py-4 text-sm text-on-surface-variant"><span class="inline-flex px-2 py-0.5 rounded-full bg-surface-container-high text-xs">${escapeHtml(properties.status)}</span></td>
                <td class="px-6 py-4 text-sm text-on-surface-variant">${properties.tags.map((tag) => `<span class="inline-flex mr-1 mb-1 px-2 py-0.5 rounded bg-primary-container text-on-primary-container text-xs">${escapeHtml(tag)}</span>`).join('')}</td>
                <td class="px-6 py-4 text-sm text-on-surface-variant"><span class="inline-flex px-2 py-0.5 rounded-full bg-surface-container-high text-xs">${escapeHtml(properties.priority)}</span></td>
                <td class="px-6 py-4 text-sm text-on-surface-variant">${timeAgo(page.updated_at)}</td>
                <td class="px-6 py-4">
                  <div class="flex items-center gap-2">
                    <div class="w-6 h-6 rounded-full bg-secondary-fixed flex items-center justify-center text-[10px] font-bold">${userInitials}</div>
                    <span class="text-sm text-on-surface">${escapeHtml(userName)}</span>
                  </div>
                </td>
                <td class="px-6 py-4 text-right opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap">
                  <button type="button" class="material-symbols-outlined text-outline-variant cursor-pointer hover:text-primary btn-edit-page mr-2" data-page-id="${page.id}" aria-label="Rename ${escapeHtml(page.title || 'page')}">edit</button>
                  <button type="button" class="material-symbols-outlined text-outline-variant cursor-pointer hover:text-primary btn-edit-properties mr-2" data-page-id="${page.id}" aria-label="Edit properties for ${escapeHtml(page.title || 'page')}">tune</button>
                  <button type="button" class="material-symbols-outlined ${page.is_favorite ? 'text-tertiary' : 'text-outline-variant'} cursor-pointer hover:text-primary btn-toggle-favorite mr-2" data-page-id="${page.id}" data-favorite="${page.is_favorite ? 'true' : 'false'}" aria-label="${page.is_favorite ? 'Remove from favorites' : 'Add to favorites'}">${page.is_favorite ? 'star' : 'star_outline'}</button>
                  <button type="button" class="material-symbols-outlined text-outline-variant cursor-pointer hover:text-primary btn-archive-page mr-2" data-page-id="${page.id}" aria-label="Archive ${escapeHtml(page.title || 'page')}">archive</button>
                  <button type="button" class="material-symbols-outlined text-outline-variant cursor-pointer hover:text-error btn-delete-page" data-page-id="${page.id}" aria-label="Delete ${escapeHtml(page.title || 'page')}">delete</button>
                </td>
              </tr>
            `;
                      }
                    )
                    .join('')
            }
            <tr class="hover:bg-surface-container-low/30 transition-colors">
              <td class="px-6 py-4" colspan="8">
                <button id="btn-inline-new" class="flex items-center gap-2 text-on-surface-variant hover:text-on-surface text-sm transition-colors">
                  <span class="material-symbols-outlined text-sm">add</span>
                  New
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div class="mt-6 flex items-center justify-between text-sm text-on-surface-variant">
        <div id="db-result-count">Showing ${pages.length} item${pages.length !== 1 ? 's' : ''}</div>
      </div>
    </div>
  `;

  const addHandler = async () => {
    const title = await requestInput('Page title:');
    if (!title) return;
    const { error } = await createPage(workspaceId, title);
    if (error) {
      showToast('Failed: ' + error.message, 'error');
      return;
    }
    showToast('Row added!', 'success');
    renderDatabase(container);
  };

  document.getElementById('btn-new-row')?.addEventListener('click', addHandler);
  document.getElementById('btn-inline-new')?.addEventListener('click', addHandler);

  document.getElementById('btn-export-csv')?.addEventListener('click', async () => {
    const rows = [...container.querySelectorAll('tr[data-page-id]')].filter((row) => !row.hidden);
    const csvEscape = (value) => `"${String(value || '').replace(/"/g, '""')}"`;
    const lines = [
      ['Name', 'Type', 'Status', 'Tags', 'Priority', 'Updated', 'Owner'].map(csvEscape).join(','),
      ...rows.map((row) => {
        const cells = row.querySelectorAll('td');
        return [cells[0]?.textContent?.trim(), cells[1]?.textContent?.trim(), cells[2]?.textContent?.trim(), cells[3]?.textContent?.trim(), cells[4]?.textContent?.trim(), cells[5]?.textContent?.trim(), cells[6]?.textContent?.trim()].map(csvEscape).join(',');
      })
    ];
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' }));
    link.download = 'motion-database.csv';
    link.click();
    URL.revokeObjectURL(link.href);
    showToast(`${rows.length} row${rows.length === 1 ? '' : 's'} exported`, 'success');
  });

  document.getElementById('btn-import-csv')?.addEventListener('click', async () => document.getElementById('db-import-input')?.click());
  document.getElementById('db-import-input')?.addEventListener('change', async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    const rows = parseCsvRows(text).filter((row) => row.title).slice(0, 100);
    if (!rows.length) {
      showToast('No page names found in that CSV', 'error');
      return;
    }
    let created = 0;
    const supportedTypes = new Set(['note', 'document', 'database', 'kanban']);
    for (const row of rows) {
      const requestedType = row.type.toLowerCase();
      const pageType = supportedTypes.has(requestedType) ? requestedType : 'note';
      const { error: importError } = await createPage(workspaceId, row.title, pageType, {
        properties: {
          status: ['idea', 'active', 'blocked', 'done'].includes(row.status) ? row.status : 'idea',
          tags: row.tags ? row.tags.split('|').map((tag) => tag.trim()).filter(Boolean).slice(0, 10) : [],
          priority: ['low', 'medium', 'high', 'urgent'].includes(row.priority) ? row.priority : 'medium'
        }
      });
      if (!importError) created += 1;
    }
    showToast(`${created} row${created === 1 ? '' : 's'} imported`, created ? 'success' : 'error');
    if (created) renderDatabase(container);
  });

  const tableBody = container.querySelector('#db-table-body');
  const resultCount = container.querySelector('#db-result-count');
  const searchInput = container.querySelector('#db-search');
  const typeFilter = container.querySelector('#db-type-filter');
  const statusFilter = container.querySelector('#db-status-filter');
  const priorityFilter = container.querySelector('#db-priority-filter');
  const favoritesOnly = container.querySelector('#db-favorites-only');
  const sortSelect = container.querySelector('#db-sort');

  function applyDatabaseView() {
    const query = searchInput?.value.trim().toLowerCase() || '';
    const type = typeFilter?.value || 'all';
    const status = statusFilter?.value || 'all';
    const priority = priorityFilter?.value || 'all';
    const favoriteOnly = Boolean(favoritesOnly?.checked);
    const rows = [...container.querySelectorAll('tr[data-page-id]')];
    const visibleRows = rows.filter((row) => {
      const matchesQuery = !query || row.dataset.pageTitle.includes(query) || row.dataset.pageTags.includes(query);
      const matchesType = type === 'all' || row.dataset.pageType === type;
      const matchesStatus = status === 'all' || row.dataset.pageStatus === status;
      const matchesPriority = priority === 'all' || row.dataset.pagePriority === priority;
      const matchesFavorite = !favoriteOnly || row.dataset.pageFavorite === 'true';
      row.hidden = !(matchesQuery && matchesType && matchesStatus && matchesPriority && matchesFavorite);
      return matchesQuery && matchesType && matchesStatus && matchesPriority && matchesFavorite;
    });

    const direction = sortSelect?.value || 'updated-desc';
    visibleRows.sort((a, b) => {
      if (direction.startsWith('name')) {
        const result = a.dataset.pageTitle.localeCompare(b.dataset.pageTitle);
        return direction === 'name-desc' ? -result : result;
      }
      const result = (a.dataset.pageUpdated || '').localeCompare(b.dataset.pageUpdated || '');
      return direction === 'updated-asc' ? result : -result;
    });
    visibleRows.forEach((row) => tableBody?.appendChild(row));

    if (resultCount) {
      resultCount.textContent = `Showing ${visibleRows.length} item${visibleRows.length !== 1 ? 's' : ''}`;
    }
  }

  searchInput?.addEventListener('input', applyDatabaseView);
  typeFilter?.addEventListener('change', applyDatabaseView);
  statusFilter?.addEventListener('change', applyDatabaseView);
  priorityFilter?.addEventListener('change', applyDatabaseView);
  favoritesOnly?.addEventListener('change', applyDatabaseView);
  sortSelect?.addEventListener('change', applyDatabaseView);
  applyDatabaseView();

  container.querySelectorAll('.btn-delete-page').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (!await requestConfirmation('Delete this page?')) return;
      const { error } = await deletePage(btn.dataset.pageId);
      if (error) {
        showToast('Failed: ' + error.message, 'error');
        return;
      }
      showToast('Deleted.', 'success');
      renderDatabase(container);
    });
  });

  container.querySelectorAll('.btn-edit-page').forEach((btn) => {
    btn.addEventListener('click', async (event) => {
      event.stopPropagation();
      const page = pages.find((item) => item.id === btn.dataset.pageId);
      if (!page) return;
      const title = await requestInput('Rename page:', page.title || 'Untitled');
      if (title === null || !title.trim() || title.trim() === page.title) return;
      const { error: updateError } = await updatePage(page.id, { title: title.trim() });
      if (updateError) {
        showToast('Failed to rename: ' + updateError.message, 'error');
        return;
      }
      showToast('Page renamed', 'success');
      renderDatabase(container);
    });
  });

  container.querySelectorAll('.btn-edit-properties').forEach((btn) => {
    btn.addEventListener('click', async (event) => {
      event.stopPropagation();
      const page = pages.find((item) => item.id === btn.dataset.pageId);
      if (!page) return;
      const current = getPageProperties(page);
      const status = await requestInput('Status: idea, active, blocked, or done', current.status);
      if (status === null) return;
      const normalizedStatus = status.trim().toLowerCase();
      if (!['idea', 'active', 'blocked', 'done'].includes(normalizedStatus)) return showToast('Use idea, active, blocked, or done', 'error');
      const priority = await requestInput('Priority: low, medium, high, or urgent', current.priority);
      if (priority === null) return;
      const normalizedPriority = priority.trim().toLowerCase();
      if (!['low', 'medium', 'high', 'urgent'].includes(normalizedPriority)) return showToast('Use low, medium, high, or urgent', 'error');
      const tags = await requestInput('Tags (separated by commas):', current.tags.join(', '));
      if (tags === null) return;
      const nextProperties = { ...current, status: normalizedStatus, priority: normalizedPriority, tags: tags.split(',').map((tag) => tag.trim()).filter(Boolean).slice(0, 10) };
      const { error: propertyError } = await updatePage(page.id, { content: { ...(page.content || {}), properties: nextProperties } });
      if (propertyError) return showToast(`Failed to update properties: ${propertyError.message}`, 'error');
      showToast('Properties updated', 'success');
      renderDatabase(container);
    });
  });

  container.querySelectorAll('.btn-archive-page').forEach((btn) => {
    btn.addEventListener('click', async (event) => {
      event.stopPropagation();
      if (!await requestConfirmation('Archive this page? You can restore it later from Settings.')) return;
      const { error: archiveError } = await archivePage(btn.dataset.pageId);
      if (archiveError) {
        showToast('Failed to archive: ' + archiveError.message, 'error');
        return;
      }
      showToast('Page archived', 'success');
      renderDatabase(container);
    });
  });

  container.querySelectorAll('.btn-toggle-favorite').forEach((btn) => {
    btn.addEventListener('click', async (event) => {
      event.stopPropagation();
      const nextFavorite = btn.dataset.favorite !== 'true';
      const { error: favoriteError } = await togglePageFavorite(btn.dataset.pageId, nextFavorite);
      if (favoriteError) {
        showToast('Failed to update favorite: ' + favoriteError.message, 'error');
        return;
      }
      renderDatabase(container);
    });
  });

  container.querySelectorAll('[data-page-id]').forEach((tr) => {
    if (tr.tagName === 'TR') {
      tr.addEventListener('click', async () => {
        const pageId = tr.getAttribute('data-page-id');
        window.location.hash = pageId ? `editor/${pageId}` : 'editor';
      });
    }
  });
}

function parseCsvRows(csv) {
  return String(csv)
    .split(/\r?\n/)
    .slice(1)
    .map((line) => {
      const cells = [];
      let cell = '';
      let quoted = false;
      for (let index = 0; index < line.length; index += 1) {
        const character = line[index];
        if (character === '"' && line[index + 1] === '"' && quoted) {
          cell += '"';
          index += 1;
        } else if (character === '"') {
          quoted = !quoted;
        } else if (character === ',' && !quoted) {
          cells.push(cell.trim());
          cell = '';
        } else {
          cell += character;
        }
      }
      cells.push(cell.trim());
      return {
        title: cells[0] || '',
        type: (cells[1] || 'note').toLowerCase(),
        status: (cells[2] || 'idea').toLowerCase(),
        tags: cells[3] || '',
        priority: (cells[4] || 'medium').toLowerCase()
      };
    });
}

function getPageProperties(page) {
  const properties = page?.content?.properties;
  return {
    status: ['idea', 'active', 'blocked', 'done'].includes(properties?.status) ? properties.status : 'idea',
    tags: Array.isArray(properties?.tags) ? properties.tags.map((tag) => String(tag)).slice(0, 10) : [],
    priority: ['low', 'medium', 'high', 'urgent'].includes(properties?.priority) ? properties.priority : 'medium'
  };
}
