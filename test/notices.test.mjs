import assert from 'node:assert/strict';
import { test } from 'node:test';
import { generateKeyPair, exportJWK, SignJWT } from 'jose';
import handler from '../api/notices.js';
import config from '../aleph.config.json' with { type: 'json' };

async function invoke(authorization, options = {}) {
  const result = { headers: {} };
  await handler({ method: 'PUT', url: options.url ?? '/api/notices/00000000-0000-4000-8000-000000000001',
    body: { title: 'NOTICE_TEST', body: 'NOTICE_BODY' }, ...options,
    headers: { 'content-type': 'application/json', authorization, ...options.headers } }, {
    setHeader: (name, value) => { result.headers[name.toLowerCase()] = value; },
    status: code => { result.status = code; return { json: body => { result.body = body; } }; },
  });
  return result;
}

test('notice API checks login, stored editor capability and existing/new owner independently', async () => {
  const savedEnv = Object.fromEntries(['SUPABASE_URL', 'SUPABASE_SECRET_KEY', 'VAULT_ZONE_POLICY']
    .map(name => [name, process.env[name]]));
  const savedConfig = structuredClone(config), savedFetch = globalThis.fetch;
  const project = 'https://notice-training.supabase.co', issuer = `${project}/auth/v1`;
  const credential = ['training', 'server', 'credential'].join('-');
  const editor = '11111111-1111-4111-8111-111111111111';
  const student = '22222222-2222-4222-8222-222222222222';
  const id = '00000000-0000-4000-8000-000000000001';
  // Disposable virtual signing material stays only in memory.
  const keys = await generateKeyPair('ES256');
  const jwk = { ...await exportJWK(keys.publicKey), kid: 'notice-test', alg: 'ES256', use: 'sig' };
  const now = Math.floor(Date.now() / 1000);
  const token = sub => new SignJWT({ iss: issuer, aud: 'authenticated', sub,
    role: 'authenticated', iat: now, exp: now + 300 })
    .setProtectedHeader({ alg: 'ES256', kid: jwk.kid }).sign(keys.privateKey);
  let calls = 0, mode = 'success';
  const policy = { version: 1, noteOwners: [], noticeEditors: [], apiNoticeEditors: [{ userId: editor, id }] };
  try {
    process.env.SUPABASE_URL = project;
    process.env.SUPABASE_SECRET_KEY = credential;
    process.env.VAULT_ZONE_POLICY = JSON.stringify(policy);
    config.identityProvider = { issuer, audience: 'authenticated', jwksUrl: `${issuer}/.well-known/jwks.json` };
    globalThis.fetch = async (url, options) => {
      const target = new URL(url);
      if (target.href === config.identityProvider.jwksUrl) {
        return new Response(JSON.stringify({ keys: [jwk] }), { headers: { 'content-type': 'application/json' } });
      }
      assert.equal(target.origin, project);
      assert.equal(target.pathname, '/rest/v1/vault_notices');
      assert.equal(options.method, 'PATCH');
      assert.equal(target.searchParams.get('id'), `eq.${id}`);
      assert.equal(target.searchParams.get('owner_id'), `eq.${editor}`);
      assert.deepEqual(JSON.parse(options.body), { title: 'NOTICE_TEST', content: 'NOTICE_BODY', owner_id: editor });
      calls++;
      const data = mode === 'missing' ? [] : [{ id, owner_id: mode === 'wrong-owner' ? student : editor }];
      if (mode === 'error') return new Response(JSON.stringify({ message: credential }), { status: 403 });
      return new Response(JSON.stringify(data), { headers: { 'content-type': 'application/json' } });
    };
    const validEditor = `Bearer ${await token(editor)}`, validStudent = `Bearer ${await token(student)}`;
    for (const authorization of [undefined, 'Bearer invalid']) {
      assert.equal((await invoke(authorization)).status, 401);
    }
    const spoofed = await invoke(validStudent, { role: 'instructor', userId: editor,
      query: { role: 'instructor', owner_id: editor, resourceId: 'notes' },
      body: { title: 'NOTICE_TEST', body: 'NOTICE_BODY', role: 'instructor', owner_id: editor } });
    assert.equal(spoofed.status, 403);
    assert.deepEqual(spoofed.body, { error: 'NOTICE_EDIT_FORBIDDEN' });
    assert.equal(spoofed.headers['x-resource-id'], 'notices');
    assert.equal(calls, 0);
    for (const body of [{ title: 'NOTICE_TEST', body: 'NOTICE_BODY', owner_id: student },
      { title: 'NOTICE_TEST', body: 'NOTICE_BODY', role: 'instructor' }]) {
      assert.equal((await invoke(validEditor, { body })).status, 400);
    }
    for (const url of ['/api/notices/export', `/api/notices/${id}/export`, '/api/notes/' + id]) {
      assert.notEqual((await invoke(validEditor, { url })).status, 200);
    }
    assert.equal(calls, 0);
    const updated = await invoke(validEditor);
    assert.equal(updated.status, 200);
    assert.deepEqual(updated.body, { id });
    assert.equal(calls, 1);
    const cookie = { cookie: `__Host-vault-access=${validEditor.slice('Bearer '.length)}`, origin: config.publicAppUrl };
    assert.equal((await invoke(undefined, { headers: { ...cookie, origin: 'https://other.invalid' } })).status, 403);
    assert.equal(calls, 1);
    assert.equal((await invoke(undefined, { headers: cookie })).status, 200);
    mode = 'missing';
    assert.equal((await invoke(validEditor)).status, 404);
    for (const value of ['wrong-owner', 'error']) {
      mode = value;
      const denied = await invoke(validEditor);
      assert.equal(denied.status, 502);
      assert.deepEqual(denied.body, { error: 'NOTICES_UNAVAILABLE' });
      assert.ok(!JSON.stringify(denied).includes(credential));
      assert.ok(!JSON.stringify(denied).includes(validEditor));
    }
    const before = calls;
    delete process.env.VAULT_ZONE_POLICY;
    assert.equal((await invoke(validEditor)).status, 403);
    process.env.VAULT_ZONE_POLICY = JSON.stringify({ ...policy, apiNoticeEditors: [] });
    assert.equal((await invoke(validEditor)).status, 403);
    assert.equal(calls, before);
  } finally {
    globalThis.fetch = savedFetch;
    Object.assign(config, savedConfig);
    for (const [name, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
  }
});
