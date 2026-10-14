import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { previewPolicyRestore } from '../src/policy-preview.mjs';

const CODES = new Set(['backup_missing', 'verification_invalid', 'backup_invalid',
  'trial_policy_invalid', 'backup_hash_mismatch', 'preincident_verification_required', 'invalid_arguments']);
const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
export async function runPolicyPreview(args, { root = ROOT, read = readFile } = {}) {
  const options = new Map();
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index];
    if (!['--backup', '--current', '--verification', '--incident-at'].includes(key)
        || options.has(key) || typeof args[index + 1] !== 'string' || args[index + 1].startsWith('--')) {
      throw Object.assign(new Error('invalid_arguments'), { code: 'invalid_arguments' });
    }
    options.set(key, args[index + 1]);
  }
  const load = async (key, fallback, code) => {
    try { return await read(resolve(root, options.get(key) ?? fallback), 'utf8'); }
    catch { throw Object.assign(new Error(code), { code }); }
  };
  // Missing backup always stops before any comparison or partial output.
  const backupText = await load('--backup', 'local-only/policy-safe.json', 'backup_missing');
  const verificationText = await load('--verification', 'local-only/policy-review.json', 'verification_invalid');
  const currentText = await load('--current', 'local-only/policy-trial.json', 'trial_policy_invalid');
  return previewPolicyRestore({ backupText, verificationText, currentText, incidentAt: options.get('--incident-at') });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const preview = await runPolicyPreview(process.argv.slice(2));
    process.stdout.write(`${JSON.stringify(preview, null, 2)}\n`);
  } catch (error) {
    const code = CODES.has(error?.code) ? error.code : 'preview_failed';
    process.stderr.write(`정책 비교 중단: ${code}\n`);
    process.exitCode = 1;
  }
}
