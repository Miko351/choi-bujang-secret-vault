import { createHash, randomBytes } from 'node:crypto';
export const DEVICE_COOKIE = '__Host-vault-device';
export const deviceHash = text => createHash('sha256').update(text).digest('hex');
export const deviceBinding = authorization => deviceHash(`vault.device.login.v1\0${authorization}`);
export async function deviceRows(query) {
  const { data, error } = await query.abortSignal(AbortSignal.timeout(10000));
  if (error || !Array.isArray(data)) throw new Error('DEVICE_UNAVAILABLE');
  return data;
}
export function deviceCookie(request) {
  const raw = request.headers?.cookie;
  if (typeof raw !== 'string' || raw.length > 12000) return null;
  const parts = raw.split(';').map(part => part.trim()).filter(part => part.startsWith(`${DEVICE_COOKIE}=`));
  if (parts.length !== 1) return null;
  const token = parts[0].slice(DEVICE_COOKIE.length + 1);
  return /^[0-9a-f]{64}$/u.test(token) ? token : null;
}
export async function readDeviceAccess({ request, supabase, ownerId, authorization, now = Date.now() }) {
  const token = deviceCookie(request);
  if (!token) return { deviceRegistered: false, status: 'not_registered' };
  const sessions = await deviceRows(supabase.from('vault_device_sessions').select('device_id,owner_id,auth_binding,expires_at')
    .eq('token_hash', deviceHash(token)).eq('owner_id', ownerId).eq('auth_binding', deviceBinding(authorization)));
  const session = sessions[0];
  if (sessions.length !== 1 || session.owner_id !== ownerId || session.auth_binding !== deviceBinding(authorization)
      || !Number.isFinite(Date.parse(session.expires_at)) || Date.parse(session.expires_at) <= now
      || !/^[0-9a-f-]{36}$/u.test(session.device_id ?? '')) {
    return { deviceRegistered: false, status: 'verification_required' };
  }
  const rows = await deviceRows(supabase.from('vault_devices').select('id,owner_id,status')
    .eq('id', session.device_id).eq('owner_id', ownerId));
  const row = rows[0];
  if (rows.length !== 1 || row.id !== session.device_id || row.owner_id !== ownerId
      || !['pending','approved','rejected','revoked'].includes(row.status)) {
    return { deviceRegistered: false, status: 'verification_required' };
  }
  return { deviceRegistered: row.status === 'approved', status: row.status, requestId: row.id };
}
export async function requireRegisteredDevice(input, response) {
  try {
    const state = await readDeviceAccess(input);
    if (state.deviceRegistered) return true;
    response.status(403).json({ error: 'DEVICE_NOT_REGISTERED' });
  } catch { response.status(503).json({ error: 'DEVICE_UNAVAILABLE' }); }
  return false;
}
export async function issueDeviceSession({ supabase, deviceId, ownerId, authorization, response }) {
  const token = randomBytes(32).toString('hex');
  const rows = await deviceRows(supabase.from('vault_device_sessions').insert({ token_hash: deviceHash(token),
    device_id: deviceId, owner_id: ownerId, auth_binding: deviceBinding(authorization),
    expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString() }).select('device_id'));
  if (rows.length !== 1 || rows[0].device_id !== deviceId) throw new Error('DEVICE_UNAVAILABLE');
  // A short-lived proof session, not a device private key. Never return it in JSON or JS storage.
  response.setHeader('Set-Cookie', `${DEVICE_COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=600`);
}

export async function retireDeviceSession(request, supabase, authorization) {
  const token = deviceCookie(request);
  if (!token || !authorization) return;
  await deviceRows(supabase.from('vault_device_sessions').delete()
    .eq('token_hash',deviceHash(token)).eq('auth_binding',deviceBinding(authorization)).select('device_id'));
}