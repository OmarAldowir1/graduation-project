import { escapeHtml as esc } from './sanitize.js';

export const AI_BLOCK_TYPES = ['text','heading1','heading2','heading3','bulleted','numbered','todo','quote','callout','code','table','toggle','divider'];

export function validateAIPlan(input) {
  if (typeof input === 'string' && input.length > 100000) throw new Error('The proposal is too large (maximum 100 KB).');
  let plan;
  try { plan = typeof input === 'string' ? JSON.parse(input.trim().replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,'')) : input; }
  catch { throw new Error('Invalid JSON. Paste or upload the JSON exported by the notebook.'); }
  if (!plan || Array.isArray(plan) || plan.version !== 1) throw new Error('Expected a version 1 Motion proposal.');
  if (Object.keys(plan).some(key=>!['version','title','blocks'].includes(key))) throw new Error('Unexpected proposal field.');
  if (typeof plan.title !== 'string' || !plan.title.trim() || plan.title.length > 200) throw new Error('A proposal title of 1–200 characters is required.');
  if (!Array.isArray(plan.blocks) || !plan.blocks.length || plan.blocks.length > 40) throw new Error('A proposal must contain 1–40 blocks.');
  let total = 0;
  const blocks = plan.blocks.map((block,index) => {
    const fail = message => { throw new Error(`Block ${index + 1}: ${message}`); };
    if (!block || !AI_BLOCK_TYPES.includes(block.type)) fail('unsupported block type.');
    const allowed = block.type === 'table' ? ['type','rows'] : block.type === 'divider' ? ['type'] : ['type','content'];
    if (Object.keys(block).some(key=>!allowed.includes(key))) fail('unexpected field.');
    const result = {type:block.type};
    if (block.type === 'table') {
      if (!Array.isArray(block.rows) || !block.rows.length || block.rows.length > 20) fail('tables need 1–20 rows.');
      const width = block.rows[0]?.length;
      if (!Number.isInteger(width) || width < 1 || width > 8) fail('tables need 1–8 columns.');
      result.rows = block.rows.map(row => {
        if (!Array.isArray(row) || row.length !== width) fail('table rows must have the same number of columns.');
        return row.map(cell => { if(typeof cell !== 'string' || cell.length > 2000) fail('table cells must be text, up to 2,000 characters.'); total += cell.length; return cell; });
      });
    } else if (block.type !== 'divider') {
      if(typeof block.content !== 'string' || !block.content.trim() || block.content.length > 12000) fail('content must be nonempty text, up to 12,000 characters.');
      result.content = block.content; total += block.content.length;
    }
    return result;
  });
  if(total > 60000) throw new Error('Proposal content exceeds 60,000 characters.');
  return {version:1,title:plan.title.trim(),blocks};
}

export function aiBlockHtml(block) {
  const text = block.content || '';
  const lines = text.split('\n').filter(line=>line.trim());
  const htmlText = esc(text).replaceAll('\n','<br>');
  if(block.type.startsWith('heading')) { const tag = `h${block.type.at(-1)}`; return `<${tag}>${htmlText}</${tag}>`; }
  if(block.type === 'table') return `<table class="editor-simple-table"><tbody>${block.rows.map((row,index)=>`<tr>${row.map(cell=>`<${index ? 'td' : 'th'}>${esc(cell)}</${index ? 'td' : 'th'}>`).join('')}</tr>`).join('')}</tbody></table>`;
  if(block.type === 'bulleted' || block.type === 'numbered') { const tag = block.type === 'numbered' ? 'ol' : 'ul'; return `<${tag}>${lines.map(line=>`<li>${esc(line)}</li>`).join('')}</${tag}>`; }
  if(block.type === 'todo') return `<ul class="editor-todo-list">${lines.map(line=>`<li><label><input type="checkbox" /> <span>${esc(line)}</span></label></li>`).join('')}</ul>`;
  if(block.type === 'code') return `<pre><code>${esc(text)}</code></pre>`;
  if(block.type === 'quote') return `<blockquote>${htmlText}</blockquote>`;
  if(block.type === 'callout') return `<aside class="editor-callout"><span>💡</span><span>${htmlText}</span></aside>`;
  if(block.type === 'toggle') return `<details class="editor-toggle"><summary>${esc(lines[0])}</summary><p>${esc(lines.slice(1).join('\n')).replaceAll('\n','<br>')}</p></details>`;
  if(block.type === 'divider') return '<hr />';
  return `<p>${htmlText}</p>`;
}

export const AI_EXAMPLE = {version:1,title:'Example project plan (sample, not model output)',blocks:[
  {type:'heading1',content:'Restaurant Booking App'},
  {type:'text',content:'Build a responsive reservation app with customer bookings and a staff dashboard.'},
  {type:'heading2',content:'Implementation checklist'},
  {type:'todo',content:'Define the booking schema\nBuild the booking form\nValidate dates and availability\nTest access permissions'},
  {type:'table',rows:[['Layer','Tool','Purpose'],['Frontend','React','Booking interface'],['Backend','Supabase','Accounts and reservations']]},
  {type:'code',content:'function isValidPartySize(size) {\n  return Number.isInteger(size) && size > 0 && size <= 12;\n}'},
  {type:'callout',content:'Review generated requirements and code before using them.'}
]};
