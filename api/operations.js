import { createHash } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { createLoginVerifier } from '../src/verify-login.mjs';
import { readSessionCookies, sameOrigin } from '../src/session-cookies.mjs';
import { readDeviceAccess, deviceRows } from '../src/device-access.mjs';
import { noteOwnerForVerifiedLogin } from './notes.js';
import { RULE_IDS } from '../src/decider.mjs';
import { readOperationsSnapshot } from '../public/operations-model.js';
import config from '../aleph.config.json' with {type:'json'};
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
let runtime;
export default async function handler(request,response) {
  response.setHeader('Cache-Control','no-store');
  response.setHeader('X-Content-Type-Options','nosniff');
  const deny=(status,error)=>response.status(status).json({error});
  try {
    const url=new URL(request.url??'',config.publicAppUrl);
    if (url.pathname!=='/api/operations' || url.search || Object.keys(request.query??{}).length) return deny(404,'NOT_FOUND');
  } catch {return deny(404,'NOT_FOUND');}
  if (request.method!=='GET') {response.setHeader('Allow','GET');return deny(405,'METHOD_NOT_ALLOWED');}
  const fromCookie=request.headers?.authorization===undefined;
  const access=fromCookie?readSessionCookies(request).access:null;
  const authorization=fromCookie&&access?`Bearer ${access}`:request.headers?.authorization;
  if (typeof authorization!=='string'||!authorization.trim()) return deny(401,'LOGIN_REQUIRED');
  if (fromCookie && ((request.headers?.origin!==undefined&&!sameOrigin(request,config))
      || ['cross-site','none'].includes(request.headers?.['sec-fetch-site']))) return deny(403,'ORIGIN_FORBIDDEN');
  try {
    const url=process.env.SUPABASE_URL, secret=process.env.SUPABASE_SECRET_KEY;
    const parsed=new URL(url);
    if (!secret || parsed.protocol!=='https:' || parsed.username || parsed.password || parsed.search || parsed.hash
        || parsed.pathname!=='/' || config.identityProvider?.issuer!==`${parsed.origin}/auth/v1`) return deny(503,'OPERATIONS_UNAVAILABLE');
    const configuration=JSON.stringify(config);
    if (!runtime||runtime.url!==url||runtime.secret!==secret||runtime.configuration!==configuration) {
      const supabase=createClient(url,secret,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
      runtime={url,secret,configuration,supabase,verify:createLoginVerifier({config,supabaseSecretKey:secret,supabaseClient:supabase})};
    }
  } catch {return deny(503,'OPERATIONS_UNAVAILABLE');}
  const current=runtime;
  let ownerId;
  try {ownerId=noteOwnerForVerifiedLogin(await current.verify(authorization));} catch { /* Fixed denial only. */ }
  if (!ownerId) return deny(401,'LOGIN_REQUIRED');
  try {
    const device=await readDeviceAccess({request,supabase:current.supabase,ownerId,authorization});
    if (!device.deviceRegistered) return deny(403,'DEVICE_NOT_REGISTERED');
    // Select only this account's device status; never read notes, credentials, sessions or audit payloads here.
    const rows=await deviceRows(current.supabase.from('vault_devices').select('id,owner_id,status')
      .eq('owner_id',ownerId).order('id',{ascending:true}).limit(257));
    if (rows.length>256 || rows.some(row=>!UUID.test(row.id??'')||row.owner_id!==ownerId
        ||!['pending','approved','rejected','revoked'].includes(row.status))
        ||new Set(rows.map(row=>row.id)).size!==rows.length) return deny(503,'OPERATIONS_UNAVAILABLE');
    if (!rows.some(row=>row.id===device.requestId&&row.status==='approved')) return deny(403,'DEVICE_NOT_REGISTERED');
    const unrun=(kind)=>({kind,source:'engine',status:'unrun',
      reasonCode:kind==='revocation_execution'?'execution_not_connected':'record_not_connected'});
    const records=[{kind:'rules',source:'server_configuration',status:'confirmed',ruleIds:[...RULE_IDS]},
      unrun('decisions'),unrun('detection'),unrun('revocation_execution'),
      {kind:'recovery',source:'restore_execution',status:'unrun',reasonCode:'record_not_connected',version:null},
      ...rows.map(row=>({kind:'device',source:'database_snapshot',status:row.status,
        ref:`d-${createHash('sha256').update('vault.operations.device.v1\0').update(JSON.stringify([ownerId,row.id])).digest('hex').slice(0,12)}`}))];
    return response.status(200).json(readOperationsSnapshot({schema:'vault.operations.v1',observedAt:new Date().toISOString(),records}));
  } catch {return deny(503,'OPERATIONS_UNAVAILABLE');}
}
