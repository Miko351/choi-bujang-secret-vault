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

test('second stage identity records step 2 and still validates Vercel metadata', () => {
  assert.equal(deploymentIdentity(env, { ...config, step: 2 }).step, 2);
  assert.throws(() => deploymentIdentity(env, { ...config, step: 3 }));
});

test('second stage build emits no note bodies and fails if source notes return', async () => {
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
    const build = () => spawnSync(process.execPath, [join(directory, 'scripts/build-public.mjs'), '--local'], {
      encoding: 'utf8', windowsHide: true,
    });
    assert.equal(build().status, 0);
    const output = join(directory, 'public/data.json');
    assert.deepEqual(JSON.parse(await readFile(output, 'utf8')), {
      sampleMarker: config.sampleMarker, notes: [],
    });
    await writeFile(join(directory, 'data.json'), JSON.stringify({
      notes: [{ title: 'PRIVATE_TEST_TITLE', content: 'PRIVATE_TEST_CONTENT' }],
    }));
    await writeFile(output, JSON.stringify({ notes: [{ content: 'STALE_TEST_CONTENT' }] }));
    const failed = build();
    assert.notEqual(failed.status, 0);
    assert.match(failed.stderr, /2단계 data.json에는 메모를 남길 수 없습니다/u);
    assert.deepEqual(JSON.parse(await readFile(output, 'utf8')).notes, []);
    assert.doesNotMatch(failed.stderr, /PRIVATE_TEST_CONTENT/u);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('second stage check accepts empty JSON but rejects notes, extra fields and invalid responses', async () => {
  const originalFetch = globalThis.fetch;
  try {
    const secondConfig = { ...config, step: 2 };
    globalThis.fetch = async () => new Response(JSON.stringify({ sampleMarker: config.sampleMarker, notes: [] }));
    const [empty] = await runAttackChecks(secondConfig);
    assert.match(empty.observed, /메모가 없는 정적 자료 확인/u);
    for (const data of [
      { sampleMarker: config.sampleMarker, notes: [{ content: 'PRIVATE_TEST_CONTENT' }] },
      { sampleMarker: config.sampleMarker, notes: [], content: 'PRIVATE_TEST_CONTENT' },
      { sampleMarker: config.sampleMarker },
    ]) {
      globalThis.fetch = async () => new Response(JSON.stringify(data));
      const [failed] = await runAttackChecks(secondConfig);
      assert.match(failed.observed, /점검 실패/u);
      assert.doesNotMatch(failed.observed, /PRIVATE_TEST_CONTENT/u);
    }
    for (const response of [new Response('<html>error</html>'), new Response(null, { status: 404 })]) {
      globalThis.fetch = async () => response;
      const [failed] = await runAttackChecks(secondConfig);
      assert.match(failed.observed, /점검 실패/u);
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
