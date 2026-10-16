import { validateAIPlan, aiBlockHtml } from './aiBlocks.js';
import { escapeHtml as esc } from './sanitize.js';
import { generatePageDraft } from './pageAI.js';

export function openAIPagePanel({pageId, pageTitle, pageText, applyBlocks, undoApply}) {
  document.querySelector('.ai-page-backdrop')?.dispatchEvent(new Event('motion:close'));
  const overlay = document.createElement('div');
  overlay.className = 'task-detail-backdrop ai-page-backdrop';
  overlay.innerHTML = `<section class="task-detail-panel ai-page-panel" role="dialog" aria-modal="true" aria-label="AI assistant">
    <header><div><small>YOUR PAGE, WITH A LITTLE HELP</small><h2>AI assistant</h2></div><button data-close aria-label="Close AI assistant">×</button></header>
    <p class="ai-panel-help">Tell me what you need. I’ll draft it here for you to review. Nothing changes on your page until you click Apply.</p>
    <div class="ai-prompt-suggestions" aria-label="Prompt ideas">
      <button data-idea="Create a programming project plan with an overview, implementation checklist and milestones table.">Plan a project</button>
      <button data-idea="Write a clear checklist for launching a new website.">Write a checklist</button>
      <button data-idea="Draft programming notes explaining a JavaScript function, with an example code block.">Draft code notes</button>
    </div>
    <label>What would you like to do?<textarea data-prompt rows="4" maxlength="4000" placeholder="For example: Plan a React project with tasks, milestones and a tools table."></textarea></label>
    <label class="ai-context-choice"><input type="checkbox" data-context /> Use this page’s text as context</label>
    <p class="ai-privacy-note">Your request and any draft you refine are sent to Google Gemini. Page text is shared only if you select it above. Free-tier inputs may be used to improve Google products. Don’t include secrets or sensitive information.</p>
    <div class="ai-panel-buttons"><button class="modal-btn-primary" data-generate disabled>Generate draft</button><button class="modal-btn-secondary" data-stop hidden>Stop generating</button></div>
    <p data-status role="status" aria-live="polite">Start with a request or choose an idea above.</p>
    <div data-results></div>
    <footer class="ai-panel-buttons"><button class="modal-btn-secondary" data-cancel disabled>Discard draft</button><button class="modal-btn-secondary" data-undo>Undo last AI apply</button><button class="modal-btn-primary" data-apply disabled>Apply selected blocks</button></footer>
  </section>`;
  const priorFocus = document.activeElement;
  const panel = overlay.querySelector('section');
  const prompt = panel.querySelector('[data-prompt]');
  const status = panel.querySelector('[data-status]');
  const results = panel.querySelector('[data-results]');
  const apply = panel.querySelector('[data-apply]');
  const generate = panel.querySelector('[data-generate]');
  const stop = panel.querySelector('[data-stop]');
  const discard = panel.querySelector('[data-cancel]');
  let plan = null;
  let operation = null;
  let controller = null;
  let requestId = 0;
  let closed = false;
  const close = () => {
    if(operation === 'save')return;
    closed = true; requestId++; controller?.abort();
    overlay.remove(); window.removeEventListener('hashchange',close);
    if(priorFocus?.isConnected)priorFocus.focus();
  };
  function updateControls() {
    panel.setAttribute('aria-busy', String(Boolean(operation)));
    prompt.disabled = Boolean(operation);
    panel.querySelector('[data-context]').disabled = Boolean(operation);
    panel.querySelectorAll('[data-idea]').forEach(button=>button.disabled=Boolean(operation));
    panel.querySelector('[data-close]').disabled = operation === 'save';
    generate.disabled = Boolean(operation) || !prompt.value.trim();
    generate.textContent = operation === 'generate' ? 'Generating…' : plan ? 'Refine draft' : 'Generate draft';
    stop.hidden = operation !== 'generate';
    discard.disabled = Boolean(operation) || !plan;
    panel.querySelector('[data-undo]').disabled = Boolean(operation);
    results.inert = Boolean(operation);
    apply.disabled = Boolean(operation) || !plan || !results.querySelector('input[data-index]:checked');
  }
  function clearDraft() {plan=null;results.innerHTML='';updateControls();}
  function renderDraft(next) {
    plan = validateAIPlan(next);
    results.innerHTML = `<div class="ai-draft-heading"><h3>${esc(plan.title)}</h3><span>Draft · ${plan.blocks.length} blocks</span></div><p class="ai-panel-help">Selected blocks will be added to “${esc(pageTitle)}”. Existing content and the page title stay unchanged.</p>${plan.blocks.map((block,index)=>`<article class="ai-proposed-block"><label class="ai-block-selection"><input type="checkbox" data-index="${index}" checked /> ${index+1}. ${esc(block.type)}</label><div class="motion-block-content">${aiBlockHtml(block)}</div></article>`).join('')}`;
    results.querySelectorAll('input:not([data-index])').forEach(input=>input.disabled=true);
  }
  overlay.addEventListener('motion:close',close);
  panel.querySelector('[data-close]').addEventListener('click',close);
  overlay.addEventListener('click',event=>{if(event.target===overlay)close();});
  window.addEventListener('hashchange',close);
  overlay.addEventListener('keydown',event=>{
    if(event.key==='Escape'){event.stopPropagation();close();}
    if(event.key==='Tab'){
      const controls=[...panel.querySelectorAll('button,input,textarea,a')].filter(el=>!el.disabled&&!el.hidden&&el.getClientRects().length&&!el.closest('[inert]'));
      if(event.shiftKey&&document.activeElement===controls[0]){event.preventDefault();controls.at(-1)?.focus();}
      else if(!event.shiftKey&&document.activeElement===controls.at(-1)){event.preventDefault();controls[0]?.focus();}
    }
    if((event.ctrlKey||event.metaKey)&&event.key==='Enter'&&document.activeElement===prompt){event.preventDefault();if(!generate.disabled)generate.click();}
  });
  prompt.addEventListener('input',updateControls);
  panel.querySelectorAll('[data-idea]').forEach(button=>button.addEventListener('click',()=>{prompt.value=button.dataset.idea;updateControls();prompt.focus();}));
  results.addEventListener('change',updateControls);
  generate.addEventListener('click',async()=>{
    if(operation||!prompt.value.trim())return;
    const id=++requestId;
    delete status.dataset.errorCode;
    operation='generate';controller=new AbortController();
    const runController=controller;
    const timeout=setTimeout(()=>runController.abort(),60000);
    updateControls();status.textContent=plan ? 'Refining your draft… Your page has not changed.' : 'Creating your draft… Your page has not changed.';
    try{
      const next=await generatePageDraft({
        prompt:prompt.value.trim(), pageId,
        ...(panel.querySelector('[data-context]').checked ? {pageContext:`${pageTitle}\n${pageText}`.slice(0,12000)}:{}),
        ...(plan ? {previousPlan:plan}:{})
      },runController.signal);
      if(closed||id!==requestId)return;
      renderDraft(next);
      status.textContent='Your draft is ready. Select blocks to apply, or change your request and click Refine draft.';
    }catch(error){
      if(!closed&&id===requestId){status.dataset.errorCode=error.code||'';status.textContent=error.name==='AbortError' ? 'Generation stopped or timed out. Your page has not changed.' : error.message;}
    }finally{
      clearTimeout(timeout);
      if(!closed&&id===requestId){operation=null;controller=null;updateControls();}
    }
  });
  stop.addEventListener('click',()=>{
    requestId++;controller?.abort();controller=null;operation=null;updateControls();
    status.textContent='Generation stopped. Your page has not changed. The attempt may still count toward the free limit.';
  });
  discard.addEventListener('click',()=>{clearDraft();status.textContent='Draft discarded. Your page was not changed.';prompt.focus();});
  async function save(action){
    if(operation)return;
    operation='save';updateControls();status.textContent='Saving…';
    try{status.textContent=await action();}catch(error){status.textContent=error.message;}
    finally{operation=null;updateControls();}
  }
  apply.addEventListener('click',()=>save(async()=>{
    const selected=[...results.querySelectorAll('input[data-index]:checked')].map(input=>plan.blocks[Number(input.dataset.index)]);
    if(!selected.length)throw new Error('Select at least one block.');
    await applyBlocks(selected.map(aiBlockHtml).join('\n'));
    clearDraft();return `${selected.length} blocks added and saved. You can undo this addition.`;
  }));
  panel.querySelector('[data-undo]').addEventListener('click',()=>save(async()=>{await undoApply();return 'Last AI addition removed and saved. Other changes were preserved.';}));
  document.body.append(overlay);prompt.focus();
}
