import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
import { generateRegistrationOptions, verifyRegistrationResponse,
  generateAuthenticationOptions, verifyAuthenticationResponse } from '@simplewebauthn/server';
import { createLoginVerifier } from './verify-login.mjs';
import { readSessionCookies, sameOrigin } from './session-cookies.mjs';
import { noteOwnerForVerifiedLogin } from '../api/notes.js';
import { deviceRows, deviceBinding, readDeviceAccess, issueDeviceSession } from './device-access.mjs';
import config from '../aleph.config.json' with { type: 'json' };
const actions = ['status','registration-options','registration','authentication-options','authentication'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
let runtime;
export function createDeviceHandler(action) {
  if (!actions.includes(action)) throw new Error('Invalid device action');
  return async (request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    const deny = (status, error) => response.status(status).json({ error });
    const method = action === 'status' ? 'GET' : 'POST';
    try {
      const url = new URL(request.url, config.publicAppUrl);
      if (url.pathname !== `/api/device-${action}` || url.search) return deny(404, 'NOT_FOUND');
    } catch { return deny(404, 'NOT_FOUND'); }
    if (request.method !== method) { response.setHeader('Allow', method); return deny(405, 'METHOD_NOT_ALLOWED'); }
    const authorization = request.headers?.authorization === undefined
      ? (readSessionCookies(request).access ? `Bearer ${readSessionCookies(request).access}` : null)
      : request.headers.authorization;
    if (typeof authorization !== 'string' || !authorization.trim()) return deny(401, 'LOGIN_REQUIRED');
    // Approval ceremonies and cookie status reads are same-origin only.
    if ((method === 'POST' || request.headers?.authorization === undefined) && !sameOrigin(request, config)) {
      // Same-origin browser GETs do not normally carry Origin.
      if (!(method === 'GET' && request.headers?.origin === undefined
          && request.headers?.['sec-fetch-site'] === 'same-origin')) return deny(403, 'ORIGIN_FORBIDDEN');
    }
    let input;
    if (method === 'POST') {
      if (!/^application\/json(?:\s*;|$)/iu.test(request.headers?.['content-type'] ?? '')) return deny(415, 'JSON_REQUIRED');
      try {
        const raw = typeof request.body === 'string' ? request.body : JSON.stringify(request.body);
        if (typeof raw !== 'string' || raw.length > 40000) return deny(400, 'INVALID_DEVICE_REQUEST');
        input = JSON.parse(raw);
        const keys = action.endsWith('-options') ? [] : ['challengeId','credential'];
        if (!input || Array.isArray(input) || typeof input !== 'object' || Object.keys(input).length !== keys.length
            || keys.some(key => !Object.hasOwn(input, key))) return deny(400, 'INVALID_DEVICE_REQUEST');
      } catch { return deny(400, 'INVALID_DEVICE_REQUEST'); }
    }
    try {
      const url = process.env.SUPABASE_URL;
      const secret = process.env.SUPABASE_SECRET_KEY;
      const parsed = new URL(url);
      if (!secret || parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.search || parsed.hash
          || parsed.pathname !== '/' || config.identityProvider?.issuer !== `${parsed.origin}/auth/v1`) return deny(503, 'DEVICE_UNAVAILABLE');
      const key = JSON.stringify(config);
      if (!runtime || runtime.url !== url || runtime.secret !== secret || runtime.key !== key) {
        const supabase = createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
        runtime = { url, secret, key, supabase, verify: createLoginVerifier({config, supabaseSecretKey:secret, supabaseClient:supabase}) };
      }
    } catch { return deny(503, 'DEVICE_UNAVAILABLE'); }
    const current = runtime;
    let ownerId;
    try { ownerId = noteOwnerForVerifiedLogin(await current.verify(authorization)); } catch { /* Fixed denial only. */ }
    if (!ownerId) return deny(401, 'LOGIN_REQUIRED');
    const supabase = current.supabase;
    try {
      if (action === 'status') return response.status(200).json(await readDeviceAccess({request,supabase,ownerId,authorization}));
      const origin = new URL(config.publicAppUrl).origin;
      const rpID = new URL(origin).hostname;
      if (action.endsWith('-options')) {
        const credentials = await deviceRows(supabase.from('vault_devices').select('credential_id,status')
          .eq('owner_id', ownerId).limit(33));
        if (credentials.length >= 32) return deny(429, 'DEVICE_LIMIT');
        const registering = action === 'registration-options';
        if (!registering && !credentials.some(row => ['pending','approved'].includes(row.status))) return deny(404, 'DEVICE_NOT_FOUND');
        const options = registering ? await generateRegistrationOptions({ rpName:'BYTE BACK 내 자료실', rpID,
          userName:'자료실 사용자', userID:Buffer.from(ownerId.replaceAll('-',''),'hex'), attestationType:'none',
          supportedAlgorithmIDs:[-7],
          excludeCredentials:credentials.map(row => ({id:row.credential_id})),
          authenticatorSelection:{authenticatorAttachment:'platform',residentKey:'required',userVerification:'required'},
        }) : await generateAuthenticationOptions({ rpID, userVerification:'required',
          allowCredentials:credentials.filter(row => ['pending','approved'].includes(row.status)).map(row => ({id:row.credential_id})),
        });
        const challengeId = randomUUID();
        const inserted = await deviceRows(supabase.from('vault_device_challenges').insert({id:challengeId,owner_id:ownerId,
          auth_binding:deviceBinding(authorization),kind:registering?'registration':'authentication',challenge:options.challenge,
          expires_at:new Date(Date.now()+120000).toISOString()}).select('id'));
        if (inserted.length !== 1 || inserted[0].id !== challengeId) return deny(503,'DEVICE_UNAVAILABLE');
        return response.status(200).json({challengeId,options});
      }
      if (!UUID.test(input.challengeId ?? '') || !input.credential || typeof input.credential !== 'object') return deny(400,'INVALID_DEVICE_REQUEST');
      // Atomic delete consumes the challenge before verification; wrong sessions cannot consume it.
      const challenges = await deviceRows(supabase.from('vault_device_challenges').delete()
        .eq('id',input.challengeId).eq('owner_id',ownerId).eq('auth_binding',deviceBinding(authorization))
        .eq('kind',action).select('id,owner_id,auth_binding,kind,challenge,expires_at'));
      const challenge = challenges[0];
      if (challenges.length !== 1 || challenge.owner_id !== ownerId || challenge.auth_binding !== deviceBinding(authorization)
          || challenge.kind !== action || !Number.isFinite(Date.parse(challenge.expires_at))
          || Date.parse(challenge.expires_at) <= Date.now()) return deny(400,'DEVICE_CHALLENGE_EXPIRED');
      let device;
      if (action === 'registration') {
        let result;
        try { result = await verifyRegistrationResponse({response:input.credential,expectedChallenge:challenge.challenge,
          expectedOrigin:origin,expectedRPID:rpID,requireUserVerification:true,supportedAlgorithmIDs:[-7]}); }
        catch { return deny(400,'DEVICE_VERIFICATION_FAILED'); }
        const info = result.registrationInfo;
        if (!result.verified || !info?.userVerified || info.credentialDeviceType !== 'singleDevice'
            || info.credentialBackedUp) return deny(400,'DEVICE_BOUND_CREDENTIAL_REQUIRED');
        const id = randomUUID();
        const saved = await deviceRows(supabase.from('vault_devices').insert({id,owner_id:ownerId,
          credential_id:info.credential.id,public_key:Buffer.from(info.credential.publicKey).toString('base64url'),
          counter:info.credential.counter,status:'pending'}).select('id,owner_id,status'));
        if (saved.length !== 1 || saved[0].id !== id || saved[0].owner_id !== ownerId || saved[0].status !== 'pending') return deny(503,'DEVICE_UNAVAILABLE');
        device = saved[0];
      } else {
        const found = await deviceRows(supabase.from('vault_devices').select('id,owner_id,status,credential_id,public_key,counter')
          .eq('owner_id',ownerId).eq('credential_id',input.credential.id));
        device = found[0];
        if (found.length !== 1 || device.owner_id !== ownerId || !['pending','approved'].includes(device.status)) return deny(403,'DEVICE_NOT_REGISTERED');
        let result;
        try { result = await verifyAuthenticationResponse({response:input.credential,expectedChallenge:challenge.challenge,
          expectedOrigin:origin,expectedRPID:rpID,requireUserVerification:true,credential:{id:device.credential_id,
            publicKey:new Uint8Array(Buffer.from(device.public_key,'base64url')),counter:device.counter}}); }
        catch { return deny(400,'DEVICE_VERIFICATION_FAILED'); }
        const info = result.authenticationInfo;
        if (!result.verified || !info.userVerified || info.credentialDeviceType !== 'singleDevice' || info.credentialBackedUp) return deny(400,'DEVICE_VERIFICATION_FAILED');
        const updated = await deviceRows(supabase.from('vault_devices').update({counter:info.newCounter})
          .eq('id',device.id).eq('owner_id',ownerId).eq('counter',device.counter).eq('status',device.status).select('id'));
        if (updated.length !== 1 || updated[0].id !== device.id) return deny(409,'DEVICE_RETRY');
      }
      await issueDeviceSession({supabase,deviceId:device.id,ownerId,authorization,response});
      // Approval is read from the database again, not from the button or registration payload.
      const tokenCookie = response.getHeader?.('Set-Cookie');
      if (typeof tokenCookie !== 'string') return deny(503,'DEVICE_UNAVAILABLE');
      const state = await readDeviceAccess({request:{headers:{cookie:tokenCookie.split(';')[0]}},supabase,ownerId,authorization});
      return response.status(200).json(state);
    } catch { return deny(503,'DEVICE_UNAVAILABLE'); }
  };
}
