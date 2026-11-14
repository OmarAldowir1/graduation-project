import {invokeAI} from './cloudflareAI.js';

export async function executeAIAction({text, action, tone, language, signal}) {
  if (!text?.trim()) throw new Error('Please select some text first.');
  const result = await invokeAI('text-ai', {mode: 'edit', text, action, tone, language}, signal);
  if (typeof result.text !== 'string' || !result.text.trim()) throw new Error('AI returned an empty response.');
  return result.text.trim();
}
