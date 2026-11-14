import {invokeAI} from './cloudflareAI.js';

export async function chatWithMotionAI({messages = [], newUserPrompt, attachedFile, workspaceContext, pageContext}) {
  const history = messages.slice(-10).filter(m => m?.text).map(m => ({
    role: m.sender === 'user' ? 'user' : 'assistant',
    content: String(m.text).slice(0, 2000)
  }));
  const result = await invokeAI('text-ai', {
    mode: 'chat',
    prompt: newUserPrompt,
    messages: history,
    ...(workspaceContext?.name ? {workspaceName: String(workspaceContext.name).slice(0, 200)} : {}),
    ...(pageContext ? {pageContext: {title: String(pageContext.title || 'Untitled').slice(0, 200), text: String(pageContext.text || '').slice(0, 12000)}} : {}),
    ...(attachedFile ? {attachment: {name: String(attachedFile.name).slice(0, 200), content: String(attachedFile.content || '').slice(0, 16000)}} : {})
  });
  if (typeof result.text !== 'string' || !result.text.trim()) throw new Error('AI returned an empty response.');
  return result.text.trim();
}
