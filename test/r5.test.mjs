import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, copyFile, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { deploymentIdentity } from '../scripts/deployment-identity.mjs';
import { runAttackChecks } from '../src/attack-check.mjs';

const config = {
  step: 1,
  judgeIssuer: 'https://aleph-judge-production.up.railway.app/defense/judge',
  sampleMarker: 'SAMPLE_NOTE_1',
  publicAppUrl: 'https://student-defense.vercel.app',
};
const env = {
  VERCEL_GIT_PROVIDER: 'github',
  VERCEL_GIT_REPO_OWNER: 'Student-A',
  VERCEL_GIT_REPO_SLUG: 'aleph-defense',
  VERCEL_GIT_COMMIT_SHA: 'a'.repeat(40),
  VERCEL_URL: 'student-defense-123.vercel.app',
};

test('build identity uses Vercel Git and deployment metadata', () => {
  assert.deepEqual(deploymentIdentity(env, config), {
    schema: 'aleph.defense.deployment.v1',
    step: 1,
    repoUrl: 'https://github.com/student-a/aleph-defense',
    commit: 'a'.repeat(40),
    publicAppUrl: 'https://student-defense-123.vercel.app',
    judgeIssuer: config.judgeIssuer,
    sampleMarker: config.sampleMarker,
  });
  assert.throws(() => deploymentIdentity({ ...env, VERCEL_GIT_PROVIDER: undefined }, config));
  assert.throws(() => deploymentIdentity({ ...env, VERCEL_GIT_COMMIT_SHA: 'short' }, config));
});

test('later stage identity records the configured stage and validates its range', () => {
  for (const step of [2, 3, 4, 5, 6, 7, 8, 9, 12]) assert.equal(deploymentIdentity(env, { ...config, step }).step, step);
  for (const step of [0, 13, 2.5, '2']) assert.throws(() => deploymentIdentity(env, { ...config, step }));
});

test('later builds remove static data, retain deployment metadata and reject source notes', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'vault-build-'));
  try {
    await mkdir(join(directory, 'scripts'));
    for (const file of ['build-public.mjs', 'deployment-identity.mjs']) {
      await copyFile(new URL(`../scripts/${file}`, import.meta.url), join(directory, 'scripts', file));
    }
    const sdkDirectory = join(directory, 'node_modules/@supabase/supabase-js/dist/umd');
    await mkdir(sdkDirectory, { recursive: true });
    await copyFile(new URL('../node_modules/@supabase/supabase-js/dist/umd/supabase.js', import.meta.url),
      join(sdkDirectory, 'supabase.js'));
    await writeFile(join(directory, 'aleph.config.json'), JSON.stringify({ ...config, step: 2 }));
    await writeFile(join(directory, 'data.json'), JSON.stringify({
      notes: [], extra: 'SOURCE_ONLY_VALUE',
    }));
    const build = (...args) => spawnSync(process.execPath, [join(directory, 'scripts/build-public.mjs'), ...args], {
      encoding: 'utf8', windowsHide: true, env: { ...process.env, ...env },
    });
    const output = join(directory, 'public/data.json');
    await mkdir(join(directory, 'public'));
    for (const step of [2, 3, 4, 5, 6, 7, 8, 9, 12]) {
      await writeFile(join(directory, 'aleph.config.json'), JSON.stringify({ ...config, step }));
      await writeFile(output, JSON.stringify({ notes: [{ content: 'STALE_TEST_CONTENT' }] }));
      assert.equal(build().status, 0);
      if (step >= 5) await assert.rejects(readFile(join(directory, 'public/vendor/supabase.js')), { code: 'ENOENT' });
      else assert.ok((await readFile(join(directory, 'public/vendor/supabase.js'))).length > 0);
      await assert.rejects(readFile(output), { code: 'ENOENT' });
      const identity = JSON.parse(await readFile(join(directory, 'public/aleph.json'), 'utf8'));
      assert.equal(identity.step, step);
      assert.equal(identity.commit, env.VERCEL_GIT_COMMIT_SHA);
      assert.equal(identity.repoUrl, 'https://github.com/student-a/aleph-defense');
    }
    await writeFile(join(directory, 'data.json'), JSON.stringify({
      notes: [{ title: 'PRIVATE_TEST_TITLE', content: 'PRIVATE_TEST_CONTENT' }],
    }));
    await writeFile(output, JSON.stringify({ notes: [{ content: 'STALE_TEST_CONTENT' }] }));
    const failed = build('--local');
    assert.notEqual(failed.status, 0);
    assert.match(failed.stderr, /2단계 이후 data.json에는 메모를 남길 수 없습니다/u);
    await assert.rejects(readFile(output), { code: 'ENOENT' });
    assert.doesNotMatch(failed.stderr, /PRIVATE_TEST_CONTENT/u);
    await rm(join(directory, 'data.json'));
    assert.equal(build().status, 0);
    await assert.rejects(readFile(output), { code: 'ENOENT' });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('second stage check requires removed static data and four notes from the public function', async () => {
  const originalFetch = globalThis.fetch;
  try {
    const secondConfig = { ...config, step: 2 };
    const notes = Array.from({ length: 4 }, () => ({ title: 'TEST', content: 'TEST' }));
    globalThis.fetch = async url => String(url).endsWith('/data.json')
      ? new Response(null, { status: 404 }) : new Response(JSON.stringify({ notes }));
    const [removed, server] = await runAttackChecks(secondConfig);
    assert.match(removed.observed, /HTTP 404로 거부됨/u);
    assert.match(server.observed, /메모 네 건 확인/u);
    globalThis.fetch = async url => String(url).endsWith('/data.json')
      ? new Response(JSON.stringify({ notes: [] })) : new Response(JSON.stringify({ notes }));
    const [stale] = await runAttackChecks(secondConfig);
    assert.match(stale.observed, /점검 실패/u);
    for (const response of [
      new Response(JSON.stringify({ notes: [] })),
      new Response(JSON.stringify({ notes: [{ content: 'PRIVATE_TEST_CONTENT' }] })),
      new Response('<html>error</html>'), new Response(null, { status: 503 }),
    ]) {
      globalThis.fetch = async url => String(url).endsWith('/data.json')
        ? new Response(null, { status: 404 }) : response;
      const [, failed] = await runAttackChecks(secondConfig);
      assert.match(failed.observed, /점검 실패/u);
      assert.doesNotMatch(failed.observed, /PRIVATE_TEST_CONTENT/u);
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('first attack check reads public data.json without credentials', async () => {
  const originalFetch = globalThis.fetch;
  let requestUrl;
  let options;
  try {
    globalThis.fetch = async (url, init) => {
      requestUrl = String(url);
      options = init;
      return new Response(JSON.stringify({ sampleMarker: 'SAMPLE_NOTE_1', notes: [{ title: '가상' }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    };
    const [result] = await runAttackChecks(config);
    assert.equal(requestUrl, 'https://student-defense.vercel.app/data.json');
    assert.equal(options.redirect, 'error');
    assert.match(result.observed, /확인 표시가 보임/u);
    globalThis.fetch = async () => new Response('<html>not the data</html>', { status: 200 });
    const [failed] = await runAttackChecks(config);
    assert.match(failed.observed, /보이지 않음/u);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('third stage self-check reports HTTP denials honestly and never attempts a valid write', async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  try {
    globalThis.fetch = async (url, options) => {
      calls.push({ url: new URL(url), options });
      return new Response(null, { status: String(url).endsWith('/data.json') ? 404 : 401 });
    };
    const results = await runAttackChecks({ ...config, step: 3 });
    assert.equal(calls.length, 5);
    assert.equal(results.length, 6);
    assert.match(results[0].observed, /HTTP 404/u);
    for (const result of results.slice(1, 5)) assert.match(result.observed, /HTTP 401/u);
    assert.match(results[5].observed, /미실행/u);
    for (const { url, options } of calls.slice(1)) {
      assert.equal(options.credentials, 'omit');
      assert.equal(options.headers?.Authorization, undefined);
      if (['POST', 'PUT'].includes(options.method)) assert.equal(options.body, '{}');
      if (['PUT', 'DELETE'].includes(options.method)) assert.equal(url.pathname, '/api/notes/not-a-uuid');
    }
    globalThis.fetch = async url => new Response(null, { status: String(url).endsWith('/data.json') ? 404 : 503 });
    const failed = await runAttackChecks({ ...config, step: 3 });
    for (const result of failed.slice(1, 5)) assert.match(result.observed, /실패.*HTTP 503/u);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('fourth stage self-check rejects HTML denials and reports stale deployments and unrun account checks', async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  const fourthConfig = { ...config, step: 4, repoUrl: 'https://github.com/student-a/aleph-defense' };
  try {
    globalThis.fetch = async (url, options) => {
      const path = new URL(url).pathname;
      calls.push({ path, options });
      if (path === '/data.json') return new Response(null, { status: 404 });
      if (path === '/aleph.json') return Response.json({ step: 3, repoUrl: fourthConfig.repoUrl, commit: 'a'.repeat(40) });
      if (path === '/') return new Response(null, { headers: { 'X-Content-Type-Options': 'nosniff' } });
      return Response.json({ error: 'LOGIN_REQUIRED' }, { status: 401 });
    };
    const results = await runAttackChecks(fourthConfig);
    assert.equal(calls.length, 8);
    assert.equal(results.length, 11);
    assert.equal(new Set(results.map(result => result.attackId)).size, results.length);
    for (const result of results.slice(1, 6)) assert.match(result.observed, /HTTP 401 JSON 오류/u);
    assert.match(results[6].observed, /배포 단계 3.*불일치/u);
    assert.match(results[7].observed, /nosniff 헤더 확인/u);
    for (const result of results.slice(8)) assert.match(result.observed, /^미실행/u);
    for (const { path, options } of calls) {
      if (path === '/data.json') continue;
      assert.equal(options.credentials, 'omit');
      assert.equal(options.headers?.Authorization, undefined);
      if (['POST', 'PUT'].includes(options.method)) assert.equal(options.body, '{}');
      if (['PUT', 'DELETE'].includes(options.method)) assert.equal(path, '/api/notes/not-a-uuid');
    }
    for (const denial of [
      () => new Response('<html>PRIVATE_TEST_CONTENT</html>', { status: 401 }),
      () => Response.json({ error: 'LOGIN_REQUIRED', notes: ['PRIVATE_TEST_CONTENT'] }, { status: 401 }),
      () => Response.json({ error: 'NOTES_NOT_CONFIGURED' }, { status: 503 }),
    ]) {
      globalThis.fetch = async url => String(url).endsWith('/data.json')
        ? new Response(null, { status: 404 }) : denial();
      const failed = await runAttackChecks(fourthConfig);
      for (const result of failed.slice(1, 6)) assert.match(result.observed, /점검 실패/u);
      assert.doesNotMatch(JSON.stringify(failed), /PRIVATE_TEST_CONTENT/u);
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('fifth stage validates the original route without sending it keys or treating user reports as automatic checks', async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  const fifthConfig = { ...config, step: 5,
    repoUrl: 'https://github.com/student-a/aleph-defense',
    identityProvider: { issuer: 'https://training.supabase.co/auth/v1' },
    originalApiUrl: 'https://training.supabase.co/rest/v1/vault_notes' };
  try {
    globalThis.fetch = async (url, options) => {
      const target = new URL(url);
      calls.push({ target, options });
      assert.equal(target.origin, new URL(fifthConfig.publicAppUrl).origin);
      if (target.pathname === '/data.json') return new Response(null, { status: 404 });
      if (target.pathname === '/aleph.json') return Response.json({ step: 5,
        repoUrl: fifthConfig.repoUrl, commit: 'b'.repeat(40) });
      if (target.pathname === '/') return new Response(null, { headers: { 'X-Content-Type-Options': 'nosniff' } });
      return Response.json({ error: 'LOGIN_REQUIRED' }, { status: 403 });
    };
    const results = await runAttackChecks(fifthConfig);
    assert.equal(calls.length, 8);
    assert.equal(results.length, 13);
    assert.equal(new Set(results.map(item => item.attackId)).size, results.length);
    for (const item of results.slice(1, 6)) assert.match(item.observed, /HTTP 403 JSON 오류/u);
    assert.match(results[6].expected, /5단계/u);
    assert.match(results[6].observed, /배포 단계 5.*일치/u);
    for (const item of results.slice(8)) assert.match(item.observed, /^미실행/u);
    assert.match(results.find(item => item.attackId === 'database_direct_privilege').expected, /PUBLIC·anon·authenticated/u);
    assert.match(results.find(item => item.attackId === 'anonymous_original_note_read').observed, /심판 확인 항목/u);
    for (const { options } of calls) {
      assert.equal(options.headers?.Authorization, undefined);
      assert.equal(options.headers?.apikey, undefined);
      if (['POST', 'PUT'].includes(options.method)) assert.equal(options.body, '{}');
    }
    for (const originalApiUrl of [null,
      'http://training.supabase.co/rest/v1/vault_notes',
      `${fifthConfig.originalApiUrl}?select=id`,
      `${fifthConfig.originalApiUrl}#fragment`,
      'https://other.supabase.co/rest/v1/vault_notes',
      'https://training.supabase.co/rest/v1/other_table',
    ]) await assert.rejects(runAttackChecks({ ...fifthConfig, originalApiUrl }), /5단계 원본/u);
    assert.equal(calls.length, 8);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('sixth stage records only deployment HTTP results and leaves live device checks unrun', async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  const sixthConfig = { ...config, step: 6,
    repoUrl: 'https://github.com/student-a/aleph-defense',
    identityProvider: { issuer: 'https://training.supabase.co/auth/v1' },
    originalApiUrl: 'https://training.supabase.co/rest/v1/vault_notes' };
  try {
    globalThis.fetch = async (url, options) => {
      const target = new URL(url);
      calls.push({ target, options });
      assert.equal(target.origin, new URL(sixthConfig.publicAppUrl).origin);
      if (target.pathname === '/data.json') return new Response(null, { status: 404 });
      if (target.pathname === '/aleph.json') return Response.json({ step: 5,
        repoUrl: sixthConfig.repoUrl, commit: 'c'.repeat(40) });
      if (target.pathname === '/') return new Response(null, { headers: { 'X-Content-Type-Options': 'nosniff' } });
      return Response.json({ error: 'LOGIN_REQUIRED' }, { status: 401 });
    };
    const results = await runAttackChecks(sixthConfig);
    assert.equal(calls.length, 8);
    assert.equal(results.length, 15);
    assert.equal(new Set(results.map(item => item.attackId)).size, results.length);
    assert.match(results[6].expected, /6단계/u);
    assert.match(results[6].observed, /배포 단계 5.*불일치/u);
    const registered = results.find(item => item.attackId === 'registered_device_note_read');
    const unregistered = results.find(item => item.attackId === 'unregistered_device_note_read');
    assert.match(registered.observed, /^미실행/u);
    assert.match(unregistered.observed, /^미실행.*심판/u);
    assert.match(unregistered.expected, /deny.*device_not_registered/u);
    for (const { options } of calls) {
      assert.equal(options.headers?.Authorization, undefined);
      assert.equal(options.headers?.apikey, undefined);
      if (['POST', 'PUT'].includes(options.method)) assert.equal(options.body, '{}');
    }
  } finally { globalThis.fetch = originalFetch; }
});

test('seventh stage leaves engine step up and fresh login checks unrun while reporting actual HTTP requests', async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  const seventhConfig = { ...config, step: 7,
    repoUrl: 'https://github.com/student-a/aleph-defense',
    identityProvider: { issuer: 'https://training.supabase.co/auth/v1' },
    originalApiUrl: 'https://training.supabase.co/rest/v1/vault_notes' };
  try {
    globalThis.fetch = async (url, options) => {
      const target = new URL(url);
      calls.push({ target, options });
      assert.equal(target.origin, new URL(seventhConfig.publicAppUrl).origin);
      if (target.pathname === '/data.json') return new Response(null, { status: 404 });
      if (target.pathname === '/aleph.json') return Response.json({ step: 6,
        repoUrl: seventhConfig.repoUrl, commit: 'd'.repeat(40) });
      if (target.pathname === '/') return new Response(null, { headers: { 'X-Content-Type-Options': 'nosniff' } });
      return Response.json({ error: 'LOGIN_REQUIRED' }, { status: 401 });
    };
    const results = await runAttackChecks(seventhConfig);
    assert.equal(calls.length, 8);
    assert.equal(results.length, 18);
    assert.equal(new Set(results.map(item => item.attackId)).size, results.length);
    assert.match(results[6].observed, /배포 단계 6.*불일치/u);
    for (const item of results.slice(8)) assert.match(item.observed, /^미실행/u);
    assert.match(results.find(item => item.attackId === 'composite_risk_step_up').expected, /step_up.*step_up_required/u);
    assert.match(results.find(item => item.attackId === 'step_up_pending_note_read').observed, /호출 계약/u);
    assert.match(results.find(item => item.attackId === 'step_up_reauthenticated_note_read').observed, /실제 재로그인/u);
    for (const { options } of calls) {
      assert.equal(options.headers?.Authorization, undefined);
      assert.equal(options.headers?.apikey, undefined);
      if (['POST', 'PUT'].includes(options.method)) assert.equal(options.body, '{}');
    }
  } finally { globalThis.fetch = originalFetch; }
});

test('ninth stage retains eight HTTP requests and leaves detection and revocation unrun', async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  const ninthConfig = { ...config, step: 9,
    repoUrl: 'https://github.com/student-a/aleph-defense',
    identityProvider: { issuer: 'https://training.supabase.co/auth/v1' },
    originalApiUrl: 'https://training.supabase.co/rest/v1/vault_notes' };
  try {
    globalThis.fetch = async (url, options) => {
      const target = new URL(url);
      calls.push({ target, options });
      assert.equal(target.origin, new URL(ninthConfig.publicAppUrl).origin);
      if (target.pathname === '/data.json') return new Response(null, { status: 404 });
      if (target.pathname === '/aleph.json') return Response.json({ step: 8,
        repoUrl: ninthConfig.repoUrl, commit: 'f'.repeat(40) });
      if (target.pathname === '/') return new Response(null, { headers: { 'X-Content-Type-Options': 'nosniff' } });
      return Response.json({ error: 'LOGIN_REQUIRED' }, { status: 401 });
    };
    const results = await runAttackChecks(ninthConfig);
    assert.equal(calls.length, 8);
    assert.equal(results.length, 20);
    assert.equal(new Set(results.map(item => item.attackId)).size, results.length);
    assert.match(results[6].observed, /배포 단계 8.*불일치/u);
    for (const item of results.slice(8)) assert.match(item.observed, /^미실행/u);
    assert.match(results.find(item => item.attackId === 'composite_detection_proposal').expected,
      /propose_revocation.*deviceId.*burst_read/u);
    assert.match(results.find(item => item.attackId === 'composite_detection_proposal').observed,
      /로컬 시험용.*심판 계약으로 확인되지 않음/u);
    assert.match(results.find(item => item.attackId === 'device_revocation_execution').observed,
      /미실행.*실제 회수 시간/u);
    for (const item of results) {
      assert.ok(item.expected.length <= 300 && item.observed.length <= 300);
    }
    for (const { options } of calls) {
      assert.equal(options.headers?.Authorization, undefined);
      assert.equal(options.headers?.apikey, undefined);
      if (['POST', 'PUT'].includes(options.method)) assert.equal(options.body, '{}');
    }
    assert.ok(calls.every(({ target }) => !target.pathname.includes('revoke')));
  } finally { globalThis.fetch = originalFetch; }
});

test('eighth stage retains real HTTP checks and explicitly records unavailable owner and instructor contracts', async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  const eighthConfig = { ...config, step: 8,
    repoUrl: 'https://github.com/student-a/aleph-defense',
    identityProvider: { issuer: 'https://training.supabase.co/auth/v1' },
    originalApiUrl: 'https://training.supabase.co/rest/v1/vault_notes' };
  try {
    globalThis.fetch = async (url, options) => {
      const target = new URL(url);
      calls.push({ target, options });
      assert.equal(target.origin, new URL(eighthConfig.publicAppUrl).origin);
      if (target.pathname === '/data.json') return new Response(null, { status: 404 });
      if (target.pathname === '/aleph.json') return Response.json({ step: 7,
        repoUrl: eighthConfig.repoUrl, commit: 'e'.repeat(40) });
      if (target.pathname === '/') return new Response(null, { headers: { 'X-Content-Type-Options': 'nosniff' } });
      return Response.json({ error: 'LOGIN_REQUIRED' }, { status: 401 });
    };
    const results = await runAttackChecks(eighthConfig);
    assert.equal(calls.length, 8);
    assert.equal(results.length, 20);
    assert.equal(new Set(results.map(item => item.attackId)).size, results.length);
    assert.match(results[6].observed, /배포 단계 7.*불일치/u);
    for (const item of results.slice(8)) assert.match(item.observed, /^미실행/u);
    assert.match(results.find(item => item.attackId === 'resource_zone_access').observed, /소유권 연결 계약/u);
    assert.match(results.find(item => item.attackId === 'instructor_notice_update').observed, /실제 공지 수정 성공은 미확인/u);
    for (const { options } of calls) {
      assert.equal(options.headers?.Authorization, undefined);
      assert.equal(options.headers?.apikey, undefined);
      if (['POST', 'PUT'].includes(options.method)) assert.equal(options.body, '{}');
    }
  } finally { globalThis.fetch = originalFetch; }
});

test('tenth stage checks anonymous recovery without writing and leaves real policy and B restore unrun', async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  const tenthConfig = { ...config, step: 10,
    repoUrl: 'https://github.com/student-a/aleph-defense',
    identityProvider: { issuer: 'https://training.supabase.co/auth/v1' },
    originalApiUrl: 'https://training.supabase.co/rest/v1/vault_notes' };
  let restoreResponse = () => Response.json({ error: 'LOGIN_REQUIRED' }, { status: 401 });
  try {
    globalThis.fetch = async (url, options) => {
      const target = new URL(url);
      calls.push({ target, options });
      assert.equal(target.origin, new URL(tenthConfig.publicAppUrl).origin);
      if (target.pathname === '/data.json') return new Response(null, { status: 404 });
      if (target.pathname === '/aleph.json') return Response.json({ step: 9,
        repoUrl: tenthConfig.repoUrl, commit: 'f'.repeat(40) });
      if (target.pathname === '/') return new Response(null, { headers: { 'X-Content-Type-Options': 'nosniff' } });
      if (target.pathname.startsWith('/api/note-recovery/')) return restoreResponse();
      return Response.json({ error: 'LOGIN_REQUIRED' }, { status: 401 });
    };
    const results = await runAttackChecks(tenthConfig);
    assert.equal(calls.length, 9);
    assert.equal(results.length, 20);
    assert.equal(new Set(results.map(item => item.attackId)).size, 20);
    assert.match(results.find(item => item.attackId === 'deployment_identity').observed, /배포 단계 9.*불일치/u);
    assert.match(results.find(item => item.attackId === 'deployment_identity').expected, /10단계/u);
    assert.match(results.find(item => item.attackId === 'anonymous_note_restore').observed, /HTTP 401 JSON 오류/u);
    assert.equal(results.filter(item => item.observed.startsWith('미실행')).length, 11);
    for (const id of ['trial_policy_restore', 'private_b_note_restore', 'cross_owner_access',
      'device_registration_access', 'step_up_confirmation_access', 'resource_zone_access']) {
      assert.match(results.find(item => item.attackId === id).observed, /^미실행/u);
    }
    const recovery = calls.find(item => item.target.pathname.startsWith('/api/note-recovery/'));
    assert.equal(recovery.target.pathname, '/api/note-recovery/not-a-uuid');
    assert.equal(recovery.options.method, 'POST');
    assert.equal(recovery.options.body, '{}');
    for (const { options } of calls) {
      assert.equal(options.headers?.Authorization, undefined);
      assert.equal(options.headers?.apikey, undefined);
      if (options.credentials) assert.equal(options.credentials, 'omit');
    }
    for (const denial of [
      () => new Response('<html>PRIVATE_TEST_CONTENT</html>', { status: 401 }),
      () => Response.json({ error: 'LOGIN_REQUIRED', body: 'PRIVATE_TEST_CONTENT' }, { status: 403 }),
      () => Response.json({ error: 'UNAVAILABLE' }, { status: 503 }),
    ]) {
      restoreResponse = denial;
      const failed = await runAttackChecks(tenthConfig);
      assert.match(failed.find(item => item.attackId === 'anonymous_note_restore').observed, /점검 실패/u);
      assert.doesNotMatch(JSON.stringify(failed), /PRIVATE_TEST_CONTENT/u);
    }
    restoreResponse = () => { throw new Error('PRIVATE_TEST_CONTENT'); };
    const failed = await runAttackChecks(tenthConfig);
    assert.equal(failed.find(item => item.attackId === 'anonymous_note_restore').observed, '비로그인 복구 점검 요청 실패');
    assert.doesNotMatch(JSON.stringify(failed), /PRIVATE_TEST_CONTENT/u);
  } finally { globalThis.fetch = originalFetch; }
});