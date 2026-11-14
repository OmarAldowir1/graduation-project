import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { updatePage, deletePage } from '../lib/queries.js';
import { showToast } from '../legacy/app.js';
import { requestConfirmation, requestForm } from '../lib/dialogs.js';
import { startNewPageIn } from '../lib/projectActions.js';
import { isPageDescendant, getDraggedPageId } from '../lib/sidebarTreeHelpers.js';

const NOTES_EXPANDED_KEY = 'motion-notes-expanded-folders';
const PROJECTS_EXPANDED_KEY = 'motion-projects-expanded';

// Context Menu for individual page item in sidebar
function PageContextMenu({ page, projects = [], currentProjectId, position, onClose, onAction }) {
  const menuRef = useRef(null);

  useEffect(() => {
    const handlePointer = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        onClose();
      }
    };
    const handleKey = (e) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('pointerdown', handlePointer);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('pointerdown', handlePointer);
      document.removeEventListener('keydown', handleKey);
    };
  }, [onClose]);

  const hasParent = Boolean(page.parent_id);

  return (
    <div
      ref={menuRef}
      className="sidebar-context-menu"
      style={{
        position: 'fixed',
        top: `${position.top}px`,
        left: `${position.left}px`,
        zIndex: 9999
      }}
      role="menu"
      onClick={(e) => e.stopPropagation()}
    >
      {/* Move out of folder / restore to root */}
      {hasParent && (
        <button
          type="button"
          className="sidebar-context-menu-item"
          role="menuitem"
          onClick={() => {
            onClose();
            onAction('move-out', page);
          }}
        >
          <span className="material-symbols-outlined text-[16px]">arrow_upward</span>
          <span>Move out</span>
        </button>
      )}

      {/* If inside a project, offer removing from project */}
      {currentProjectId && (
        <button
          type="button"
          className="sidebar-context-menu-item"
          role="menuitem"
          onClick={() => {
            onClose();
            onAction('remove-from-project', page);
          }}
        >
          <span className="material-symbols-outlined text-[16px]">folder_off</span>
          <span>Remove from project</span>
        </button>
      )}

      {/* Move to another project */}
      {projects.length > 0 && (
        <button
          type="button"
          className="sidebar-context-menu-item"
          role="menuitem"
          onClick={() => {
            onClose();
            onAction('move-to-project', page);
          }}
        >
          <span className="material-symbols-outlined text-[16px]">drive_file_move</span>
          <span>Move to project…</span>
        </button>
      )}

      {/* Add sub-page */}
      <button
        type="button"
        className="sidebar-context-menu-item"
        role="menuitem"
        onClick={() => {
          onClose();
          onAction('add-subpage', page);
        }}
      >
        <span className="material-symbols-outlined text-[16px]">add</span>
        <span>Add sub-page</span>
      </button>

      <div className="sidebar-context-menu-divider" />

      {/* Delete page */}
      <button
        type="button"
        className="sidebar-context-menu-item text-danger"
        role="menuitem"
        onClick={() => {
          onClose();
          onAction('delete', page);
        }}
      >
        <span className="material-symbols-outlined text-[16px]">delete</span>
        <span>Delete page</span>
      </button>
    </div>
  );
}

// Tree node representing a page (and its subpages recursively)
function SidebarPageNode({
  node,
  depth = 0,
  expandedIds,
  onToggleExpand,
  activePageId,
  allPages,
  projects,
  currentProjectId,
  onPageMoved,
  onStartDrag,
  onEndDrag,
  dragActive
}) {
  const [isDragOver, setIsDragOver] = useState(false);
  const [menuPos, setMenuPos] = useState(null);

  const hasChildren = node.children && node.children.length > 0;
  const isExpanded = expandedIds.has(node.id);
  const isActive = activePageId === node.id;

  const handleDragStart = (e) => {
    e.stopPropagation();
    e.dataTransfer.setData('application/x-page-id', node.id);
    e.dataTransfer.setData('text/plain', node.id);
    e.dataTransfer.effectAllowed = 'move';
    window.__motionDraggingPageId = node.id;
    onStartDrag?.(node.id);
  };

  const handleDragEnd = () => {
    window.__motionDraggingPageId = null;
    onEndDrag?.();
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'move';
    if (!isDragOver) setIsDragOver(true);
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!e.currentTarget.contains(e.relatedTarget)) {
      setIsDragOver(false);
    }
  };

  const handleDrop = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
    const draggedId = getDraggedPageId(e);
    if (!draggedId || draggedId === node.id) return;

    const draggedPage = allPages.find((p) => p.id === draggedId);
    if (!draggedPage) return;

    if (draggedPage.page_type === 'project') {
      showToast('Cannot nest a project inside a page', 'error');
      return;
    }

    if (isPageDescendant(node.id, draggedPage.id, allPages)) {
      showToast('Cannot move a page inside itself or one of its subpages', 'error');
      return;
    }

    const { error } = await updatePage(draggedPage.id, { parent_id: node.id });
    if (error) {
      showToast('Failed to move page: ' + error.message, 'error');
      return;
    }

    // Auto-expand this node so it becomes a folder and shows the child
    if (!isExpanded) {
      onToggleExpand(node.id);
    }

    showToast(`Moved "${draggedPage.title || 'Untitled'}" into "${node.title || 'Untitled'}"`, 'success');
    window.dispatchEvent(new CustomEvent('motion:pages-changed'));
    window.dispatchEvent(new CustomEvent('motion:page-changed', { detail: draggedPage.id }));
    onPageMoved?.();
  };

  // Restore / move out of folder
  const handleMoveOut = async (e) => {
    e?.stopPropagation();
    e?.preventDefault();
    // If inside a project and nested under another page, move to project root.
    // If in other pages, move to root (null).
    const newParentId = currentProjectId ? currentProjectId : null;
    const { error } = await updatePage(node.id, { parent_id: newParentId });
    if (error) {
      showToast('Failed to restore page: ' + error.message, 'error');
      return;
    }
    showToast(`Moved "${node.title || 'Untitled'}" to the top level`, 'success');
    window.dispatchEvent(new CustomEvent('motion:pages-changed'));
    window.dispatchEvent(new CustomEvent('motion:page-changed', { detail: node.id }));
    onPageMoved?.();
  };

  const handleAddSubpage = async (e) => {
    e?.stopPropagation();
    e?.preventDefault();
    const newPage = await startNewPageIn(node.id, { open: true });
    if (newPage) {
      if (!isExpanded) onToggleExpand(node.id);
      onPageMoved?.();
    }
  };

  const handleOpenMenu = (e) => {
    e.stopPropagation();
    e.preventDefault();
    const rect = e.currentTarget.getBoundingClientRect();
    const left = Math.min(rect.right, window.innerWidth - 220);
    setMenuPos({ top: rect.bottom + 4, left: Math.max(10, left) });
  };

  const handleAction = async (action) => {
    if (action === 'move-out') {
      handleMoveOut();
    } else if (action === 'remove-from-project') {
      const { error } = await updatePage(node.id, { parent_id: null });
      if (error) {
        showToast('Failed to remove from project: ' + error.message, 'error');
        return;
      }
      showToast(`Removed "${node.title || 'Untitled'}" from the project`, 'success');
      window.dispatchEvent(new CustomEvent('motion:pages-changed'));
      onPageMoved?.();
    } else if (action === 'move-to-project') {
      const values = await requestForm({
        title: 'Move page to project',
        description: `Select target project for "${node.title || 'Untitled'}"`,
        submitLabel: 'Move',
        fields: [
          {
            name: 'projectId',
            label: 'Project',
            type: 'select',
            value: currentProjectId || '',
            options: [
              { value: '', label: 'None (Other pages)' },
              ...projects.map((p) => ({
                value: p.id,
                label: `${p.icon || '📁'} ${p.title || 'Untitled project'}`
              }))
            ]
          }
        ]
      });
      if (values) {
        const targetId = values.projectId || null;
        const { error } = await updatePage(node.id, { parent_id: targetId });
        if (error) {
          showToast('Failed to move page: ' + error.message, 'error');
          return;
        }
        showToast('Page moved successfully', 'success');
        window.dispatchEvent(new CustomEvent('motion:pages-changed'));
        onPageMoved?.();
      }
    } else if (action === 'add-subpage') {
      handleAddSubpage();
    } else if (action === 'delete') {
      const confirmed = await requestConfirmation(`Delete page "${node.title || 'Untitled'}"? Sub-pages will also be deleted.`);
      if (confirmed) {
        const { error } = await deletePage(node.id);
        if (error) {
          showToast('Failed to delete page: ' + error.message, 'error');
          return;
        }
        showToast('Page deleted', 'success');
        window.dispatchEvent(new CustomEvent('motion:pages-changed'));
        onPageMoved?.();
        if (window.location.hash.includes(node.id)) {
          window.location.hash = currentProjectId ? `project/${currentProjectId}` : 'notes';
        }
      }
    }
  };

  return (
    <div className="sidebar-tree-node">
      <div
        draggable
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={`sidebar-tree-item ${isActive ? 'is-active' : ''} ${isDragOver ? 'drag-over' : ''}`}
        style={{ paddingLeft: `${depth * 0.75 + 0.35}rem` }}
      >
        {/* Expand / collapse chevron button */}
        {hasChildren ? (
          <button
            type="button"
            className="sidebar-chevron-btn"
            onClick={(e) => {
              e.stopPropagation();
              e.preventDefault();
              onToggleExpand(node.id);
            }}
            title={isExpanded ? 'Collapse folder' : 'Expand folder'}
          >
            <span className={`material-symbols-outlined text-[15px] note-folder-arrow ${isExpanded ? 'is-expanded rotate-90' : ''}`}>
              chevron_right
            </span>
          </button>
        ) : (
          <span className="sidebar-chevron-placeholder" />
        )}

        {/* Page link & icon */}
        <a
          href={`#editor/${node.id}`}
          draggable={false}
          className="sidebar-tree-link"
          title={node.title || 'Untitled'}
        >
          {hasChildren ? (
            <span className="material-symbols-outlined text-[15px] text-amber-500 flex-shrink-0">
              {isExpanded ? 'folder_open' : 'folder'}
            </span>
          ) : (
            <span className="material-symbols-outlined text-[15px] opacity-70 flex-shrink-0">
              {node.page_type === 'kanban' ? 'view_kanban' : node.page_type === 'database' ? 'table_chart' : 'description'}
            </span>
          )}
          <span className="truncate flex-1 font-normal">
            {node.title || 'Untitled'}
          </span>
        </a>

        {/* Hover action buttons */}
        <div className="sidebar-item-actions">
          {/* Option to restore / move out if it is nested */}
          {node.parent_id && (
            <button
              type="button"
              className="sidebar-action-btn"
              onClick={handleMoveOut}
              title="Move out of folder"
            >
              <span className="material-symbols-outlined text-[14px]">arrow_upward</span>
            </button>
          )}

          {/* Add subpage button */}
          <button
            type="button"
            className="sidebar-action-btn"
            onClick={handleAddSubpage}
            title="Add sub-page"
          >
            <span className="material-symbols-outlined text-[14px]">add</span>
          </button>

          {/* Context menu button */}
          <button
            type="button"
            className="sidebar-action-btn"
            onClick={handleOpenMenu}
            title="More options"
          >
            <span className="material-symbols-outlined text-[14px]">more_vert</span>
          </button>
        </div>
      </div>

      {/* Context Menu Popup */}
      {menuPos && (
        <PageContextMenu
          page={node}
          projects={projects}
          currentProjectId={currentProjectId}
          position={menuPos}
          onClose={() => setMenuPos(null)}
          onAction={handleAction}
        />
      )}

      {/* Nested children */}
      {hasChildren && isExpanded && (
        <div className="sidebar-tree-children">
          {node.children.map((child) => (
            <SidebarPageNode
              key={child.id}
              node={child}
              depth={depth + 1}
              expandedIds={expandedIds}
              onToggleExpand={onToggleExpand}
              activePageId={activePageId}
              allPages={allPages}
              projects={projects}
              currentProjectId={currentProjectId}
              onPageMoved={onPageMoved}
              onStartDrag={onStartDrag}
              onEndDrag={onEndDrag}
              dragActive={dragActive}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// Full page tree for a section (Other pages OR inside a Project)
export function SidebarTree({
  pages = [],
  allPages = [],
  projects = [],
  activePageId,
  currentProjectId = null,
  onPageMoved,
  showRootDropZone = true
}) {
  const [expandedIds, setExpandedIds] = useState(() => {
    try {
      const raw = localStorage.getItem(NOTES_EXPANDED_KEY);
      return raw ? new Set(JSON.parse(raw)) : new Set();
    } catch {
      return new Set();
    }
  });

  const [dragActive, setDragActive] = useState(false);
  const [rootDragOver, setRootDragOver] = useState(false);

  useEffect(() => {
    const start = () => setDragActive(true);
    const end = () => {
      setDragActive(false);
      setRootDragOver(false);
    };
    window.addEventListener('motion:page-drag-start', start);
    window.addEventListener('motion:page-drag-end', end);
    window.addEventListener('dragend', end);
    window.addEventListener('drop', end);
    return () => {
      window.removeEventListener('motion:page-drag-start', start);
      window.removeEventListener('motion:page-drag-end', end);
      window.removeEventListener('dragend', end);
      window.removeEventListener('drop', end);
    };
  }, []);

  const toggleExpand = useCallback((id) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      try {
        localStorage.setItem(NOTES_EXPANDED_KEY, JSON.stringify([...next]));
      } catch {
        // ignore
      }
      return next;
    });
  }, []);

  // Build tree hierarchy for these pages
  const hierarchy = useMemo(() => {
    const map = new Map();
    pages.forEach((p) => map.set(p.id, { ...p, children: [] }));
    const roots = [];
    pages.forEach((p) => {
      const node = map.get(p.id);
      // If parent is within this set of pages, attach as child
      if (p.parent_id && map.has(p.parent_id)) {
        map.get(p.parent_id).children.push(node);
      } else {
        roots.push(node);
      }
    });
    return roots;
  }, [pages]);

  const handleRootDrop = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    setRootDragOver(false);
    const draggedId = getDraggedPageId(e);
    if (!draggedId) return;

    const draggedPage = allPages.find((p) => p.id === draggedId);
    if (!draggedPage) return;

    // Target parent for root in this tree:
    // If in a project, root parent is the project id.
    // If in Other pages, root parent is null.
    const newParentId = currentProjectId ? currentProjectId : null;

    if (draggedPage.parent_id === newParentId) return;

    const { error } = await updatePage(draggedPage.id, { parent_id: newParentId });
    if (error) {
      showToast('Failed to move page: ' + error.message, 'error');
      return;
    }

    showToast(
      newParentId
        ? 'Page moved to the top level of the project'
        : 'Page moved to the top level of Other pages',
      'success'
    );
    window.dispatchEvent(new CustomEvent('motion:pages-changed'));
    window.dispatchEvent(new CustomEvent('motion:page-changed', { detail: draggedPage.id }));
    onPageMoved?.();
  };

  return (
    <div className="sidebar-tree-container">
      {/* Root drop zone when dragging */}
      {showRootDropZone && dragActive && (
        <div
          onDragOver={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setRootDragOver(true);
          }}
          onDragLeave={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget)) setRootDragOver(false);
          }}
          onDrop={handleRootDrop}
          className={`sidebar-drop-zone ${rootDragOver ? 'drag-over' : ''}`}
          title="Drop here to move to the top level"
        >
          <span className="material-symbols-outlined text-sm">drive_file_move</span>
          <span className="truncate">Drop here to move to the top level</span>
        </div>
      )}

      {hierarchy.length === 0 ? (
        <p className="sidebar-hint" style={{ padding: '4px 8px', fontSize: '11.5px' }}>
          {currentProjectId ? 'No pages in this project yet' : 'No pages yet'}
        </p>
      ) : (
        hierarchy.map((rootNode) => (
          <SidebarPageNode
            key={rootNode.id}
            node={rootNode}
            depth={0}
            expandedIds={expandedIds}
            onToggleExpand={toggleExpand}
            activePageId={activePageId}
            allPages={allPages}
            projects={projects}
            currentProjectId={currentProjectId}
            onPageMoved={onPageMoved}
            onStartDrag={() => setDragActive(true)}
            onEndDrag={() => setDragActive(false)}
            dragActive={dragActive}
          />
        ))
      )}
    </div>
  );
}

// Projects Section in Sidebar: Expandable projects with nested pages & drop target
export function SidebarProjectsList({
  projects = [],
  allPages = [],
  projectIndex,
  activeProjectId,
  activePageId,
  onPageMoved
}) {
  const [expandedProjects, setExpandedProjects] = useState(() => {
    try {
      const raw = localStorage.getItem(PROJECTS_EXPANDED_KEY);
      return raw ? new Set(JSON.parse(raw)) : new Set();
    } catch {
      return new Set();
    }
  });

  const [dragOverProjectId, setDragOverProjectId] = useState(null);

  const toggleProject = (projectId, e) => {
    e?.stopPropagation();
    e?.preventDefault();
    setExpandedProjects((prev) => {
      const next = new Set(prev);
      if (next.has(projectId)) next.delete(projectId);
      else next.add(projectId);
      try {
        localStorage.setItem(PROJECTS_EXPANDED_KEY, JSON.stringify([...next]));
      } catch {
        // ignore
      }
      return next;
    });
  };

  const handleDragOver = (e, projectId) => {
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'move';
    if (dragOverProjectId !== projectId) setDragOverProjectId(projectId);
  };

  const handleDragLeave = (e, projectId) => {
    e.preventDefault();
    e.stopPropagation();
    if (!e.currentTarget.contains(e.relatedTarget)) {
      if (dragOverProjectId === projectId) setDragOverProjectId(null);
    }
  };

  const handleDropOnProject = async (e, projectId) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOverProjectId(null);
    const draggedId = getDraggedPageId(e);
    if (!draggedId || draggedId === projectId) return;

    const draggedPage = allPages.find((p) => p.id === draggedId);
    const targetProject = projects.find((p) => p.id === projectId);
    if (!draggedPage || !targetProject) return;

    if (draggedPage.page_type === 'project') {
      showToast('Cannot nest a project inside another project', 'error');
      return;
    }

    if (isPageDescendant(targetProject.id, draggedPage.id, allPages)) {
      showToast('Cannot move a page inside its own descendant', 'error');
      return;
    }

    const { error } = await updatePage(draggedPage.id, { parent_id: projectId });
    if (error) {
      showToast('Failed to add page to project: ' + error.message, 'error');
      return;
    }

    // Auto-expand the project so the user sees the page inside it!
    setExpandedProjects((prev) => {
      const next = new Set(prev);
      next.add(projectId);
      try {
        localStorage.setItem(PROJECTS_EXPANDED_KEY, JSON.stringify([...next]));
      } catch {
        // ignore
      }
      return next;
    });

    showToast(`Added "${draggedPage.title || 'Untitled'}" to the project "${targetProject.title || 'Untitled'}"`, 'success');
    window.dispatchEvent(new CustomEvent('motion:pages-changed'));
    window.dispatchEvent(new CustomEvent('motion:page-changed', { detail: draggedPage.id }));
    onPageMoved?.();
  };

  const handleAddPageToProject = async (projectId, e) => {
    e?.stopPropagation();
    e?.preventDefault();
    const newPage = await startNewPageIn(projectId, { open: true });
    if (newPage) {
      setExpandedProjects((prev) => {
        const next = new Set(prev);
        next.add(projectId);
        try {
          localStorage.setItem(PROJECTS_EXPANDED_KEY, JSON.stringify([...next]));
        } catch {
          // ignore
        }
        return next;
      });
      onPageMoved?.();
    }
  };

  return (
    <div className="sidebar-projects-list space-y-1">
      {projects.map((project) => {
        const isExpanded = expandedProjects.has(project.id);
        const isActive = activeProjectId === project.id;
        const isDragOver = dragOverProjectId === project.id;

        // Pages belonging to this project
        const projectPages = allPages.filter(
          (p) => projectIndex?.get(p.id) === project.id && p.id !== project.id
        );

        return (
          <div key={project.id} className="sidebar-project-group">
            <div
              className={`sidebar-project-header sidebar-link sidebar-project ${isActive ? 'is-active' : ''} ${isDragOver ? 'drag-over' : ''}`}
              onDragOver={(e) => handleDragOver(e, project.id)}
              onDragLeave={(e) => handleDragLeave(e, project.id)}
              onDrop={(e) => handleDropOnProject(e, project.id)}
            >
              {/* Expand / collapse chevron */}
              <button
                type="button"
                className="sidebar-chevron-btn"
                onClick={(e) => toggleProject(project.id, e)}
                title={isExpanded ? 'Collapse project pages' : 'Expand project pages'}
              >
                <span className={`material-symbols-outlined text-[15px] note-folder-arrow ${isExpanded ? 'is-expanded rotate-90' : ''}`}>
                  chevron_right
                </span>
              </button>

              {/* Project title and icon */}
              <a
                href={`#project/${project.id}`}
                className="sidebar-tree-link"
                title={project.title || 'Untitled project'}
              >
                <span className="sidebar-emoji">{project.icon || '📁'}</span>
                <span className="truncate flex-1">{project.title || 'Untitled project'}</span>
              </a>

              {/* Quick actions on project row */}
              <div className="sidebar-item-actions">
                <button
                  type="button"
                  className="sidebar-action-btn"
                  onClick={(e) => handleAddPageToProject(project.id, e)}
                  title="Add page to project"
                >
                  <span className="material-symbols-outlined text-[14px]">add</span>
                </button>
              </div>
            </div>

            {/* Nested pages tree under this project */}
            {isExpanded && (
              <div className="sidebar-project-pages" style={{ marginLeft: '12px', paddingLeft: '4px', borderLeft: '1px solid rgba(245, 247, 248, 0.1)' }}>
                <SidebarTree
                  pages={projectPages}
                  allPages={allPages}
                  projects={projects}
                  activePageId={activePageId}
                  currentProjectId={project.id}
                  onPageMoved={onPageMoved}
                  showRootDropZone={false}
                />
                {projectPages.length === 0 && (
                  <button
                    type="button"
                    onClick={(e) => handleAddPageToProject(project.id, e)}
                    className="sidebar-tree-empty-add-btn"
                  >
                    <span className="material-symbols-outlined text-xs">add</span>
                    <span>Add a page to this project</span>
                  </button>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
