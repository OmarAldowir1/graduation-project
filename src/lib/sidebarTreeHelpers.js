// Helper functions for page nesting, ancestor validation, and drag-and-drop

export function isPageDescendant(candidateId, ancestorId, pages = []) {
  const byId = new Map(pages.map((p) => [p.id, p]));
  const seen = new Set();
  let current = byId.get(candidateId);
  while (current?.parent_id && !seen.has(current.id)) {
    if (current.parent_id === ancestorId) return true;
    seen.add(current.id);
    current = byId.get(current.parent_id);
  }
  return false;
}

export function getDraggedPageId(e) {
  if (!e || !e.dataTransfer) {
    return (typeof window !== 'undefined' && window.__motionDraggingPageId) || null;
  }
  let id = '';
  try {
    id = e.dataTransfer.getData('application/x-page-id');
  } catch {
    // ignore
  }
  if (!id) {
    try {
      id = e.dataTransfer.getData('text/plain');
    } catch {
      // ignore
    }
  }
  if (!id && typeof window !== 'undefined' && window.__motionDraggingPageId) {
    id = window.__motionDraggingPageId;
  }
  if (!id) return null;
  if (id.includes('#editor/')) {
    id = id.split('#editor/')[1]?.split('?')[0]?.trim();
  } else if (id.includes('/editor/')) {
    id = id.split('/editor/')[1]?.split('?')[0]?.trim();
  }
  return id || null;
}

export function buildTreeHierarchy(pages = []) {
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
}

