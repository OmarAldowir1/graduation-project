import { requestInput } from "./lib/dialogs.js";
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, showToast } from './legacy/app.js';
import { getSession, onAuthStateChange, supabase } from './lib/supabase.js';
import { isSupabaseConfigured } from './lib/config.js';
import { escapeHtml } from './lib/sanitize.js';
import {
  createPage,
  createTask,
  getUserProfile,
  getSettings,
  updateSettings,
  getWorkspaces,
  getRecentPages,
  getPages,
  updatePage,
  getTasks,
  getNotifications,
  markNotificationRead,
  markAllNotificationsRead,
  acceptWorkspaceInvitation,
  createWorkspace
} from './lib/queries.js';
import Login, { PasswordReset } from './components/Login.jsx';
import TeamChat from './components/TeamChat.jsx';
import AIChatView from './components/AIChatView.jsx';
import AIPageSidebar from './components/AIPageSidebar.jsx';
import NotionAIFace from './components/NotionAIFace.jsx';
import Modal, { PromptDialog } from './components/Modal.jsx';
import { getStoredChats, createNewAIChat, deleteAIChat, formatChatDate } from './lib/aiChatStore.js';
import './App.css';
import './ui-refresh.css';

import { renderDashboard } from './legacy/pages/dashboard.js';
import { renderNotes } from './legacy/pages/notes.js';
import { renderEditor } from './legacy/pages/editor.js';
import { renderKanban } from './legacy/pages/kanban.js';
import { renderDatabase } from './legacy/pages/database.js';
import { renderSettings } from './legacy/pages/settings.js';
import { renderProfile } from './legacy/pages/profile.js';

function parseHash() {
  const raw = window.location.hash.startsWith('#')
    ? window.location.hash.slice(1)
    : window.location.hash;

  const safe = raw || 'dashboard';
  if (/(^|&)type=recovery(?:&|$)/.test(safe) || safe.startsWith('access_token=')) {
    return { raw: safe, path: 'reset-password', segments: [], query: new URLSearchParams(safe.replace(/^\?/, '')) };
  }
  const [pathPart, queryPart] = safe.split('?');
  const parts = (pathPart || 'dashboard').split('/').filter(Boolean);
  const path = parts[0] || 'dashboard';
  const segments = parts.slice(1);
  const query = new URLSearchParams(queryPart || '');
  return { raw: safe, path, segments, query };
}

function LegacyRenderer({ renderer, routeKey, route }) {
  const ref = useRef(null);

  useEffect(() => {
    if (!renderer || !ref.current) return;

    ref.current.innerHTML = `
      <div class="loading-overlay" style="position:relative; min-height:60vh;">
        <div class="loading-spinner"></div>
      </div>
    `;

    Promise.resolve()
      .then(() => renderer(ref.current, route))
      .catch((err) => {
        console.error('Legacy render error:', err);
        ref.current.innerHTML = `
          <div class="error-state" style="margin:2rem;">
            <span class="material-symbols-outlined" style="font-size:2.5rem; margin-bottom:0.5rem;">error</span>
            <h3 style="font-weight:600; margin-bottom:0.25rem;">Something went wrong</h3>
            <p style="font-size:0.875rem; opacity:0.7;">${escapeHtml(err?.message || String(err))}</p>
          </div>
        `;
      });
    // routeKey changes whenever the route changes; keeping the dependency shape stable also avoids HMR hook warnings.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [renderer, routeKey]);

  return <div ref={ref} />;
}

function SearchPalette({ isOpen, query, setQuery, results, loading, onClose, onSelect, onAction }) {
  const [activeIndex, setActiveIndex] = useState(0);
  const safeActiveIndex = results.length ? Math.min(activeIndex, results.length - 1) : 0;

  if (!isOpen) return null;

  return (
    <div className="command-palette-backdrop" role="presentation" onClick={onClose}>
      <section
        className="command-palette"
        role="dialog"
        aria-modal="true"
        aria-label="Search workspace"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="command-palette-search">
          <span className="material-symbols-outlined" aria-hidden="true">search</span>
          <input
            autoFocus
            value={query}
            onChange={(event) => {
              setActiveIndex(0);
              setQuery(event.target.value);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Escape') onClose();
              if (event.key === 'ArrowDown' && results.length) {
                event.preventDefault();
                setActiveIndex((index) => (index + 1) % results.length);
              }
              if (event.key === 'ArrowUp' && results.length) {
                event.preventDefault();
                setActiveIndex((index) => (index - 1 + results.length) % results.length);
              }
              if (event.key === 'Enter' && results[safeActiveIndex]) onSelect(results[safeActiveIndex]);
            }}
            placeholder="Search pages and tasks..."
            aria-label="Search pages and tasks"
          />
          <kbd>Esc</kbd>
        </div>

        <div className="command-palette-results">
          {loading ? <p className="command-palette-empty">Searching your workspace...</p> : null}
          {!loading && query.trim() && results.length === 0 ? (
            <p className="command-palette-empty">No matching pages or tasks.</p>
          ) : null}
          {!loading && !query.trim() ? (
            <>
              <p className="command-palette-empty">Type to search your workspace.</p>
              <div className="command-palette-actions">
                <button type="button" className="command-palette-result" onClick={() => onAction('new-page')}>
                  <span className="material-symbols-outlined">add</span><span className="command-palette-result-copy"><strong>New page</strong><small>Create from a template</small></span>
                </button>
                <button type="button" className="command-palette-result" onClick={() => onAction('notes')}>
                  <span className="material-symbols-outlined">description</span><span className="command-palette-result-copy"><strong>Open Notes</strong><small>Browse your pages</small></span>
                </button>
                <button type="button" className="command-palette-result" onClick={() => onAction('kanban')}>
                  <span className="material-symbols-outlined">view_kanban</span><span className="command-palette-result-copy"><strong>Open Kanban</strong><small>Manage tasks</small></span>
                </button>
                <button type="button" className="command-palette-result" onClick={() => onAction('database')}>
                  <span className="material-symbols-outlined">local_library</span><span className="command-palette-result-copy"><strong>Open Library</strong><small>Browse workspace library</small></span>
                </button>
                <button type="button" className="command-palette-result" onClick={() => onAction('new-task')}>
                  <span className="material-symbols-outlined">add_task</span><span className="command-palette-result-copy"><strong>New task</strong><small>Add work to Kanban</small></span>
                </button>
              </div>
            </>
          ) : null}
          {results.map((result, index) => (
            <button
              key={`${result.type}-${result.id}`}
              className={`command-palette-result ${index === safeActiveIndex ? 'command-palette-result-active' : ''}`}
              aria-selected={index === safeActiveIndex}
              type="button"
              onClick={() => onSelect(result)}
            >
              <span className="material-symbols-outlined" aria-hidden="true">
                {result.type === 'task' ? 'check_circle' : 'description'}
              </span>
              <span className="command-palette-result-copy">
                <strong>{result.title || 'Untitled'}</strong>
                <small>{result.type === 'task' ? 'Task' : 'Page'}</small>
              </span>
              <span className="material-symbols-outlined" aria-hidden="true">arrow_forward</span>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}

function PageCreationDialog({ isOpen, onClose, onSubmit }) {
  const [title, setTitle] = useState('');
  const [template, setTemplate] = useState('blank');

  useEffect(() => {
    if (!isOpen) return undefined;
    const timer = window.setTimeout(() => {
      setTitle('');
      setTemplate('blank');
    }, 0);
    return () => window.clearTimeout(timer);
  }, [isOpen]);

  const templates = {
    blank: { label: 'Blank note', pageType: 'note', content: {} },
    meeting: { label: 'Meeting notes', pageType: 'note', content: { html: '<h2>Meeting notes</h2><p><strong>Date:</strong> </p><h3>Agenda</h3><ul><li></li></ul><h3>Decisions</h3><p></p><h3>Action items</h3><ul><li></li></ul>' } },
    brief: { label: 'Project brief', pageType: 'document', content: { html: '<h2>Project brief</h2><p><strong>Objective:</strong> </p><h3>Context</h3><p></p><h3>Scope</h3><ul><li></li></ul><h3>Success metrics</h3><ul><li></li></ul>' } },
    board: { label: 'Kanban board', pageType: 'kanban', content: { html: '<h2>Project board</h2><p>Use the Kanban view to track this work from idea to done.</p>' } },
    database: { label: 'Project database', pageType: 'database', content: { html: '<h2>Project database</h2><p>Add pages below as rows and filter them by type or status.</p>' } }
  };

  const selected = templates[template];
  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Create New Page"
      footer={
        <>
          <button className="modal-btn-secondary" type="button" onClick={onClose}>Cancel</button>
          <button className="modal-btn-primary" type="button" disabled={!title.trim()} onClick={() => { onSubmit(title.trim(), selected); onClose(); }}>Create page</button>
        </>
      }
    >
      <form onSubmit={(event) => { event.preventDefault(); if (title.trim()) { onSubmit(title.trim(), selected); onClose(); } }}>
        <label className="modal-label" htmlFor="new-page-title">Page title</label>
        <input id="new-page-title" className="modal-input" value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Page title..." autoFocus />
        <label className="modal-label" htmlFor="new-page-template">Start with a template</label>
        <select id="new-page-template" className="modal-input" value={template} onChange={(event) => setTemplate(event.target.value)}>
          {Object.entries(templates).map(([key, item]) => <option key={key} value={key}>{item.label}</option>)}
        </select>
        <p className="modal-help">You can edit or replace the starter content at any time.</p>
      </form>
    </Modal>
  );
}

function updateNavActiveState(activeRoute) {
  const navLinks = document.querySelectorAll('[data-nav-route]');
  navLinks.forEach((link) => {
    const route = link.getAttribute('data-nav-route');
    if (route === activeRoute) {
      link.className =
        'flex items-center gap-3 px-3 py-2 bg-white dark:bg-stone-800 text-[#2d3433] dark:text-stone-100 font-semibold rounded-md shadow-sm transition-colors duration-200';
    } else {
      link.className =
        'flex items-center gap-3 px-3 py-2 text-[#5a6060] dark:text-stone-400 hover:bg-[#e8ebea] dark:hover:bg-stone-800/50 rounded-md transition-colors duration-200';
    }
  });
}

// ============================================
// Theme Management
// ============================================
function getInitialTheme() {
  const saved = localStorage.getItem('motion-theme');
  if (saved === 'dark' || saved === 'light') return saved;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function applyTheme(theme) {
  const html = document.documentElement;
  if (theme === 'dark') {
    html.classList.add('dark');
    html.classList.remove('light');
  } else {
    html.classList.add('light');
    html.classList.remove('dark');
  }
  localStorage.setItem('motion-theme', theme);
}

function isPageDescendant(candidateId, ancestorId, pages) {
  const byId = new Map(pages.map((page) => [page.id, page]));
  const seen = new Set();
  let current = byId.get(candidateId);
  while (current?.parent_id && !seen.has(current.id)) {
    if (current.parent_id === ancestorId) return true;
    seen.add(current.id);
    current = byId.get(current.parent_id);
  }
  return false;
}

function SidebarNotesTree({ pages, searchQuery, onPageMoved }) {
  const [expandedIds, setExpandedIds] = useState(() => {
    try {
      const raw = localStorage.getItem('motion-notes-expanded-folders');
      return raw ? new Set(JSON.parse(raw)) : new Set();
    } catch {
      return new Set();
    }
  });

  const [dragOverId, setDragOverId] = useState(null);
  const [rootDragOver, setRootDragOver] = useState(false);

  const toggleFolder = useCallback((folderId, e) => {
    e?.stopPropagation();
    e?.preventDefault();
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(folderId)) {
        next.delete(folderId);
      } else {
        next.add(folderId);
      }
      try {
        localStorage.setItem('motion-notes-expanded-folders', JSON.stringify([...next]));
      } catch {
        // Ignore
      }
      return next;
    });
  }, []);

  const hierarchy = useMemo(() => {
    const map = new Map();
    pages.forEach((p) => map.set(p.id, { ...p, children: [] }));
    const roots = [];
    pages.forEach((p) => {
      const node = map.get(p.id);
      if (p.parent_id && map.has(p.parent_id)) {
        map.get(p.parent_id).children.push(node);
      } else {
        roots.push(node);
      }
    });
    return roots;
  }, [pages]);

  const handleDragStart = (e, pageId) => {
    e.dataTransfer.setData('text/plain', pageId);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e, targetId) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (dragOverId !== targetId) setDragOverId(targetId);
  };

  const handleDragLeave = (e, targetId) => {
    if (dragOverId === targetId) setDragOverId(null);
  };

  const handleDrop = async (e, targetId) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOverId(null);
    const draggedId = e.dataTransfer.getData('text/plain');
    if (!draggedId || draggedId === targetId) return;

    const draggedPage = pages.find((p) => p.id === draggedId);
    const targetPage = pages.find((p) => p.id === targetId);
    if (!draggedPage || !targetPage) return;

    if (isPageDescendant(targetPage.id, draggedPage.id, pages)) {
      showToast('Cannot move a folder inside itself or one of its subpages', 'error');
      return;
    }

    const { error } = await updatePage(draggedPage.id, { parent_id: targetPage.id });
    if (error) {
      showToast('Failed to move page: ' + error.message, 'error');
      return;
    }

    setExpandedIds((prev) => {
      const next = new Set(prev);
      next.add(targetId);
      try {
        localStorage.setItem('motion-notes-expanded-folders', JSON.stringify([...next]));
      } catch {
        // Ignore
      }
      return next;
    });

    showToast(`Moved page into "${targetPage.title || 'Untitled'}" successfully`, 'success');
    window.dispatchEvent(new CustomEvent('motion:page-changed', { detail: draggedPage.id }));
    onPageMoved?.();
  };

  const handleRootDrop = async (e) => {
    e.preventDefault();
    setRootDragOver(false);
    const draggedId = e.dataTransfer.getData('text/plain');
    const draggedPage = pages.find((p) => p.id === draggedId);
    if (!draggedPage || !draggedPage.parent_id) return;

    const { error } = await updatePage(draggedPage.id, { parent_id: null });
    if (error) {
      showToast('Failed to move page: ' + error.message, 'error');
      return;
    }
    showToast('Moved page to root level', 'success');
    window.dispatchEvent(new CustomEvent('motion:page-changed', { detail: draggedPage.id }));
    onPageMoved?.();
  };

  const renderNode = (node, depth = 0) => {
    const hasChildren = node.children && node.children.length > 0;
    const isExpanded = expandedIds.has(node.id);
    const isNested = depth > 0;
    const isDragOver = dragOverId === node.id;

    const term = searchQuery.trim().toLowerCase();
    const matchesSearch = !term || (node.title || '').toLowerCase().includes(term);
    const hasMatchingChild =
      term &&
      (function checkMatch(n) {
        return (n.children || []).some((c) => (c.title || '').toLowerCase().includes(term) || checkMatch(c));
      })(node);

    if (term && !matchesSearch && !hasMatchingChild) {
      return null;
    }

    return (
      <div key={node.id} className="w-full">
        <div
          draggable
          onDragStart={(e) => handleDragStart(e, node.id)}
          onDragOver={(e) => handleDragOver(e, node.id)}
          onDragLeave={(e) => handleDragLeave(e, node.id)}
          onDrop={(e) => handleDrop(e, node.id)}
          className={`flex items-center gap-1.5 px-2 py-1.5 rounded-md transition-all duration-150 group cursor-pointer ${isDragOver ? 'ring-2 ring-primary bg-primary/10' : 'hover:bg-surface-container-high'
            } ${isNested ? 'text-[11px] text-on-surface-variant' : 'text-xs text-on-surface-variant font-medium'}`}
          style={{ paddingLeft: `${depth * 0.75 + 0.35}rem` }}
        >
          {hasChildren ? (
            <button
              type="button"
              onClick={(e) => toggleFolder(node.id, e)}
              className="p-0.5 -ml-1 text-on-surface-variant/70 hover:text-on-surface flex items-center justify-center flex-shrink-0"
              title={isExpanded ? 'Collapse folder' : 'Expand folder'}
            >
              <span className={`material-symbols-outlined text-[15px] note-folder-arrow ${isExpanded ? 'is-expanded rotate-90' : ''}`}>
                chevron_right
              </span>
            </button>
          ) : (
            <span className="w-3.5 h-3.5 flex-shrink-0 -ml-1" />
          )}

          <a
            href={`#editor/${node.id}`}
            className="flex items-center gap-1.5 flex-1 min-w-0 text-inherit hover:text-on-surface no-underline"
          >
            {hasChildren ? (
              <span className="material-symbols-outlined text-amber-500 text-[15px] flex-shrink-0">
                {isExpanded ? 'folder_open' : 'folder'}
              </span>
            ) : (
              <span className="material-symbols-outlined text-[14px] opacity-70 flex-shrink-0">
                {node.page_type === 'kanban' ? 'view_kanban' : node.page_type === 'database' ? 'local_library' : 'description'}
              </span>
            )}
            <span className={`truncate flex-1 ${isNested ? 'text-[11px] font-normal' : 'text-xs font-medium'}`}>
              {node.title || 'Untitled'}
            </span>
          </a>
        </div>

        {hasChildren && (isExpanded || term) && (
          <div className="border-l border-outline-variant/15 ml-2.5 pl-1 space-y-0.5">
            {node.children.map((child) => renderNode(child, depth + 1))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-1">
      {/* Root drop zone */}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setRootDragOver(true);
        }}
        onDragLeave={() => setRootDragOver(false)}
        onDrop={handleRootDrop}
        className={`px-2 py-1.5 text-[10px] uppercase tracking-wider rounded-md border border-dashed transition-all flex items-center gap-1.5 cursor-pointer ${rootDragOver ? 'border-primary bg-primary/10 text-primary' : 'border-outline-variant/30 text-on-surface-variant/60'
          }`}
        title="Drop here to move page to root level"
      >
        <span className="material-symbols-outlined text-xs">drive_file_move</span>
        <span className="truncate">Root pages (Drop here to un-nest)</span>
      </div>

      {hierarchy.length === 0 ? (
        <p className="text-xs text-on-surface-variant/60 py-4 text-center">No pages found</p>
      ) : (
        hierarchy.map((rootNode) => renderNode(rootNode, 0))
      )}
    </div>
  );
}

export default function App() {
  const [route, setRoute] = useState(() => parseHash());
  const [isBootstrapping, setIsBootstrapping] = useState(true);
  const [breadcrumb, setBreadcrumb] = useState(() => (parseHash().path === 'ai-chat' ? 'AI Chat' : 'Dashboard'));
  const [toast, setToast] = useState(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  useEffect(() => {
    if (!sidebarOpen) return;
    const closeOnEscape = (event) => {
      if (event.key === 'Escape') setSidebarOpen(false);
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [sidebarOpen]);
  const [theme, setTheme] = useState(getInitialTheme);
  const [notifOpen, setNotifOpen] = useState(false);
  const [recentActivity, setRecentActivity] = useState([]);
  const [notifications, setNotifications] = useState([]);
  const [onlineMemberCount, setOnlineMemberCount] = useState(0);
  const [isOffline, setIsOffline] = useState(() => typeof navigator !== 'undefined' && !navigator.onLine);
  const [newPageModalOpen, setNewPageModalOpen] = useState(false);
  const [newWorkspaceModalOpen, setNewWorkspaceModalOpen] = useState(false);
  useEffect(() => {
    const openNewPage = () => setNewPageModalOpen(true);
    window.addEventListener('motion:open-new-page', openNewPage);
    return () => window.removeEventListener('motion:open-new-page', openNewPage);
  }, []);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searchLoading, setSearchLoading] = useState(false);

  // AI Chat Sidebar States
  const [isAISidebarOpen, setIsAISidebarOpen] = useState(false);
  const [aiChats, setAiChats] = useState(getStoredChats);
  const [activeAIChatId, setActiveAIChatId] = useState(() => {
    const hash = parseHash();
    return hash.query.get('id') || getStoredChats()[0]?.id || null;
  });
  const [sidebarMode, setSidebarMode] = useState(() => (parseHash().path === 'ai-chat' ? 'ai-chat' : 'pages'));
  const [aiChatSearchOpen, setAiChatSearchOpen] = useState(false);
  const [aiChatSearchQuery, setAiChatSearchQuery] = useState('');
  const [inviteCardDismissed, setInviteCardDismissed] = useState(false);
  const [sidebarPages, setSidebarPages] = useState([]);
  const [notesSearchQuery, setNotesSearchQuery] = useState('');

  // Force re-render when AppState changes
  const [appVersion, forceUpdate] = useState(0);

  // Sync workspace pages for sidebar notes drawer
  useEffect(() => {
    if (!AppState.workspace?.id) return;
    getPages(AppState.workspace.id).then(({ data }) => {
      if (data) setSidebarPages(data);
    });
  }, [AppState.workspace?.id, appVersion]);

  const routeKey = useMemo(() => `${route.raw}:${AppState.workspace?.id || ''}:${appVersion}`, [route.raw, appVersion]);

  const renderer = useMemo(() => {
    const map = {
      dashboard: renderDashboard,
      notes: renderNotes,
      editor: renderEditor,
      kanban: renderKanban,
      database: renderDatabase,
      settings: renderSettings,
      profile: renderProfile
    };
    return map[route.path] || renderDashboard;
  }, [route.path]);

  const showShell = !['login', 'reset-password'].includes(route.path);

  // Apply theme on mount and changes
  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  useEffect(() => {
    const handleOffline = () => {
      setIsOffline(true);
      showToast('You are offline. Changes may not sync until you reconnect.', 'error');
    };
    const handleOnline = () => {
      setIsOffline(false);
      showToast('Connection restored.', 'success');
    };
    window.addEventListener('offline', handleOffline);
    window.addEventListener('online', handleOnline);
    return () => {
      window.removeEventListener('offline', handleOffline);
      window.removeEventListener('online', handleOnline);
    };
  }, []);

  const toggleTheme = useCallback(() => {
    setTheme((prev) => {
      const next = prev === 'dark' ? 'light' : 'dark';
      // Also save to Supabase if logged in
      if (AppState.user?.id) {
        updateSettings(AppState.user.id, { theme: next }).catch(() => { });
      }
      return next;
    });
  }, []);

  const currentUserId = AppState.user?.id || null;
  const currentWorkspaceId = AppState.workspace?.id || null;
  useEffect(() => {
    if (!currentUserId) return undefined;
    const channel = supabase
      .channel(`motion-live-${currentUserId}-${currentWorkspaceId || 'none'}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'notifications', filter: `recipient_id=eq.${currentUserId}` },
        (payload) => setNotifications((current) => [payload.new, ...current.filter((item) => item.id !== payload.new.id)].slice(0, 25))
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'pages', ...(currentWorkspaceId ? { filter: `workspace_id=eq.${currentWorkspaceId}` } : {}) },
        (payload) => {
          window.dispatchEvent(new CustomEvent('motion:page-changed', { detail: payload.new?.id || payload.old?.id || null }));
          if (parseHash().path !== 'editor') forceUpdate((value) => value + 1);
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'tasks', ...(currentWorkspaceId ? { filter: `workspace_id=eq.${currentWorkspaceId}` } : {}) },
        () => {
          if (parseHash().path !== 'editor') forceUpdate((value) => value + 1);
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'comments' },
        (payload) => {
          window.dispatchEvent(new CustomEvent('motion:comments-changed', { detail: payload.new?.page_id || payload.old?.page_id || null }));
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [currentUserId, currentWorkspaceId]);

  useEffect(() => {
    if (!isSupabaseConfigured || !currentUserId || !currentWorkspaceId) {
      return undefined;
    }
    const presenceChannel = supabase.channel(`motion-presence-${currentWorkspaceId}`, {
      config: { presence: { key: currentUserId } }
    });
    const syncPresence = () => setOnlineMemberCount(Object.keys(presenceChannel.presenceState()).length);
    presenceChannel.on('presence', { event: 'sync' }, syncPresence);
    presenceChannel.on('presence', { event: 'join' }, syncPresence);
    presenceChannel.on('presence', { event: 'leave' }, syncPresence);
    presenceChannel.subscribe(async (status) => {
      if (status === 'SUBSCRIBED') {
        await presenceChannel.track({ user_id: currentUserId, online_at: new Date().toISOString() });
        syncPresence();
      }
    });
    return () => {
      supabase.removeChannel(presenceChannel);
      setOnlineMemberCount(0);
    };
  }, [currentUserId, currentWorkspaceId]);

  const openSearch = useCallback(() => {
    setSearchQuery('');
    setSearchOpen(true);
  }, []);

  const closeSearch = useCallback(() => {
    setSearchOpen(false);
    setSearchQuery('');
    setSearchResults([]);
  }, []);

  useEffect(() => {
    if (!searchOpen || !AppState.workspace?.id) return;
    const term = searchQuery.trim().toLowerCase();
    if (!term) {
      return;
    }

    let cancelled = false;
    const debounceTimer = window.setTimeout(() => {
      if (!cancelled) setSearchLoading(true);
      Promise.all([getPages(AppState.workspace.id), getTasks({ workspaceId: AppState.workspace.id })])
        .then(([pagesResult, tasksResult]) => {
          if (cancelled) return;
          const pages = (pagesResult.data || [])
            .filter((page) => {
              const searchable = [
                page.title || '',
                page.page_type || '',
                page.content?.html || '',
                page.content?.properties?.status || '',
                page.content?.properties?.priority || '',
                ...(Array.isArray(page.content?.properties?.tags) ? page.content.properties.tags : [])
              ].join(' ').toLowerCase();
              return searchable.includes(term);
            })
            .slice(0, 8)
            .map((page) => ({ id: page.id, title: page.title || 'Untitled page', type: 'page' }));
          const tasks = (tasksResult.data || [])
            .filter((task) => [task.title || '', task.status || '', task.priority || '', ...(task.tags || [])].join(' ').toLowerCase().includes(term))
            .slice(0, 8)
            .map((task) => ({ id: task.id, title: task.title || 'Untitled task', type: 'task' }));
          setSearchResults([...pages, ...tasks].slice(0, 12));
        })
        .catch(() => {
          if (!cancelled) setSearchResults([]);
        })
        .finally(() => {
          if (!cancelled) setSearchLoading(false);
        });
    }, 180);

    return () => {
      cancelled = true;
      window.clearTimeout(debounceTimer);
    };
  }, [searchOpen, searchQuery]);

  // Hash change listener
  useEffect(() => {
    const onHashChange = () => {
      const nextRoute = parseHash();
      setRoute(nextRoute);
      setSidebarOpen(false); // Close sidebar on navigation (mobile)
      if (nextRoute.path === 'ai-chat') {
        setBreadcrumb('AI Chat');
        setSidebarMode('ai-chat');
        const qId = nextRoute.query.get('id');
        if (qId) setActiveAIChatId(qId);
      }
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  // Update active nav state
  useEffect(() => {
    updateNavActiveState(route.path);
  }, [route.path]);

  // Sync AI chats when updated
  useEffect(() => {
    const handleAIChatsUpdate = () => {
      setAiChats(getStoredChats());
    };
    window.addEventListener('motion:ai-chats-updated', handleAIChatsUpdate);
    return () => window.removeEventListener('motion:ai-chats-updated', handleAIChatsUpdate);
  }, []);

  const handleStartNewAIChat = useCallback(() => {
    const newChat = createNewAIChat('New chat');
    setAiChats(getStoredChats());
    setActiveAIChatId(newChat.id);
    setSidebarMode('ai-chat');
    window.location.hash = `ai-chat?id=${encodeURIComponent(newChat.id)}`;
  }, []);

  // Custom event listeners
  useEffect(() => {
    const onCrumb = (e) => setBreadcrumb(e.detail || '');
    const onToast = (e) => {
      setToast(e.detail);
      window.setTimeout(() => setToast(null), 3000);
    };
    window.addEventListener('motion:breadcrumb', onCrumb);
    window.addEventListener('motion:toast', onToast);
    return () => {
      window.removeEventListener('motion:breadcrumb', onCrumb);
      window.removeEventListener('motion:toast', onToast);
    };
  }, []);

  // Global keyboard shortcuts
  useEffect(() => {
    const handleKeyboard = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        openSearch();
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'n') {
        e.preventDefault();
        setNewPageModalOpen(true);
      }
    };
    window.addEventListener('keydown', handleKeyboard);
    return () => window.removeEventListener('keydown', handleKeyboard);
  }, [openSearch]);

  // Bootstrap auth
  useEffect(() => {
    let unsub = null;
    let authBootstrapTimer;

    async function bootstrap() {
      setIsBootstrapping(true);
      try {
        if (!isSupabaseConfigured) {
          AppState.user = null;
          AppState.profile = null;
          AppState.workspaces = [];
          AppState.workspace = null;
          AppState.isLoading = false;
          if (!['login', 'reset-password'].includes(parseHash().path)) window.location.hash = 'login';
          return;
        }
        const session = await getSession();
        if (!session) {
          const pendingRoute = parseHash();
          if (pendingRoute.path === 'invite' && pendingRoute.segments[0]) {
            localStorage.setItem('motion-pending-invite', pendingRoute.segments[0]);
          }
          AppState.user = null;
          AppState.profile = null;
          AppState.workspaces = [];
          AppState.workspace = null;
          AppState.isLoading = false;
          if (!['login', 'reset-password'].includes(parseHash().path)) window.location.hash = 'login';
          return;
        }

        const currentRoute = parseHash();
        const pendingInviteToken = currentRoute.path === 'invite'
          ? currentRoute.segments[0]
          : localStorage.getItem('motion-pending-invite');
        if (pendingInviteToken) {
          const { error: inviteError } = await acceptWorkspaceInvitation(pendingInviteToken);
          if (inviteError) showToast(inviteError.message || 'Could not accept invitation', 'error');
          else showToast('You joined the workspace', 'success');
          localStorage.removeItem('motion-pending-invite');
          window.location.hash = 'dashboard';
        }

        AppState.user = session.user;

        const [{ data: profile }, { data: workspaces }, { data: settings }] = await Promise.all([
          getUserProfile(session.user.id),
          getWorkspaces(),
          getSettings(session.user.id)
        ]);

        AppState.profile = profile || null;
        AppState.workspaces = workspaces || [];
        const savedWorkspaceId = localStorage.getItem('motion-workspace-id');
        AppState.workspace = workspaces?.find((workspace) => workspace.id === savedWorkspaceId) || workspaces?.[0] || null;
        if (AppState.workspace?.id) localStorage.setItem('motion-workspace-id', AppState.workspace.id);
        AppState.isLoading = false;

        // Apply saved theme preference from DB
        if (settings?.theme && (settings.theme === 'dark' || settings.theme === 'light')) {
          setTheme(settings.theme);
        }

        // Load recent activity for notification bell
        const { data: activityPages } = await getRecentPages(5, AppState.workspace?.id);
        setRecentActivity(activityPages || []);
        const { data: userNotifications } = await getNotifications(10);
        setNotifications(userNotifications || []);

        forceUpdate((n) => n + 1);

        // If we're on login but already have a session, go home.
        if (parseHash().path === 'login') window.location.hash = 'dashboard';
      } catch (err) {
        console.error('Bootstrap error:', err);
        showToast(err?.message || 'Failed to bootstrap app', 'error');
      } finally {
        setIsBootstrapping(false);
      }
    }

    bootstrap();

    const { data } = isSupabaseConfigured ? onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT') {
        AppState.user = null;
        AppState.profile = null;
        AppState.workspaces = [];
        AppState.workspace = null;
        window.location.hash = 'login';
      }
      if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') {
        // Leave the SDK's auth notification/lock before making more auth calls.
        window.clearTimeout(authBootstrapTimer);
        authBootstrapTimer = window.setTimeout(() => { void bootstrap(); }, 0);
      }
    }) : { data: null };
    unsub = data?.subscription;

    return () => {
      window.clearTimeout(authBootstrapTimer);
      try {
        unsub?.unsubscribe?.();
      } catch {
        // ignore
      }
    };
  }, []);

  // New page creation via modal
  async function handleCreatePage(title, template = { pageType: 'note', content: {} }) {
    if (!AppState.workspace) {
      showToast('No workspace found. Please create one first.', 'error');
      return;
    }

    const { data, error } = await createPage(AppState.workspace.id, title || 'Untitled', template.pageType, template.content);
    if (error) {
      showToast('Failed to create page: ' + error.message, 'error');
      return;
    }
    showToast('New page created!', 'success');
    window.location.hash = data?.id ? `editor/${data.id}` : 'editor';
  }

  async function handleCreateWorkspace(name) {
    if (!AppState.user?.id) return;
    const { data, error } = await createWorkspace(name, AppState.user.id);
    if (error) {
      showToast(`Could not create workspace: ${error.message}`, 'error');
      return;
    }
    AppState.workspaces = [data, ...(AppState.workspaces || [])];
    AppState.workspace = data;
    localStorage.setItem('motion-workspace-id', data.id);
    forceUpdate((value) => value + 1);
    showToast('Workspace created', 'success');
    window.location.hash = 'dashboard';
  }

  // Computed values
  const avatarUrl = /^https?:\/\//i.test(AppState.profile?.avatar_url || '') ? AppState.profile.avatar_url : '';
  const userInitials =
    (AppState.profile?.name || AppState.user?.email || 'U')
      .split(' ')
      .map((w) => w[0])
      .join('')
      .toUpperCase()
      .slice(0, 2) || 'U';

  const workspaceName = AppState.workspace?.name || 'Premium Workspace';

  // Close notification dropdown when clicking outside
  useEffect(() => {
    if (!notifOpen) return;
    const handleClick = (e) => {
      if (!e.target.closest('#notif-area')) setNotifOpen(false);
    };
    document.addEventListener('click', handleClick);
    return () => document.removeEventListener('click', handleClick);
  }, [notifOpen]);

  if (!showShell) {
    if (route.path === 'reset-password') return <PasswordReset />;
    return <Login isBootstrapping={isBootstrapping} />;
  }

  function timeAgoShort(ts) {
    const now = new Date();
    const then = new Date(ts);
    const seconds = Math.floor((now - then) / 1000);
    if (seconds < 60) return 'Just now';
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
    return `${Math.floor(seconds / 86400)}d ago`;
  }

  function handleWorkspaceChange(event) {
    const workspace = AppState.workspaces.find((item) => item.id === event.target.value);
    if (!workspace) return;
    AppState.workspace = workspace;
    localStorage.setItem('motion-workspace-id', workspace.id);
    forceUpdate((value) => value + 1);
    window.location.hash = 'dashboard';
  }

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Mobile Sidebar Overlay */}
      <div
        className={`sidebar-overlay ${sidebarOpen ? 'active' : ''}`}
        onClick={() => setSidebarOpen(false)}
      />

      {/* Sidebar */}
      <aside
        id="sidebar"
        inert={!sidebarOpen}
        aria-label="Workspace navigation"
        className={`motion-sidebar h-screen w-64 flex-shrink-0 flex flex-col py-6 px-4 ${sidebarOpen ? 'sidebar-open' : ''}`}
      >
        <button
          type="button"
          className="absolute top-3 right-3 flex items-center justify-center w-8 h-8 rounded-lg hover:bg-surface-container-high"
          aria-label="Close sidebar"
          onClick={() => setSidebarOpen(false)}
        >
          <span className="material-symbols-outlined">close</span>
        </button>
        <div className="flex items-center gap-3 mb-8 px-2">
          <div className="w-8 h-8 rounded-lg bg-primary-container flex items-center justify-center">
            <span className="material-symbols-outlined text-primary text-xl">monochrome_photos</span>
          </div>
          <div>
            <h1 className="text-lg font-bold tracking-tighter text-[#2d3433] dark:text-stone-100">Motion</h1>
            {AppState.workspaces.length > 1 ? (
              <select
                id="workspace-switcher"
                className="workspace-switcher font-['Inter'] tracking-tight text-xs text-[#5f5e5e] dark:text-stone-400"
                value={AppState.workspace?.id || ''}
                onChange={handleWorkspaceChange}
                aria-label="Switch workspace"
              >
                {AppState.workspaces.map((workspace) => <option key={workspace.id} value={workspace.id}>{workspace.name}</option>)}
              </select>
            ) : (
              <p className="font-['Inter'] tracking-tight text-xs text-[#5f5e5e] dark:text-stone-400" id="sidebar-workspace-name">{workspaceName}</p>
            )}
            {onlineMemberCount > 0 ? <p className="mt-1 text-[10px] text-primary flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-primary"></span>{onlineMemberCount} online</p> : null}
          </div>
        </div>

        {/* Notion-Style Top Navigation Bar (Home, Chat, Notes, Inbox, Search) */}
        <div className="notion-top-nav">
          <button
            type="button"
            className={`notion-nav-btn ${sidebarMode === 'pages' ? 'is-active' : ''}`}
            title="Home"
            aria-label="Home"
            onClick={() => setSidebarMode('pages')}
          >
            <span className="material-symbols-outlined text-lg">home</span>
            {sidebarMode === 'pages' && <span className="notion-nav-label">Home</span>}
          </button>

          <button
            type="button"
            className={`notion-nav-btn ${sidebarMode === 'ai-chat' ? 'is-active' : ''}`}
            title="Chat"
            aria-label="Chat"
            onClick={() => setSidebarMode('ai-chat')}
          >
            <span className="material-symbols-outlined text-lg">chat</span>
            {sidebarMode === 'ai-chat' && <span className="notion-nav-label">Chat</span>}
          </button>

          <button
            type="button"
            className={`notion-nav-btn ${sidebarMode === 'notes' ? 'is-active' : ''}`}
            title="Notes"
            aria-label="Notes"
            onClick={() => setSidebarMode('notes')}
          >
            <span className="material-symbols-outlined text-lg">description</span>
            {sidebarMode === 'notes' && <span className="notion-nav-label">Notes</span>}
          </button>

          <button
            type="button"
            className={`notion-nav-btn ${sidebarMode === 'inbox' ? 'is-active' : ''}`}
            title="Notifications"
            aria-label="Notifications"
            onClick={() => setSidebarMode((prev) => (prev === 'inbox' ? 'pages' : 'inbox'))}
          >
            <span className="material-symbols-outlined text-lg">inbox</span>
            {sidebarMode === 'inbox' && <span className="notion-nav-label">Inbox</span>}
            {notifications.some((n) => !n.read_at) && (
              <span className="notion-badge-dot">
                {notifications.filter((n) => !n.read_at).length > 9 ? '9+' : notifications.filter((n) => !n.read_at).length}
              </span>
            )}
          </button>

          <button
            type="button"
            className="notion-nav-btn"
            title="Search (Ctrl+K)"
            aria-label="Search"
            onClick={openSearch}
          >
            <span className="material-symbols-outlined text-lg">search</span>
          </button>
        </div>

        {/* Conditional Sidebar: AI Chat Panel vs Standard Workspace Navigation */}
        {sidebarMode === 'ai-chat' ? (
          <div className="notion-ai-sidebar">
            <h3 className="notion-ai-section-title">Motion AI</h3>
            <div className="notion-ai-agents-row">
              <button
                type="button"
                className="notion-ai-agent-chip"
                onClick={() => {
                  window.location.hash = activeAIChatId ? `ai-chat?id=${encodeURIComponent(activeAIChatId)}` : 'ai-chat';
                }}
              >
                <div className="notion-ai-avatar-circle">
                  <span className="material-symbols-outlined text-xl">auto_awesome</span>
                </div>
                <span>Motion AI</span>
              </button>

              <button
                type="button"
                className="notion-ai-agent-chip"
                onClick={handleStartNewAIChat}
                title="Start new conversation with AI"
              >
                <div className="notion-ai-add-circle">
                  <span className="material-symbols-outlined text-xl">add</span>
                </div>
                <span>New agent</span>
              </button>
            </div>

            {/* Older Chats Header */}
            <div className="notion-ai-older-bar">
              <span className="notion-ai-older-title">Older</span>
              <div className="notion-ai-older-actions">
                <button
                  type="button"
                  title="Search chats"
                  onClick={() => setAiChatSearchOpen((prev) => !prev)}
                >
                  <span className="material-symbols-outlined text-sm">search</span>
                </button>
                <button
                  type="button"
                  title="New chat"
                  onClick={handleStartNewAIChat}
                >
                  <span className="material-symbols-outlined text-sm">add</span>
                </button>
              </div>
            </div>

            {aiChatSearchOpen && (
              <div className="mb-2 px-1">
                <input
                  type="text"
                  value={aiChatSearchQuery}
                  onChange={(e) => setAiChatSearchQuery(e.target.value)}
                  placeholder="Search chats..."
                  className="w-full text-xs px-2.5 py-1.5 rounded-md border border-outline-variant/30 bg-surface-container-high outline-none text-on-surface"
                  autoFocus
                />
              </div>
            )}

            {/* Chat List */}
            <div className="notion-ai-chat-list">
              {aiChats
                .filter((chat) => (chat.title || '').toLowerCase().includes(aiChatSearchQuery.trim().toLowerCase()))
                .length === 0 ? (
                <p className="text-xs text-on-surface-variant/60 py-4 text-center">No previous chats</p>
              ) : (
                aiChats
                  .filter((chat) => (chat.title || '').toLowerCase().includes(aiChatSearchQuery.trim().toLowerCase()))
                  .map((chat) => (
                    <div
                      key={chat.id}
                      className={`notion-ai-chat-item ${activeAIChatId === chat.id ? 'is-selected' : ''}`}
                      onClick={() => {
                        setActiveAIChatId(chat.id);
                        window.location.hash = `ai-chat?id=${encodeURIComponent(chat.id)}`;
                      }}
                      role="button"
                      tabIndex={0}
                    >
                      <div className="notion-ai-chat-item-main">
                        <span className="material-symbols-outlined text-sm text-on-surface-variant">chat_bubble_outline</span>
                        <span className="notion-ai-chat-item-title" title={chat.title}>{chat.title || 'Untitled chat'}</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <span className="notion-ai-chat-item-date">{formatChatDate(chat.updatedAt || chat.createdAt)}</span>
                        <button
                          type="button"
                          className="notion-ai-chat-delete-btn"
                          title="Delete chat"
                          onClick={(e) => {
                            e.stopPropagation();
                            deleteAIChat(chat.id);
                            const remaining = getStoredChats();
                            setAiChats(remaining);
                            if (activeAIChatId === chat.id && remaining.length > 0) {
                              setActiveAIChatId(remaining[0].id);
                              window.location.hash = `ai-chat?id=${encodeURIComponent(remaining[0].id)}`;
                            }
                          }}
                        >
                          <span className="material-symbols-outlined text-xs">close</span>
                        </button>
                      </div>
                    </div>
                  ))
              )}
            </div>

            {/* Bottom Invite Card */}
            {!inviteCardDismissed && (
              <div className="notion-ai-invite-card">
                <div className="notion-ai-invite-card-header">
                  <span className="notion-ai-invite-card-title">
                    <span className="material-symbols-outlined text-sm">person_add</span>
                    Invite members
                  </span>
                  <button
                    type="button"
                    className="text-on-surface-variant/60 hover:text-on-surface text-xs"
                    onClick={() => setInviteCardDismissed(true)}
                    aria-label="Dismiss"
                  >
                    <span className="material-symbols-outlined text-xs">close</span>
                  </button>
                </div>
                <p className="notion-ai-invite-card-desc">Collaborate with your team.</p>
              </div>
            )}

            {/* Bottom New Ctrl+N Button */}
            <button
              type="button"
              className="notion-ai-new-btn"
              onClick={handleStartNewAIChat}
            >
              <span className="material-symbols-outlined text-sm">edit_square</span>
              <span>New</span>
              <span className="text-[10px] opacity-60 font-mono">Ctrl+N</span>
            </button>
          </div>
        ) : sidebarMode === 'notes' ? (
          <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
            <div className="flex items-center justify-between px-1 mb-2">
              <h3 className="text-xs font-semibold text-on-surface-variant uppercase tracking-wider">Pages & Notes</h3>
              <button
                type="button"
                onClick={() => setNewPageModalOpen(true)}
                className="w-6 h-6 flex items-center justify-center rounded hover:bg-surface-container-high text-on-surface-variant"
                title="New Page"
              >
                <span className="material-symbols-outlined text-sm">add</span>
              </button>
            </div>
            <div className="mb-2 px-1">
              <input
                type="text"
                value={notesSearchQuery}
                onChange={(e) => setNotesSearchQuery(e.target.value)}
                placeholder="Search pages..."
                className="w-full text-xs px-2.5 py-1.5 rounded-md border border-outline-variant/30 bg-surface-container-high outline-none text-on-surface"
              />
            </div>
            <div className="flex-1 overflow-y-auto px-1">
              <SidebarNotesTree
                pages={sidebarPages}
                searchQuery={notesSearchQuery}
                onPageMoved={() => {
                  if (AppState.workspace?.id) {
                    getPages(AppState.workspace.id).then(({ data }) => {
                      if (data) setSidebarPages(data);
                    });
                  }
                }}
              />
            </div>
          </div>
        ) : sidebarMode === 'inbox' ? (
          <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
            <div className="flex items-center justify-between px-1 mb-2">
              <h3 className="text-xs font-semibold text-on-surface-variant uppercase tracking-wider">Inbox</h3>
              {notifications.length > 0 && (
                <button
                  type="button"
                  onClick={async () => {
                    await markAllNotificationsRead();
                    const { data } = await getNotifications(10);
                    setNotifications(data || []);
                  }}
                  className="text-[10px] font-semibold text-primary hover:underline"
                >
                  Mark all read
                </button>
              )}
            </div>
            <div className="flex-1 overflow-y-auto space-y-1.5 px-1">
              {notifications.length === 0 ? (
                <p className="text-xs text-on-surface-variant/60 py-4 text-center">No notifications</p>
              ) : (
                notifications.map((n) => (
                  <div
                    key={n.id}
                    className={`p-2.5 rounded-lg text-xs transition-colors ${!n.read_at ? 'bg-primary/5 border border-primary/20' : 'bg-surface-container-low'}`}
                  >
                    <p className="font-medium text-on-surface truncate">{n.title || n.message || 'Notification'}</p>
                    <p className="text-[10px] text-on-surface-variant mt-0.5">{timeAgoShort(n.created_at)}</p>
                  </div>
                ))
              )}
            </div>
          </div>
        ) : (
          /* Standard Pages/Workspace Navigation */
          <>
            <p className="motion-nav-caption">CREATE</p>
            <div className="flex flex-col gap-1.5 mb-3 px-1">
              <button
                id="btn-new-page"
                onClick={() => setNewPageModalOpen(true)}
                className="h-8 px-3 bg-primary text-on-primary rounded-md text-xs font-semibold flex items-center justify-center gap-1.5 hover:opacity-90 transition-all shadow-sm active:scale-[0.98]"
                type="button"
              >
                <span className="material-symbols-outlined text-sm">add</span>
                New Page
              </button>
              <button
                className="h-8 px-3 border border-outline-variant/40 text-on-surface-variant hover:text-on-surface rounded-md text-xs font-semibold flex items-center justify-center gap-1.5 hover:bg-surface-container-high transition-all active:scale-[0.98]"
                type="button"
                onClick={() => setNewWorkspaceModalOpen(true)}
              >
                <span className="material-symbols-outlined text-sm">add_business</span>
                New Workspace
              </button>
            </div>

            <p className="motion-nav-caption">WORKSPACE</p>
            <nav className="flex-grow space-y-1">
              <a href="#chat" data-nav-route="chat" className="flex items-center gap-3 px-3 py-2 text-on-surface-variant hover:bg-surface-container-high rounded-md transition-colors duration-200">
                <span className="material-symbols-outlined">forum</span>
                <span className="text-sm">Team chat</span>
              </a>
              <a
                href="#database"
                data-nav-route="database"
                className="flex items-center gap-3 px-3 py-2 text-on-surface-variant hover:bg-surface-container-high rounded-md transition-colors duration-200"
              >
                <span className="material-symbols-outlined">local_library</span>
                <span className="text-sm">Library</span>
              </a>
              <a
                href="#kanban"
                data-nav-route="kanban"
                className="flex items-center gap-3 px-3 py-2 text-on-surface-variant hover:bg-surface-container-high rounded-md transition-colors duration-200"
              >
                <span className="material-symbols-outlined">view_kanban</span>
                <span className="text-sm">Kanban</span>
              </a>
            </nav>

            <div className="mt-auto pt-4 space-y-1 motion-nav-footer">
              <p className="motion-nav-caption">ACCOUNT</p>
              <a
                href="#settings"
                data-nav-route="settings"
                className="flex items-center gap-3 px-3 py-2 text-on-surface-variant hover:bg-surface-container-high rounded-md transition-colors duration-200"
              >
                <span className="material-symbols-outlined">settings</span>
                <span className="text-sm">Settings</span>
              </a>
              <a
                href="#profile"
                data-nav-route="profile"
                className="flex items-center gap-3 px-3 py-2 text-on-surface-variant hover:bg-surface-container-high rounded-md transition-colors duration-200"
              >
                <span className="material-symbols-outlined">account_circle</span>
                <span className="text-sm">Profile</span>
              </a>
            </div>
          </>
        )}
      </aside>

      {/* Main */}
      <main className="motion-main flex-grow min-w-0 flex flex-col overflow-y-auto overflow-x-hidden bg-surface">
        <header className="motion-topbar sticky top-0 w-full z-40 flex justify-between items-center px-6 h-14">
          <div className="flex items-center gap-4">
            {/* Mobile hamburger */}
            <button
              className="flex items-center justify-center w-8 h-8 rounded-lg hover:bg-[#e8ebea] dark:hover:bg-stone-800 transition-colors"
              onClick={() => setSidebarOpen(true)}
              aria-label="Open sidebar"
              aria-expanded={sidebarOpen}
              aria-controls="sidebar"
            >
              <span className="material-symbols-outlined">menu</span>
            </button>

            <div id="breadcrumb" className="flex items-center gap-2 text-sm text-on-surface-variant">
              <a
                href="#dashboard"
                aria-label="Go to home dashboard"
                title="Home"
                onClick={() => setSidebarMode('pages')}
                className="inline-flex items-center justify-center rounded p-1 hover:bg-surface-container-high focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
              >
                <span className="material-symbols-outlined text-sm" aria-hidden="true">home</span>
              </a>
              <span>/</span>
              <span
                className="text-[#2d3433] dark:text-stone-100 font-bold"
                id="breadcrumb-current"
              >
                {route.path === 'dashboard'
                  ? 'Home'
                  : route.path === 'ai-chat'
                    ? (aiChats.find((c) => c.id === activeAIChatId)?.title || 'Chat')
                    : route.path === 'chat'
                      ? 'Team chat'
                      : route.path === 'database'
                        ? 'Library'
                        : route.path === 'notes'
                          ? 'Notes'
                          : route.path === 'kanban'
                            ? 'Kanban'
                            : route.path === 'settings'
                              ? 'Settings'
                              : route.path === 'profile'
                                ? 'Profile'
                                : breadcrumb || 'Home'}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {/* Theme Toggle */}
            <button
              className="workspace-search-trigger"
              onClick={openSearch}
              title="Search (⌘K)"
              aria-label="Search workspace"
            >
              <span className="material-symbols-outlined" style={{ fontSize: '1.25rem' }}>
                search
              </span>
              <span className="workspace-search-label">Search anything</span>
              <kbd className="workspace-search-shortcut">⌘ K</kbd>
            </button>

            <button
              className="theme-toggle"
              onClick={toggleTheme}
              title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            >
              <span className="material-symbols-outlined" style={{ fontSize: '1.25rem' }}>
                {theme === 'dark' ? 'light_mode' : 'dark_mode'}
              </span>
            </button>

            {/* Notification Bell */}
            <div id="notif-area" className="relative">
              <button
                className="theme-toggle"
                onClick={() => setNotifOpen((v) => !v)}
                title="Notifications"
                aria-label="Open notifications"
              >
                <span className="material-symbols-outlined" style={{ fontSize: '1.25rem' }}>
                  notifications
                </span>
                {notifications.some((notification) => !notification.read_at) && (
                  <span className="notification-badge">
                    {notifications.filter((notification) => !notification.read_at).length > 9
                      ? '9+'
                      : notifications.filter((notification) => !notification.read_at).length}
                  </span>
                )}
              </button>

              {notifOpen && (
                <div className="notification-dropdown">
                  <div className="px-4 py-3 border-b" style={{ borderColor: 'var(--surface-container-high, #e4e9e8)' }}>
                    <div className="flex items-center justify-between gap-3">
                      <h4 className="text-sm font-bold text-on-surface">Notifications</h4>
                      {notifications.length > 0 && (
                        <button
                          className="text-[11px] font-semibold text-primary hover:underline whitespace-nowrap"
                          onClick={async () => {
                            const { error: markAllError } = await markAllNotificationsRead();
                            if (markAllError) {
                              showToast(`Could not mark notifications read: ${markAllError.message}`, 'error');
                              return;
                            }
                            setNotifications((current) => current.map((notification) => ({ ...notification, read_at: new Date().toISOString() })));
                          }}
                        >
                          Mark all read
                        </button>
                      )}
                    </div>
                  </div>
                  <div className="py-2">
                    {notifications.length === 0 && recentActivity.length === 0 ? (
                      <div className="px-4 py-6 text-center">
                        <span className="material-symbols-outlined text-on-surface-variant/30" style={{ fontSize: '2rem' }}>
                          notifications_off
                        </span>
                        <p className="text-xs text-on-surface-variant mt-2">No recent activity</p>
                      </div>
                    ) : notifications.length > 0 ? (
                      notifications.map((notification) => {
                        const title = notification.payload?.title || notification.payload?.message || String(notification.type || 'Workspace update').replaceAll('_', ' ');
                        const hasPage = Boolean(notification.page_id);
                        return (
                          <button
                            key={notification.id}
                            className={`w-full text-left px-4 py-2.5 hover:bg-surface-container-low flex items-center gap-3 transition-colors ${notification.read_at ? '' : 'notification-unread'}`}
                            onClick={async () => {
                              if (!notification.read_at) {
                                const { error: markReadError } = await markNotificationRead(notification.id);
                                if (markReadError) {
                                  showToast(`Could not mark notification read: ${markReadError.message}`, 'error');
                                  return;
                                }
                                setNotifications((current) => current.map((item) => item.id === notification.id ? { ...item, read_at: new Date().toISOString() } : item));
                              }
                              if (hasPage) window.location.hash = `editor/${notification.page_id}`;
                              else if (notification.type === 'task_assigned') {
                                const taskId = notification.payload?.task_id;
                                window.location.hash = taskId ? `kanban?task=${encodeURIComponent(taskId)}` : 'kanban';
                              }
                              setNotifOpen(false);
                            }}
                          >
                            <div className="w-8 h-8 rounded-lg bg-surface-container-high flex items-center justify-center flex-shrink-0">
                              <span className="material-symbols-outlined text-sm text-on-surface-variant">
                                {notification.type?.includes('comment') ? 'comment' : notification.type === 'task_assigned' ? 'assignment' : notification.type?.includes('member') ? 'group' : 'notifications'}
                              </span>
                            </div>
                            <div className="min-w-0 flex-1">
                              <p className="text-sm font-medium text-on-surface truncate">
                                {title}
                              </p>
                              <p className="text-[11px] text-on-surface-variant">
                                {timeAgoShort(notification.created_at)}
                              </p>
                            </div>
                            {!notification.read_at && <span className="notification-unread-dot" aria-label="Unread" />}
                          </button>
                        );
                      })
                    ) : (
                      recentActivity.map((page) => (
                        <button
                          key={page.id}
                          className="w-full text-left px-4 py-2.5 hover:bg-surface-container-low flex items-center gap-3 transition-colors"
                          onClick={() => {
                            window.location.hash = `editor/${page.id}`;
                            setNotifOpen(false);
                          }}
                        >
                          <div className="w-8 h-8 rounded-lg bg-surface-container-high flex items-center justify-center flex-shrink-0">
                            <span className="text-lg">{page.icon || '📄'}</span>
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium text-on-surface truncate">{page.title || 'Untitled'}</p>
                            <p className="text-[11px] text-on-surface-variant">Updated {timeAgoShort(page.updated_at)}</p>
                          </div>
                        </button>
                      ))
                    )}
                  </div>
                  {(notifications.length > 0 || recentActivity.length > 0) && (
                    <div className="px-4 py-2 border-t" style={{ borderColor: 'var(--surface-container-high, #e4e9e8)' }}>
                      <button
                        className="text-xs font-semibold text-primary hover:underline w-full text-center"
                        onClick={() => {
                          window.location.hash = 'notes';
                          setNotifOpen(false);
                        }}
                      >
                        View all pages
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* User Avatar */}
            <div
              id="header-avatar"
              className="w-8 h-8 rounded-full overflow-hidden bg-surface-container-highest cursor-pointer border border-outline-variant/10"
              onClick={() => (window.location.hash = 'profile')}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  window.location.hash = 'profile';
                }
              }}
              role="button"
              tabIndex={0}
            >
              {avatarUrl ? (
                <img src={avatarUrl} alt="Profile" className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-xs font-bold text-on-surface-variant">
                  {userInitials}
                </div>
              )}
            </div>
          </div>
        </header>

        {isOffline ? (
          <div className="mx-4 mt-3 rounded-lg border border-error/30 bg-error-container/30 px-4 py-2 text-xs text-on-error-container flex items-center gap-2" role="status">
            <span className="material-symbols-outlined text-sm" aria-hidden="true">cloud_off</span>
            You are offline. Changes may not sync until your connection returns.
          </div>
        ) : null}

        <div className="flex-1 min-h-0 flex overflow-hidden relative">
          <div id="page-content" className="flex-1 min-w-0 overflow-y-auto">
            {isBootstrapping ? (
              <div className="flex items-center justify-center h-[60vh]">
                <div className="text-center">
                  <div className="loading-spinner mx-auto mb-4"></div>
                  <p className="text-sm text-on-surface-variant">Loading Motion...</p>
                </div>
              </div>
            ) : route.path === 'chat' ? (
              <TeamChat key={AppState.workspace?.id} workspace={AppState.workspace} user={AppState.user} />
            ) : route.path === 'ai-chat' ? (
              <AIChatView
                key={AppState.workspace?.id}
                activeChatId={activeAIChatId}
                onSelectChat={(id) => {
                  setActiveAIChatId(id);
                  window.location.hash = `ai-chat?id=${encodeURIComponent(id)}`;
                }}
                workspace={AppState.workspace}
                user={AppState.user}
              />
            ) : (
              <LegacyRenderer renderer={renderer} routeKey={routeKey} route={route} />
            )}
          </div>

          {/* Docked AI Chat Sidebar (Image 2) */}
          {isAISidebarOpen && (
            <AIPageSidebar
              isOpen={isAISidebarOpen}
              onClose={() => setIsAISidebarOpen(false)}
              workspace={AppState.workspace}
              user={AppState.user}
            />
          )}

          {/* Floating Notion AI button at the bottom-right corner of the page (Image 1) */}
          {!isAISidebarOpen && (route.path === 'editor' || route.path === 'notes') && (
            <button
              type="button"
              onClick={() => setIsAISidebarOpen(true)}
              className="fixed bottom-6 right-8 z-40 w-12 h-12 rounded-full shadow-lg hover:shadow-2xl hover:scale-110 active:scale-95 transition-all flex items-center justify-center bg-[#f0f0ef] dark:bg-[#343536] border border-black/10 dark:border-white/10 group cursor-pointer"
              title="Open Notion AI Assistant"
              aria-label="Open Notion AI Assistant"
            >
              <NotionAIFace size={36} className="pointer-events-none" />
            </button>
          )}
        </div>
      </main>

      {/* Toast */}
      {toast ? (
        <div className={`toast toast-${toast.type || 'success'}`}>{toast.message}</div>
      ) : null}

      <SearchPalette
        isOpen={searchOpen}
        query={searchQuery}
        setQuery={setSearchQuery}
        results={searchResults}
        loading={searchLoading}
        onClose={closeSearch}
        onSelect={(result) => {
          closeSearch();
          window.location.hash = result.type === 'task' ? `kanban?task=${encodeURIComponent(result.id)}` : `editor/${result.id}`;
        }}
        onAction={async (action) => {
          closeSearch();
          if (action === 'new-page') {
            setNewPageModalOpen(true);
            return;
          }
          if (action === 'new-task') {
            const title = await requestInput('Task title:');
            if (!title?.trim() || !AppState.workspace?.id) return;
            createTask(title.trim(), { workspaceId: AppState.workspace.id, assigneeId: AppState.user?.id || null }).then(({ data: task, error }) => {
              if (error) showToast(`Could not create task: ${error.message}`, 'error');
              else {
                showToast('Task created', 'success');
                window.location.hash = `kanban?task=${encodeURIComponent(task.id)}`;
              }
            });
            return;
          }
          window.location.hash = action;
        }}
      />

      {/* New Page Modal */}
      <PageCreationDialog
        isOpen={newPageModalOpen}
        onClose={() => setNewPageModalOpen(false)}
        onSubmit={handleCreatePage}
      />
      <PromptDialog
        isOpen={newWorkspaceModalOpen}
        onClose={() => setNewWorkspaceModalOpen(false)}
        onSubmit={handleCreateWorkspace}
        title="Create Workspace"
        placeholder="Workspace name..."
        submitText="Create workspace"
      />
    </div>
  );
}
