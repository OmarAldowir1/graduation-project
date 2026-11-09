// Motion AI agent (browser side): builds the workspace snapshot the model sees,
// runs the request (including "read this page first" rounds), describes proposed
// actions in plain language, and performs them with the user's own permissions.
import { AppState } from '../legacy/app.js';
import { supabase } from './supabase.js';
import { invokeAI } from './cloudflareAI.js';
import { getPages, getTasks, getWorkspaceMembers, createPage, createTask, updateTask, updatePage, createComment, createTaskComment } from './queries.js';
import { buildProjectIndex, listProjects, projectProgress, tasksForProject, PROJECT_TEMPLATES, PROJECT_TYPE } from './projects.js';
import { markdownToHtml } from './markdown.js';

function todayKey() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

// ---------- snapshot ----------

export async function buildAgentContext({ focusPageId = null } = {}) {
  const workspaceId = AppState.workspace?.id;
  if (!workspaceId) throw new Error('Select a team first.');
  const [pagesResult, tasksResult, membersResult] = await Promise.all([
    getPages(workspaceId),
    getTasks({ workspaceId }),
    getWorkspaceMembers(workspaceId)
  ]);
  const pages = (pagesResult.data || []).filter((page) => !page.archived_at);
  const tasks = tasksResult.data || [];
  const members = membersResult.data || [];
  const projectIndex = buildProjectIndex(pages);
  const projects = listProjects(pages);

  const refs = new Map(); // ref -> { kind, id, title }
  const byId = new Map(); // id -> ref
  // People are identified by their user id (not the membership row id).
  const idFor = (prefix, item) => (prefix === 'U' ? item.user_id : item.id);
  const add = (prefix, list, titleOf) => list.map((item, index) => {
    const ref = `${prefix}${index + 1}`;
    refs.set(ref, { kind: prefix, id: idFor(prefix, item), title: titleOf(item) });
    byId.set(`${prefix}:${idFor(prefix, item)}`, ref);
    return ref;
  });

  const meId = AppState.user?.id;
  const sortedMembers = [...members].sort((a, b) => (a.user_id === meId ? -1 : b.user_id === meId ? 1 : 0));
  const memberName = (member) => member.user?.name || member.user?.email?.split('@')[0] || 'Member';
  add('U', sortedMembers, memberName);
  add('P', projects, (project) => project.title || 'Untitled project');
  const visiblePages = pages.slice(0, 200);
  add('G', visiblePages, (page) => page.title || 'Untitled');
  const openFirst = [...tasks].sort((a, b) => Number(a.status === 'done') - Number(b.status === 'done')).slice(0, 250);
  add('T', openFirst, (task) => task.title || 'Untitled task');
  const ref = (prefix, id) => (id ? byId.get(`${prefix}:${id}`) || null : null);

  const route = window.location.hash.replace(/^#/, '');
  const [path, segment] = route.split(/[/?]/);
  let currentView = '';
  if (focusPageId && ref('G', focusPageId)) currentView = `page ${ref('G', focusPageId)} (the user asked about this page)`;
  else if (path === 'project' && ref('P', segment)) currentView = `project ${ref('P', segment)}`;
  else if (path === 'editor' && ref('G', segment)) currentView = `page ${ref('G', segment)}`;

  const snapshot = {
    team: AppState.workspace?.name || 'Team',
    me: ref('U', meId),
    today: todayKey(),
    currentView,
    members: sortedMembers.map((member) => ({ ref: ref('U', member.user_id), name: memberName(member), role: member.role || '' })),
    projects: projects.map((project) => {
      const progress = projectProgress(tasksForProject(tasks, pages, project.id));
      return { ref: ref('P', project.id), title: project.title || 'Untitled project', done: progress.done, total: progress.total, plan: ref('G', project.id) };
    }),
    pages: visiblePages.map((page) => ({ ref: ref('G', page.id), title: page.title || 'Untitled', project: ref('P', projectIndex.get(page.id)) })),
    tasks: openFirst.map((task) => ({
      ref: ref('T', task.id),
      title: task.title || 'Untitled task',
      status: task.status || 'todo',
      priority: task.priority || 'medium',
      due: task.due_date || null,
      owner: ref('U', task.assignee_id),
      project: ref('P', projectIndex.get(task.page_id))
    }))
  };
  return { snapshot, refs, members, pages, tasks };
}

function htmlToText(html = '') {
  const template = document.createElement('template');
  template.innerHTML = String(html);
  return (template.content.textContent || '').replace(/\n{3,}/g, '\n\n').trim();
}

// ---------- run ----------

async function readPageText(context, pageRef) {
  const entry = context.refs.get(pageRef);
  if (!entry) return null;
  const { data } = await supabase.from('pages').select('title, content').eq('id', entry.id).single();
  return { ref: pageRef, title: data?.title || entry.title, text: htmlToText(data?.content?.html || '').slice(0, 12000) || '(empty page)' };
}

export async function runAgent({ prompt, history = [], attachment = null, signal, focusPageId = null }) {
  const context = await buildAgentContext({ focusPageId });
  const focusRef = focusPageId ? [...context.refs].find(([, entry]) => entry.kind === 'G' && entry.id === focusPageId)?.[0] : null;
  const messages = history.slice(-12).filter((m) => m?.text).map((m) => ({
    role: m.sender === 'user' ? 'user' : 'assistant',
    content: String(m.text).slice(0, 3000)
  }));
  const base = {
    mode: 'agent',
    prompt: String(prompt).slice(0, 4000),
    messages,
    snapshot: context.snapshot,
    ...(attachment ? { attachment: { name: String(attachment.name).slice(0, 200), content: String(attachment.content || '').slice(0, 16000) } } : {})
  };
  // When the user asked about a specific page, send its text up front.
  const focusText = focusRef ? await readPageText(context, focusRef) : null;
  let result = (await invokeAI('text-ai', focusText ? { ...base, readResults: [focusText] } : base, signal)).agent;
  // One "read the page first" round: fetch the requested pages and ask again.
  if (result?.read?.length && !result.actions?.length) {
    const readResults = [];
    for (const pageRef of [...new Set([...(focusText ? [focusRef] : []), ...result.read])].slice(0, 3)) {
      const page = pageRef === focusRef && focusText ? focusText : await readPageText(context, pageRef);
      if (page) readResults.push(page);
    }
    if (readResults.length) result = (await invokeAI('text-ai', { ...base, readResults }, signal)).agent;
  }
  if (!result || typeof result !== 'object') throw new Error('AI returned an invalid response.');
  const sources = (result.sources || []).map((ref) => context.refs.get(ref)).filter(Boolean).map((entry) => ({
    title: entry.title,
    kind: entry.kind,
    href: entry.kind === 'P' ? `#project/${entry.id}` : entry.kind === 'G' ? `#editor/${entry.id}` : `#kanban?task=${encodeURIComponent(entry.id)}`
  }));
  return { ...result, sources, reply: replaceRefs(result.reply || '', context.refs), context };
}

// Safety net: if the model still wrote refs in its reply, show names instead.
export function replaceRefs(text, refs) {
  return String(text).replace(/\b([PGTU]\d{1,4})\b/g, (match) => (refs.get(match) ? `“${refs.get(match).title}”` : match));
}

// ---------- describe ----------

const PRIORITY_LABEL = { low: 'low', medium: 'medium', high: 'high', urgent: 'urgent' };
const STATUS_LABEL = { todo: 'To do', in_progress: 'In progress', done: 'Done' };

export function describeAction(action, refs, createdTitles = new Map()) {
  const name = (ref) => refs.get(ref)?.title || createdTitles.get(ref) || 'new item';
  switch (action.type) {
    case 'create_project':
      return { icon: 'create_new_folder', text: `Create project “${action.title}”`, detail: PROJECT_TEMPLATES[action.template]?.label || '' };
    case 'create_page':
      return { icon: 'note_add', text: `Create page “${action.title}”`, detail: action.project ? `in ${name(action.project)}` : '' };
    case 'append_to_page':
      return { icon: 'edit_note', text: `Add text to “${name(action.page)}”`, detail: `${action.content.split('\n').filter(Boolean).length} line(s)` };
    case 'create_task': {
      const bits = [action.project && `in ${name(action.project)}`, action.owner && `owner ${name(action.owner)}`, action.due && `due ${action.due}`, action.priority && PRIORITY_LABEL[action.priority]].filter(Boolean);
      return { icon: 'add_task', text: `Create task “${action.title}”`, detail: bits.join(' · ') };
    }
    case 'update_task': {
      const bits = [
        action.title && `rename to “${action.title}”`,
        action.status && `status → ${STATUS_LABEL[action.status]}`,
        action.priority && `priority → ${action.priority}`,
        action.owner && (action.owner === 'none' ? 'remove owner' : `owner → ${name(action.owner)}`),
        action.due && (action.due === 'none' ? 'remove due date' : `due → ${action.due}`)
      ].filter(Boolean);
      return { icon: 'edit', text: `Update task “${name(action.task)}”`, detail: bits.join(' · ') };
    }
    case 'comment':
      return { icon: 'comment', text: `Comment on “${name(action.page || action.task)}”`, detail: action.text.slice(0, 90) + (action.text.length > 90 ? '…' : '') };
    case 'open':
      return { icon: 'open_in_new', text: `Open ${['home', 'my-tasks', 'all-tasks', 'team-chat', 'settings', 'team'].includes(action.target) ? action.target.replace('-', ' ') : `“${name(action.target)}”`}`, detail: '' };
    default:
      return { icon: 'help', text: action.type, detail: '' };
  }
}

// ---------- execute ----------

// Runs approved actions in order. Returns [{ ok, text, href }].
export async function executeAgentActions(actions, context) {
  const workspaceId = AppState.workspace?.id;
  const me = AppState.user?.id;
  const created = new Map(); // NEW1 -> { id, kind, title }
  const results = [];
  let navigateTo = null;
  const idOf = (ref, kind) => {
    if (created.has(ref)) return created.get(ref).id;
    const entry = context.refs.get(ref);
    return entry && entry.kind === kind ? entry.id : null;
  };
  const titleOf = (ref) => created.get(ref)?.title || context.refs.get(ref)?.title || 'item';

  for (const action of actions) {
    const info = describeAction(action, context.refs, new Map([...created].map(([key, value]) => [key, value.title])));
    try {
      if (action.type === 'create_project') {
        const template = PROJECT_TEMPLATES[action.template] || PROJECT_TEMPLATES.blank;
        const { data: project, error } = await createPage(workspaceId, action.title, PROJECT_TYPE, { html: template.html }, null);
        if (error) throw error;
        await updatePage(project.id, { icon: template.icon });
        // The AI's own tasks replace the template's generic starter tasks.
        const hasOwnTasks = action.ref && actions.some((other) => other.type === 'create_task' && other.project === action.ref);
        for (const [index, task] of (hasOwnTasks ? [] : template.tasks).entries()) {
          await createTask(task.title, { workspaceId, pageId: project.id, priority: task.priority, sortOrder: Date.now() + index });
        }
        if (action.ref) created.set(action.ref, { id: project.id, kind: 'P', title: action.title });
        results.push({ ok: true, text: info.text, href: `#project/${project.id}` });
        navigateTo ??= `project/${project.id}`;
      } else if (action.type === 'create_page') {
        const parentId = action.project ? idOf(action.project, 'P') : null;
        const { data: page, error } = await createPage(workspaceId, action.title, 'note', { html: markdownToHtml(action.content) }, parentId);
        if (error) throw error;
        if (action.ref) created.set(action.ref, { id: page.id, kind: 'G', title: action.title });
        results.push({ ok: true, text: info.text, href: `#editor/${page.id}` });
        navigateTo ??= `editor/${page.id}`;
      } else if (action.type === 'append_to_page') {
        const pageId = idOf(action.page, 'G');
        const { data: page, error: readError } = await supabase.from('pages').select('content').eq('id', pageId).single();
        if (readError) throw readError;
        const html = `${page?.content?.html || ''}${markdownToHtml(action.content)}`;
        const { error } = await updatePage(pageId, { content: { ...(page?.content || {}), html } });
        if (error) throw error;
        try { localStorage.removeItem(`motion-page-draft:${pageId}`); } catch { /* ignore */ }
        results.push({ ok: true, text: info.text, href: `#editor/${pageId}` });
      } else if (action.type === 'create_task') {
        const projectId = action.project ? idOf(action.project, 'P') : null;
        const { data: task, error } = await createTask(action.title, {
          workspaceId,
          pageId: projectId,
          status: action.status || 'todo',
          priority: action.priority || 'medium',
          dueDate: action.due || null,
          assigneeId: action.owner ? idOf(action.owner, 'U') : null,
          sortOrder: Date.now()
        });
        if (error) throw error;
        if (action.description) await updateTask(task.id, { details: { description: action.description } });
        results.push({ ok: true, text: info.text, href: `#kanban?task=${encodeURIComponent(task.id)}` });
      } else if (action.type === 'update_task') {
        const taskId = idOf(action.task, 'T');
        const updates = {};
        if (action.title) updates.title = action.title;
        if (action.status) updates.status = action.status;
        if (action.priority) updates.priority = action.priority;
        if (action.owner) updates.assignee_id = action.owner === 'none' ? null : idOf(action.owner, 'U');
        if (action.due) updates.due_date = action.due === 'none' ? null : action.due;
        const { error } = await updateTask(taskId, updates);
        if (error) throw error;
        results.push({ ok: true, text: info.text, href: `#kanban?task=${encodeURIComponent(taskId)}` });
      } else if (action.type === 'comment') {
        const mentionIds = action.mention.map((ref) => idOf(ref, 'U')).filter(Boolean);
        const mentionText = action.mention.map((ref) => `@${titleOf(ref)}`).filter((tag) => !action.text.includes(tag)).join(' ');
        const text = `${action.text}${mentionText ? ` ${mentionText}` : ''}`;
        if (action.page) {
          const { error } = await createComment(idOf(action.page, 'G'), text, null, mentionIds);
          if (error) throw error;
          results.push({ ok: true, text: info.text, href: `#editor/${idOf(action.page, 'G')}` });
        } else {
          const taskId = idOf(action.task, 'T');
          const { error } = await createTaskComment(taskId, me, text, mentionIds);
          if (error) throw error;
          results.push({ ok: true, text: info.text, href: `#kanban?task=${encodeURIComponent(taskId)}` });
        }
      } else if (action.type === 'open') {
        const fixed = { home: 'dashboard', 'my-tasks': 'kanban?assignee=mine', 'all-tasks': 'kanban', 'team-chat': 'chat', settings: 'settings', team: 'settings?section=team' };
        const target = action.target;
        navigateTo = fixed[target]
          || (idOf(target, 'P') && `project/${idOf(target, 'P')}`)
          || (idOf(target, 'G') && `editor/${idOf(target, 'G')}`)
          || (idOf(target, 'T') && `kanban?task=${encodeURIComponent(idOf(target, 'T'))}`)
          || navigateTo;
        results.push({ ok: true, text: info.text, href: navigateTo ? `#${navigateTo}` : null });
      }
    } catch (error) {
      results.push({ ok: false, text: info.text, error: error?.message || String(error) });
    }
  }
  window.dispatchEvent(new CustomEvent('motion:pages-changed'));
  return { results, navigateTo };
}
