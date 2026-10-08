import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import handler from '../api/notes.js';

const fakeSecret = ['test', 'server', 'credential'].join('-');
const notes = Array.from({ length: 4 }, (_, i) => ({ title: `TEST ${i}`, content: `BODY ${i}` }));

async function invoke(method = 'GET') {
  const result = { headers: {} };
  await handler({ method }, {
    setHeader: (name, value) => { result.headers[name.toLowerCase()] = value; },
    status: code => {
      result.status = code;
      return { json: body => { result.body = body; } };
    },
  });
  return result;
}

test('server queries only note fields with server credentials and never forwards errors or secrets', async () => {
  const saved = { url: process.env.SUPABASE_URL, key: process.env.SUPABASE_SECRET_KEY, fetch: globalThis.fetch };
  const logging = Object.fromEntries(['log', 'warn', 'error'].map(name => [name, console[name]]));
  const logs = [];
  try {
    for (const name of Object.keys(logging)) console[name] = (...args) => logs.push(args);
    process.env.SUPABASE_URL = 'https://training.supabase.co';
    process.env.SUPABASE_SECRET_KEY = fakeSecret;
    let called;
    globalThis.fetch = async (url, options) => {
      called = { url: new URL(url), headers: new Headers(options.headers) };
      return new Response(JSON.stringify(notes.map(note => ({ ...note, secret: fakeSecret, owner_id: 'HIDDEN' }))), {
        headers: { 'content-type': 'application/json' },
      });
    };
    const success = await invoke();
    assert.equal(success.status, 200);
    assert.deepEqual(success.body, { notes });
    assert.equal(called.url.pathname, '/rest/v1/vault_notes');
    assert.equal(called.url.searchParams.get('select'), 'title,content');
    assert.equal(called.headers.get('apikey'), fakeSecret);
    assert.equal(success.headers['cache-control'], 'no-store');
    assert.ok(!JSON.stringify(success).includes(fakeSecret));

    for (const fail of [
      async () => new Response(JSON.stringify({ message: fakeSecret, details: fakeSecret }), { status: 403 }),
      async () => { throw new Error(fakeSecret); },
      async () => new Response(JSON.stringify([{ title: null, content: fakeSecret }])),
    ]) {
      globalThis.fetch = fail;
      const failure = await invoke();
      assert.equal(failure.status, 502);
      assert.deepEqual(failure.body, { error: 'NOTES_UNAVAILABLE' });
      assert.ok(!JSON.stringify(failure).includes(fakeSecret));
    }
    let requestCount = 0;
    globalThis.fetch = async () => { requestCount++; throw new Error('Unexpected request'); };
    delete process.env.SUPABASE_SECRET_KEY;
    assert.equal((await invoke()).status, 503);
    process.env.SUPABASE_SECRET_KEY = fakeSecret;
    process.env.SUPABASE_URL = 'http://training.supabase.co';
    assert.equal((await invoke()).status, 503);
    const rejected = await invoke('POST');
    assert.equal(rejected.status, 405);
    assert.equal(rejected.headers.allow, 'GET');
    assert.equal(requestCount, 0);
    assert.deepEqual(logs, []);
  } finally {
    for (const [name, value] of [['SUPABASE_URL', saved.url], ['SUPABASE_SECRET_KEY', saved.key]]) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
    globalThis.fetch = saved.fetch;
    Object.assign(console, logging);
  }
});

test('browser requests the server function and renders four cards without Supabase credentials', async () => {
  const html = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
  assert.doesNotMatch(html, /SUPABASE|supabase-js|data\.json/u);
  const script = html.match(/<script type="module">([\s\S]*?)<\/script>/u)[1];
  const list = { replaceChildren(...children) { this.children = children; } };
  const document = {
    querySelector: () => list,
    createElement: tag => ({ tag, append(...children) { this.children = children; } }),
  };
  let requested;
  await runInNewContext(`(async () => { ${script} })()`, {
    document,
    fetch: async (url, options) => {
      requested = { url, options };
      return { ok: true, json: async () => ({ notes }) };
    },
  });
  assert.equal(requested.url, '/api/notes');
  assert.equal(requested.options.cache, 'no-store');
  assert.equal(requested.options.headers, undefined);
  assert.equal(list.children.length, 4);
  list.children.forEach((card, i) => {
    assert.equal(card.tag, 'li');
    assert.equal(card.children[0].textContent, notes[i].title);
    assert.equal(card.children[1].textContent, notes[i].content);
  });
});
