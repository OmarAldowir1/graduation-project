import { supabase } from './supabase.js';
import { validateAIPlan } from './aiBlocks.js';

// End users never supply an API key or choose a provider. Provider credentials
// and the free-tier gate live exclusively in the authenticated Edge Function.
export async function generatePageDraft({prompt,pageId,pageContext,previousPlan},signal) {
  const {data,error:sessionError}=await supabase.auth.getSession();
  if(sessionError||!data?.session)throw new Error('Please sign in again to use AI.');
  const {data:result,error}=await supabase.functions.invoke('page-ai',{
    body:{prompt,pageId,...(pageContext ? {pageContext}:{}),...(previousPlan ? {previousPlan}:{})},
    signal
  });
  if(signal?.aborted)throw new DOMException('Generation stopped','AbortError');
  if(error){
    if(error.context instanceof Response){
      if(error.context.status===404)throw new Error('AI is not activated yet. Ask the workspace administrator to finish the free AI setup.');
      const payload=await error.context.json().catch(()=>null);
      if(payload?.error?.message){const failure=new Error(payload.error.message);failure.code=payload.error.code;throw failure;}
    }
    throw new Error('Could not reach AI. Check your connection or ask the administrator to finish the free AI setup.');
  }
  return validateAIPlan(result?.plan);
}
