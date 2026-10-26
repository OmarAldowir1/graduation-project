import { escapeHtml as esc } from './sanitize.js';

export { AI_BLOCK_TYPES, validateAIPlan } from '../../supabase/functions/_shared/aiContract.js';
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
