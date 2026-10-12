import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { generateKeyPair, exportJWK, SignJWT } from 'jose';
import handler from '../api/notes.js';
import config from '../aleph.config.json' with { type: 'json' };

const fakeSecret = ['test', 'server', 'credential'].join('-');
const notes = Array.from({ length: 4 }, (_, i) => ({
  id: `00000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`, title: `TEST ${i}`, body: `BODY ${i}`,
}));

async function invoke({ method = 'GET', authorization, url = '/api/notes', headers = {}, ...untrusted } = {}) {
  const result = { headers: {} };
  await handler({ method, url, headers: { 'content-type': 'application/json', authorization, ...headers }, ...untrusted }, {
    setHeader: (name, value) => { result.headers[name.toLowerCase()] = value; },
    status: code => {
      result.status = code;
      return { json: body => { result.body = body; }, end: () => {} };
    },
  });
  return result;
}

test('notes API uses the unchanged starter verifier before every note query', async t => {
  const saved = {
    url: process.env.SUPABASE_URL, key: process.env.SUPABASE_SECRET_KEY,
    fetch: globalThis.fetch, config: structuredClone(config),
  };
  const logging = Object.fromEntries(['log', 'warn', 'error'].map(name => [name, console[name]]));
  const logs = [];
  // Disposable signing material stays in memory; no real account or stored JWT.
  const keys = await generateKeyPair('ES256');
  const wrongKeys = await generateKeyPair('ES256');
  const jwk = { ...await exportJWK(keys.publicKey), kid: 'training-key', alg: 'ES256', use: 'sig' };
  const project = 'https://training.supabase.co';
  const issuer = `${project}/auth/v1`;
  const sub = '11111111-1111-4111-8111-111111111111';
  const now = Math.floor(Date.now() / 1000);
  const claims = { iss: issuer, aud: 'authenticated', sub, role: 'authenticated', iat: now, exp: now + 300 };
  const sign = (payload, key = keys.privateKey) => new SignJWT(payload)
    .setProtectedHeader({ alg: 'ES256', kid: jwk.kid }).sign(key);
  let databaseCalls = 0;
  let called;
  let databaseMode = 'success';
  const stored = new Map(notes.map(note => [note.id, {
    id: note.id, title: note.title, content: note.body, owner_id: sub,
  }]));
  try {
    for (const name of Object.keys(logging)) console[name] = (...args) => logs.push(args);
    process.env.SUPABASE_URL = project;
    process.env.SUPABASE_SECRET_KEY = fakeSecret;
    Object.assign(config, { step: 4, identityProvider: {
      issuer, audience: 'authenticated', jwksUrl: `${issuer}/.well-known/jwks.json`,
    } });
    globalThis.fetch = async (url, options) => {
      const target = new URL(url);
      if (target.href === config.identityProvider.jwksUrl ||
        target.href === `${config.judgeIssuer}/.well-known/jwks.json`) {
        return new Response(JSON.stringify({ keys: [jwk] }), { headers: { 'content-type': 'application/json' } });
      }
      if (target.href === `${issuer}/user`) {
        return new Response(JSON.stringify({ message: 'UNVERIFIED' }), { status: 401 });
      }
      if (target.origin !== project || target.pathname !== '/rest/v1/vault_notes') throw new Error('Unexpected request');
      databaseCalls++;
      called = { url: target, headers: new Headers(options.headers) };
      if (databaseMode === 'error') {
        return new Response(JSON.stringify({ message: fakeSecret, details: fakeSecret }), { status: 403 });
      }
      if (databaseMode === 'throw') throw new Error(fakeSecret);
      if (databaseMode === 'malformed') return new Response(JSON.stringify([{ id: notes[0].id, title: null, body: fakeSecret }]));
      const method = options.method ?? 'GET';
      const targetId = target.searchParams.get('id')?.slice('eq.'.length);
      const owner = target.searchParams.get('owner_id')?.slice('eq.'.length);
      let rows = [...stored.values()].filter(row => (!targetId || row.id === targetId) && (!owner || row.owner_id === owner));
      if (method === 'POST') {
        const inserted = JSON.parse(options.body);
        if (stored.has(inserted.id)) return new Response(JSON.stringify({ code: '23505', message: fakeSecret }), { status: 409 });
        stored.set(inserted.id, inserted);
        rows = [inserted];
      } else if (method === 'PATCH') {
        const changes = JSON.parse(options.body);
        rows.forEach(row => Object.assign(row, changes));
      } else if (method === 'DELETE') {
        rows.forEach(row => stored.delete(row.id));
      }
      const projected = target.searchParams.get('select') === 'id' ? rows.map(row => ({ id: row.id }))
        : target.searchParams.get('select') === 'id,owner_id'
          ? rows.map(row => ({ id: row.id, owner_id: row.owner_id, secret: fakeSecret }))
        : rows.map(row => ({ id: row.id, title: row.title, body: row.content, secret: fakeSecret, owner_id: row.owner_id }));
      if (databaseMode === 'wrong-owner-response') {
        projected.forEach(row => { row.owner_id = '99999999-9999-4999-8999-999999999999'; });
      }
      return new Response(JSON.stringify(projected), {
        headers: { 'content-type': 'application/json' },
      });
    };

    await t.test('anonymous and browser-forged userId/role requests get 401 without a DB call', async () => {
      for (const method of ['GET', 'POST', 'PUT', 'DELETE']) {
        for (const authorization of [undefined, '', ['Bearer invalid']]) {
          const result = await invoke({ authorization, query: { userId: sub, role: 'authenticated' },
            method, url: ['PUT', 'DELETE'].includes(method) ? `/api/notes/${notes[0].id}` : '/api/notes',
            body: { userId: sub, role: 'judge' }, userId: sub, role: 'judge' });
          assert.equal(result.status, 401);
          assert.deepEqual(result.body, { error: 'LOGIN_REQUIRED' });
        }
      }
      assert.equal(databaseCalls, 0);
    });

    await t.test('malformed, expired, wrong issuer/audience/role/sub and invalid signature are denied', async () => {
      const invalid = [
        'Bearer invalid', `Bearer ${await sign({ ...claims, exp: now - 60 })}`,
        `Bearer ${await sign({ ...claims, iss: 'https://other.supabase.co/auth/v1' })}`,
        `Bearer ${await sign({ ...claims, aud: 'anon' })}`,
        `Bearer ${await sign({ ...claims, role: 'service_role' })}`,
        `Bearer ${await sign({ ...claims, sub: 'NOT_A_UUID' })}`,
        `Bearer ${await sign(claims, wrongKeys.privateKey)}`,
      ];
      for (const authorization of invalid) {
        const result = await invoke({ authorization, query: { userId: sub, role: 'authenticated' } });
        assert.equal(result.status, 401);
        assert.deepEqual(result.body, { error: 'LOGIN_REQUIRED' });
      }
      assert.equal(databaseCalls, 0);
    });

    const valid = `Bearer ${await sign(claims)}`;
    await t.test('verified training A can read four notes without credential or identity leakage', async () => {
      const result = await invoke({ authorization: valid, query: { userId: 'FORGED', role: 'service_role' } });
      assert.equal(result.status, 200);
      assert.deepEqual(result.body, notes);
      assert.equal(called.url.pathname, '/rest/v1/vault_notes');
      assert.equal(called.url.searchParams.get('select'), 'id,title,body:content');
      assert.equal(called.url.searchParams.get('owner_id'), `eq.${sub}`);
      assert.equal(called.headers.get('apikey'), fakeSecret);
      assert.equal(result.headers['cache-control'], 'no-store');
      assert.ok(!JSON.stringify(result).includes(fakeSecret));
      assert.ok(!JSON.stringify(result).includes(valid));
      assert.ok(!JSON.stringify(result).includes(sub));
    });

    await t.test('cookie requests use the unchanged verifier, retain own CRUD and reject cross-site writes', async () => {
      const authorization = await sign(claims);
      const headers = { cookie: `__Host-vault-access=${authorization}`, origin: config.publicAppUrl };
      const list = await invoke({ headers });
      assert.equal(list.status, 200);
      assert.equal(list.body.length, 4);
      const before = databaseCalls;
      const id = '88888888-8888-4888-8888-888888888888';
      assert.equal((await invoke({ method: 'POST', headers: { ...headers, origin: 'https://other.invalid' },
        body: { id, title: 'COOKIE_TEST', body: 'COOKIE_BODY' } })).status, 403);
      assert.equal(databaseCalls, before);
      assert.equal((await invoke({ method: 'POST', headers, body: { id, title: 'COOKIE_TEST', body: 'COOKIE_BODY' } })).status, 201);
      assert.equal(stored.get(id).owner_id, sub);
      assert.equal((await invoke({ method: 'PUT', url: `/api/notes/${id}`, headers,
        body: { title: 'COOKIE_UPDATED', body: 'COOKIE_BODY' } })).status, 200);
      assert.equal((await invoke({ method: 'DELETE', url: `/api/notes/${id}`, headers })).status, 204);
      assert.equal((await invoke({ url: `/api/notes/${id}`, headers })).status, 404);
      assert.equal((await invoke({ authorization: 'Bearer invalid', headers })).status, 401);
      assert.equal((await invoke({ headers: { cookie: '__Host-vault-access=unverified' } })).status, 401);
    });

    await t.test('the starter judge A flow is preserved', async () => {
      const authorization = `Bearer ${await sign({
        ...claims, iss: config.judgeIssuer, aud: new URL(config.publicAppUrl).hostname,
        aleph_role: 'judge', aleph_identity: 'a', aleph_run: '22222222-2222-4222-8222-222222222222',
      })}`;
      const result = await invoke({ authorization });
      assert.equal(result.status, 200);
      assert.deepEqual(result.body, notes);
    });

    await t.test('DB failures never expose upstream errors or credentials', async () => {
      for (const mode of ['error', 'throw', 'malformed']) {
        databaseMode = mode;
        const result = await invoke({ authorization: valid });
        assert.equal(result.status, 502);
        assert.deepEqual(result.body, { error: 'NOTES_UNAVAILABLE' });
        assert.ok(!JSON.stringify(result).includes(fakeSecret));
        assert.ok(!JSON.stringify(result).includes(valid));
      }
      databaseMode = 'success';
    });

    await t.test('missing or mismatched settings fail closed, even after a successful request', async () => {
      const before = databaseCalls;
      delete process.env.SUPABASE_SECRET_KEY;
      assert.equal((await invoke({ authorization: valid })).status, 503);
      process.env.SUPABASE_SECRET_KEY = fakeSecret;
      process.env.SUPABASE_URL = 'http://training.supabase.co';
      assert.equal((await invoke({ authorization: valid })).status, 503);
      process.env.SUPABASE_URL = project;
      config.identityProvider.issuer = '';
      assert.equal((await invoke({ authorization: valid })).status, 503);
      config.identityProvider.issuer = 'https://other.supabase.co/auth/v1';
      assert.equal((await invoke({ authorization: valid })).status, 503);
      config.identityProvider.issuer = issuer;
      config.identityProvider.jwksUrl = 'https://other.supabase.co/auth/v1/.well-known/jwks.json';
      assert.equal((await invoke({ authorization: valid })).status, 503);
      config.identityProvider.jwksUrl = `${issuer}/.well-known/jwks.json`;
      const rejected = await invoke({ method: 'PATCH', authorization: valid });
      assert.equal(rejected.status, 405);
      assert.equal(rejected.headers.allow, 'GET, POST');
      assert.equal(databaseCalls, before);
    });

    await t.test('A can create with a supplied or generated UUID, read, update, delete, then get 404', async () => {
      const id = '33333333-3333-4333-8333-333333333333';
      const created = await invoke({ method: 'POST', authorization: valid,
        body: { id, title: 'CREATE_TEST', body: 'CREATE_BODY', owner_id: 'FORGED_OWNER', userId: 'FORGED', role: 'judge' } });
      assert.equal(created.status, 201);
      assert.deepEqual(created.body, { id });
      assert.equal(stored.get(id).owner_id, sub);
      assert.equal(stored.get(id).content, 'CREATE_BODY');
      assert.equal((await invoke({ method: 'POST', authorization: valid,
        body: { id, title: 'DUPLICATE', body: 'DUPLICATE' } })).status, 409);
      const path = `/api/notes/${id}`;
      const read = await invoke({ authorization: valid, url: path });
      assert.deepEqual(read.body, { id, title: 'CREATE_TEST', body: 'CREATE_BODY' });
      const updated = await invoke({ method: 'PUT', authorization: valid, url: path,
        body: { title: 'UPDATED_TEST', body: 'UPDATED_BODY' } });
      assert.equal(updated.status, 200);
      assert.equal(stored.get(id).owner_id, sub);
      assert.equal((await invoke({ authorization: valid, url: path })).body.body, 'UPDATED_BODY');
      // This is the form Vercel passes after the configured internal rewrite.
      assert.equal((await invoke({ authorization: valid, query: { noteId: id } })).body.id, id);
      assert.equal((await invoke({ method: 'DELETE', authorization: valid, url: path })).status, 204);
      assert.equal((await invoke({ authorization: valid, url: path })).status, 404);
      assert.equal((await invoke({ method: 'DELETE', authorization: valid, url: path })).status, 404);
      const generated = await invoke({ method: 'POST', authorization: valid,
        body: JSON.stringify({ title: 'GENERATED_TEST', body: 'GENERATED_BODY' }) });
      assert.equal(generated.status, 201);
      assert.match(generated.body.id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u);
      assert.equal(stored.get(generated.body.id).owner_id, sub);
      await invoke({ method: 'DELETE', authorization: valid, url: `/api/notes/${generated.body.id}` });
    });

    await t.test('A and B retain their own CRUD and cannot read, edit or delete each other notes', async () => {
      const otherId = '44444444-4444-4444-8444-444444444444';
      const otherUser = '55555555-5555-4555-8555-555555555555';
      stored.set(otherId, { id: otherId, title: 'OTHER_TEST', content: 'OTHER_BODY', owner_id: otherUser });
      const otherAuthorization = `Bearer ${await sign({ ...claims, sub: otherUser })}`;
      for (const actor of [
        { userId: sub, authorization: valid, ownId: notes[0].id, foreignId: otherId,
          otherUser, expectedList: notes },
        { userId: otherUser, authorization: otherAuthorization, ownId: otherId, foreignId: notes[0].id,
          otherUser: sub, expectedList: [{ id: otherId, title: 'OTHER_TEST', body: 'OTHER_BODY' }] },
      ]) {
        const { authorization } = actor;
        const spoofed = { owner_id: actor.otherUser, userId: actor.otherUser, role: 'service_role' };
        const list = await invoke({ authorization, query: spoofed });
        assert.deepEqual(list.body, actor.expectedList);
        const own = await invoke({ authorization, url: `/api/notes/${actor.ownId}?owner_id=${actor.otherUser}`,
          query: spoofed });
        assert.equal(own.status, 200);
        assert.deepEqual(Object.keys(own.body).sort(), ['body', 'id', 'title']);
        const before = structuredClone(stored.get(actor.foreignId));
        for (const method of ['GET', 'PUT', 'DELETE']) {
          const denied = await invoke({ method, authorization,
            url: `/api/notes/${actor.foreignId}?owner_id=${actor.userId}`, query: spoofed,
            body: { title: 'CROSS_OWNER_TEST', body: 'CROSS_OWNER_BODY' } });
          assert.equal(denied.status, 404);
          assert.deepEqual(denied.body, { error: 'NOT_FOUND' });
          assert.deepEqual(stored.get(actor.foreignId), before);
        }
        // A caller-supplied ID may collide, but POST must never overwrite another owner.
        assert.equal((await invoke({ method: 'POST', authorization,
          body: { id: actor.foreignId, title: 'OVERWRITE_TEST', body: 'OVERWRITE_BODY' } })).status, 409);
        assert.deepEqual(stored.get(actor.foreignId), before);

        const created = await invoke({ method: 'POST', authorization, query: spoofed,
          body: { title: 'OWN_TEST', body: 'OWN_BODY', ...spoofed } });
        assert.equal(created.status, 201);
        const id = created.body.id;
        assert.equal(stored.get(id).owner_id, actor.userId);
        const path = `/api/notes/${id}`;
        assert.deepEqual((await invoke({ authorization, url: path })).body,
          { id, title: 'OWN_TEST', body: 'OWN_BODY' });
        const updated = await invoke({ method: 'PUT', authorization, url: path,
          body: { title: 'OWN_UPDATED_TEST', body: 'OWN_UPDATED_BODY' } });
        assert.equal(updated.status, 200);
        assert.equal(stored.get(id).owner_id, actor.userId);
        assert.equal((await invoke({ authorization, url: path })).body.body, 'OWN_UPDATED_BODY');
        assert.equal((await invoke({ method: 'DELETE', authorization, url: path })).status, 204);
        assert.equal((await invoke({ authorization, url: path })).status, 404);
      }
      assert.equal([...stored.values()].filter(row => row.owner_id === sub).length, 4);
      assert.equal([...stored.values()].filter(row => row.owner_id === otherUser).length, 1);
    });

    await t.test('verified UUID subjects remain valid when their letters are uppercase', async () => {
      const canonicalOwner = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
      const authorization = `Bearer ${await sign({ ...claims, sub: canonicalOwner.toUpperCase() })}`;
      const created = await invoke({ method: 'POST', authorization,
        body: { title: 'UUID_CASE_TEST', body: 'UUID_CASE_BODY' } });
      assert.equal(created.status, 201);
      const id = created.body.id;
      assert.equal(stored.get(id).owner_id, canonicalOwner);
      const path = `/api/notes/${id}`;
      assert.equal((await invoke({ authorization, url: path })).status, 200);
      assert.equal((await invoke({ method: 'PUT', authorization, url: path,
        body: { title: 'UUID_CASE_UPDATED', body: 'UUID_CASE_BODY' } })).status, 200);
      assert.equal(stored.get(id).owner_id, canonicalOwner);
      assert.equal((await invoke({ method: 'DELETE', authorization, url: path })).status, 204);
    });

    await t.test('PUT rejects owner fields without touching either the existing or new owner', async () => {
      const id = notes[0].id;
      const before = structuredClone(stored.get(id));
      const beforeCalls = databaseCalls;
      for (const owner_id of ['55555555-5555-4555-8555-555555555555', sub, null]) {
        const result = await invoke({ method: 'PUT', authorization: valid, url: `/api/notes/${id}`,
          body: { title: 'OWNER_TRANSFER_TEST', body: 'OWNER_TRANSFER_BODY', owner_id } });
        assert.equal(result.status, 403);
        assert.deepEqual(result.body, { error: 'OWNER_CHANGE_FORBIDDEN' });
        assert.deepEqual(stored.get(id), before);
      }
      assert.equal(databaseCalls, beforeCalls);
    });

    await t.test('a stale editor cannot update or delete a row whose owner has changed', async () => {
      const id = '88888888-8888-4888-8888-888888888888';
      stored.set(id, { id, title: 'RACE_TEST', content: 'RACE_BODY', owner_id: sub });
      const path = `/api/notes/${id}`;
      assert.equal((await invoke({ authorization: valid, url: path })).status, 200);
      // Model an administrator reassignment after the caller read the row.
      stored.get(id).owner_id = '55555555-5555-4555-8555-555555555555';
      const before = structuredClone(stored.get(id));
      assert.equal((await invoke({ method: 'PUT', authorization: valid, url: path,
        body: { title: 'STALE_WRITE', body: 'STALE_BODY' } })).status, 404);
      assert.deepEqual(stored.get(id), before);
      assert.equal((await invoke({ method: 'DELETE', authorization: valid, url: path })).status, 404);
      assert.deepEqual(stored.get(id), before);
      stored.delete(id);
    });

    await t.test('write success requires the returned new owner to match the verified user', async () => {
      const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
      try {
        databaseMode = 'wrong-owner-response';
        for (const [method, url, body] of [
          ['POST', '/api/notes', { id, title: 'OWNER_CHECK_TEST', body: 'OWNER_CHECK_BODY' }],
          ['PUT', `/api/notes/${id}`, { title: 'OWNER_CHECK_UPDATED', body: 'OWNER_CHECK_BODY' }],
        ]) {
          const result = await invoke({ method, url, body, authorization: valid });
          assert.equal(result.status, 502);
          assert.deepEqual(result.body, { error: 'NOTES_UNAVAILABLE' });
          assert.ok(!JSON.stringify(result).includes(fakeSecret));
        }
      } finally {
        databaseMode = 'success';
        stored.delete(id);
      }
    });

    await t.test('invalid routes, JSON, IDs and payloads never reach the DB', async () => {
      const before = databaseCalls;
      for (const body of [{ title: '', body: 'BODY' }, { title: 'TITLE', body: '' },
        { id: 'BAD', title: 'TITLE', body: 'BODY' }, { title: 'x'.repeat(201), body: 'BODY' },
        { title: 'TITLE', body: 'x'.repeat(10001) }, [], '{bad']) {
        assert.equal((await invoke({ method: 'POST', authorization: valid, body })).status, 400);
      }
      assert.equal((await invoke({ authorization: valid, url: '/api/notes/BAD' })).status, 400);
      assert.equal((await invoke({ authorization: valid, url: '/api/notes/extra/path' })).status, 404);
      assert.equal((await invoke({ method: 'PUT', authorization: valid, body: {} })).status, 405);
      assert.equal((await invoke({ method: 'POST', authorization: valid, url: `/api/notes/${notes[0].id}`, body: {} })).status, 405);
      assert.equal((await invoke({ method: 'POST', authorization: valid, headers: { 'content-type': 'text/plain' }, body: {} })).status, 415);
      assert.equal(databaseCalls, before);
    });
    assert.deepEqual(logs, []);
  } finally {
    for (const [name, value] of [['SUPABASE_URL', saved.url], ['SUPABASE_SECRET_KEY', saved.key]]) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
    globalThis.fetch = saved.fetch;
    Object.assign(config, saved.config);
    Object.assign(console, logging);
  }
});

test('static screen has no anonymous notes fetch or server secret', async () => {
  const html = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
  assert.doesNotMatch(html, /SUPABASE_SECRET_KEY|data\.json|fetch\(|<script type="module">/u);
  assert.match(html, /로그인 후 자료를 볼 수 있습니다/u);
  assert.match(html, /src="\/auth-ui\.js"/u);
});
