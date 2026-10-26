import { useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase.js';
import { setBreadcrumb } from '../legacy/app.js';

const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const BUCKET = 'workspace-chat-images';

// Stable per-user accent: reloading or switching workspaces keeps the same color.
function memberHue(userId) {
  let hash = 0;
  for (const character of userId || '') hash = (Math.imul(hash, 31) + character.charCodeAt(0)) >>> 0;
  return hash % 360;
}

function ChatImage({ path }) {
  const [url, setUrl] = useState('');
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let active = true;
    async function load() {
      const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, 600);
      if (active) { setUrl(data?.signedUrl || ''); setFailed(Boolean(error)); }
    }
    void load();
    const timer = window.setInterval(load, 540000);
    return () => { active = false; window.clearInterval(timer); };
  }, [path]);
  return failed ? <p>Image unavailable.</p> : url ? <a href={url} target="_blank" rel="noreferrer"><img className="team-chat-image" src={url} alt="Image shared by a workspace member" onError={() => setFailed(true)} /></a> : <p>Loading image…</p>;
}

export default function TeamChat({ workspace, user }) {
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState('');
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState('');
  const [error, setError] = useState('');
  const [connectionError, setConnectionError] = useState('');
  const [ready, setReady] = useState(false);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const input = useRef(null);
  const list = useRef(null);
  const nearBottom = useRef(true);
  const sendLock = useRef(false);
  const workspaceId = workspace?.id;

  useEffect(() => { setBreadcrumb('Team chat'); }, []);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);
  useEffect(() => {
    if (!workspaceId) return;
    let active = true;
    let pending = false;
    async function load() {
      if (pending) return;
      pending = true;
      const { data, error: loadError } = await supabase.from('workspace_messages')
        .select('id,user_id,body,image_path,created_at,sender:users(name)')
        .eq('workspace_id', workspaceId).order('created_at', { ascending: false }).order('id', { ascending: false }).limit(100);
      pending = false;
      if (!active) return;
      setLoading(false);
      if (loadError) {
        setReady(false);
        setConnectionError(['42P01', 'PGRST205'].includes(loadError.code)
          ? 'Team chat needs database setup. Run sql/team-chat.sql in this project’s Supabase SQL editor, then click Retry.'
          : `Could not load chat: ${loadError.message}`);
        return;
      }
      setMessages((data || []).reverse());
      setConnectionError(''); setReady(true);
    }
    void load();
    const timer = window.setInterval(() => { if (!document.hidden) void load(); }, 5000);
    return () => { active = false; window.clearInterval(timer); };
  }, [workspaceId, refresh]);
  useEffect(() => {
    if (nearBottom.current && list.current) list.current.scrollTop = list.current.scrollHeight;
  }, [messages]);

  function chooseImage(event) {
    const selected = event.target.files?.[0];
    if (!selected) return;
    if (!IMAGE_TYPES.includes(selected.type) || selected.size > 5 * 1024 * 1024) {
      setError('Choose a JPG, PNG, WebP or GIF image up to 5 MB.');
      event.target.value = '';
      return;
    }
    setError(''); setFile(selected); setPreview(URL.createObjectURL(selected));
  }

  async function send(event) {
    event.preventDefault();
    if (sendLock.current || !ready || (!text.trim() && !file) || !user?.id || !workspaceId) return;
    sendLock.current = true; setSending(true); setError('');
    let imagePath = null;
    try {
      const id = crypto.randomUUID();
      if (file) {
        const extension = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' }[file.type];
        imagePath = `${workspaceId}/${user.id}/${id}.${extension}`;
        const { error: uploadError } = await supabase.storage.from(BUCKET).upload(imagePath, file, { contentType: file.type, upsert: false });
        if (uploadError) throw uploadError;
      }
      const { error: sendError } = await supabase.from('workspace_messages').insert({ id, workspace_id: workspaceId, user_id: user.id, body: text.trim(), image_path: imagePath });
      if (sendError) throw sendError;
      setText(''); setFile(null); setPreview('');
      if (input.current) input.current.value = '';
      nearBottom.current = true; setRefresh(value => value + 1);
    } catch (sendError) {
      setError(`Could not send message: ${sendError.message}. Your draft is still here. Check the conversation before retrying.`);
    } finally {
      sendLock.current = false; setSending(false);
    }
  }

  if (!workspaceId) return <div className="empty-state"><h2>Select a workspace to chat</h2></div>;
  return <section className="team-chat" aria-label="Workspace team chat">
    <header><h1>Team chat</h1><p>{workspace.name} · Only this workspace’s members · Refreshes every 5 seconds</p></header>
    {connectionError && <div className="team-chat-error" role="alert">{connectionError} <button type="button" onClick={() => setRefresh(value => value + 1)}>Retry</button></div>}
    {error && <div className="team-chat-error" role="alert">{error}</div>}
    <div ref={list} className="team-chat-messages" aria-label="Messages" onScroll={() => {
      const el = list.current;
      nearBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 100;
    }}>
      {loading ? <p role="status">Loading conversation…</p> : !messages.length && !connectionError ? <div className="empty-state"><h2>Start the conversation</h2><p>Share an update or an image with your team.</p></div> : null}
      {messages.length === 100 && <p className="team-chat-caption">Showing the latest 100 messages.</p>}
      {messages.map(message => <article key={message.id} style={{ '--sender-hue': memberHue(message.user_id) }} className={`team-chat-message ${message.user_id === user?.id ? 'is-own' : ''}`}>
        <div className="team-chat-meta"><strong>{message.user_id === user?.id ? 'You' : message.sender?.name || 'Workspace member'}</strong><time dateTime={message.created_at} title={new Date(message.created_at).toLocaleString()}>{new Date(message.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time></div>
        {message.body && <p className="team-chat-body">{message.body}</p>}
        {message.image_path && <ChatImage path={message.image_path} />}
      </article>)}
    </div>
    <form className="team-chat-composer" onSubmit={send}>
      {file && <div className="team-chat-attachment">{preview && <img src={preview} alt="Selected image preview" />}<span>{file.name}</span><button type="button" disabled={sending} onClick={() => { setFile(null); setPreview(''); input.current.value = ''; }}>Remove image</button></div>}
      <label htmlFor="chat-message">Message your team</label>
      <textarea id="chat-message" value={text} onChange={event => setText(event.target.value)} maxLength={4000} rows={2} disabled={sending} placeholder="Write a message…" />
      <div className="team-chat-actions">
        <small>{text.length}/4000 · Images up to 5 MB</small>
        <input ref={input} type="file" accept={IMAGE_TYPES.join(',')} onChange={chooseImage} disabled={sending} hidden tabIndex={-1} />
        <button className="team-chat-attach-button" type="button" aria-label="Attach image" title="Attach image (up to 5 MB)" disabled={sending} onClick={() => input.current?.click()}>
          <span className="material-symbols-outlined" aria-hidden="true">attach_file</span>
        </button>
        <button className="modal-btn-primary" type="submit" disabled={sending || !ready || (!text.trim() && !file)}>{sending ? 'Sending…' : 'Send'}</button>
      </div>
    </form>
  </section>;
}
