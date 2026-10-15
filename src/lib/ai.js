// Optional AI adapter for Motion.
// Configure VITE_AI_ENDPOINT to connect a server-side provider. Never put a
// provider secret in VITE_* variables; browser-exposed variables are public.

const endpoint = import.meta.env.VITE_AI_ENDPOINT;

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
  if (!endpoint) return { text: localAssist(text, action), source: 'local' };

  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 12000);

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, text }),
      signal: controller.signal
    });
    if (!response.ok) throw new Error(`AI endpoint returned ${response.status}`);
    const payload = await response.json();
    const result = payload.text || payload.result || payload.output;
    if (!result) throw new Error('AI endpoint returned an empty response');
    return { text: String(result), source: 'remote' };
  } catch (error) {
    return { text: localAssist(text, action), source: 'local', error };
  } finally {
    window.clearTimeout(timeout);
  }
}
