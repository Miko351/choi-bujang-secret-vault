import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import { mkdtemp, writeFile, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve, sep } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { previewPolicyRestore } from '../src/policy-preview.mjs';
import { runPolicyPreview } from '../scripts/policy-preview.mjs';

const safe = () => ({ version: 1, noteOwners: [], noticeEditors: [], apiNoticeEditors: [] });
function inputs(backup = safe(), current = safe()) {
  const backupText = JSON.stringify(backup);
  return { backupText, currentText: JSON.stringify(current), incidentAt: '2026-10-02T00:00:00.000Z',
    verificationText: JSON.stringify({ schema: 'vault.policy.review.v1', backupVersion: 9,
      verifiedAt: '2026-10-01T00:00:00.000Z',
      sha256: createHash('sha256').update(backupText).digest('hex') }) };
}

test('preview shows the reviewed version and exact scope from trial to backup without policy values', () => {
  const backup = safe();
  backup.noteOwners.push({ classId: 'class_fixture', projectId: 'project_fixture',
    subjectId: 'learner_fixture', id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' });
  const current = structuredClone(backup);
  current.noteOwners[0].subjectId = 'other_fixture';
  current.apiNoticeEditors.push({ userId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' });
  const request = inputs(backup, current);
  const before = structuredClone(request);
  const output = previewPolicyRestore(request);
  assert.deepEqual(output, { mode: 'preview', restoreVersion: 9, verifiedAt: '2026-10-01T00:00:00.000Z',
    changeCount: 2, changes: [{ path: '/apiNoticeEditors/0', operation: 'remove' },
      { path: '/noteOwners/0/subjectId', operation: 'replace' }] });
  assert.deepEqual(request, before);
  assert.ok(!JSON.stringify(output).includes('other_fixture'));
  assert.ok(!JSON.stringify(output).includes('learner_fixture'));
  assert.equal(previewPolicyRestore(inputs()).changeCount, 0);
  assert.deepEqual(previewPolicyRestore(inputs(current, backup)).changes,
    [{ path: '/apiNoticeEditors/0', operation: 'add' }, { path: '/noteOwners/0/subjectId', operation: 'replace' }]);
});

test('missing, tampered, unreviewed or post-incident backups stop instead of approving themselves', () => {
  assert.throws(() => previewPolicyRestore(), { code: 'backup_missing' });
  const valid = inputs();
  for (const verificationText of [undefined, '{}', 'invalid',
    JSON.stringify({ ...JSON.parse(valid.verificationText), verified: true })]) {
    assert.throws(() => previewPolicyRestore({ ...valid, verificationText }), { code: 'verification_invalid' });
  }
  assert.throws(() => previewPolicyRestore({ ...valid, backupText: valid.backupText + ' ' }), { code: 'backup_hash_mismatch' });
  for (const incidentAt of [undefined, 'invalid', '2026-10-01T00:00:00.000Z', '2026-09-30T00:00:00.000Z']) {
    assert.throws(() => previewPolicyRestore({ ...valid, incidentAt }), { code: 'preincident_verification_required' });
  }
  const invalidBackup = inputs({ ...safe(), token: 'redacted_fixture' });
  assert.throws(() => previewPolicyRestore(invalidBackup), { code: 'backup_invalid' });
  assert.throws(() => previewPolicyRestore({ ...valid, currentText: '{"body":"redacted_fixture"}' }),
    { code: 'trial_policy_invalid' });
});

test('invalid dates, ambiguous ownership and malformed grants stop with fixed errors', () => {
  const request = inputs();
  const review = JSON.parse(request.verificationText);
  review.verifiedAt = '2026-02-30T00:00:00.000Z';
  assert.throws(() => previewPolicyRestore({ ...request, verificationText: JSON.stringify(review) }),
    { code: 'preincident_verification_required' });
  const row = { classId: 'class_fixture', projectId: 'project_fixture', subjectId: 'learner_fixture',
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' };
  for (const policy of [{ ...safe(), noteOwners: [row, { ...row, subjectId: 'other_fixture' }] },
    { ...safe(), apiNoticeEditors: [{ id: row.id, userId: 'invalid' }] }]) {
    assert.throws(() => previewPolicyRestore(inputs(policy)), { code: 'backup_invalid' });
  }
});

test('runner rejects absent backups and bad arguments without reading live configuration', async () => {
  let reads = 0;
  await assert.rejects(runPolicyPreview([], { read: async () => { reads++; throw new Error('redacted_fixture'); } }),
    { code: 'backup_missing' });
  assert.equal(reads, 1);
  await assert.rejects(runPolicyPreview(['--apply', 'yes']), { code: 'invalid_arguments' });
  await assert.rejects(runPolicyPreview(['--backup']), { code: 'invalid_arguments' });
});

test('CLI emits only a preview and never writes input files or a restore endpoint', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'vault-preview-'));
  try {
    const request = inputs();
    for (const [name, data] of [['safe.json', request.backupText], ['trial.json', request.currentText],
      ['review.json', request.verificationText]]) await writeFile(join(dir, name), data);
    const script = fileURLToPath(new URL('../scripts/policy-preview.mjs', import.meta.url));
    const args = [script, '--backup', join(dir, 'safe.json'), '--current', join(dir, 'trial.json'),
      '--verification', join(dir, 'review.json'), '--incident-at', request.incidentAt];
    const result = spawnSync(process.execPath, args, { encoding: 'utf8', windowsHide: true });
    assert.equal(result.status, 0);
    assert.equal(result.stderr, '');
    assert.equal(JSON.parse(result.stdout).mode, 'preview');
    assert.equal(await readFile(join(dir, 'safe.json'), 'utf8'), request.backupText);
    assert.equal(await readFile(join(dir, 'trial.json'), 'utf8'), request.currentText);
    assert.equal(await readFile(join(dir, 'review.json'), 'utf8'), request.verificationText);
    assert.deepEqual((await readdir(dir)).sort(), ['review.json', 'safe.json', 'trial.json']);
    await writeFile(join(dir, 'safe.json'), 'redacted_fixture');
    const failed = spawnSync(process.execPath, args, { encoding: 'utf8', windowsHide: true });
    assert.equal(failed.status, 1);
    assert.equal(failed.stdout, '');
    assert.equal(failed.stderr, '정책 비교 중단: backup_hash_mismatch\n');
    assert.ok(!failed.stderr.includes('redacted_fixture'));
  } finally {
    if (!resolve(dir).startsWith(resolve(tmpdir()) + sep) || !basename(dir).startsWith('vault-preview-')) {
      throw new Error('unexpected_temporary_path');
    }
    await rm(dir, { recursive: true, force: true });
  }
});
