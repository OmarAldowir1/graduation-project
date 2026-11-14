import { useEffect, useRef } from 'react';
import { pickAndFocus } from '../lib/focusZone.js';

const IDEAS = [
  { icon: 'groups', title: 'Team', text: 'The people you work with. Invite them from Settings → Team.' },
  { icon: 'folder', title: 'Project', text: 'One goal, like your graduation project, with its plan, tasks and pages.' },
  { icon: 'diversity_3', title: 'Teams in a project', text: 'Split big work (Design, Backend…). Each team has a leader who manages its tasks.' },
  { icon: 'task_alt', title: 'Task', text: 'One thing to do, with an owner, a due date and a progress %.' },
  { icon: 'description', title: 'Page', text: 'Notes and documents. Type / for headings and lists, @ to mention someone.' }
];

const SHORTCUTS = [
  ['⌘ / Ctrl + K', 'Search everything'],
  ['/', 'Add a block in a page'],
  ['@', 'Mention a teammate'],
  ['⌘ / Ctrl + \\', 'Show or hide the sidebar'],
  ['Space', 'Pause or resume Focus'],
  ['Right-click your picture', 'Edit profile or log out'],
  ['?', 'Open this help']
];

// "How Groupify works": the main ideas, the weekly flow with buttons that do it,
// and shortcuts. Opens from the ? button or the ? key.
export default function HelpPanel({ open, onClose, project, onNewProject }) {
  const panelRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    panelRef.current?.focus();
    const onKey = (event) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;
  const go = (hash) => { onClose(); window.location.assign(`#${hash}`); };
  const projectHash = (tab = '') => (project ? `project/${project.id}${tab ? `/${tab}` : ''}` : null);
  const steps = [
    { n: 1, title: 'Plan', text: 'Create a project, or ask the AI to plan it for you.', actions: [{ label: 'New project', run: () => { onClose(); onNewProject(); } }, { label: 'Ask AI to plan', run: () => go('ai-chat') }] },
    { n: 2, title: 'Split the work', text: 'Add teams with leaders, then tasks with owners and dates.', actions: project ? [{ label: 'Open Teams', run: () => go(projectHash('teams')) }] : [] },
    { n: 3, title: 'Do the work', text: 'Pick a task and use Focus: a timer with no distractions.', actions: [{ label: 'Start Focus', run: () => { onClose(); pickAndFocus(); } }] },
    { n: 4, title: 'Check in weekly', text: 'Share what you did, what’s next and what’s blocking you.', actions: project ? [{ label: 'Check in', run: () => go(projectHash('checkins')) }] : [] },
    { n: 5, title: 'Report progress', text: 'One click makes a report for your team or supervisor.', actions: project ? [{ label: 'Open Overview', run: () => go(projectHash()) }] : [] }
  ];

  return (
    <div className="help-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <aside className="help-panel" role="dialog" aria-modal="true" aria-label="How Groupify works" ref={panelRef} tabIndex={-1}>
        <header className="help-head">
          <div><p className="gs-eyebrow">Help</p><h2>How Groupify works</h2></div>
          <button type="button" className="team-icon-btn" onClick={onClose} aria-label="Close help"><span className="material-symbols-outlined">close</span></button>
        </header>

        <section className="help-section">
          <h3>The main ideas</h3>
          <ul className="help-ideas">
            {IDEAS.map((idea) => (
              <li key={idea.title}><span className="material-symbols-outlined">{idea.icon}</span><div><strong>{idea.title}</strong><p>{idea.text}</p></div></li>
            ))}
          </ul>
        </section>

        <section className="help-section">
          <h3>Your week in 5 steps{project ? <small> · {project.icon || '📁'} {project.title}</small> : null}</h3>
          <ol className="help-steps">
            {steps.map((step) => (
              <li key={step.n}>
                <span className="help-step-n">{step.n}</span>
                <div>
                  <strong>{step.title}</strong>
                  <p>{step.text}</p>
                  {step.actions.length ? <div className="help-step-actions">{step.actions.map((action) => <button key={action.label} type="button" onClick={action.run}>{action.label}</button>)}</div> : null}
                </div>
              </li>
            ))}
          </ol>
          {!project ? <p className="help-note">Create a project to unlock Teams, Check-ins and reports.</p> : null}
        </section>

        <section className="help-section">
          <h3>Handy shortcuts</h3>
          <dl className="help-keys">
            {SHORTCUTS.map(([keys, text]) => <div key={keys}><dt><kbd>{keys}</kbd></dt><dd>{text}</dd></div>)}
          </dl>
        </section>

        <p className="help-foot"><span className="material-symbols-outlined">auto_awesome</span> Still unsure? Ask the AI “How do I…?” — it knows your projects.</p>
      </aside>
    </div>
  );
}
