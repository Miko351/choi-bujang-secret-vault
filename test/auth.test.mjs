import assert from 'node:assert/strict';
import { test } from 'node:test';
import { generateKeyPair, exportJWK, SignJWT } from 'jose';
import handler from '../api/notes.js';
import config from '../aleph.config.json' with { type: 'json' };
import { ACCESS_COOKIE, REFRESH_COOKIE } from '../src/session-cookies.mjs';
import { createServerAuthClient } from '../public/auth-client.js';

async function invoke(action, { method = action === 'session' ? 'GET' : 'POST', headers = {}, body = {}, rewritten = false } = {}) {
  const result = { headers: {} };
  await handler({ method, url: rewritten ? '/api/notes' : `/api/auth/${action}`,
    ...(rewritten ? { query: { authAction: action } } : {}), headers: {
    origin: config.publicAppUrl, 'content-type': 'application/json', ...headers,
  }, body }, {
    setHeader: (name, value) => { result.headers[name.toLowerCase()] = value; },
    status: status => { result.status = status; return { json: data => { result.body = data; } }; },
  });
  return result;
}

test('server Auth uses official SDK and unchanged verifier without JSON credential leaks or shared user sessions', async t => {
  const saved = { config: structuredClone(config), fetch: globalThis.fetch,
    url: process.env.SUPABASE_URL, secret: process.env.SUPABASE_SECRET_KEY };
  const logMethods = Object.fromEntries(['log', 'warn', 'error'].map(name => [name, console[name]]));
  const logs = [];
  const project = 'https://auth-training.supabase.co';
  const keys = await generateKeyPair('ES256');
  const jwk = { ...await exportJWK(keys.publicKey), alg: 'ES256', kid: 'auth-test', use: 'sig' };
  const sub = '11111111-1111-4111-8111-111111111111';
  const second = '22222222-2222-4222-8222-222222222222';
  const now = Math.floor(Date.now() / 1000);
  const token = async (id = sub, exp = now + 300) => new SignJWT({ iss: `${project}/auth/v1`,
    aud: 'authenticated', role: 'authenticated', sub: id, iat: now, exp })
    .setProtectedHeader({ alg: 'ES256', kid: 'auth-test' }).sign(keys.privateKey);
  const access = await token();
  const secondAccess = await token(second);
  const refresh = 'SYNTHETIC_REFRESH_1';
  const secret = ['synthetic', 'server', 'credential'].join('-');
  const password = ['synthetic', 'form', 'input'].join('-');
  const email = ['fixture', 'example.test'].join('@');
  const cookie = `${ACCESS_COOKIE}=${access}; ${REFRESH_COOKIE}=${refresh}`;
  let mode = 'success';
  const requests = [];
  const json = (data, status = 200) => Response.json(data, { status,
    headers: { 'x-supabase-api-version': '2024-01-01' } });
  try {
    for (const name of Object.keys(logMethods)) console[name] = (...args) => { logs.push(args); };
    process.env.SUPABASE_URL = project;
    process.env.SUPABASE_SECRET_KEY = secret;
    Object.assign(config, { identityProvider: { issuer: `${project}/auth/v1`, audience: 'authenticated',
      jwksUrl: `${project}/auth/v1/.well-known/jwks.json` } });
    globalThis.fetch = async (url, options) => {
      const target = new URL(url);
      requests.push({ target, options });
      assert.equal(target.origin, project);
      if (target.pathname.endsWith('/.well-known/jwks.json')) return json({ keys: [jwk] });
      if (target.pathname.endsWith('/user')) return json({ id: sub });
      if (target.pathname.endsWith('/logout')) {
        assert.equal(target.searchParams.get('scope'), 'local');
        return new Response(null, { status: 204 });
      }
      assert.equal(target.pathname, '/auth/v1/token');
      if (mode === 'failed-login') return json({ code: 'invalid_credentials', message: secret }, 400);
      if (mode === 'bad-refresh') return json({ code: 'refresh_token_not_found', message: secret }, 400);
      const isRefresh = target.searchParams.get('grant_type') === 'refresh_token';
      const input = JSON.parse(options.body);
      if (isRefresh) assert.equal(input.refresh_token, refresh);
      else { assert.equal(input.email, email); assert.equal(input.password, password); }
      const userId = mode === 'second-user' ? second : sub;
      return json({ access_token: mode === 'unverified' ? 'invalid' : userId === second ? secondAccess : access,
        refresh_token: refresh, expires_in: 300, token_type: 'bearer', user: { id: userId } });
    };
    await t.test('missing session is anonymous and cross-site or invalid inputs do not reach Auth', async () => {
      assert.deepEqual((await invoke('session')).body, { user: null });
      assert.deepEqual((await invoke('session', { rewritten: true })).body, { user: null });
      const before = requests.length;
      assert.equal((await invoke('login', { headers: { origin: 'https://other.invalid' }, body: { email, password } })).status, 403);
      assert.equal((await invoke('login', { headers: { origin: undefined }, body: { email, password } })).status, 403);
      assert.equal((await invoke('login', { body: { email } })).status, 400);
      assert.equal((await invoke('login', { headers: { 'content-type': 'text/plain' } })).status, 415);
      assert.equal((await invoke('session', { method: 'POST' })).status, 405);
      assert.equal((await invoke('unknown')).status, 404);
      assert.equal(requests.length, before);
    });
    await t.test('login sets Secure HttpOnly host cookies and returns only verified user metadata', async () => {
      const result = await invoke('login', { rewritten: true, body: { email, password, userId: second, role: 'service_role' } });
      assert.equal(result.status, 200);
      assert.deepEqual(result.body, { user: { id: sub } });
      assert.equal(result.headers['cache-control'], 'no-store');
      assert.equal(result.headers['set-cookie'].length, 3);
      for (const value of result.headers['set-cookie']) assert.ok(value.includes('Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age='));
      const output = JSON.stringify(result.body);
      assert.ok(!output.includes(access) && !output.includes(refresh) && !output.includes(secret) && !output.includes(password));
      assert.deepEqual((await invoke('session', { headers: { cookie } })).body, { user: { id: sub } });
      assert.equal((await invoke('session', { headers: { cookie: `${ACCESS_COOKIE}=unverified` } })).status, 401);
      assert.deepEqual((await invoke('session')).body, { user: null });
    });
    await t.test('sessions do not bleed between request clients and failed sign-in never sets cookies', async () => {
      mode = 'second-user';
      assert.deepEqual((await invoke('login', { body: { email, password } })).body, { user: { id: second } });
      mode = 'failed-login';
      const result = await invoke('login', { body: { email, password } });
      assert.equal(result.status, 401);
      assert.deepEqual(result.body, { error: 'invalid_credentials' });
      assert.equal(result.headers['set-cookie'], undefined);
      assert.deepEqual((await invoke('session', { headers: { cookie } })).body, { user: { id: sub } });
      mode = 'unverified';
      const unverified = await invoke('login', { body: { email, password } });
      assert.equal(unverified.status, 401);
      assert.equal(unverified.headers['set-cookie'], undefined);
      mode = 'success';
    });
    await t.test('expired access refreshes via SDK, refresh failure clears cookies, logout revokes only local session', async () => {
      const expired = await token(sub, now - 10);
      const expiredCookie = `${ACCESS_COOKIE}=${expired}; ${REFRESH_COOKIE}=${refresh}`;
      assert.equal((await invoke('session', { headers: { cookie: expiredCookie } })).status, 401);
      const refreshed = await invoke('refresh', { headers: { cookie: expiredCookie } });
      assert.equal(refreshed.status, 200);
      assert.deepEqual(refreshed.body, { user: { id: sub } });
      assert.equal(refreshed.headers['set-cookie'].length, 3);
      mode = 'bad-refresh';
      const failed = await invoke('refresh', { headers: { cookie: expiredCookie } });
      assert.equal(failed.status, 401);
      assert.ok(failed.headers['set-cookie'].every(value => value.endsWith('Max-Age=0')));
      mode = 'success';
      const loggedOut = await invoke('logout', { headers: { cookie } });
      assert.equal(loggedOut.status, 200);
      assert.deepEqual(loggedOut.body, { user: null });
      assert.ok(loggedOut.headers['set-cookie'].every(value => value.endsWith('Max-Age=0')));
    });
    await t.test('missing or mismatched server environment fails closed', async () => {
      delete process.env.SUPABASE_SECRET_KEY;
      assert.equal((await invoke('login', { body: { email, password } })).status, 503);
      process.env.SUPABASE_SECRET_KEY = secret;
      process.env.SUPABASE_URL = 'https://other.supabase.co';
      assert.equal((await invoke('login', { body: { email, password } })).status, 503);
    });
    assert.equal(logs.length, 0);
  } finally {
    for (const [name, value] of Object.entries(logMethods)) console[name] = value;
    Object.assign(config, saved.config);
    globalThis.fetch = saved.fetch;
    for (const [name, value] of [['SUPABASE_URL', saved.url], ['SUPABASE_SECRET_KEY', saved.secret]]) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
  }
});

test('browser Auth transport uses same-origin endpoints and cookies without keys or tokens', async () => {
  const user = { id: '11111111-1111-4111-8111-111111111111' };
  const calls = [];
  const events = [];
  let active = false;
  let expired = false;
  const client = createServerAuthClient({ fetch: async (url, options) => {
    calls.push({ url, options });
    assert.equal(options.credentials, 'same-origin');
    assert.equal(options.headers?.Authorization, undefined);
    assert.ok(url.startsWith('/api/'));
    if (url === '/api/auth/login') { active = true; return Response.json({ user }); }
    if (url === '/api/auth/logout') { active = false; return Response.json({ user: null }); }
    if (url === '/api/auth/refresh') { expired = false; return Response.json({ user }); }
    if (url === '/api/auth/session') return expired ? Response.json({ error: 'LOGIN_REQUIRED' }, { status: 401 })
      : Response.json({ user: active ? user : null });
    return expired ? Response.json({ error: 'LOGIN_REQUIRED' }, { status: 401 }) : Response.json([]);
  } });
  client.auth.onAuthStateChange((event, session) => events.push({ event, session }));
  assert.equal((await client.auth.getSession()).data.session, null);
  const login = await client.auth.signInWithPassword({ email: ['fixture', 'example.test'].join('@'), password: 'SYNTHETIC_FORM_INPUT' });
  assert.deepEqual(login.data.session, { user });
  expired = true;
  assert.equal((await client.fetch('/api/notes', { method: 'GET' })).status, 200);
  assert.equal(calls.filter(item => item.url === '/api/auth/refresh').length, 1);
  assert.ok(events.some(item => item.event === 'TOKEN_REFRESHED'));
  await client.auth.signOut();
  assert.equal(events.at(-1).event, 'SIGNED_OUT');
  assert.equal(events.at(-1).session, null);
  assert.ok(events.every(item => !Object.hasOwn(item.session ?? {}, 'access_token')));
});

test('a late session refresh completes before logout so it cannot restore cleared cookies', async () => {
  const user = { id: '11111111-1111-4111-8111-111111111111' };
  let expired = false;
  let active = true;
  let finishRefresh;
  let refreshStarted;
  const started = new Promise(resolve => { refreshStarted = resolve; });
  const calls = [];
  const events = [];
  const client = createServerAuthClient({ fetch: async url => {
    calls.push(url);
    if (url === '/api/auth/login') return Response.json({ user });
    if (url === '/api/auth/logout') { active = false; return Response.json({ user: null }); }
    if (url === '/api/auth/refresh') {
      refreshStarted();
      return new Promise(resolve => { finishRefresh = () => {
        expired = false;
        resolve(Response.json({ user }));
      }; });
    }
    if (url === '/api/auth/session') return expired ? Response.json({ error: 'LOGIN_REQUIRED' }, { status: 401 })
      : Response.json({ user: active ? user : null });
    return expired || !active ? Response.json({ error: 'LOGIN_REQUIRED' }, { status: 401 }) : Response.json([]);
  } });
  client.auth.onAuthStateChange(event => { events.push(event); });
  await client.auth.signInWithPassword({});
  expired = true;
  const notesRequest = client.fetch('/api/notes');
  await started;
  const logout = client.auth.signOut();
  assert.equal(calls.includes('/api/auth/logout'), false);
  finishRefresh();
  await logout;
  await notesRequest;
  assert.equal(active, false);
  assert.equal(events.at(-1), 'SIGNED_OUT');
  assert.equal((await client.auth.getSession()).data.session, null);
});
