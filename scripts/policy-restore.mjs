import { readFile, lstat, realpath, open, rename, unlink } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { planTrialPolicyRestore } from '../src/policy-restore.mjs';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const CODES = new Set(['backup_missing', 'verification_invalid', 'backup_invalid', 'trial_policy_invalid',
  'backup_hash_mismatch', 'preincident_verification_required', 'invalid_arguments', 'confirmation_invalid',
  'confirmation_mismatch', 'trial_path_invalid', 'trial_busy', 'inputs_changed']);
const fail = code => { throw Object.assign(new Error(code), { code }); };
export async function runTrialPolicyRestore(args, { root = ROOT, showPreview = () => {} } = {}) {
  const options = new Map();
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index];
    if (!['--backup', '--verification', '--incident-at', '--confirm'].includes(key)
        || options.has(key) || typeof args[index + 1] !== 'string' || args[index + 1].startsWith('--')) fail('invalid_arguments');
    options.set(key, args[index + 1]);
  }
  const backupPath = resolve(root, options.get('--backup') ?? 'local-only/policy-safe.json');
  const reviewPath = resolve(root, options.get('--verification') ?? 'local-only/policy-review.json');
  const local = join(resolve(root), 'local-only');
  const currentPath = join(local, 'policy-trial.json');
  const samePath = (a, b) => process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
  const load = async (path, code) => { try { return await readFile(path, 'utf8'); } catch { fail(code); } };
  const loadInputs = async () => ({ backupText: await load(backupPath, 'backup_missing'),
    verificationText: await load(reviewPath, 'verification_invalid'),
    currentText: await load(currentPath, 'trial_policy_invalid'), incidentAt: options.get('--incident-at') });
  async function checkTarget() {
    try {
      const parent = await lstat(local);
      const file = await lstat(currentPath);
      if (!parent.isDirectory() || parent.isSymbolicLink() || !file.isFile() || file.isSymbolicLink()
          || file.nlink !== 1 || !samePath(await realpath(local), local)
          || !samePath(await realpath(currentPath), currentPath)
          || samePath(await realpath(backupPath), currentPath)
          || samePath(await realpath(reviewPath), currentPath)) fail('trial_path_invalid');
    } catch { fail('trial_path_invalid'); }
  }
  const input = await loadInputs();
  await checkTarget();
  const plan = planTrialPolicyRestore(input);
  const confirmation = options.get('--confirm');
  if (confirmation === undefined) return plan.preview;
  await showPreview(plan.preview);
  if (!/^[0-9a-f]{64}$/u.test(confirmation)) fail('confirmation_invalid');
  if (confirmation !== plan.preview.planId) fail('confirmation_mismatch');
  if (plan.preview.changeCount === 0) return { ...plan.preview, mode: 'unchanged' };
  const lockPath = join(local, '.policy-restore.lock');
  let lock;
  try { lock = await open(lockPath, 'wx', 0o600); } catch { fail('trial_busy'); }
  const temporary = join(local, `.policy-trial-${randomUUID()}.tmp`);
  let temporaryCreated = false;
  try {
    await checkTarget();
    if (planTrialPolicyRestore(await loadInputs()).preview.planId !== confirmation) fail('inputs_changed');
    const file = await open(temporary, 'wx', 0o600);
    temporaryCreated = true;
    try { await file.writeFile(plan.restoredText, 'utf8'); await file.sync(); } finally { await file.close(); }
    await checkTarget();
    if (planTrialPolicyRestore(await loadInputs()).preview.planId !== confirmation) fail('inputs_changed');
    await rename(temporary, currentPath);
    temporaryCreated = false;
    return { ...plan.preview, mode: 'restored' };
  } finally {
    try {
      if (temporaryCreated) await unlink(temporary);
    } finally {
      try { await lock.close(); } finally { await unlink(lockPath); }
    }
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = await runTrialPolicyRestore(process.argv.slice(2), {
      showPreview: preview => process.stdout.write(`${JSON.stringify(preview, null, 2)}\n`),
    });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`시험 정책 복원 중단: ${CODES.has(error?.code) ? error.code : 'restore_failed'}\n`);
    process.exitCode = 1;
  }
}
