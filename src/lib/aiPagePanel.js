import { AI_EXAMPLE, validateAIPlan, aiBlockHtml } from './aiBlocks.js';
import { escapeHtml as esc } from './sanitize.js';

export function openAIPagePanel({pageTitle, pageText, applyBlocks, undoApply}) {
  document.querySelector('.ai-page-backdrop')?.dispatchEvent(new Event('motion:close'));
  const overlay = document.createElement('div');
  overlay.className = 'task-detail-backdrop ai-page-backdrop';
  overlay.innerHTML = `<section class="task-detail-panel ai-page-panel" role="dialog" aria-modal="true" aria-label="AI page assistant">
    <header><div><small>FREE COLAB PROTOTYPE</small><h2>AI page assistant</h2></div><button data-close aria-label="Close AI page assistant">×</button></header>
    <p class="ai-panel-help">Generate in the Colab notebook, then import the result here. No API calls or automatic page uploads.</p>
    <a href="https://colab.research.google.com/github/OmarAldowir1/graduation-project/blob/codex/page-ai-prototype/colab/Motion_Page_AI.ipynb" target="_blank" rel="noopener noreferrer">Open free Colab notebook ↗</a>
    <label>Your request<textarea data-prompt rows="3" maxlength="4000" placeholder="Create a project plan for a restaurant booking app using React."></textarea></label>
    <label class="ai-context-choice"><input type="checkbox" data-context /> Include current page text when copying the request</label>
    <button class="modal-btn-secondary" data-copy>Copy request for Colab</button>
    <label>Generated JSON<textarea data-json rows="7" placeholder="Paste the notebook’s version 1 JSON proposal here."></textarea></label>
    <div class="ai-panel-buttons"><label class="ai-file-label">Upload JSON<input data-file type="file" accept=".json,application/json" /></label><button class="modal-btn-secondary" data-example>Load sample</button><button class="modal-btn-primary" data-preview>Preview</button></div>
    <p data-status role="status"></p><div data-results></div>
    <footer class="ai-panel-buttons"><button class="modal-btn-secondary" data-cancel>Cancel preview</button><button class="modal-btn-secondary" data-undo>Undo last AI apply</button><button class="modal-btn-primary" data-apply disabled>Apply selected blocks</button></footer>
  </section>`;
  const priorFocus = document.activeElement;
  const panel = overlay.querySelector('section');
  let plan = null;
  let busy = false;
  const status = overlay.querySelector('[data-status]');
  const json = overlay.querySelector('[data-json]');
  const results = overlay.querySelector('[data-results]');
  const apply = overlay.querySelector('[data-apply]');
  const close = () => { if(busy) return; overlay.remove(); window.removeEventListener('hashchange',close); if(priorFocus?.isConnected) priorFocus.focus(); };
  overlay.addEventListener('motion:close',close);
  overlay.querySelector('[data-close]').addEventListener('click',close);
  overlay.addEventListener('click',event=>{if(event.target===overlay) close();});
  window.addEventListener('hashchange',close);
  overlay.addEventListener('keydown',event=>{
    if(event.key==='Escape') {event.stopPropagation(); close();}
    if(event.key==='Tab') { const controls=[...panel.querySelectorAll('button,input,textarea,a')].filter(el=>!el.disabled); if(event.shiftKey&&document.activeElement===controls[0]){event.preventDefault();controls.at(-1).focus();}else if(!event.shiftKey&&document.activeElement===controls.at(-1)){event.preventDefault();controls[0].focus();} }
  });
  function invalidate() {plan=null;results.innerHTML='';apply.disabled=true;}
  json.addEventListener('input',invalidate);
  overlay.querySelector('[data-copy]').addEventListener('click',async()=>{
    const request=overlay.querySelector('[data-prompt]').value.trim();
    if(!request){status.textContent='Describe the page you want first.';return;}
    const text=JSON.stringify({request,page_context:overlay.querySelector('[data-context]').checked ? `${pageTitle}\n${pageText}`.slice(0,12000):''},null,2);
    try{await navigator.clipboard.writeText(text);status.textContent='Request copied. Paste it into the notebook’s REQUEST_JSON field.';}
    catch{json.value=text;invalidate();status.textContent='Clipboard unavailable. Copy the request shown in the JSON field into Colab.';}
  });
  overlay.querySelector('[data-file]').addEventListener('change',async event=>{
    const file=event.target.files?.[0]; if(!file)return;
    invalidate();if(file.size>100000){status.textContent='File exceeds 100 KB.';return;}
    json.value=await file.text();status.textContent='JSON loaded. Click Preview.';
  });
  overlay.querySelector('[data-example]').addEventListener('click',()=>{json.value=JSON.stringify(AI_EXAMPLE,null,2);invalidate();status.textContent='Sample loaded for testing. This is not model-generated output.';});
  overlay.querySelector('[data-preview]').addEventListener('click',()=>{
    invalidate();try{plan=validateAIPlan(json.value);}catch(error){status.textContent=error.message;return;}
    results.innerHTML=`<h3>${esc(plan.title)}</h3><p class="ai-panel-help">Append to “${esc(pageTitle)}”. The current title and blocks stay unchanged.</p>${plan.blocks.map((block,index)=>`<article class="ai-proposed-block"><label class="ai-block-selection"><input type="checkbox" data-index="${index}" checked /> ${index+1}. ${esc(block.type)}</label><div class="motion-block-content">${aiBlockHtml(block)}</div></article>`).join('')}`;
    results.querySelectorAll('input:not([data-index])').forEach(input=>input.disabled=true);
    apply.disabled=false;status.textContent=`${plan.blocks.length} valid blocks. Select the ones you want to add.`;
  });
  results.addEventListener('change',()=>{apply.disabled=!results.querySelector('input[data-index]:checked');});
  overlay.querySelector('[data-cancel]').addEventListener('click',()=>{invalidate();status.textContent='Preview cancelled. Your page was not changed.';});
  async function run(action) {
    if(busy)return;busy=true;panel.querySelectorAll('button').forEach(button=>button.disabled=true);
    try{status.textContent=await action();}catch(error){status.textContent=error.message;}
    finally{busy=false;panel.querySelectorAll('button').forEach(button=>button.disabled=false);apply.disabled=!plan||!results.querySelector('input[data-index]:checked');}
  }
  apply.addEventListener('click',()=>run(async()=>{
    if(!plan)throw new Error('Preview valid JSON first.');
    const selected=[...results.querySelectorAll('input[data-index]:checked')].map(input=>plan.blocks[Number(input.dataset.index)]);
    if(!selected.length)throw new Error('Select at least one block.');
    await applyBlocks(selected.map(aiBlockHtml).join('\n'));invalidate();return `${selected.length} blocks applied and saved. Undo is available.`;
  }));
  overlay.querySelector('[data-undo]').addEventListener('click',()=>run(async()=>{await undoApply();return 'Last AI addition removed and saved. Other page changes were preserved.';}));
  document.body.append(overlay);overlay.querySelector('[data-prompt]').focus();
}
