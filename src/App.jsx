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
  getTasks,
  getNotifications,
  markNotificationRead,
  markAllNotificationsRead,
  acceptWorkspaceInvitation,
  createWorkspace
} from './lib/queries.js';
import Login, { PasswordReset } from './components/Login.jsx';
import Modal, { PromptDialog } from './components/Modal.jsx';
import './App.css';

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
                  <span className="material-symbols-outlined">database</span><span className="command-palette-result-copy"><strong>Open Database</strong><small>Browse workspace data</small></span>
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

export default function App() {
  const [route, setRoute] = useState(() => parseHash());
  const [isBootstrapping, setIsBootstrapping] = useState(true);
  const [breadcrumb, setBreadcrumb] = useState('Dashboard');
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
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searchLoading, setSearchLoading] = useState(false);

  // Force re-render when AppState changes
  const [appVersion, forceUpdate] = useState(0);

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
        updateSettings(AppState.user.id, { theme: next }).catch(() => {});
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
      setRoute(parseHash());
      setSidebarOpen(false); // Close sidebar on navigation (mobile)
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  // Update active nav state
  useEffect(() => {
    updateNavActiveState(route.path);
  }, [route.path]);

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
        bootstrap();
      }
    }) : { data: null };
    unsub = data?.subscription;

    return () => {
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
        className={`h-screen w-64 flex-shrink-0 bg-[#f2f4f3] dark:bg-stone-900 flex flex-col py-6 px-4 ${sidebarOpen ? 'sidebar-open' : ''}`}
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

        <button
          id="btn-new-page"
          onClick={() => setNewPageModalOpen(true)}
          className="mb-6 mx-2 py-2 px-4 bg-primary text-on-primary rounded-lg font-medium flex items-center justify-center gap-2 hover:opacity-90 transition-opacity"
          type="button"
        >
          <span className="material-symbols-outlined text-sm">add</span>
          New Page
        </button>
        <button
          className="mb-5 mx-2 w-[calc(100%-1rem)] py-2 px-4 border border-outline-variant/30 text-on-surface-variant rounded-lg font-medium flex items-center justify-center gap-2 hover:bg-surface-container-high transition-colors"
          type="button"
          onClick={() => setNewWorkspaceModalOpen(true)}
        >
          <span className="material-symbols-outlined text-sm">add_business</span>
          New Workspace
        </button>

        <nav className="flex-grow space-y-1">
          <a
            href="#dashboard"
            data-nav-route="dashboard"
            className="flex items-center gap-3 px-3 py-2 text-on-surface-variant hover:bg-surface-container-high rounded-md transition-colors duration-200"
          >
            <span className="material-symbols-outlined">dashboard</span>
            <span className="text-sm">Dashboard</span>
          </a>
          <a
            href="#notes"
            data-nav-route="notes"
            className="flex items-center gap-3 px-3 py-2 text-on-surface-variant hover:bg-surface-container-high rounded-md transition-colors duration-200"
          >
            <span className="material-symbols-outlined">description</span>
            <span className="text-sm">Notes</span>
          </a>
          <a
            href="#database"
            data-nav-route="database"
            className="flex items-center gap-3 px-3 py-2 text-on-surface-variant hover:bg-surface-container-high rounded-md transition-colors duration-200"
          >
            <span className="material-symbols-outlined">database</span>
            <span className="text-sm">Database</span>
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

        <div className="mt-auto pt-4 space-y-1">
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
      </aside>

      {/* Main */}
      <main className="flex-grow min-w-0 flex flex-col overflow-y-auto overflow-x-hidden bg-surface">
        <header className="sticky top-0 w-full z-40 bg-[#f9f9f8]/70 dark:bg-stone-950/70 backdrop-blur-xl flex justify-between items-center px-6 h-14">
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
                className="inline-flex items-center justify-center rounded p-1 hover:bg-surface-container-high focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
              >
                <span className="material-symbols-outlined text-sm" aria-hidden="true">home</span>
              </a>
              <span>/</span>
              <span
                className="text-[#2d3433] dark:text-stone-100 font-bold"
                id="breadcrumb-current"
              >
                {breadcrumb}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {/* Theme Toggle */}
            <button
              className="theme-toggle search-trigger"
              onClick={openSearch}
              title="Search (⌘K)"
              aria-label="Search workspace"
            >
              <span className="material-symbols-outlined" style={{ fontSize: '1.25rem' }}>
                search
              </span>
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

        <div id="page-content" className="flex-1 min-w-0">
          {isBootstrapping ? (
            <div className="flex items-center justify-center h-[60vh]">
              <div className="text-center">
                <div className="loading-spinner mx-auto mb-4"></div>
                <p className="text-sm text-on-surface-variant">Loading Motion...</p>
              </div>
            </div>
          ) : (
            <LegacyRenderer renderer={renderer} routeKey={routeKey} route={route} />
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
