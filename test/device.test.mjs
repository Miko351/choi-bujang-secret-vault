import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID, randomBytes, createHash, generateKeyPairSync, sign } from 'node:crypto';
import { generateKeyPair, exportJWK, SignJWT } from 'jose';
import { isoCBOR } from '@simplewebauthn/server/helpers';
import { createDeviceHandler } from '../src/device-handler.mjs';
import notesHandler from '../api/notes.js';
import { DEVICE_COOKIE, retireDeviceSession } from '../src/device-access.mjs';
import { createClient } from '@supabase/supabase-js';
import config from '../aleph.config.json' with {type:'json'};

const hash = value => createHash('sha256').update(value).digest();
async function invoke(handler, {url,authorization,cookie,method='POST',body={},headers={}} = {}) {
  const result = {headers:{}};
  const response = {setHeader(name,value){result.headers[name.toLowerCase()]=value;},
    getHeader(name){return result.headers[name.toLowerCase()];},
    status(status){result.status=status;return {json(value){result.body=value;},end(){}};}};
  await handler({url,method,body,headers:{authorization,cookie,origin:config.publicAppUrl,
    'content-type':'application/json',...headers}},response);
  return result;
}
function authenticator(rpID) {
  // Test-only authenticator key, retained in memory and never logged or written.
  const pair = generateKeyPairSync('ec',{namedCurve:'prime256v1'});
  const jwk = pair.publicKey.export({format:'jwk'});
  const id = randomBytes(32).toString('base64url');
  const cose = isoCBOR.encode(new Map([[1,2],[3,-7],[-1,1],
    [-2,new Uint8Array(Buffer.from(jwk.x,'base64url'))],[-3,new Uint8Array(Buffer.from(jwk.y,'base64url'))]]));
  return {id, response(options,{origin=config.publicAppUrl,registration=true,flags=registration?0x45:0x05,counter=1,badSignature=false}={}) {
    const client = Buffer.from(JSON.stringify({type:registration?'webauthn.create':'webauthn.get',challenge:options.challenge,origin,crossOrigin:false}));
    const number = Buffer.alloc(4); number.writeUInt32BE(counter);
    const auth = Buffer.concat([hash(rpID),Buffer.from([flags]),number,
      ...(registration?[Buffer.alloc(16),Buffer.from([0,32]),Buffer.from(id,'base64url'),Buffer.from(cose)]:[])]);
    const signature = sign('sha256',Buffer.concat([auth,hash(client)]),pair.privateKey);
    if (badSignature) signature[signature.length-1] ^= 1;
    return {id,rawId:id,type:'public-key',authenticatorAttachment:'platform',clientExtensionResults:{},
      response:registration?{clientDataJSON:client.toString('base64url'),attestationObject:Buffer.from(isoCBOR.encode(new Map([
        ['fmt','none'],['authData',new Uint8Array(auth)],['attStmt',new Map()]]))).toString('base64url'),transports:['internal']}
      :{clientDataJSON:client.toString('base64url'),authenticatorData:auth.toString('base64url'),signature:signature.toString('base64url')}};
  }};
}

test('WebAuthn request stays pending; only server-approved proof opens notes, with no client key storage', async t => {
  const saved = {config:structuredClone(config),fetch:globalThis.fetch,url:process.env.SUPABASE_URL,key:process.env.SUPABASE_SECRET_KEY};
  const logging = Object.fromEntries(['log','warn','error'].map(key=>[key,console[key]]));
  let logs = 0;
  const project = 'https://device-training.supabase.co';
  const pair = await generateKeyPair('ES256');
  const jwk = {...await exportJWK(pair.publicKey),alg:'ES256',kid:'device-fixture'};
  const a = '11111111-1111-4111-8111-111111111111', b = '22222222-2222-4222-8222-222222222222';
  const now = Math.floor(Date.now()/1000);
  const token = (sub,iat=now) => new SignJWT({iss:`${project}/auth/v1`,aud:'authenticated',role:'authenticated',sub,iat,exp:now+600})
    .setProtectedHeader({alg:'ES256',kid:jwk.kid}).sign(pair.privateKey);
  const authorization = `Bearer ${await token(a)}`;
  const otherAuth = `Bearer ${await token(b)}`;
  const changedAuth = `Bearer ${await token(a,now-1)}`;
  const tables = Object.fromEntries(['vault_devices','vault_device_challenges','vault_device_sessions','vault_notes'].map(name=>[name,[]]));
  let noteCalls = 0;
  let dbFailure = false;
  let cookie;
  const api = async (action,body={},options={}) => {
    const result = await invoke(createDeviceHandler(action),{url:`/api/device-${action}`,method:action==='status'?'GET':'POST',
      authorization,cookie,body,...options});
    if (typeof result.headers['set-cookie'] === 'string') cookie = result.headers['set-cookie'].split(';')[0];
    return result;
  };
  const notes = (method='GET',url='/api/notes',body,extras={}) => invoke(notesHandler,{method,url,body,authorization,cookie,...extras});
  try {
    Object.assign(config,{identityProvider:{issuer:`${project}/auth/v1`,audience:'authenticated',jwksUrl:`${project}/auth/v1/.well-known/jwks.json`}});
    process.env.SUPABASE_URL=project; process.env.SUPABASE_SECRET_KEY=['device','fixture','server'].join('-');
    for (const key of Object.keys(logging)) console[key]=()=>{logs++;};
    globalThis.fetch = async (url,options={}) => {
      const target = new URL(url);
      assert.equal(target.origin,project);
      if (target.href===config.identityProvider.jwksUrl) return Response.json({keys:[jwk]});
      if (target.pathname==='/auth/v1/user') return Response.json({id:a,aud:'authenticated'});
      if (target.pathname==='/auth/v1/logout') return new Response(null,{status:204});
      const name=target.pathname.split('/').at(-1);
      assert.ok(Object.hasOwn(tables,name), 'Only the four scoped training tables are used');
      if (dbFailure) return Response.json({message:process.env.SUPABASE_SECRET_KEY},{status:403});
      if (name==='vault_notes') noteCalls++;
      const matches = row => [...target.searchParams].every(([key,value]) => !value.startsWith('eq.') || String(row[key])===value.slice(3));
      let rows=tables[name].filter(matches);
      if (options.method==='POST') {
        const row=JSON.parse(options.body);
        if (name==='vault_devices' && tables[name].some(value=>value.credential_id===row.credential_id)) return Response.json({code:'23505'},{status:409});
        tables[name].push(row);rows=[row];
      } else if (options.method==='DELETE') {
        tables[name]=tables[name].filter(row=>!rows.includes(row));
      } else if (options.method==='PATCH') {
        rows.forEach(row=>Object.assign(row,JSON.parse(options.body)));
      }
      if (target.searchParams.has('limit')) rows=rows.slice(0,Number(target.searchParams.get('limit')));
      const projection=(target.searchParams.get('select')??'').split(',');
      return Response.json(rows.map(row=>Object.fromEntries(projection.map(field=>{
        const [alias,source]=field.split(':'); return [alias,row[source??alias]];
      }))));
    };
    const hardware=authenticator(new URL(config.publicAppUrl).hostname);
    let registrationOptions;
    await t.test('missing, forged and unapproved requests never reach note data',async()=>{
      assert.equal((await api('status',{}, {authorization:undefined,cookie:undefined})).status,401);
      assert.equal((await api('status',{}, {authorization:'Bearer invalid'})).status,401);
      assert.equal((await api('registration-options',{role:'approved'})).status,400);
      assert.equal((await api('registration-options',{}, {headers:{origin:'https://wrong.invalid'}})).status,403);
      for (const method of ['GET','POST','PUT','DELETE']) {
        const result=await notes(method,['PUT','DELETE'].includes(method)?`/api/notes/${randomUUID()}`:'/api/notes',
          ['POST','PUT'].includes(method)?{title:'fixture',body:'fixture'}:undefined,
          {headers:{'x-device-registered':'true'},deviceRegistered:true,role:'approved'});
        assert.equal(result.status,403);assert.deepEqual(result.body,{error:'DEVICE_NOT_REGISTERED'});
      }
      assert.equal(noteCalls,0);
    });
    await t.test('verified registration creates a pending request, never approval; replay is rejected',async()=>{
      registrationOptions=await api('registration-options');
      assert.equal(registrationOptions.status,200);
      const body={challengeId:registrationOptions.body.challengeId,credential:hardware.response(registrationOptions.body.options)};
      const registered=await api('registration',body);
      assert.equal(registered.status,200);
      assert.equal(registered.body.status,'pending');assert.equal(registered.body.deviceRegistered,false);
      assert.match(registered.headers['set-cookie'],/HttpOnly; Secure; SameSite=Strict; Max-Age=600/u);
      assert.equal(tables.vault_devices.length,1);assert.equal(tables.vault_devices[0].status,'pending');
      assert.equal((await api('registration',body)).status,400);
      assert.equal((await notes()).status,403);assert.equal(noteCalls,0);
      assert.deepEqual(Object.keys(registered.body).sort(),['deviceRegistered','requestId','status']);
    });
    await t.test('only separately approved proof enables own CRUD and retains cross-owner denials',async()=>{
      const device=tables.vault_devices[0];device.status='approved';
      const status=await api('status');assert.equal(status.body.deviceRegistered,true);
      const created=await notes('POST','/api/notes',{title:'fixture',body:'fixture'});
      assert.equal(created.status,201);const id=created.body.id;
      assert.equal((await notes()).status,200);
      assert.equal((await notes('GET',`/api/notes/${id}`)).body.id,id);
      assert.equal((await notes('PUT',`/api/notes/${id}`,{title:'changed',body:'changed'})).status,200);
      assert.equal((await notes('PUT',`/api/notes/${id}`,{title:'changed',body:'changed',owner_id:b})).status,403);
      const before=noteCalls;
      assert.equal((await notes('GET','/api/notes',undefined,{authorization:otherAuth})).status,403);
      assert.equal((await notes('GET','/api/notes',undefined,{authorization:changedAuth})).status,403);
      assert.equal((await notes('GET','/api/notes',undefined,{cookie:`${DEVICE_COOKIE}=${'f'.repeat(64)}`})).status,403);
      assert.equal(noteCalls,before);
      const foreign=randomUUID();tables.vault_notes.push({id:foreign,owner_id:b,title:'other',content:'other'});
      assert.equal((await notes('GET',`/api/notes/${foreign}`)).status,404);
      assert.equal((await notes('DELETE',`/api/notes/${id}`)).status,204);
      assert.equal((await notes('GET',`/api/notes/${id}`)).status,404);
    });
    await t.test('expired sessions require fresh verified signatures; wrong origin, signatures, UV and replay fail',async()=>{
      tables.vault_device_sessions.forEach(row=>{row.expires_at=new Date(0).toISOString();});
      assert.equal((await api('status')).body.status,'verification_required');
      assert.equal((await notes()).status,403);
      for (const altered of [{origin:'https://wrong.invalid'},{badSignature:true},{flags:0x01}]) {
        const options=await api('authentication-options');
        const result=await api('authentication',{challengeId:options.body.challengeId,
          credential:hardware.response(options.body.options,{registration:false,counter:2,...altered})});
        assert.equal(result.status,400);
      }
      const options=await api('authentication-options');
      const body={challengeId:options.body.challengeId,credential:hardware.response(options.body.options,{registration:false,counter:2})};
      assert.equal((await api('authentication',body)).body.deviceRegistered,true);
      assert.equal((await api('authentication',body)).status,400);
      assert.equal((await notes()).status,200);
      const registration=await api('registration-options');
      const multi=authenticator(new URL(config.publicAppUrl).hostname);
      assert.equal((await api('registration',{challengeId:registration.body.challengeId,
        credential:multi.response(registration.body.options,{flags:0x4d})})).status,400);
    });
    await t.test('revocation, unavailable DB, logout and login-binding changes fail closed without exposing bodies',async()=>{
      const before=noteCalls;
      tables.vault_devices[0].status='revoked';
      assert.equal((await api('status')).body.deviceRegistered,false);assert.equal((await notes()).status,403);
      tables.vault_devices[0].status='approved';
      dbFailure=true;
      const failed=await notes();assert.equal(failed.status,503);
      assert.ok(!JSON.stringify(failed).includes(process.env.SUPABASE_SECRET_KEY));
      dbFailure=false;assert.equal(noteCalls,before);
      const previousCookie=cookie;
      const logout=await invoke(notesHandler,{url:'/api/auth/logout',method:'POST',cookie:
        `__Host-vault-access=${authorization.slice(7)}; __Host-vault-refresh=fixture_refresh; ${cookie}`});
      assert.equal(logout.status,200);
      assert.ok(logout.headers['set-cookie'].some(value=>value.startsWith(`${DEVICE_COOKIE}=`)&&value.endsWith('Max-Age=0')));
      assert.equal((await notes('GET','/api/notes',undefined,{cookie:previousCookie})).status,403);
      const client=createClient(project,process.env.SUPABASE_SECRET_KEY,{auth:{persistSession:false}});
      await retireDeviceSession({headers:{}},client,authorization);
      assert.equal(logs,0);
    });
  } finally {
    Object.assign(config,saved.config);globalThis.fetch=saved.fetch;Object.assign(console,logging);
    for (const [key,value] of [['SUPABASE_URL',saved.url],['SUPABASE_SECRET_KEY',saved.key]]) {
      if (value===undefined) delete process.env[key]; else process.env[key]=value;
    }
  }
});
