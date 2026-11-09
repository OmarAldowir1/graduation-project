import test from 'node:test';
import assert from 'node:assert/strict';
import {createPageAIHandler} from '../supabase/functions/cloudflare-page-ai/handler.js';
import {FREE_MODEL} from '../supabase/functions/_shared/cloudflareAI.js';
import {AI_EXAMPLE} from '../src/lib/aiBlocks.js';
import {assistWithText} from '../src/lib/ai.js';

const pageId = '82ad19ac-8435-4d0f-97bf-978f669db09e';
const origin = 'http://localhost:5173';
const accountId = 'a'.repeat(32);
function fixture(overrides = {}) {
  const calls = [];
  const settings = {CLOUDFLARE_AI_TOKEN: 'test-token', CLOUDFLARE_ACCOUNT_ID: accountId, MOTION_AI_CLOUDFLARE_PLAN: 'workers-free', MOTION_AI_ALLOWED_ORIGINS: origin};
  const handler = createPageAIHandler({
    env: key => settings[key], authenticate: async () => ({id: 'test-user'}), authorizePage: async () => true, reserveQuota: async () => ({allowed: true}),
    fetchImpl: async (url, options) => { calls.push({url, options}); return Response.json({success: true, result: {response: JSON.stringify(AI_EXAMPLE)}}); },
    ...overrides
  });
  const invoke = (body = {prompt: 'Create a project plan', pageId}, headers = {}, method = 'POST') => handler(new Request('https://example.test/functions/v1/page-ai', {method, headers: {Origin: origin, Authorization: 'Bearer test-session', 'Content-Type': 'application/json', ...headers}, ...(method === 'POST' ? {body: JSON.stringify(body)} : {})}));
  return {invoke, calls, settings};
}

test('page drafts use only the fixed Cloudflare model and preserve access controls', async () => {
  const f = fixture();
  const response = await f.invoke();
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).plan, AI_EXAMPLE);
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].url, `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${FREE_MODEL}`);
  assert.equal(f.calls[0].options.headers.Authorization, 'Bearer test-token');
  const payload = JSON.parse(f.calls[0].options.body);
  assert.equal(payload.response_format.type, 'json_object');
  assert.equal(payload.max_tokens, 3000);
  assert.equal(payload.messages[0].role, 'system');
  assert.equal(JSON.parse(payload.messages[1].content).page_context, '');
  assert.equal(payload.model, undefined);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
});

test('unconfirmed Free plan and missing credentials never contact Cloudflare', async () => {
  for (const changes of [{MOTION_AI_CLOUDFLARE_PLAN: 'paid'}, {MOTION_AI_CLOUDFLARE_PLAN: ''}, {CLOUDFLARE_AI_TOKEN: ''}, {CLOUDFLARE_ACCOUNT_ID: 'invalid'}]) {
    const f = fixture(); Object.assign(f.settings, changes);
    const response = await f.invoke();
    assert.equal(response.status, 503);
    assert.equal((await response.json()).error.code, 'AI_NOT_CONFIGURED');
    assert.equal(f.calls.length, 0);
  }
});

test('authentication, page permission and quota gate generation', async () => {
  for (const [overrides, status] of [[{authenticate: async () => null}, 401], [{authorizePage: async () => false}, 403], [{reserveQuota: async () => ({allowed: false})}, 429]]) {
    const f = fixture(overrides);
    assert.equal((await f.invoke()).status, status);
    assert.equal(f.calls.length, 0);
  }
  const f = fixture();
  assert.equal((await f.invoke(undefined, {Authorization: ''})).status, 401);
});

test('bad requests cannot pick a model, URL or key', async () => {
  const base = {prompt: 'test', pageId};
  for (const body of [null, [], {...base, model: 'paid'}, {...base, key: 'secret'}, {...base, endpoint: 'https://attacker.test'}, {...base, pageId: 'bad'}, {...base, prompt: ' '}, {...base, prompt: 'a'.repeat(4001)}, {...base, pageContext: 'x'.repeat(12001)}]) {
    const f = fixture();
    assert.equal((await f.invoke(body)).status, 400);
    assert.equal(f.calls.length, 0);
  }
});

test('provider errors and malformed output fail without retry or secret leakage', async () => {
  for (const status of [400, 401, 403, 429, 500]) {
    let calls = 0;
    const f = fixture({fetchImpl: async () => { calls++; return Response.json({errors: [{message: 'provider-secret'}]}, {status}); }});
    const response = await f.invoke();
    assert.equal(response.status, status === 429 ? 429 : 503);
    assert.equal(calls, 1);
    assert.ok(!(await response.text()).includes('provider-secret'));
  }
  for (const output of ['not json', JSON.stringify({...AI_EXAMPLE, blocks: [{type: 'script', content: 'unsafe'}]})]) {
    const f = fixture({fetchImpl: async () => Response.json({success: true, result: {response: output}})});
    assert.equal((await f.invoke()).status, 502);
  }
});

test('CORS and local text helpers remain bounded', async () => {
  const f = fixture();
  assert.equal((await f.invoke(undefined, {Origin: 'https://attacker.test'})).status, 403);
  assert.equal((await f.invoke(undefined, {}, 'OPTIONS')).status, 204);
  assert.equal((await f.invoke(undefined, {}, 'GET')).status, 405);
  assert.equal(f.calls.length, 0);
  assert.equal((await assistWithText('build a demo. test it.', 'improve')).source, 'local');
});
