import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm,writeFile,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import {test} from 'node:test';
import {respond,respondFixture} from '../xdr/brute-force/respond.mjs';
import {decide as decideAccess} from '../src/decider.mjs';
import {fixtureRequests} from '../scripts/fixture-7.mjs';

const now=Date.parse('2026-10-14T03:00:00.000Z');
const attack=()=>({id:'bf-attack',rule:{level:12,description:'같은 주소에서 2분 안에 로그인 실패 48건이 쌓였습니다.',mitre:['T1110']},
  data:{srcip:'203.0.113.10',srcuser:'user01',count:'48'}});
const partial=()=>({id:'bf-partial',rule:{level:6,description:'같은 계정 로그인 실패 4건 뒤에 성공했습니다.',mitre:['T1110']},
  data:{srcip:'192.0.2.50',srcuser:'user01',count:'4'}});
const normal=()=>({id:'bf-normal',rule:{level:3,description:'로그인이 성공했습니다.',mitre:[]},
  data:{srcip:'192.0.2.60',srcuser:'user01'}});
async function inTemp(run) {
  const directory=await mkdtemp(join(tmpdir(),'vault-xdr-respond-'));
  try {return await run(directory);}
  finally {
    assert.ok(resolve(directory).startsWith(resolve(tmpdir())+sep));
    await rm(directory,{recursive:true,force:true});
  }
}

test('a trusted mock rule sink denies only the verified attack device, preserves base denials and expires',async()=>inTemp(async directory=>{
  const {normal:request}=fixtureRequests();
  const bad={...request,deviceId:'b'.repeat(16)};
  const target=Object.fromEntries(['classId','projectId','subjectId','deviceId'].map(key=>[key,bad[key]]));
  const policies=new Map([['prior-service-rule',{untouched:true}]]);
  const installed=[];let resolved=0;
  const logPath=join(directory,'alerts.log');
  await writeFile(logPath,'{"status":"prior-audit"}\n');
  const options={logPath,now:()=>now,ttlSeconds:60,
    resolveVerifiedTarget:async evidence=>{
      resolved++;assert.deepEqual(evidence,{evidenceAlertId:'bf-attack',sourceIp:'203.0.113.10'});return target;
    },
    registerDenyRule:async rule=>{
      assert.equal(rule.action,'deny');assert.deepEqual(rule.match,target);
      assert.equal(rule.evidenceAlertId,'bf-attack');assert.equal(rule.expiresAt,new Date(now+60000).toISOString());
      assert.ok(Object.isFrozen(rule)&&Object.isFrozen(rule.match));
      installed.push(rule);policies.set(rule.ruleId,rule);return {status:'registered',ruleId:rule.ruleId};
    }};
  const block=await respond(attack(),options);
  assert.equal(block.status,'registered');
  assert.equal((await respond(partial(),options)).status,'alerted');
  assert.equal((await respond(normal(),options)).status,'recorded');
  assert.equal(resolved,1);assert.equal(installed.length,1);
  const canRead=async(req,time)=>{
    const denied=installed.some(rule=>Date.parse(rule.expiresAt)>time&&Object.entries(rule.match).every(([key,value])=>req[key]===value));
    return !denied&&(await decideAccess(req)).decision==='allow';
  };
  assert.equal(await canRead(bad,now),false);
  assert.equal(await canRead(request,now),true);
  assert.equal(await canRead({...request,deviceRegistered:false},now),false);
  assert.equal(await canRead({...request,subjectId:'other_fixture'},now),false);
  assert.equal(await canRead(bad,now+60000),true);
  assert.deepEqual(policies.get('prior-service-rule'),{untouched:true});
  const log=await readFile(logPath,'utf8');
  assert.ok(log.startsWith('{"status":"prior-audit"}\n'));
  const entries=log.trim().split('\n').map(line=>JSON.parse(line));
  assert.deepEqual(entries.slice(1).map(entry=>entry.status),['registration_requested','registered','alerted']);
  for(const value of [target.subjectId,target.deviceId,'203.0.113.10','user01',attack().rule.description]) assert.ok(!log.includes(value));
}));

test('provided fixtures without an engine binding stay pending and never block normal or ambiguous events',async()=>inTemp(async directory=>{
  const {counts,outcomes}=await respondFixture({logPath:join(directory,'alerts.log'),now:()=>now});
  assert.deepEqual(counts,{registered:0,pending:10,registration_unconfirmed:0,alerted:9,recorded:9});
  assert.equal(outcomes.length,28);
  const entries=(await readFile(join(directory,'alerts.log'),'utf8')).trim().split('\n').map(line=>JSON.parse(line));
  assert.equal(entries.length,19);
  assert.ok(entries.filter(entry=>entry.status==='pending').every(entry=>entry.action==='block'));
  assert.ok(entries.filter(entry=>entry.status==='alerted').every(entry=>entry.action==='alert'));
  assert.ok(entries.every(entry=>!Object.hasOwn(entry,'match')&&!Object.hasOwn(entry,'sourceIp')));
}));

test('missing or invalid bindings never call registration; externally supplied block labels do not count',async()=>inTemp(async directory=>{
  let writes=0;
  const options={logPath:join(directory,'alerts.log'),now:()=>now,registerDenyRule:async()=>{writes++;}};
  for(const target of [null,{subjectId:'user01'},
    {classId:'c',projectId:'p',subjectId:'s',deviceId:'bad'},
    {classId:'c',projectId:'p',subjectId:'s',deviceId:'a'.repeat(16),role:'admin'}]) {
    const out=await respond(attack(),{...options,resolveVerifiedTarget:async()=>target});
    assert.equal(out.status,'pending');
  }
  const out=await respond({...normal(),action:'block',confidence:1},options);
  assert.equal(out.status,'recorded');assert.equal(writes,0);
  await assert.rejects(respond(attack(),{...options,ttlSeconds:0}),/^Error: RESPONSE_TTL_INVALID$/u);
}));

test('write failures prevent registration and callback errors cannot enter the append-only log',async()=>inTemp(async directory=>{
  const target={classId:'c',projectId:'p',subjectId:'s',deviceId:'a'.repeat(16)};
  let writes=0;
  const secret=['private','callback','detail'].join('-');
  const options={now:()=>now,resolveVerifiedTarget:async()=>target,registerDenyRule:async()=>{writes++;throw new Error(secret);}};
  const directoryAsLog=join(directory,'directory');await mkdir(directoryAsLog);
  await assert.rejects(respond(attack(),{...options,logPath:directoryAsLog}),/^Error: RESPONSE_LOG_UNAVAILABLE$/u);
  assert.equal(writes,0);
  const logPath=join(directory,'alerts.log');
  assert.equal((await respond(attack(),{...options,logPath})).status,'registration_unconfirmed');
  assert.equal(writes,1);
  assert.ok(!(await readFile(logPath,'utf8')).includes(secret));
}));

test('response leaves original classification and ZTNA rule sources unchanged',async()=>{
  const classification=await readFile(new URL('../xdr/brute-force/decide.mjs',import.meta.url),'utf8');
  const base=await readFile(new URL('../src/decider.mjs',import.meta.url),'utf8');
  assert.doesNotMatch(classification,/\bimport\b|\bprocess\b|\bfetch\b/u);
  assert.ok(!base.includes('respond.mjs'));
});