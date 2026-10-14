import { createHash } from 'node:crypto';
import { previewPolicyRestore } from './policy-preview.mjs';

// Plan only the notes section; other service policy always comes from current.
export function planTrialPolicyRestore(input) {
  const preview = previewPolicyRestore({ ...input, scope: 'notes' });
  const current = JSON.parse(input.currentText);
  const backup = JSON.parse(input.backupText);
  const restoredText = `${JSON.stringify({ ...current, noteOwners: backup.noteOwners }, null, 2)}\n`;
  // This is a change-confirmation fingerprint, not a login token or secret.
  const planId = createHash('sha256').update(JSON.stringify({ scope: 'notes',
    backupText: input.backupText, currentText: input.currentText,
    verificationText: input.verificationText, incidentAt: input.incidentAt })).digest('hex');
  return { preview: { ...preview, planId }, restoredText };
}
