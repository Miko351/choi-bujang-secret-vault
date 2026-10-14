import { deviceHash } from '../src/device-access.mjs';
export const approvedCookie = `__Host-vault-device=${'a'.repeat(64)}`;
const deviceId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
export function approvedDeviceResponse(target) {
  const owner_id = target.searchParams.get('owner_id')?.slice(3);
  if (target.pathname === '/rest/v1/vault_device_sessions') {
    return Response.json(target.searchParams.get('token_hash') === `eq.${deviceHash('a'.repeat(64))}`
      ? [{device_id:deviceId,owner_id,auth_binding:target.searchParams.get('auth_binding')?.slice(3),
        expires_at:new Date(Date.now()+600000).toISOString()}] : []);
  }
  if (target.pathname === '/rest/v1/vault_devices') return Response.json([{id:deviceId,owner_id,status:'approved'}]);
  return null;
}
