import { createHash } from 'node:crypto';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
export function noteContentSha256({ title, body }) {
  return createHash('sha256').update(JSON.stringify({ title, body }), 'utf8').digest('hex');
}

// Only a server-held B training backup is supported; never take it from a request.
export function readBNoteBackup(raw) {
  if (typeof raw !== 'string' || !raw || raw.length > 20000) return null;
  try {
    const item = JSON.parse(raw);
    const keys = ['schema', 'account', 'id', 'owner_id', 'title', 'body', 'contentSha256'];
    if (!item || typeof item !== 'object' || Array.isArray(item)
        || Object.keys(item).length !== keys.length || keys.some(key => !Object.hasOwn(item, key))
        || item.schema !== 'vault.note.backup.v1' || item.account !== 'b'
        || typeof item.id !== 'string' || typeof item.owner_id !== 'string'
        || !UUID.test(item.id) || !UUID.test(item.owner_id)
        || typeof item.title !== 'string' || !item.title.trim() || item.title.length > 200
        || typeof item.body !== 'string' || !item.body.trim() || item.body.length > 10000
        || typeof item.contentSha256 !== 'string' || !/^[0-9a-f]{64}$/u.test(item.contentSha256)
        || noteContentSha256(item) !== item.contentSha256) return null;
    return item;
  } catch { return null; }
}
