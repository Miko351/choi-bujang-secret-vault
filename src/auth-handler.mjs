import { retireDeviceSession } from './device-access.mjs';
import { createClient } from '@supabase/supabase-js';
import { createLoginVerifier } from './verify-login.mjs';
import { readSessionCookies, setSessionCookies, clearSessionCookies, sameOrigin } from './session-cookies.mjs';
import config from '../aleph.config.json' with { type: 'json' };

const SAFE_ERRORS = new Set(['invalid_credentials', 'email_not_confirmed', 'user_banned',
  'over_request_rate_limit', 'over_email_send_rate_limit', 'email_provider_disabled']);

export default async function handler(request, response) {
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  let action;
  try {
    const path = new URL(request.url ?? '/api/auth', 'http://route.invalid').pathname;
    const match = /^\/api\/auth(?:\/(login|logout|session|refresh))?\/?$/u.exec(path);
    action = match?.[1] ?? (match ? request.query?.action : undefined);
  } catch { /* Invalid route is rejected below. */ }
  if (!['login', 'logout', 'session', 'refresh'].includes(action)) {
    return response.status(404).json({ error: 'NOT_FOUND' });
  }
  const method = action === 'session' ? 'GET' : 'POST';
  if (request.method !== method) {
    response.setHeader('Allow', method);
    return response.status(405).json({ error: 'METHOD_NOT_ALLOWED' });
  }
  if (method === 'POST' && !sameOrigin(request, config)) {
    return response.status(403).json({ error: 'ORIGIN_FORBIDDEN' });
  }
  const cookies = readSessionCookies(request);
  if (action === 'session' && !cookies.access && !cookies.refresh) {
    return response.status(200).json({ user: null });
  }
  let input;
  if (action === 'login') {
    if (!/^application\/json(?:\s*;|$)/iu.test(request.headers?.['content-type'] ?? '')) {
      return response.status(415).json({ error: 'JSON_REQUIRED' });
    }
    try {
      input = typeof request.body === 'string' ? JSON.parse(request.body) : request.body;
      if (!input || Array.isArray(input) || typeof input.email !== 'string'
          || !input.email.trim() || input.email.length > 320
          || typeof input.password !== 'string' || !input.password || input.password.length > 4096) {
        return response.status(400).json({ error: 'INVALID_LOGIN' });
      }
    } catch { return response.status(400).json({ error: 'INVALID_LOGIN' }); }
  }
  try {
    const url = new URL(process.env.SUPABASE_URL);
    const secret = process.env.SUPABASE_SECRET_KEY;
    if (!secret || url.protocol !== 'https:' || url.username || url.password || url.search || url.hash
        || url.pathname !== '/' || config.identityProvider?.issuer !== `${url.origin}/auth/v1`) {
      return response.status(503).json({ error: 'AUTH_NOT_CONFIGURED' });
    }
    // Each request gets its own SDK client. Never mutate the notes service-role client.
    const client = createClient(url.origin, secret, { auth: {
      persistSession: false, autoRefreshToken: false, detectSessionInUrl: false,
    }, global: { fetch: (target, options) => fetch(target, {
      ...options, signal: AbortSignal.timeout(10000),
    }) } });
    const verify = createLoginVerifier({ config, supabaseSecretKey: secret, supabaseClient: client });
    if (action === 'session') {
      const identity = cookies.access && await verify(`Bearer ${cookies.access}`);
      if (identity?.kind !== 'student') return response.status(401).json({ error: 'LOGIN_REQUIRED' });
      return response.status(200).json({ user: { id: identity.userId } });
    }
    if (action === 'logout') {
      if (cookies.access && cookies.refresh) {
        const restored = await client.auth.setSession({ access_token: cookies.access, refresh_token: cookies.refresh });
        if (restored.error && ![400, 401, 403].includes(restored.error.status)) {
          return response.status(503).json({ error: 'AUTH_UNAVAILABLE' });
        }
        if (!restored.error) {
          const { error } = await client.auth.signOut({ scope: 'local' });
          if (error) return response.status(503).json({ error: 'AUTH_UNAVAILABLE' });
        }
      }
      await retireDeviceSession(request,client,cookies.access ? `Bearer ${cookies.access}` : null);
      clearSessionCookies(response);
      return response.status(200).json({ user: null });
    }
    if (action === 'refresh' && !cookies.refresh) {
      clearSessionCookies(response);
      return response.status(401).json({ error: 'LOGIN_REQUIRED' });
    }
    const result = action === 'login'
      ? await client.auth.signInWithPassword({ email: input.email.trim(), password: input.password })
      : await client.auth.refreshSession({ refresh_token: cookies.refresh });
    if (result.error) {
      if (action === 'refresh' && [400, 401, 403].includes(result.error.status)) clearSessionCookies(response);
      return response.status(result.error.status === 429 ? 429
        : result.error.status >= 500 || result.error.name === 'AuthRetryableFetchError' ? 503 : 401)
        .json({ error: SAFE_ERRORS.has(result.error.code) ? result.error.code : 'LOGIN_REQUIRED' });
    }
    const session = result.data?.session;
    const identity = session?.access_token && await verify(`Bearer ${session.access_token}`);
    if (identity?.kind !== 'student') return response.status(401).json({ error: 'LOGIN_REQUIRED' });
    await retireDeviceSession(request,client,cookies.access ? `Bearer ${cookies.access}` : null);
    setSessionCookies(response, session);
    return response.status(200).json({ user: { id: identity.userId } });
  } catch {
    // Never expose upstream exceptions, request bodies, keys or session tokens.
    return response.status(503).json({ error: 'AUTH_UNAVAILABLE' });
  }
}
