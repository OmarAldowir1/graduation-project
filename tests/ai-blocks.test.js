import test from 'node:test';
import assert from 'node:assert/strict';
import {AI_EXAMPLE, validateAIPlan, aiBlockHtml} from '../src/lib/aiBlocks.js';

test('sample contract supports safe generation of all example blocks',()=>{
  const plan=validateAIPlan(JSON.stringify(AI_EXAMPLE));
  assert.equal(plan.blocks.length,7);
  assert.match(aiBlockHtml(plan.blocks[4]),/<table/);
});
test('reject malformed, oversized, unsupported, and uneven proposals',()=>{
  for(const proposal of [
    '{invalid', 'x'.repeat(100001),
    {...AI_EXAMPLE,version:2},
    {...AI_EXAMPLE,blocks:[]},
    {...AI_EXAMPLE,blocks:[{type:'script',content:'alert(1)'}]},
    {...AI_EXAMPLE,blocks:[{type:'table',rows:[['A','B'],['C']]}]},
    {...AI_EXAMPLE,blocks:[{type:'text',content:'   '}]},
    {...AI_EXAMPLE,blocks:Array.from({length:6},()=>({type:'text',content:'x'.repeat(12000)}))}
  ]) assert.throws(()=>validateAIPlan(proposal));
});
test('model text is escaped even in code, tables, and headings',()=>{
  const payload='<img src=x onerror=alert(1)><script>alert(2)</script>';
  for(const block of [{type:'heading1',content:payload},{type:'code',content:payload},{type:'table',rows:[[payload]]}]){
    const html=aiBlockHtml(block);
    assert.ok(!html.includes('<script>'));
    assert.ok(!html.includes('<img'));
    assert.ok(html.includes('&lt;'));
  }
});
