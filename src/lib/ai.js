// Deterministic local text tools, not generative AI. No network/provider calls.
// Generative page drafts use only the guarded page-ai Edge Function.

function localAssist(text, action) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  if (!clean) return 'Add some page content first.';

  if (action === 'summarize') {
    const sentences = clean.match(/[^.!?]+[.!?]+/g) || [clean];
    return sentences.slice(0, 3).join(' ').trim();
  }

  if (action === 'tasks') {
    const candidates = clean
      .split(/(?<=[.!?])\s+|\s*\n\s*|\s*[•-]\s*/)
      .map((item) => item.trim())
      .filter((item) => /\b(todo|task|action|follow up|need to|should|must|assign)\b/i.test(item));
    return candidates.length ? candidates.map((item) => `☐ ${item}`).join('\n') : 'No action items were detected.';
  }

  if (action === 'improve') {
    return clean.replace(/\s+/g, ' ').replace(/(^\w|[.!?]\s+\w)/g, (match) => match.toUpperCase());
  }

  return clean;
}

export async function assistWithText(text, action) {
  return { text: localAssist(text, action), source: 'local' };
}
