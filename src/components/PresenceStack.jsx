import { useEffect, useRef, useState } from 'react';
import { joinFocus } from '../lib/focusZone.js';

const PLACES = {
  dashboard: 'Home',
  project: 'a project',
  notes: 'All pages',
  kanban: 'the task board',
  database: 'Table view',
  chat: 'Team chat',
  'ai-chat': 'AI chat',
  settings: 'Settings',
  profile: 'Profile'
};

function focusText(focus, now) {
  if (!focus) return '';
  if (focus.paused) return `🎯 Focusing on “${focus.title}” · paused`;
  const minutes = Math.max(0, Math.ceil((Number(focus.ends_at) - now) / 60000));
  return `🎯 Focusing on “${focus.title}” · ${minutes} min left`;
}

function describePlace(person) {
  if (person.path === 'editor' || person.path === 'project') return person.label ? `Viewing “${person.label}”` : 'Viewing a page';
  return PLACES[person.path] ? `On ${PLACES[person.path]}` : 'Online';
}

function initials(name) {
  return String(name || '?').trim().split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase() || '').join('') || '?';
}

function Avatar({ person, size = 28 }) {
  const url = /^https?:\/\//i.test(person.avatar_url || '') ? person.avatar_url : '';
  return url
    ? <img className="presence-avatar" src={url} alt="" style={{ width: size, height: size }} />
    : <span className="presence-avatar" style={{ width: size, height: size, background: person.color }} aria-hidden="true">{initials(person.name)}</span>;
}

// Teammates online in this workspace, and where they are.
export default function PresenceStack({ people, currentUserId, currentPageId }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (event) => { if (!ref.current?.contains(event.target)) setOpen(false); };
    const onKey = (event) => { if (event.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);

  // Refresh "min left" every 30 seconds while someone is focusing.
  const [now, setNow] = useState(() => Date.now());
  const anyFocus = people.some((person) => person.focus && person.user_id !== currentUserId);
  useEffect(() => {
    if (!anyFocus) return undefined;
    const id = window.setInterval(() => setNow(Date.now()), 30000);
    return () => window.clearInterval(id);
  }, [anyFocus]);

  const others = people.filter((person) => person.user_id !== currentUserId);
  if (!others.length) return null;
  const herePeople = currentPageId ? others.filter((person) => person.page_id === currentPageId) : [];
  const visible = others.slice(0, 4);

  return (
    <div className="presence-stack" ref={ref}>
      <button
        type="button"
        className="presence-trigger"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-label={`${others.length} teammate${others.length === 1 ? '' : 's'} online`}
        title={herePeople.length ? `${herePeople.map((person) => person.name).join(', ')} also on this page` : 'Who’s online'}
      >
        {visible.map((person) => (
          <span key={person.user_id} className={`presence-ring ${person.page_id && person.page_id === currentPageId ? 'is-here' : ''} ${person.focus ? 'is-focusing' : ''}`} title={person.focus ? focusText(person.focus, now) : undefined}>
            <Avatar person={person} />
            {person.focus ? <span className="presence-focus-badge" aria-hidden="true">🎯</span> : null}
          </span>
        ))}
        {others.length > visible.length ? <span className="presence-more">+{others.length - visible.length}</span> : null}
      </button>
      {open ? (
        <div className="presence-popover" role="dialog" aria-label="Online teammates">
          <p className="presence-popover-title">Online now · {others.length}</p>
          {others.map((person) => (
            <div key={person.user_id} className={`presence-row-wrap ${person.focus ? 'is-focusing' : ''}`}>
              <button
                type="button"
                className="presence-row"
                disabled={!person.page_id && !PLACES[person.path]}
                onClick={() => {
                  setOpen(false);
                  window.location.hash = person.page_id ? `editor/${person.page_id}` : (person.path || 'dashboard');
                }}
              >
                <span className="presence-ring is-online"><Avatar person={person} size={30} /></span>
                <span className="presence-row-text">
                  <strong>{person.name}</strong>
                  <small>{person.focus ? focusText(person.focus, now) : person.page_id && person.page_id === currentPageId ? 'On this page with you' : describePlace(person)}</small>
                </span>
                {!person.focus && person.page_id && person.page_id !== currentPageId ? <span className="material-symbols-outlined presence-go" aria-hidden="true">arrow_forward</span> : null}
              </button>
              {person.focus && !person.focus.paused && Number(person.focus.ends_at) - now > 120000 ? (
                <button type="button" className="presence-join" onClick={() => { setOpen(false); joinFocus({ endsAt: Number(person.focus.ends_at), withName: person.name }); }} title={`Focus at the same time as ${person.name}`}>Join</button>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
