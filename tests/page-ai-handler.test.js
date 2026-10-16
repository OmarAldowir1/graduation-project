import test from 'node:test';
import assert from 'node:assert/strict';
import { createPageAIHandler, FREE_MODEL } from '../supabase/functions/page-ai/handler.js';
import { AI_EXAMPLE } from '../src/lib/aiBlocks.js';
import { assistWithText } from '../src/lib/ai.js';

const pageId='82ad19ac-8435-4d0f-97bf-978f669db09e';
const origin='http://localhost:5173';
function fixture(overrides={}) {
  const calls=[];
  const settings={GEMINI_API_KEY:'test-key-not-a-real-key',MOTION_AI_BILLING_MODE:'unlinked-free-tier',MOTION_AI_ALLOWED_ORIGINS:origin};
  const handler=createPageAIHandler({
    env:key=>settings[key],authenticate:async()=>({id:'test-user'}),authorizePage:async()=>true,reserveQuota:async()=>({allowed:true}),
    fetchImpl:async(url,options)=>{calls.push({url,options});return Response.json({candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify(AI_EXAMPLE)}]}}]});},
    ...overrides
  });
  const invoke=(body={prompt:'Create a project plan',pageId},headers={},method='POST')=>handler(new Request('https://example.test/functions/v1/page-ai',{method,headers:{Origin:origin,Authorization:'Bearer test-session','Content-Type':'application/json',...headers},...(method==='POST'?{body:JSON.stringify(body)}:{})}));
  return {invoke,calls,settings};
}
test('valid authenticated request uses only the allowlisted provider and returns a validated draft',async()=>{
  const f=fixture();const response=await f.invoke();
  assert.equal(response.status,200);assert.deepEqual((await response.json()).plan,AI_EXAMPLE);
  assert.equal(f.calls.length,1);
  assert.equal(f.calls[0].url,`https://generativelanguage.googleapis.com/v1beta/models/${FREE_MODEL}:generateContent`);
  assert.ok(!f.calls[0].url.includes('test-key'));
  const options=f.calls[0].options;assert.equal(options.headers['x-goog-api-key'],'test-key-not-a-real-key');
  const payload=JSON.parse(options.body);
  assert.equal(payload.generationConfig.maxOutputTokens,6000);assert.equal(payload.generationConfig.responseMimeType,'application/json');
  assert.equal(payload.tools,undefined);assert.equal(payload.cachedContent,undefined);
  const contents=JSON.parse(payload.contents[0].parts[0].text);
  assert.equal(contents.page_context,'');assert.equal(contents.previous_draft,null);
  assert.equal(response.headers.get('Cache-Control'),'no-store');
});
test('disabled/unconfirmed billing and missing key fail closed before calling a provider',async()=>{
  for(const changes of [{MOTION_AI_BILLING_MODE:'disabled'},{MOTION_AI_BILLING_MODE:'paid'},{GEMINI_API_KEY:''}]){
    const f=fixture();Object.assign(f.settings,changes);
    const response=await f.invoke();assert.equal(response.status,503);assert.equal((await response.json()).error.code,'AI_NOT_CONFIGURED');assert.equal(f.calls.length,0);
  }
});
test('authentication and page access are checked before any generation',async()=>{
  for(const [overrides,status] of [[{authenticate:async()=>null},401],[{authorizePage:async()=>false},403]]){
    const f=fixture(overrides);assert.equal((await f.invoke()).status,status);assert.equal(f.calls.length,0);
  }
  const f=fixture();assert.equal((await f.invoke(undefined,{Authorization:''})).status,401);assert.equal(f.calls.length,0);
});
test('persistent quota denial and quota database failure never fall back or generate',async()=>{
  for(const reserveQuota of [async()=>({allowed:false}),async()=>{throw new Error('database secret detail');}]){
    const f=fixture({reserveQuota});const response=await f.invoke();assert.ok([429,503].includes(response.status));assert.equal(f.calls.length,0);assert.ok(!(await response.text()).includes('database secret detail'));
  }
});
test('reject arbitrary model/key/endpoint, bad IDs, long input, malformed prior drafts and oversized bodies',async()=>{
  const base={prompt:'test',pageId};
  for(const body of [null,[],{...base,model:'paid-model'},{...base,key:'secret'},{...base,endpoint:'https://attacker.test'},{...base,pageId:'not-a-uuid'},{...base,prompt:' '},{...base,prompt:'a'.repeat(4001)},{...base,pageContext:'x'.repeat(12001)},{...base,previousPlan:{bad:true}},{...base,prompt:'x'.repeat(180001)}]){
    const f=fixture();assert.ok([400,413].includes((await f.invoke(body)).status));assert.equal(f.calls.length,0);
  }
});
test('context and previous draft are sent only when explicitly supplied',async()=>{
  const f=fixture();await f.invoke({prompt:'Make this shorter',pageId,pageContext:'Opted-in page text',previousPlan:AI_EXAMPLE});
  const user=JSON.parse(JSON.parse(f.calls[0].options.body).contents[0].parts[0].text);
  assert.equal(user.page_context,'Opted-in page text');assert.deepEqual(user.previous_draft,AI_EXAMPLE);
});
test('provider quota, outages and timeout have clear errors without retry or secret leakage',async()=>{
  for(const providerStatus of [429,400,401,403,500,503]){
    let count=0;const f=fixture({fetchImpl:async()=>{count++;return Response.json({error:'provider-secret-detail'},{status:providerStatus});}});
    const response=await f.invoke();assert.equal(response.status,providerStatus===429?429:503);assert.equal(count,1);assert.ok(!(await response.text()).includes('provider-secret-detail'));
  }
  const f=fixture({fetchImpl:async()=>{throw new DOMException('secret','TimeoutError');}});assert.equal((await f.invoke()).status,504);
});
test('invalid, truncated, unsafe or empty model output is not offered for Apply',async()=>{
  for(const payload of [
    {candidates:[{finishReason:'MAX_TOKENS',content:{parts:[{text:JSON.stringify(AI_EXAMPLE)}]}}]},
    {promptFeedback:{blockReason:'SAFETY'}},
    {candidates:[{finishReason:'SAFETY'}]},
    {candidates:[{finishReason:'STOP',content:{parts:[{text:'not json'}]}}]},
    {candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify({...AI_EXAMPLE,blocks:[{type:'script',content:'execute'}]})}]}}]},
    {candidates:[]}
  ]){
    const f=fixture({fetchImpl:async()=>Response.json(payload)});const response=await f.invoke();assert.ok([422,502].includes(response.status));assert.equal((await response.json()).plan,undefined);
  }
});
test('CORS allowlist and method checks work without invoking dependencies',async()=>{
  const f=fixture();assert.equal((await f.invoke(undefined,{Origin:'https://attacker.test'})).status,403);
  const preflight=await f.invoke(undefined,{},'OPTIONS');assert.equal(preflight.status,204);assert.equal(preflight.headers.get('Access-Control-Allow-Origin'),origin);
  assert.equal((await f.invoke(undefined,{},'GET')).status,405);assert.equal(f.calls.length,0);
});
test('legacy text tools remain explicitly local, with no remote provider adapter',async()=>{
  const result=await assistWithText('build a demo. test it.','improve');
  assert.equal(result.source,'local');assert.equal(result.text,'Build a demo. Test it.');
});
