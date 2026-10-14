import { requireRegisteredDevice } from '../src/device-access.mjs';
import { createClient } from '@supabase/supabase-js';
import { createLoginVerifier } from '../src/verify-login.mjs';
import { readSessionCookies, sameOrigin } from '../src/session-cookies.mjs';
import { canEditNoticeInApi, RESOURCE_IDS } from '../src/decider.mjs';
import config from '../aleph.config.json' with { type: 'json' };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
let runtime;

export default async function handler(request, response) {
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('X-Resource-Id', RESOURCE_IDS.INSTRUCTOR_NOTICES);
  const fromCookie = request.headers?.authorization === undefined;
  const access = fromCookie ? readSessionCookies(request).access : undefined;
  const authorization = fromCookie && access ? `Bearer ${access}` : request.headers?.authorization;
  if (typeof authorization !== 'string' || !authorization.trim()) {
    return response.status(401).json({ error: 'LOGIN_REQUIRED' });
  }
  if (fromCookie && !sameOrigin(request, config)) {
    return response.status(403).json({ error: 'ORIGIN_FORBIDDEN' });
  }
  try {
    const url = process.env.SUPABASE_URL;
    const secret = process.env.SUPABASE_SECRET_KEY;
    const parsed = new URL(url);
    if (!secret || parsed.protocol !== 'https:' || parsed.username || parsed.password
        || parsed.search || parsed.hash || parsed.pathname !== '/'
        || config.identityProvider?.issuer !== `${parsed.origin}/auth/v1`) {
      return response.status(503).json({ error: 'NOTICES_NOT_CONFIGURED' });
    }
    const configuration = JSON.stringify(config);
    if (!runtime || runtime.url !== url || runtime.secret !== secret || runtime.configuration !== configuration) {
      const supabase = createClient(url, secret, {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      });
      runtime = { url, secret, configuration, supabase,
        verify: createLoginVerifier({ config, supabaseSecretKey: secret, supabaseClient: supabase }) };
    }
  } catch {
    return response.status(503).json({ error: 'NOTICES_NOT_CONFIGURED' });
  }
  const current = runtime;
  let identity;
  try { identity = await current.verify(authorization); } catch { /* Fail closed. */ }
  if (!UUID.test(identity?.userId ?? '')) {
    return response.status(401).json({ error: 'LOGIN_REQUIRED' });
  }
  const userId = identity.userId.toLowerCase();
  let id;
  try {
    const path = new URL(request.url ?? '', 'http://route.invalid').pathname;
    const match = /^\/api\/notices(?:\/([^/]+))?$/u.exec(path);
    if (!match) return response.status(404).json({ error: 'NOT_FOUND' });
    // A rewrite carries only a data ID; query strings never select a function.
    id = match[1] ?? request.query?.noticeId;
    if (typeof id !== 'string' || !UUID.test(id)) {
      return response.status(400).json({ error: 'INVALID_NOTICE_ID' });
    }
    id = id.toLowerCase();
  } catch { return response.status(400).json({ error: 'INVALID_NOTICE_ID' }); }
  if (request.method !== 'PUT') {
    response.setHeader('Allow', 'PUT');
    return response.status(405).json({ error: 'METHOD_NOT_ALLOWED' });
  }
  // This is a server-managed capability for this notice, not the login role,
  // a browser menu, user_metadata or a submitted role/owner/resource claim.
  if (!canEditNoticeInApi(userId, id)) {
    return response.status(403).json({ error: 'NOTICE_EDIT_FORBIDDEN' });
  }
  if (!/^application\/json(?:\s*;|$)/iu.test(request.headers?.['content-type'] ?? '')) {
    return response.status(415).json({ error: 'JSON_REQUIRED' });
  }
  let input;
  try {
    input = typeof request.body === 'string' ? JSON.parse(request.body) : request.body;
    if (!input || typeof input !== 'object' || Array.isArray(input)
        || Object.keys(input).length !== 2 || !Object.hasOwn(input, 'title') || !Object.hasOwn(input, 'body')
        || typeof input.title !== 'string' || !input.title.trim() || input.title.trim().length > 200
        || typeof input.body !== 'string' || !input.body.trim() || input.body.length > 10000) {
      return response.status(400).json({ error: 'INVALID_NOTICE' });
    }
  } catch { return response.status(400).json({ error: 'INVALID_NOTICE' }); }
  if (!await requireRegisteredDevice({request, supabase:current.supabase, ownerId:userId, authorization}, response)) return;
  try {
    // Both the stored owner and the new owner must be the verified user.
    // No table creation, data migration or changes to vault_notes occur here.
    const { data, error } = await current.supabase.from('vault_notices')
      .update({ title: input.title.trim(), content: input.body, owner_id: userId })
      .eq('id', id).eq('owner_id', userId).select('id,owner_id')
      .abortSignal(AbortSignal.timeout(10000));
    if (error || !Array.isArray(data) || data.length > 1
        || data.some(row => row.id !== id || row.owner_id !== userId)) {
      return response.status(502).json({ error: 'NOTICES_UNAVAILABLE' });
    }
    if (!data.length) return response.status(404).json({ error: 'NOT_FOUND' });
    return response.status(200).json({ id });
  } catch {
    return response.status(502).json({ error: 'NOTICES_UNAVAILABLE' });
  }
}
