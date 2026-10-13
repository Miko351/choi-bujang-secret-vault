import { createClient } from '@supabase/supabase-js';
import { createHash, randomUUID } from 'node:crypto';
import { createLoginVerifier } from '../src/verify-login.mjs';
import { readSessionCookies, sameOrigin } from '../src/session-cookies.mjs';
import authHandler from '../src/auth-handler.mjs';
import config from '../aleph.config.json' with { type: 'json' };
import { resourceIdForApiPath } from '../src/decider.mjs';

// Reuse the starter verifier and its JWKS cache within this server runtime.
let runtime;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
function noteOwnerForVerifiedLogin(login) {
  if (typeof login?.userId !== 'string' || !UUID.test(login.userId)) return null;
  const subject = login.userId.toLowerCase();
  if (login.kind === 'student') return subject;
  if (login.kind !== 'judge' || !['a', 'b'].includes(login.identity)
      || typeof login.runId !== 'string' || !UUID.test(login.runId)) return null;
  // The unchanged verifier has already checked signature, issuer and audience.
  // Distinct signed practice identities/runs must not collapse onto one sub.
  // This is an internal ownership UUID, never a credential or a new login claim.
  const tuple = [config.judgeIssuer, new URL(config.publicAppUrl).hostname,
    login.runId.toLowerCase(), login.identity, subject];
  const bytes = createHash('sha256').update('vault.notes.owner.v1\0')
    .update(JSON.stringify(tuple)).digest().subarray(0, 16);
  // UUIDv8 marks this application-defined, deterministic owner namespace.
  bytes[6] = (bytes[6] & 15) | 128;
  bytes[8] = (bytes[8] & 63) | 128;
  return bytes.toString('hex').replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/u, '$1-$2-$3-$4-$5');
}
export default async function handler(request, response) {
  let path;
  try { path = new URL(request.url ?? '/api/notes', 'http://route.invalid').pathname; } catch { /* Existing route validation handles this below. */ }
  if (path?.startsWith('/api/auth') || (path === '/api/notes' && request.query?.authAction !== undefined)) {
    const action = request.query?.authAction;
    return authHandler({ method: request.method, headers: request.headers, body: request.body,
      url: path.startsWith('/api/auth') ? request.url : `/api/auth/${typeof action === 'string' ? action : 'invalid'}` }, response);
  }
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  const resourceId = resourceIdForApiPath(path);
  if (resourceId !== null) response.setHeader('X-Resource-Id', resourceId);
  const fromCookie = request.headers?.authorization === undefined;
  const access = fromCookie ? readSessionCookies(request).access : undefined;
  const authorization = fromCookie && access ? `Bearer ${access}` : request.headers?.authorization;
  if (typeof authorization !== 'string' || !authorization.trim()) {
    return response.status(401).json({ error: 'LOGIN_REQUIRED' });
  }
  if (fromCookie && !['GET', 'HEAD'].includes(request.method) && !sameOrigin(request, config)) {
    return response.status(403).json({ error: 'ORIGIN_FORBIDDEN' });
  }

  const url = process.env.SUPABASE_URL;
  const secret = process.env.SUPABASE_SECRET_KEY;
  try {
    const parsed = new URL(url);
    if (!secret || parsed.protocol !== 'https:' || parsed.username || parsed.password
        || parsed.search || parsed.hash || parsed.pathname !== '/'
        || config.identityProvider?.issuer !== `${parsed.origin}/auth/v1`) {
      return response.status(503).json({ error: 'NOTES_NOT_CONFIGURED' });
    }
    const configuration = JSON.stringify(config);
    if (!runtime || runtime.url !== url || runtime.secret !== secret || runtime.configuration !== configuration) {
      const supabase = createClient(url, secret, {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      });
      const verify = createLoginVerifier({ config, supabaseSecretKey: secret, supabaseClient: supabase });
      runtime = { url, secret, configuration, supabase, verify };
    }
  } catch {
    return response.status(503).json({ error: 'NOTES_NOT_CONFIGURED' });
  }

  const current = runtime;
  let identity;
  let ownerId;
  try {
    identity = await current.verify(authorization);
    ownerId = noteOwnerForVerifiedLogin(identity);
    if (!ownerId) return response.status(401).json({ error: 'LOGIN_REQUIRED' });
    // Identity comes only from the unchanged verifier. Ignore request userId/role.
  } catch {
    return response.status(401).json({ error: 'LOGIN_REQUIRED' });
  }

  let id;
  try {
    const target = new URL(request.url ?? '/api/notes', 'http://route.invalid');
    const match = /^\/api\/notes(?:\/([^/]+))?\/?$/u.exec(target.pathname);
    if (!match) return response.status(404).json({ error: 'NOT_FOUND' });
    // A notes URL may select a data ID, never a table, zone, role or function.
    // Do not turn an unsupported resource request into a successful own-list read.
    if ([...target.searchParams.keys()].some(key => key !== 'noteId')) {
      return response.status(403).json({ error: 'RESOURCE_NOT_ALLOWED' });
    }
    // The rewrite carries a data ID in the URL. A framework query object may
    // be absent; never silently turn a single-row request into a list response.
    const urlIds = target.searchParams.getAll('noteId');
    const candidates = [match[1], request.query?.noteId, ...urlIds]
      .filter(value => value !== undefined);
    if (urlIds.length > 1 || candidates.some(value => typeof value !== 'string' || !UUID.test(value))
        || new Set(candidates.map(value => value.toLowerCase())).size > 1) {
      return response.status(400).json({ error: 'INVALID_NOTE_ID' });
    }
    id = candidates[0]?.toLowerCase();
  } catch {
    return response.status(400).json({ error: 'INVALID_NOTE_ID' });
  }
  const allowed = id ? ['GET', 'PUT', 'DELETE'] : ['GET', 'POST'];
  if (!allowed.includes(request.method)) {
    response.setHeader('Allow', allowed.join(', '));
    return response.status(405).json({ error: 'METHOD_NOT_ALLOWED' });
  }

  let input;
  if (request.method === 'POST' || request.method === 'PUT') {
    if (!/^application\/json(?:\s*;|$)/iu.test(request.headers?.['content-type'] ?? '')) {
      return response.status(415).json({ error: 'JSON_REQUIRED' });
    }
    try {
      input = typeof request.body === 'string' ? JSON.parse(request.body) : request.body;
      if (!input || typeof input !== 'object' || Array.isArray(input)
          || typeof input.title !== 'string' || !input.title.trim() || input.title.trim().length > 200
          || typeof input.body !== 'string' || !input.body.trim() || input.body.length > 10000
          || (request.method === 'POST' && input.id !== undefined
            && (typeof input.id !== 'string' || !UUID.test(input.id)))) {
        return response.status(400).json({ error: 'INVALID_NOTE' });
      }
      if (request.method === 'PUT' && Object.hasOwn(input, 'owner_id')) {
        return response.status(403).json({ error: 'OWNER_CHANGE_FORBIDDEN' });
      }
    } catch {
      return response.status(400).json({ error: 'INVALID_NOTE' });
    }
  }

  try {
    const table = current.supabase.from('vault_notes');
    let operation;
    if (request.method === 'POST') {
      const createdId = input.id?.toLowerCase() ?? randomUUID();
      operation = table.insert({ id: createdId, title: input.title.trim(), content: input.body,
        owner_id: ownerId }).select('id,owner_id');
    } else if (request.method === 'PUT') {
      // Check the existing owner in the same write, and bind the new owner as well.
      operation = table.update({ title: input.title.trim(), content: input.body,
        owner_id: ownerId }).eq('id', id).eq('owner_id', ownerId)
        .select('id,owner_id');
    } else if (request.method === 'DELETE') {
      operation = table.delete().eq('id', id).eq('owner_id', ownerId).select('id,owner_id');
    } else if (id) {
      operation = table.select('id,title,body:content,owner_id').eq('id', id).eq('owner_id', ownerId);
    } else {
      operation = table.select('id,title,body:content,owner_id').eq('owner_id', ownerId)
        .order('created_at', { ascending: true }).order('id', { ascending: true });
    }
    const { data, error } = await operation.abortSignal(AbortSignal.timeout(10000));
    if (error?.code === '23505' && request.method === 'POST') {
      return response.status(409).json({ error: 'NOTE_EXISTS' });
    }
    if (error || !Array.isArray(data)
        || data.some(note => !UUID.test(note?.id ?? '') || (request.method === 'GET'
          && (typeof note.title !== 'string' || typeof note.body !== 'string'))
          // Recheck the stored/returned owner for every method, even after the DB filter.
          // Missing or contradictory ownership must never reach the browser.
          || note.owner_id !== ownerId)) {
      return response.status(502).json({ error: 'NOTES_UNAVAILABLE' });
    }
    if (request.method === 'POST') {
      if (data.length !== 1) return response.status(502).json({ error: 'NOTES_UNAVAILABLE' });
      return response.status(201).json({ id: data[0].id });
    }
    if (id && data.length === 0) return response.status(404).json({ error: 'NOT_FOUND' });
    if (id && data.length !== 1) return response.status(502).json({ error: 'NOTES_UNAVAILABLE' });
    if (request.method === 'DELETE') return response.status(204).end();
    if (request.method === 'PUT') return response.status(200).json({ id: data[0].id });
    // Only the contract fields cross the server boundary.
    const result = data.map(({ id, title, body }) => ({ id, title, body }));
    return response.status(200).json(id ? result[0] : result);
  } catch {
    // Never log or return upstream errors: they may contain URLs or credentials.
    return response.status(502).json({ error: 'NOTES_UNAVAILABLE' });
  }
}
