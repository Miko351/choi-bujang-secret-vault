import assert from 'node:assert/strict';
import { test } from 'node:test';
import { generateKeyPair, exportJWK, SignJWT } from 'jose';
import handler from '../api/operations.js';
import config from '../aleph.config.json' with {type:'json'};
import { RULE_IDS } from '../src/decider.mjs';
import { deviceBinding, deviceHash } from '../src/device-access.mjs';
import { readOperationsSnapshot, operationsView } from '../public/operations-model.js';

async function invoke({authorization,cookie,method='GET',url='/api/operations',headers={},...claims}={}) {
  const result={headers:{}};
  await handler({method,url,headers:{authorization,cookie,origin:config.publicAppUrl,...headers},...claims},{
    setHeader(name,value){result.headers[name.toLowerCase()]=value;},
    status(status){result.status=status;return {json(body){result.body=body;}};},
  });return result;
}

test('operations API masks current server records and cannot turn unrun detection, revocation or recovery into success',async t=>{
  const saved={config:structuredClone(config),fetch:globalThis.fetch,url:process.env.SUPABASE_URL,key:process.env.SUPABASE_SECRET_KEY};
  const logging=Object.fromEntries(['log','warn','error'].map(key=>[key,console[key]]));let logged=0;
  const project='https://operations-training.supabase.co';
  const a='11111111-1111-4111-8111-111111111111',b='22222222-2222-4222-8222-222222222222';
  const deviceId='dddddddd-dddd-4ddd-8ddd-dddddddddddd';
  const secret=['operations','server','fixture'].join('-');
  const proof='a'.repeat(64),cookie=`__Host-vault-device=${proof}`;
  const key=await generateKeyPair('ES256');const jwk={...await exportJWK(key.publicKey),alg:'ES256',kid:'operations-fixture'};
  const token=async owner=>new SignJWT({iss:`${project}/auth/v1`,aud:'authenticated',role:'authenticated',sub:owner,
    exp:Math.floor(Date.now()/1000)+300}).setProtectedHeader({alg:'ES256',kid:jwk.kid}).sign(key.privateKey);
  const authorization=`Bearer ${await token(a)}`,other=`Bearer ${await token(b)}`;
  const rows=[{id:deviceId,owner_id:a,status:'approved'},
    {id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',owner_id:a,status:'pending'},
    {id:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',owner_id:a,status:'revoked'},
    {id:'cccccccc-cccc-4ccc-8ccc-cccccccccccc',owner_id:b,status:'revoked'}];
  let mode='normal',dbCalls=0,writes=0;
  const call=extras=>invoke({authorization,cookie,...extras});
  try {
    Object.assign(config,{identityProvider:{issuer:`${project}/auth/v1`,audience:'authenticated',jwksUrl:`${project}/auth/v1/.well-known/jwks.json`}});
    process.env.SUPABASE_URL=project;process.env.SUPABASE_SECRET_KEY=secret;
    for (const name of Object.keys(logging)) console[name]=()=>{logged++;};
    globalThis.fetch=async(url,options={})=>{
      const target=new URL(url);assert.equal(target.origin,project);
      if (target.href===config.identityProvider.jwksUrl) return Response.json({keys:[jwk]});
      dbCalls++;if (options.method&&options.method!=='GET') writes++;
      if (mode==='db-failure') return Response.json({message:secret,body:'PRIVATE_NOTE_CONTENT'},{status:403});
      if (target.pathname==='/rest/v1/vault_device_sessions') {
        assert.equal(target.searchParams.get('select'),'device_id,owner_id,auth_binding,expires_at');
        const valid=target.searchParams.get('token_hash')===`eq.${deviceHash(proof)}`
          &&target.searchParams.get('owner_id')===`eq.${a}`&&target.searchParams.get('auth_binding')===`eq.${deviceBinding(authorization)}`;
        return Response.json(valid?[{device_id:deviceId,owner_id:a,auth_binding:deviceBinding(authorization),expires_at:new Date(Date.now()+600000).toISOString()}]:[]);
      }
      assert.equal(target.pathname,'/rest/v1/vault_devices','No notes, audit history, private keys or recovery copies may be read');
      assert.equal(target.searchParams.get('select'),'id,owner_id,status');
      assert.equal(target.searchParams.get('owner_id'),`eq.${a}`);
      if (target.searchParams.has('id')) return Response.json([rows[0]]);
      assert.equal(target.searchParams.get('limit'),'257');
      const selected=mode==='foreign'?rows:rows.filter(row=>row.owner_id===a);
      if (mode==='overflow') return Response.json(Array.from({length:257},()=>rows[0]));
      if (mode==='duplicate') return Response.json([rows[0],rows[0]]);
      if (mode==='removed') return Response.json([]);
      return Response.json(selected.map(row=>({...row,title:'PRIVATE_NOTE_TITLE',body:'PRIVATE_NOTE_CONTENT',secret})));
    };
    await t.test('anonymous, bad login, missing proof, cross-origin and submitted roles cannot read records',async()=>{
      assert.equal((await invoke()).status,401);
      assert.equal((await call({authorization:'Bearer invalid'})).status,401);
      assert.equal((await call({cookie:undefined,body:{role:'admin',deviceRegistered:true},role:'admin'})).status,403);
      assert.equal((await call({authorization:other})).status,403);
      assert.equal((await call({authorization:undefined,headers:{cookie:`__Host-vault-access=${authorization.slice(7)}; ${cookie}`,origin:'https://wrong.invalid'}})).status,403);
      assert.equal((await call({url:'/api/operations?owner_id='+b})).status,404);
      assert.equal((await call({method:'POST'})).status,405);
    });
    await t.test('API returns only scoped redacted records; counts derive from that exact response',async()=>{
      const result=await call();assert.equal(result.status,200);
      assert.deepEqual(Object.keys(result.body).sort(),['observedAt','records','schema']);
      const snapshot=readOperationsSnapshot(result.body);
      assert.deepEqual(snapshot.records.find(row=>row.kind==='rules').ruleIds,[...RULE_IDS]);
      assert.equal(snapshot.records.filter(row=>row.kind==='device').length,3);
      const view=operationsView(snapshot);
      assert.equal(view.ruleCount,`${RULE_IDS.length}개`);assert.equal(view.revocationCount,'1 / 3개');
      assert.equal(view.detectionCount,'미실행');assert.equal(view.recoveryVersion,'미실행');
      assert.equal(snapshot.records.find(row=>row.kind==='recovery').version,null);
      assert.equal(view.records.length,snapshot.records.length);
      assert.equal(snapshot.records.filter(row=>row.status==='unrun').length,4);
      for (const row of snapshot.records.filter(row=>row.kind==='device')) assert.match(row.ref,/^d-[0-9a-f]{12}$/u);
      const serialized=JSON.stringify(result);
      for (const value of [a,b,deviceId,proof,authorization,secret,'PRIVATE_NOTE_TITLE','PRIVATE_NOTE_CONTENT']) assert.ok(!serialized.includes(value));
      assert.equal(result.headers['cache-control'],'no-store');assert.equal(result.headers['x-content-type-options'],'nosniff');
    });
    await t.test('a refreshed DB snapshot changes current-state counts without claiming a revocation execution',async()=>{
      rows[1].status='revoked';const result=await call();assert.equal(result.status,200);
      const view=operationsView(result.body);assert.equal(view.revocationCount,'2 / 3개');
      assert.equal(result.body.records.find(row=>row.kind==='revocation_execution').status,'unrun');
      rows[1].status='pending';rows[0].status='revoked';assert.equal((await call()).status,403);rows[0].status='approved';
    });
    await t.test('DB failures, foreign rows, truncation, duplicates and a device removal fail instead of showing zero or success',async()=>{
      for (const failure of ['db-failure','foreign','overflow','duplicate','removed']) {
        mode=failure;const result=await call();assert.equal(result.status,failure==='removed'?403:503);
        assert.deepEqual(Object.keys(result.body),['error']);assert.ok(!JSON.stringify(result).includes(secret));
      }
      mode='normal';assert.ok(dbCalls>0);assert.equal(writes,0);assert.equal(logged,0);
    });
  } finally {
    Object.assign(config,saved.config);globalThis.fetch=saved.fetch;Object.assign(console,logging);
    for (const [key,value] of [['SUPABASE_URL',saved.url],['SUPABASE_SECRET_KEY',saved.key]]) {
      if (value===undefined) delete process.env[key];else process.env[key]=value;
    }
  }
});
