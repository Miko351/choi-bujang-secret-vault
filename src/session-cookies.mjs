import { DEVICE_COOKIE } from './device-access.mjs';
// Cookie transport only. Token verification stays in verify-login.mjs.
export const ACCESS_COOKIE = '__Host-vault-access';
export const REFRESH_COOKIE = '__Host-vault-refresh';
const MAX_AGE = 60 * 60 * 24 * 14;
const OPAQUE = /^[A-Za-z0-9._~-]{1,3500}$/u;

export function readSessionCookies(request) {
  const raw = request.headers?.cookie;
  if (typeof raw !== 'string' || raw.length > 10000) return {};
  const result = {};
  for (const [field, name] of [['access', ACCESS_COOKIE], ['refresh', REFRESH_COOKIE]]) {
    const values = raw.split(';').map(part => part.trim()).filter(part => part.startsWith(`${name}=`));
    if (values.length !== 1) continue;
    const value = values[0].slice(name.length + 1);
    if (OPAQUE.test(value)) result[field] = value;
  }
  return result;
}

export function setSessionCookies(response, session) {
  if (!OPAQUE.test(session?.access_token ?? '') || !OPAQUE.test(session?.refresh_token ?? '')) {
    throw new Error('invalid_session_transport');
  }
  response.setHeader('Set-Cookie', [
    `${ACCESS_COOKIE}=${session.access_token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${MAX_AGE}`,
    `${REFRESH_COOKIE}=${session.refresh_token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${MAX_AGE}`,
    `${DEVICE_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`,
  ]);
}

export function clearSessionCookies(response) {
  response.setHeader('Set-Cookie', [ACCESS_COOKIE, REFRESH_COOKIE, DEVICE_COOKIE].map(name =>
    `${name}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`));
}

export function sameOrigin(request, config) {
  return request.headers?.origin === new URL(config.publicAppUrl).origin
    && !['cross-site', 'none'].includes(request.headers?.['sec-fetch-site']);
}
