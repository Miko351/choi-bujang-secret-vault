import { createHash } from 'node:crypto';

const ROOT_FIELDS = ['version', 'noteOwners', 'noticeEditors', 'apiNoticeEditors'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const fields = (value, names) => object(value) && Object.keys(value).length === names.length
  && names.every(name => Object.hasOwn(value, name));
const fail = code => { const error = new Error(code); error.code = code; throw error; };
const parse = (text, code) => {
  if (typeof text !== 'string' || text.length > 1024 * 1024) fail(code);
  try { return JSON.parse(text); } catch { fail(code); }
};
function timestamp(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u.test(value)) return null;
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return null;
  const canonical = new Date(time).toISOString();
  return canonical === value || canonical.replace('.000Z', 'Z') === value ? time : null;
}
function validatePolicy(policy, code) {
  if (!fields(policy, ROOT_FIELDS) || policy.version !== 1) fail(code);
  const owners = new Set();
  for (const key of ROOT_FIELDS.slice(1)) {
    const names = key === 'apiNoticeEditors' ? ['userId', 'id'] : ['classId', 'projectId', 'subjectId', 'id'];
    if (!Array.isArray(policy[key]) || policy[key].length > 256) fail(code);
    for (const row of policy[key]) {
      if (!fields(row, names) || names.some(name => typeof row[name] !== 'string'
          || !row[name].length || row[name].length > 256 || row[name].trim() !== row[name])
          || !UUID.test(row.id) || (key === 'apiNoticeEditors' && !UUID.test(row.userId))) fail(code);
      if (key === 'noteOwners') {
        const ownerKey = JSON.stringify([row.classId, row.projectId, row.id]);
        if (owners.has(ownerKey)) fail(code);
        owners.add(ownerKey);
      }
    }
  }
}
function changesBetween(current, backup, path, changes) {
  if (current === backup) return;
  if (Array.isArray(current) && Array.isArray(backup)) {
    for (let index = 0; index < Math.max(current.length, backup.length); index++) {
      const child = `${path}/${index}`;
      if (index >= current.length) changes.push({ path: child, operation: 'add' });
      else if (index >= backup.length) changes.push({ path: child, operation: 'remove' });
      else changesBetween(current[index], backup[index], child, changes);
    }
  } else if (object(current) && object(backup)) {
    for (const key of [...new Set([...Object.keys(current), ...Object.keys(backup)])].sort()) {
      const child = `${path}/${key}`;
      if (!Object.hasOwn(current, key)) changes.push({ path: child, operation: 'add' });
      else if (!Object.hasOwn(backup, key)) changes.push({ path: child, operation: 'remove' });
      else changesBetween(current[key], backup[key], child, changes);
    }
  } else changes.push({ path, operation: 'replace' });
}

// The verification record must come from a separately trusted pre-incident review.
// A matching hash proves integrity against that record, not that a policy is safe.
// No production environment, filesystem writes, network calls or restore operation.
export function previewPolicyRestore({ backupText, currentText, verificationText, incidentAt, scope = 'all' } = {}) {
  if (backupText === undefined || backupText === null) fail('backup_missing');
  const verification = parse(verificationText, 'verification_invalid');
  if (!fields(verification, ['schema', 'backupVersion', 'verifiedAt', 'sha256'])
      || verification.schema !== 'vault.policy.review.v1'
      || !Number.isSafeInteger(verification.backupVersion) || verification.backupVersion < 1
      || typeof verification.sha256 !== 'string' || !/^[0-9a-f]{64}$/u.test(verification.sha256)) {
    fail('verification_invalid');
  }
  const verifiedTime = timestamp(verification.verifiedAt);
  const incidentTime = timestamp(incidentAt);
  if (verifiedTime === null || incidentTime === null || verifiedTime >= incidentTime) fail('preincident_verification_required');
  if (typeof backupText !== 'string' || backupText.length > 1024 * 1024) fail('backup_invalid');
  if (createHash('sha256').update(backupText, 'utf8').digest('hex') !== verification.sha256) fail('backup_hash_mismatch');
  const backup = parse(backupText, 'backup_invalid');
  const current = parse(currentText, 'trial_policy_invalid');
  validatePolicy(backup, 'backup_invalid');
  validatePolicy(current, 'trial_policy_invalid');
  const changes = [];
  if (!['all', 'notes'].includes(scope)) fail('scope_invalid');
  if (scope === 'notes') changesBetween(current.noteOwners, backup.noteOwners, '/noteOwners', changes);
  else changesBetween(current, backup, '', changes);
  return { mode: 'preview', ...(scope === 'notes' ? { scope: 'notes' } : {}), restoreVersion: verification.backupVersion,
    verifiedAt: verification.verifiedAt, changeCount: changes.length, changes };
}
