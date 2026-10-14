import { createClient } from '@supabase/supabase-js';
import { createLoginVerifier } from '../src/verify-login.mjs';
import { readSessionCookies, sameOrigin } from '../src/session-cookies.mjs';
import { noteOwnerForVerifiedLogin } from './notes.js';
import { noteContentSha256, readBNoteBackup } from '../src/note-backup.mjs';
import config from '../aleph.config.json' with { type: 'json' };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
let runtime;
export default async function handler(request, response) {
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('X-Resource-Id', 'notes');
  const fromCookie = request.headers?.authorization === undefined;
  const access = fromCookie ? readSessionCookies(request).access : undefined;
  const authorization = fromCookie && access ? `Bearer ${access}` : request.headers?.authorization;
  if (typeof authorization !== 'string' || !authorization.trim()) return response.status(401).json({ error: 'LOGIN_REQUIRED' });
  if (fromCookie && !sameOrigin(request, config)) return response.status(403).json({ error: 'ORIGIN_FORBIDDEN' });
  try {
    const url = process.env.SUPABASE_URL;
    const secret = process.env.SUPABASE_SECRET_KEY;
    const parsed = new URL(url);
    if (!secret || parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.search
        || parsed.hash || parsed.pathname !== '/' || config.identityProvider?.issuer !== `${parsed.origin}/auth/v1`) {
      return response.status(503).json({ error: 'RESTORE_NOT_CONFIGURED' });
    }
    const configuration = JSON.stringify(config);
    if (!runtime || runtime.url !== url || runtime.secret !== secret || runtime.configuration !== configuration) {
      const supabase = createClient(url, secret, {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      });
      runtime = { url, secret, configuration, supabase,
        verify: createLoginVerifier({ config, supabaseSecretKey: secret, supabaseClient: supabase }) };
    }
  } catch { return response.status(503).json({ error: 'RESTORE_NOT_CONFIGURED' }); }
  let ownerId;
  try { ownerId = noteOwnerForVerifiedLogin(await runtime.verify(authorization)); } catch { /* Fixed denial only. */ }
  if (!ownerId) return response.status(401).json({ error: 'LOGIN_REQUIRED' });
  let id;
  try {
    const target = new URL(request.url ?? '', 'http://route.invalid');
    const match = /^\/api\/note-recovery(?:\/([^/]+))?\/?$/u.exec(target.pathname);
    if (!match) return response.status(404).json({ error: 'NOT_FOUND' });
    if ([...target.searchParams.keys(), ...Object.keys(request.query ?? {})].some(key => key !== 'noteId')) {
      return response.status(403).json({ error: 'RESOURCE_NOT_ALLOWED' });
    }
    const urlIds = target.searchParams.getAll('noteId');
    const ids = [match[1], request.query?.noteId, ...urlIds].filter(value => value !== undefined);
    if (!ids.length || urlIds.length > 1 || ids.some(value => typeof value !== 'string' || !UUID.test(value))
        || new Set(ids.map(value => value.toLowerCase())).size !== 1) {
      return response.status(400).json({ error: 'INVALID_NOTE_ID' });
    }
    id = ids[0].toLowerCase();
  } catch { return response.status(400).json({ error: 'INVALID_NOTE_ID' }); }
  if (request.method !== 'POST') {
    response.setHeader('Allow', 'POST');
    return response.status(405).json({ error: 'METHOD_NOT_ALLOWED' });
  }
  if (!/^application\/json(?:\s*;|$)/iu.test(request.headers?.['content-type'] ?? '')) {
    return response.status(415).json({ error: 'JSON_REQUIRED' });
  }
  let input;
  try {
    input = typeof request.body === 'string' ? JSON.parse(request.body) : request.body;
    if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).length !== 1
        || typeof input.contentSha256 !== 'string' || !/^[0-9a-f]{64}$/u.test(input.contentSha256)) {
      return response.status(400).json({ error: 'INVALID_RESTORE_REQUEST' });
    }
  } catch { return response.status(400).json({ error: 'INVALID_RESTORE_REQUEST' }); }
  const backup = readBNoteBackup(process.env.VAULT_B_NOTE_BACKUP);
  if (!backup) return response.status(503).json({ error: 'RESTORE_BACKUP_UNAVAILABLE' });
  if (backup.id !== id || backup.owner_id !== ownerId) return response.status(404).json({ error: 'NOT_FOUND' });
  if (input.contentSha256 !== backup.contentSha256) return response.status(409).json({ error: 'BACKUP_MISMATCH' });
  try {
    // Only vault_notes and this exact ID are accessed; no audit/other-service table.
    const table = runtime.supabase.from('vault_notes');
    const existing = await table.select('id,owner_id').eq('id', id).abortSignal(AbortSignal.timeout(10000));
    if (existing.error || !Array.isArray(existing.data) || existing.data.length > 1
        || existing.data.some(row => row.id !== id || !UUID.test(row.owner_id ?? ''))) {
      return response.status(502).json({ error: 'RESTORE_UNAVAILABLE' });
    }
    if (existing.data.length && existing.data[0].owner_id !== ownerId) return response.status(404).json({ error: 'NOT_FOUND' });
    const values = { title: backup.title, content: backup.body, owner_id: ownerId };
    // Never upsert: a concurrent foreign insertion must not be overwritten.
    const write = existing.data.length
      ? table.update(values).eq('id', id).eq('owner_id', ownerId)
      : table.insert({ id, ...values });
    const result = await write.select('id,owner_id,title,body:content').abortSignal(AbortSignal.timeout(10000));
    if (result.error?.code === '23505' || (!result.error && Array.isArray(result.data) && result.data.length === 0)) {
      return response.status(409).json({ error: 'RESTORE_CONFLICT' });
    }
    if (result.error || !Array.isArray(result.data) || result.data.length !== 1
        || result.data[0].id !== id || result.data[0].owner_id !== ownerId
        || typeof result.data[0].title !== 'string' || typeof result.data[0].body !== 'string'
        || noteContentSha256(result.data[0]) !== backup.contentSha256) {
      return response.status(502).json({ error: 'RESTORE_UNAVAILABLE' });
    }
    return response.status(200).json({ id, owner_id: ownerId, contentSha256: backup.contentSha256 });
  } catch { return response.status(502).json({ error: 'RESTORE_UNAVAILABLE' }); }
}
