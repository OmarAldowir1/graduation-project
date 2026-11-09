import { useEffect, useState } from 'react';
import { fetchSharedPage } from '../lib/pageTools.js';
import { sanitizeHtml } from '../lib/sanitize.js';

// Read-only view of a page shared with "anyone with the link". No sign-in needed.
export default function SharedPage({ token }) {
  const [state, setState] = useState({ loading: true, page: null, error: '' });

  useEffect(() => {
    let cancelled = false;
    const valid = /^[0-9a-f-]{36}$/i.test(token || '');
    (valid ? fetchSharedPage(token) : Promise.resolve({ data: null }))
      .then(({ data, error }) => {
        if (cancelled) return;
        setState({ loading: false, page: data || null, error: error ? 'This link could not be opened right now.' : '' });
        if (data?.title) document.title = `${data.title} — shared from Motion`;
      });
    return () => { cancelled = true; };
  }, [token]);

  if (state.loading) {
    return <div className="shared-page shared-center"><div className="loading-spinner" /></div>;
  }
  if (!state.page) {
    return (
      <div className="shared-page shared-center">
        <span className="material-symbols-outlined shared-icon">link_off</span>
        <h1>This page isn’t available</h1>
        <p>{state.error || 'The link may have been turned off, or the page was archived.'}</p>
        <a href="#login">Go to Motion</a>
      </div>
    );
  }
  const { page } = state;
  const cover = /^https?:\/\//i.test(page.cover_url || '') ? page.cover_url : '';
  return (
    <div className="shared-page">
      <header className="shared-bar">
        <span>Shared from <strong>{page.team || 'a Motion team'}</strong> · read-only</span>
        <a href="#login">Open Motion</a>
      </header>
      <article className="shared-article">
        {cover ? <img className="shared-cover" src={cover} alt="" /> : null}
        <div className="shared-emoji">{page.icon || '📄'}</div>
        <h1>{page.title || 'Untitled'}</h1>
        <p className="shared-meta">Last updated {new Date(page.updated_at).toLocaleDateString(undefined, { dateStyle: 'medium' })}</p>
        <div className="editor-rich-content shared-content" dangerouslySetInnerHTML={{ __html: sanitizeHtml(page.html || '') }} />
      </article>
    </div>
  );
}
