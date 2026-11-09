// Live co-editing for a page: Yjs CRDT + y-quill binding, synced over a Supabase
// Realtime broadcast channel (no extra server). The page is still saved as HTML by
// the editor's normal autosave; this layer only keeps open editors in sync and
// shows teammates' cursors.
//
// Join protocol:
//  1. Subscribe and announce presence (with join time).
//  2. Ask peers for their document state ("sync-request").
//  3. If a peer answers, adopt the shared document. If nobody is there (or this
//     client joined first), seed the shared document from the saved page.
import * as Y from 'yjs';
import { QuillBinding } from 'y-quill';
import * as awarenessProtocol from 'y-protocols/awareness';
import { supabase } from './supabase.js';

const COLORS = ['#6366f1', '#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#ec4899', '#8b5cf6', '#14b8a6'];

function toBase64(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}
function fromBase64(text) {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
function colorFor(id = '') {
  let hash = 0;
  for (const char of String(id)) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return COLORS[hash % COLORS.length];
}

// Returns { stop(), peerCount() }. onPeersChange(list of { name, color }) is called when people join/leave.
export function startLiveCollaboration({ quill, pageId, user, onPeersChange = () => {}, onStatus = () => {} }) {
  const doc = new Y.Doc();
  const ytext = doc.getText('page');
  const awareness = new awarenessProtocol.Awareness(doc);
  const me = { id: user?.id || `guest-${doc.clientID}`, name: user?.name || 'Teammate', color: colorFor(user?.id) };
  const joinedAt = Date.now();
  const clientKey = `${me.id}:${doc.clientID}`;
  awareness.setLocalStateField('user', { name: me.name, color: me.color });

  let binding = null;
  let stopped = false;
  let seedTimer = null;
  const channel = supabase.channel(`page-live-${pageId}`, { config: { broadcast: { self: false }, presence: { key: clientKey } } });
  const send = (event, payload) => channel.send({ type: 'broadcast', event, payload });

  const others = () => Object.entries(channel.presenceState())
    .filter(([key]) => key !== clientKey)
    .map(([, metas]) => metas[0])
    .filter(Boolean);

  const bind = () => {
    if (binding || stopped) return;
    binding = new QuillBinding(ytext, quill, awareness);
    onStatus('live');
  };

  const seedFromEditor = () => {
    if (binding || stopped) return;
    if (ytext.length === 0) {
      // Seed the shared document with the page as it is in the editor now.
      doc.transact(() => ytext.applyDelta(quill.getContents().ops), 'seed');
    }
    bind();
  };

  doc.on('update', (update, origin) => {
    if (origin === 'remote' || stopped) return;
    send('update', { u: toBase64(update) });
  });
  awareness.on('update', ({ added, updated, removed }, origin) => {
    if (origin === 'remote' || stopped) return;
    const changed = [...added, ...updated, ...removed];
    send('awareness', { u: toBase64(awarenessProtocol.encodeAwarenessUpdate(awareness, changed)) });
  });

  channel
    .on('broadcast', { event: 'update' }, ({ payload }) => {
      Y.applyUpdate(doc, fromBase64(payload.u), 'remote');
      // Someone else seeded first: adopt their document.
      if (!binding && ytext.length > 0) bind();
    })
    .on('broadcast', { event: 'awareness' }, ({ payload }) => {
      awarenessProtocol.applyAwarenessUpdate(awareness, fromBase64(payload.u), 'remote');
    })
    .on('broadcast', { event: 'sync-request' }, ({ payload }) => {
      if (!binding || ytext.length === 0) return;
      const diff = Y.encodeStateAsUpdate(doc, payload.sv ? fromBase64(payload.sv) : undefined);
      send('sync-reply', { to: payload.from, u: toBase64(diff) });
      send('awareness', { u: toBase64(awarenessProtocol.encodeAwarenessUpdate(awareness, [doc.clientID])) });
    })
    .on('broadcast', { event: 'sync-reply' }, ({ payload }) => {
      if (payload.to !== clientKey) return;
      Y.applyUpdate(doc, fromBase64(payload.u), 'remote');
      if (ytext.length > 0) bind();
    })
    .on('presence', { event: 'sync' }, () => {
      onPeersChange(others().map((meta) => ({ name: meta.name, color: meta.color })));
    })
    .subscribe(async (status) => {
      if (status !== 'SUBSCRIBED' || stopped) return;
      await channel.track({ name: me.name, color: me.color, joinedAt });
      send('sync-request', { from: clientKey, sv: toBase64(Y.encodeStateVector(doc)) });
      // Wait briefly for an answer. If someone who joined earlier is here, give them
      // longer to answer before seeding, to avoid two people seeding at once.
      const decide = () => {
        if (binding || stopped) return;
        const earlier = others().some((meta) => (meta.joinedAt || 0) < joinedAt);
        if (earlier && Date.now() - joinedAt < 6000) {
          seedTimer = window.setTimeout(decide, 700);
          return;
        }
        seedFromEditor();
      };
      seedTimer = window.setTimeout(decide, 900);
    });

  return {
    peerCount: () => others().length,
    stop() {
      stopped = true;
      window.clearTimeout(seedTimer);
      try { awarenessProtocol.removeAwarenessStates(awareness, [doc.clientID], 'local'); } catch { /* ignore */ }
      binding?.destroy();
      supabase.removeChannel(channel);
      doc.destroy();
    }
  };
}
