import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm, link } from 'node:fs/promises';
import { basename, join, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { runTrialPolicyRestore } from '../scripts/policy-restore.mjs';
import { decide } from '../src/decider.mjs';
import { fixtureRequests } from '../scripts/fixture-7.mjs';

async function fixture(run) {
  const root = await mkdtemp(join(tmpdir(), 'vault-restore-'));
  try {
    const local = join(root, 'local-only');
    await mkdir(local);
    const { normal } = fixtureRequests();
    const scope = { classId: normal.classId, projectId: normal.projectId };
    const idA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const idB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    const safe = { version: 1, noteOwners: [
      { ...scope, subjectId: normal.subjectId, id: idA },
      { ...scope, subjectId: 'other_fixture', id: idB }], noticeEditors: [], apiNoticeEditors: [] };
    const trial = structuredClone(safe);
    trial.noteOwners[0].subjectId = 'other_fixture';
    trial.noticeEditors.push({ ...scope, subjectId: 'editor_fixture', id: idB });
    trial.apiNoticeEditors.push({ userId: idA, id: idB });
    const backupText = JSON.stringify(safe);
    const review = { schema: 'vault.policy.review.v1', backupVersion: 9,
      verifiedAt: '2026-10-01T00:00:00.000Z',
      sha256: createHash('sha256').update(backupText).digest('hex') };
    const current = join(local, 'policy-trial.json');
    const audit = join(local, 'audit.jsonl');
    await writeFile(join(local, 'policy-safe.json'), backupText);
    await writeFile(join(local, 'policy-review.json'), JSON.stringify(review));
    await writeFile(current, JSON.stringify(trial));
    await writeFile(audit, '{"event":"trial_started"}\n');
    await writeFile(join(local, 'other-service.json'), '{"rules":["preserve_fixture"]}');
    const args = ['--incident-at', '2026-10-02T00:00:00.000Z'];
    await run({ root, local, current, audit, args, safe, trial, normal, idA, idB });
  } finally {
    if (!resolve(root).startsWith(resolve(tmpdir()) + sep) || !basename(root).startsWith('vault-restore-')) {
      throw new Error('unexpected_temporary_path');
    }
    await rm(root, { recursive: true, force: true });
  }
}

test('reviewed notes restore denies B-to-A again while preserving A, B own access and other services', async () => {
  await fixture(async ({root, local, current, audit, args, trial, normal, idA, idB}) => {
    const saved = process.env.VAULT_ZONE_POLICY;
    const request = (actor, id, method) => ({ ...normal, subjectId: actor, method,
      path: `/notes/${id}`, route: `${method} /notes/:id` });
    try {
      process.env.VAULT_ZONE_POLICY = await readFile(current, 'utf8');
      for (const method of ['GET', 'PUT']) {
        assert.equal((await decide(request('other_fixture', idA, method))).decision, 'allow');
        assert.equal((await decide(request(normal.subjectId, idA, method))).decision, 'deny');
      }
      const originalAudit = await readFile(audit);
      const otherService = await readFile(join(local, 'other-service.json'));
      const backupBefore = await readFile(join(local, 'policy-safe.json'));
      const reviewBefore = await readFile(join(local, 'policy-review.json'));
      const plan = await runTrialPolicyRestore(args, {root});
      assert.equal(plan.mode, 'preview');
      assert.equal(plan.scope, 'notes');
      assert.deepEqual(plan.changes, [{path:'/noteOwners/0/subjectId',operation:'replace'}]);
      assert.ok(!JSON.stringify(plan).includes(normal.subjectId));
      assert.ok(!JSON.stringify(plan).includes(idA));
      assert.deepEqual(JSON.parse(await readFile(current, 'utf8')), trial);
      let displayed = false;
      const result = await runTrialPolicyRestore([...args, '--confirm', plan.planId], {root,
        showPreview: async shown => {
          assert.deepEqual(shown, plan);
          assert.deepEqual(JSON.parse(await readFile(current, 'utf8')), trial);
          displayed = true;
        }});
      assert.ok(displayed);
      assert.equal(result.mode, 'restored');
      const restored = JSON.parse(await readFile(current, 'utf8'));
      assert.deepEqual(restored.noticeEditors, trial.noticeEditors);
      assert.deepEqual(restored.apiNoticeEditors, trial.apiNoticeEditors);
      assert.deepEqual(await readFile(audit), originalAudit);
      assert.deepEqual(await readFile(join(local, 'other-service.json')), otherService);
      assert.deepEqual(await readFile(join(local, 'policy-safe.json')), backupBefore);
      assert.deepEqual(await readFile(join(local, 'policy-review.json')), reviewBefore);
      process.env.VAULT_ZONE_POLICY = JSON.stringify(restored);
      for (const method of ['GET', 'PUT']) {
        assert.equal((await decide(request(normal.subjectId, idA, method))).decision, 'allow');
        assert.equal((await decide(request('other_fixture', idA, method))).decision, 'deny');
        assert.equal((await decide(request('other_fixture', idB, method))).decision, 'allow');
      }
      assert.equal((await readdir(local)).length, 5);
      const unchanged = await runTrialPolicyRestore(args, {root});
      assert.equal(unchanged.changeCount, 0);
      assert.equal((await runTrialPolicyRestore([...args, '--confirm', unchanged.planId], {root})).mode, 'unchanged');
    } finally {
      if (saved === undefined) delete process.env.VAULT_ZONE_POLICY;
      else process.env.VAULT_ZONE_POLICY = saved;
    }
  });
});

test('no confirmation, wrong confirmation, changed inputs or missing backup never restore', async () => {
  await fixture(async ({root, local, current, args}) => {
    const before = await readFile(current, 'utf8');
    const plan = await runTrialPolicyRestore(args, {root});
    await assert.rejects(runTrialPolicyRestore([...args, '--confirm', '0'.repeat(64)], {root}),
      {code:'confirmation_mismatch'});
    assert.equal(await readFile(current, 'utf8'), before);
    await writeFile(current, before + '\n');
    await assert.rejects(runTrialPolicyRestore([...args, '--confirm', plan.planId], {root}),
      {code:'confirmation_mismatch'});
    const changed = await readFile(current, 'utf8');
    await assert.rejects(runTrialPolicyRestore([...args, '--backup', join(local, 'absent.json')], {root}),
      {code:'backup_missing'});
    assert.equal(await readFile(current, 'utf8'), changed);
    await assert.rejects(runTrialPolicyRestore([...args, '--current', 'aleph.config.json'], {root}),
      {code:'invalid_arguments'});
  });
});

test('a change after preview stops before replacement and releases only its own lock', async () => {
  await fixture(async ({root, local, current, args}) => {
    const plan = await runTrialPolicyRestore(args, {root});
    const changed = (await readFile(current, 'utf8')) + '\n';
    await assert.rejects(runTrialPolicyRestore([...args, '--confirm', plan.planId], {root,
      showPreview: () => writeFile(current, changed)}), {code:'inputs_changed'});
    assert.equal(await readFile(current, 'utf8'), changed);
    assert.equal((await readdir(local)).length, 5);
    const next = await runTrialPolicyRestore(args, {root});
    await writeFile(join(local, '.policy-restore.lock'), 'preserve_existing_lock');
    await assert.rejects(runTrialPolicyRestore([...args, '--confirm', next.planId], {root}), {code:'trial_busy'});
    assert.equal(await readFile(join(local, '.policy-restore.lock'), 'utf8'), 'preserve_existing_lock');
    assert.equal(await readFile(current, 'utf8'), changed);
  });
});

test('shared files cannot be replaced as trial policy or alter an audit alias', async () => {
  await fixture(async ({root, local, current, args}) => {
    await link(current, join(local, 'audit-alias.json'));
    await assert.rejects(runTrialPolicyRestore(args, {root}), {code:'trial_path_invalid'});
  });
});

test('CLI displays the matching preview before applying an explicit confirmation', async () => {
  await fixture(async ({root, local, current, args}) => {
    const script = fileURLToPath(new URL('../scripts/policy-restore.mjs', import.meta.url));
    const paths = [...args, '--backup', join(local, 'policy-safe.json'),
      '--verification', join(local, 'policy-review.json')];
    // The executable has a fixed project root; test the same CLI via its runner
    // in a child process rooted explicitly at the disposable trial directory.
    const runnerUrl = new URL('../scripts/policy-restore.mjs', import.meta.url).href;
    const execute = confirmation => spawnSync(process.execPath, ['--input-type=module', '-e',
      `import {runTrialPolicyRestore} from ${JSON.stringify(runnerUrl)};
       const args=JSON.parse(process.argv[1]);
       const result=await runTrialPolicyRestore(args,{root:process.argv[2],
         showPreview:p=>process.stdout.write(JSON.stringify(p)+'\\n')});
       process.stdout.write(JSON.stringify(result)+'\\n');`,
      JSON.stringify(confirmation ? [...paths, '--confirm', confirmation] : paths), root],
      { encoding: 'utf8', windowsHide: true });
    const first = execute();
    assert.equal(first.status, 0);
    const plan = JSON.parse(first.stdout.trim());
    assert.equal(plan.mode, 'preview');
    const second = execute(plan.planId);
    assert.equal(second.status, 0);
    const lines = second.stdout.trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
    assert.equal(lines[0].mode, 'preview');
    assert.equal(lines[1].mode, 'restored');
    assert.equal(lines[0].planId, lines[1].planId);
    assert.equal(JSON.parse(await readFile(current, 'utf8')).noteOwners[0].subjectId, 'learner_fixture');
    assert.ok(script.endsWith('policy-restore.mjs'));
  });
});