import {validateAIPlan} from './aiBlocks.js';
import {invokeAI} from './cloudflareAI.js';

export async function generatePageDraft({prompt, pageId, pageContext, previousPlan}, signal) {
  const result = await invokeAI('cloudflare-page-ai', {
    prompt,
    pageId,
    ...(pageContext ? {pageContext} : {}),
    ...(previousPlan ? {previousPlan} : {})
  }, signal);
  return validateAIPlan(result.plan);
}
