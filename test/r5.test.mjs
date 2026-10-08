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
  for (const step of [2, 3, 12]) assert.equal(deploymentIdentity(env, { ...config, step }).step, step);
  for (const step of [0, 13, 2.5, '2']) assert.throws(() => deploymentIdentity(env, { ...config, step }));
});

test('later builds remove static data, retain deployment metadata and reject source notes', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'vault-build-'));
  try {
    await mkdir(join(directory, 'scripts'));
    for (const file of ['build-public.mjs', 'deployment-identity.mjs']) {
      await copyFile(new URL(`../scripts/${file}`, import.meta.url), join(directory, 'scripts', file));
    }
    await writeFile(join(directory, 'aleph.config.json'), JSON.stringify({ ...config, step: 2 }));
    await writeFile(join(directory, 'data.json'), JSON.stringify({
      notes: [], extra: 'SOURCE_ONLY_VALUE',
    }));
    const build = (...args) => spawnSync(process.execPath, [join(directory, 'scripts/build-public.mjs'), ...args], {
      encoding: 'utf8', windowsHide: true, env: { ...process.env, ...env },
    });
    const output = join(directory, 'public/data.json');
    await mkdir(join(directory, 'public'));
    for (const step of [2, 3, 12]) {
      await writeFile(join(directory, 'aleph.config.json'), JSON.stringify({ ...config, step }));
      await writeFile(output, JSON.stringify({ notes: [{ content: 'STALE_TEST_CONTENT' }] }));
      assert.equal(build().status, 0);
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
