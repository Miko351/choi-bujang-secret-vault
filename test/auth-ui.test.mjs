import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mountAuthUI } from '../public/auth-ui.js';

const config = { projectUrl: 'https://training.supabase.co', publishableKey: 'sb_publishable_test_fixture' };
const account = { user: { id: 'TEST_A' }, access_token: 'SDK_SESSION_FIXTURE' };

function fixture({ session = null, initialError = null } = {}) {
  const nodes = Object.fromEntries(['login-form', 'login-email', 'login-password', 'login-button',
    'logout-button', 'auth-status', 'auth-error', 'notes', 'note-editor', 'note-form',
    'note-heading', 'note-title', 'note-body', 'note-save', 'note-cancel', 'note-status'].map(id => [id, {
    value: '', textContent: '', hidden: false, disabled: false, listeners: {}, attributes: {},
    addEventListener(event, listener) { this.listeners[event] = listener; },
    setAttribute(name, value) { this.attributes[name] = value; },
    replaceChildren(...children) { this.children = children; },
  }]));
  const element = tag => ({ tag, listeners: {}, attributes: {},
    append(...children) { this.children = children; },
    addEventListener(event, listener) { this.listeners[event] = listener; },
    setAttribute(name, value) { this.attributes[name] = value; },
    focus() { this.focused = true; },
  });
  nodes['note-title'].focus = () => {};
  const document = {
    querySelector: selector => nodes[selector.slice(1)],
    createElement: element,
  };
  const calls = [];
  const noteCalls = [];
  let noteFetch = async (url, options) => {
    noteCalls.push({ url, options });
    return { ok: true, status: 200, json: async () => Array.from({ length: 4 }, (_, i) =>
      ({ id: `00000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`, title: `TEST ${i}`, body: `BODY ${i}` })) };
  };
  let change;
  const sdk = {
    auth: {
      onAuthStateChange(callback) { change = callback; },
      async getSession() { return { data: { session }, error: initialError }; },
      async signInWithPassword(input) {
        calls.push({ method: 'signInWithPassword', input });
        change('SIGNED_IN', account);
        return { data: { session: account }, error: null };
      },
      async signOut(options) {
        calls.push({ method: 'signOut', options });
        change('SIGNED_OUT', null);
        return { error: null };
      },
    },
  };
  return {
    nodes, calls, sdk, noteCalls,
    setNoteFetch: callback => { noteFetch = callback; },
    change: (...args) => change(...args),
    mount: async (settings = config) => mountAuthUI({ document, config: settings,
      fetch: (...args) => noteFetch(...args),
      createClient: (url, key, options) => {
        calls.push({ method: 'createClient', url, key, options });
        return sdk;
      },
    }),
    submit: () => nodes['login-form'].listeners.submit({ preventDefault() {} }),
    logout: () => nodes['logout-button'].listeners.click(),
    saveNote: () => nodes['note-form'].listeners.submit({ preventDefault() {} }),
  };
}

test('incomplete or invalid public settings disable login without creating a client or requesting Auth', async () => {
  for (const settings of [{ projectUrl: '', publishableKey: '' },
    { ...config, projectUrl: '' }, { ...config, publishableKey: '' },
    { ...config, publishableKey: 'server-only-value' },
    { ...config, projectUrl: 'http://training.supabase.co' }]) {
    const f = fixture();
    await f.mount(settings);
    assert.deepEqual(f.calls, []);
    assert.deepEqual(f.noteCalls, []);
    assert.match(f.nodes.notes.children[0].textContent, /로그인 후/u);
    assert.equal(f.nodes['auth-status'].textContent, '로그아웃됨');
    assert.equal(f.nodes['login-button'].disabled, true);
    assert.equal(f.nodes['logout-button'].hidden, true);
    assert.match(f.nodes['auth-error'].textContent, /연결 정보가 아직 설정되지/u);
  }
});

test('SDK sign-in and local sign-out switch the form, button and status; password is cleared', async () => {
  const f = fixture();
  await f.mount();
  assert.equal(f.nodes['auth-status'].textContent, '로그아웃됨');
  assert.equal(f.nodes['login-button'].disabled, false);
  assert.equal(f.noteCalls.length, 0);
  f.nodes['login-email'].value = ' a@example.com ';
  f.nodes['login-password'].value = 'SYNTHETIC_FORM_INPUT';
  await f.submit();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.calls[1].method, 'signInWithPassword');
  assert.deepEqual(f.calls[1].input, { email: 'a@example.com', password: 'SYNTHETIC_FORM_INPUT' });
  assert.equal(f.nodes['auth-status'].textContent, '로그인됨');
  assert.equal(f.nodes['login-form'].hidden, true);
  assert.equal(f.nodes['logout-button'].hidden, false);
  assert.equal(f.nodes['login-password'].value, '');
  assert.equal(f.noteCalls.length, 1);
  assert.equal(f.noteCalls[0].url, '/api/notes');
  assert.equal(f.noteCalls[0].options.headers.Authorization, `Bearer ${account.access_token}`);
  assert.equal(f.noteCalls[0].options.credentials, 'omit');
  assert.equal(f.nodes.notes.children.length, 4);
  await f.logout();
  assert.deepEqual(f.calls[2], { method: 'signOut', options: { scope: 'local' } });
  assert.equal(f.nodes['auth-status'].textContent, '로그아웃됨');
  assert.equal(f.nodes['login-form'].hidden, false);
  assert.equal(f.nodes['logout-button'].hidden, true);
  assert.equal(f.noteCalls[0].options.signal.aborted, true);
  assert.match(f.nodes.notes.children[0].textContent, /로그인 후/u);
});

test('failed sign-in displays a safe reason, clears password and allows retry', async () => {
  for (const error of [
    { code: 'invalid_credentials', message: 'SENSITIVE_REQUEST_DETAILS' },
    { code: 'email_not_confirmed', message: 'SENSITIVE_REQUEST_DETAILS' },
    { code: 'unknown', message: 'SENSITIVE_REQUEST_DETAILS', status: 500 },
    { code: 'unknown', message: 'SENSITIVE_REQUEST_DETAILS' },
    new TypeError('SENSITIVE_REQUEST_DETAILS'),
  ]) {
    const f = fixture();
    await f.mount();
    f.sdk.auth.signInWithPassword = async () => error instanceof Error
      ? Promise.reject(error) : { data: { session: null }, error };
    f.nodes['login-password'].value = 'SYNTHETIC_FORM_INPUT';
    await f.submit();
    assert.equal(f.nodes['auth-status'].textContent, '로그아웃됨');
    assert.equal(f.nodes['auth-error'].hidden, false);
    assert.match(f.nodes['auth-error'].textContent, /로그인 실패:/u);
    assert.doesNotMatch(f.nodes['auth-error'].textContent, /SENSITIVE_REQUEST_DETAILS|SYNTHETIC_FORM_INPUT/u);
    if (error.code === 'invalid_credentials') assert.match(f.nodes['auth-error'].textContent, /이메일 또는 비밀번호/u);
    if (error.code === 'email_not_confirmed') assert.match(f.nodes['auth-error'].textContent, /이메일 인증/u);
    assert.equal(f.nodes['login-password'].value, '');
    assert.equal(f.nodes['login-button'].disabled, false);
  }
});

test('persisted and external SDK sessions update UI; failed sign-out keeps its session visible', async () => {
  const f = fixture({ session: account });
  await f.mount();
  assert.equal(f.nodes['auth-status'].textContent, '로그인됨');
  f.sdk.auth.signOut = async () => ({ error: { name: 'AuthRetryableFetchError', message: 'SENSITIVE_REQUEST_DETAILS' } });
  await f.logout();
  assert.equal(f.nodes['auth-status'].textContent, '로그인됨');
  assert.match(f.nodes['auth-error'].textContent, /로그아웃 실패:.*연결하지 못했습니다/u);
  assert.doesNotMatch(f.nodes['auth-error'].textContent, /SENSITIVE_REQUEST_DETAILS/u);
  assert.equal(f.nodes['logout-button'].disabled, false);
  f.change('SIGNED_OUT', null);
  assert.equal(f.nodes['auth-status'].textContent, '로그아웃됨');
  assert.equal(f.nodes['auth-error'].hidden, true);
  f.change('SIGNED_IN', account);
  assert.equal(f.nodes['auth-status'].textContent, '로그인됨');
});

test('a newer Auth event wins over a stale session restoration response', async () => {
  const f = fixture();
  f.sdk.auth.getSession = async () => {
    f.change('SIGNED_IN', account);
    return { data: { session: null }, error: null };
  };
  await f.mount();
  assert.equal(f.nodes['auth-status'].textContent, '로그인됨');
  assert.equal(f.nodes['login-form'].hidden, true);
});

test('logout clears cards immediately and ignores a late successful API response', async () => {
  const f = fixture();
  let finish;
  f.setNoteFetch(() => new Promise(resolve => { finish = resolve; }));
  await f.mount();
  await f.submit();
  await f.logout();
  finish({ ok: true, status: 200, json: async () => ({ notes: [{ title: 'STALE', content: 'STALE' }] }) });
  await new Promise(resolve => setImmediate(resolve));
  assert.match(f.nodes.notes.children[0].textContent, /로그인 후/u);
  assert.equal(f.nodes['auth-status'].textContent, '로그아웃됨');
});

test('token refresh reloads notes and denied API responses never render note data', async () => {
  const f = fixture({ session: account });
  await f.mount();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.nodes.notes.children.length, 4);
  let next;
  f.setNoteFetch(async (url, options) => {
    next = { url, options };
    return { ok: false, status: 401, json: async () => ({ notes: [{ title: 'DENIED', content: 'DENIED' }] }) };
  });
  f.change('TOKEN_REFRESHED', { ...account, access_token: 'REFRESHED_SDK_FIXTURE' });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(next.options.headers.Authorization, 'Bearer REFRESHED_SDK_FIXTURE');
  assert.match(f.nodes.notes.children[0].textContent, /로그인 확인에 실패/u);
  assert.equal(f.nodes.notes.children.length, 1);
  assert.equal(f.nodes['auth-status'].textContent, '로그인됨');
});

test('memo editor creates, loads for editing, updates and deletes through authenticated contract routes', async () => {
  const f = fixture();
  const id = '33333333-3333-4333-8333-333333333333';
  const rows = new Map();
  const requests = [];
  f.setNoteFetch(async (url, options) => {
    const method = options.method ?? 'GET';
    requests.push({ url, method, options });
    assert.equal(options.headers.Authorization, `Bearer ${account.access_token}`);
    const response = data => ({ ok: true, status: 200, json: async () => structuredClone(data) });
    if (method === 'POST') {
      const input = JSON.parse(options.body);
      assert.deepEqual(Object.keys(input).sort(), ['body', 'title']);
      rows.set(id, { id, ...input });
      return { ...response({ id }), status: 201 };
    }
    if (method === 'PUT') {
      Object.assign(rows.get(id), JSON.parse(options.body));
      return response({ id });
    }
    if (method === 'DELETE') {
      rows.delete(id);
      return { ok: true, status: 204, json: () => assert.fail('DELETE has no JSON body') };
    }
    return response(url === '/api/notes' ? [...rows.values()] : rows.get(id));
  });
  await f.mount();
  assert.equal(f.nodes['note-editor'].hidden, true);
  f.nodes['note-title'].value = 'LOGGED_OUT_DRAFT';
  f.nodes['note-body'].value = 'LOGGED_OUT_DRAFT';
  await f.saveNote();
  assert.equal(requests.length, 0);
  await f.submit();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.nodes['note-editor'].hidden, false);
  assert.equal(f.nodes['note-title'].value, '');
  f.nodes['note-title'].value = 'CREATE_TEST';
  f.nodes['note-body'].value = 'CREATE_BODY';
  await f.saveNote();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.nodes.notes.children[0].children[0].textContent, 'CREATE_TEST');
  assert.match(f.nodes['note-status'].textContent, /추가했습니다/u);
  await f.nodes.notes.children[0].children[2].children[0].listeners.click();
  assert.equal(f.nodes['note-title'].value, 'CREATE_TEST');
  assert.equal(f.nodes['note-body'].value, 'CREATE_BODY');
  assert.equal(f.nodes['note-save'].textContent, '수정 저장');
  f.nodes['note-title'].value = 'UPDATED_TEST';
  f.nodes['note-body'].value = 'UPDATED_BODY';
  await f.saveNote();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.nodes.notes.children[0].children[1].textContent, 'UPDATED_BODY');
  assert.equal(f.nodes['note-cancel'].hidden, true);
  await f.nodes.notes.children[0].children[2].children[1].listeners.click();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(rows.size, 0);
  assert.match(f.nodes.notes.children[0].textContent, /아직 메모가 없습니다/u);
  assert.match(f.nodes['note-status'].textContent, /삭제했습니다/u);
  for (const method of ['PUT', 'DELETE']) {
    assert.equal(requests.find(request => request.method === method).url, `/api/notes/${id}`);
  }
  assert.ok(requests.some(request => request.method === 'GET' && request.url === `/api/notes/${id}`));
  await f.logout();
  assert.equal(f.nodes['note-editor'].hidden, true);
  assert.equal(f.nodes['note-title'].value, '');
});

test('failed writes retain the draft; logout ignores a late successful write response', async () => {
  const f = fixture({ session: account });
  await f.mount();
  await new Promise(resolve => setImmediate(resolve));
  f.nodes['note-title'].value = 'DRAFT_TITLE';
  f.nodes['note-body'].value = 'DRAFT_BODY';
  f.setNoteFetch(async () => ({ ok: false, status: 401 }));
  await f.saveNote();
  assert.equal(f.nodes['note-title'].value, 'DRAFT_TITLE');
  assert.match(f.nodes['note-status'].textContent, /로그인 확인에 실패/u);
  assert.equal(f.nodes['note-save'].disabled, false);
  let finish;
  f.setNoteFetch(() => new Promise(resolve => { finish = resolve; }));
  const writing = f.saveNote();
  assert.equal(f.nodes['note-save'].disabled, true);
  await f.logout();
  finish({ ok: true, status: 201, json: async () => ({ id: '33333333-3333-4333-8333-333333333333' }) });
  await writing;
  assert.equal(f.nodes['note-editor'].hidden, true);
  assert.equal(f.nodes['note-title'].value, '');
  assert.equal(f.nodes['note-status'].textContent, '');
  assert.match(f.nodes.notes.children[0].textContent, /로그인 후/u);
});
