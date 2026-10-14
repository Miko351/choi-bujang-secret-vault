import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {runInNewContext} from 'node:vm';
import {test} from 'node:test';
import {decide} from '../xdr/privilege/decide.mjs';

const sourceUrl=new URL('../xdr/privilege/decide.mjs',import.meta.url);
const fixtureUrl=new URL('../xdr/fixtures/privilege.json',import.meta.url);
const original=await readFile(fixtureUrl);
const alerts=JSON.parse(original).alerts;
const patterns=JSON.parse(await readFile(new URL('../xdr/privilege/patterns.json',import.meta.url),'utf8')).patterns;
const sample=(description,level=6,mitre=['T1068','T1078'],group='')=>({rule:{description,level,mitre},data:{group}});
const check=out=>{
  assert.deepEqual(Object.keys(out).sort(),['action','confidence','reason']);
  assert.ok(Number.isFinite(out.confidence)&&out.confidence>=0&&out.confidence<=1);
  assert.equal(out.action,out.confidence>=0.85?'block':out.confidence>=0.5?'alert':'record');
  assert.ok(typeof out.reason==='string'&&out.reason.length>0&&!/[\r\n]/u.test(out.reason));
  assert.ok(out.reason==='일치 패턴 없음'||patterns.some(pattern=>pattern.name===out.reason));
};

test('one isolated file exports only decide and embeds exact documented patterns without runtime access',async()=>{
  const source=await readFile(sourceUrl,'utf8');assert.ok(source.startsWith('const PATTERNS ='));
  assert.doesNotMatch(source,/\bimport\b|\brequire\b|\bprocess\b|\bfetch\b|\beval\b|\bFunction\b|\bconsole\b/u);
  const blocked=()=>{throw new Error('EXTERNAL_ACCESS');};
  const isolated=runInNewContext(source.replace('export function decide','function decide')+'\n({decide,patterns:PATTERNS});',
    {fetch:blocked,require:blocked,console:{log:blocked,error:blocked},process:new Proxy({},{get:blocked})},{timeout:1000});
  assert.deepEqual(JSON.parse(JSON.stringify(isolated.patterns)),patterns);
  assert.deepEqual(Object.keys(await import(sourceUrl.href)),['decide']);
  for(const alert of alerts)assert.deepEqual(JSON.parse(JSON.stringify(isolated.decide(alert))),decide(alert));
});

test('actual admin additions, recent elevation and unfamiliar privileged execution compounds block',()=>{
  for(const alert of alerts.slice(0,9)){
    const out=decide(alert);check(out);assert.equal(out.action,'block');
    assert.deepEqual(decide({...alert,id:'unrelated',timestamp:'other',rule:{...alert.rule,level:3,mitre:[]}}),out);
  }
  assert.equal(decide(alerts[0]).reason,patterns[0].name);
  assert.equal(decide(alerts[1]).reason,patterns[1].name);
  assert.equal(decide(alerts[2]).reason,patterns[2].name);
});

test('cancelled elevation, failed commands, ordinary groups and incomplete account warnings alert',()=>{
  for(const alert of alerts.slice(9,17)){const out=decide(alert);check(out);assert.equal(out.action,'alert');}
  for(const description of [
    '관리자 그룹에 추가됐습니다. 승인은 미확인입니다.',
    '관리자 그룹에 추가됐습니다. 승인은 확인되지 않았습니다.',
    '관리자 그룹에 추가됐습니다. 승인은 모릅니다.',
  ])assert.equal(decide(sample(description,13,['T1078'],'administrators')).action,'alert');
  assert.equal(decide(sample('관리자 명령이 실패 1건으로 끝났습니다.',13)).action,'alert');
});

test('ordinary events, metadata, names and group labels alone cannot create a privilege change',()=>{
  for(const alert of alerts.slice(17)){
    check(decide(alert));assert.equal(decide(alert).action,'record');
    assert.equal(decide({...alert,rule:{...alert.rule,level:13,mitre:['T1068','T1078']}}).action,'record');
  }
  for(const alert of [sample('정상 조회',13,undefined,'administrators'),
    sample('관리자 그룹 소속을 읽기만 했습니다.',13,undefined,'administrators'),
    {...sample('자료실을 열었습니다.',13),data:{group:'administrators',count:'1000',srcuser:'admin01'}},
  ])assert.equal(decide(alert).action,'record');
  assert.equal(decide(sample('승인된 실습으로 원격 주소에서 관리자 그룹에 추가됐습니다.',13,undefined,'administrators')).action,'record');
});

test('negated changes and time alone never block, and no work schedule is inferred from timestamps',()=>{
  for(const description of [
    '과제 그룹에 추가됐습니다. 관리자 그룹은 아닙니다.',
    '원격 주소에서 관리자 그룹에 추가하지 않았습니다.',
    '수업 시간 밖에 로그인했습니다.',
    '관리자 명령을 실행했습니다. 승인은 미확인입니다.',
  ]){const out=decide(sample(description,13));check(out);assert.notEqual(out.action,'block');}
  const ordinary=sample('관리자 명령이 한 번 실행됐습니다.');
  for(const timestamp of ['2026-10-14T03:00:00+09:00','2026-10-14T13:00:00+09:00','invalid']){
    assert.deepEqual(decide({...ordinary,timestamp}),decide(ordinary));
  }
  const mismatch=sample('관리자 그룹에 추가됐습니다.','bad',['T1078'],'project-week3');
  assert.notEqual(decide(mismatch).action,'block');
});

test('confidence thresholds include exactly 0.5 and 0.85 with the prescribed output fields',()=>{
  const warning=decide(sample('관리자 명령이 실패 1건으로 끝났습니다.'));
  assert.equal(warning.confidence,0.5);assert.equal(warning.action,'alert');
  const block=decide(sample('원격 주소에서 관리자 그룹에 추가됐습니다.',6,undefined,'administrators'));
  assert.equal(block.confidence,0.85);assert.equal(block.action,'block');
});

test('malformed input stays valid and output never copies names, tokens or descriptions; calls share no state',()=>{
  for(const value of [null,undefined,true,1,'',[],{}, {rule:{description:[],level:'bad',mitre:'T1078'},data:null}, {data:{group:{}}}])check(decide(value));
  const alert=structuredClone(alerts[0]);const secret=['training','credential','only'].join('-');alert.rule.description+=' token='+secret;
  const unreadable={get(){throw new Error('UNRELATED_FIELD_READ');}};
  for(const name of ['password','token','full_log','srcuser','srcip'])Object.defineProperty(alert.data,name,unreadable);
  Object.freeze(alert.data);Object.freeze(alert.rule);Object.freeze(alert);
  const before=decide(alert);assert.equal(before.action,'block');assert.ok(!JSON.stringify(before).includes(secret));
  assert.ok(!JSON.stringify(before).includes(alert.rule.description));decide(sample('정상 조회',3,[]));assert.deepEqual(decide(alert),before);
  assert.deepEqual(decide({...alert,id:'different',data:{group:alert.data.group,srcip:'192.0.2.99',srcuser:'user99'}}),before);
});

test('all supplied alerts get valid decisions and original fixture bytes remain unchanged',async()=>{
  const counts={block:0,alert:0,record:0};for(const alert of alerts){const out=decide(alert);check(out);counts[out.action]++;}
  assert.deepEqual(counts,{block:9,alert:8,record:9});
  const hash=bytes=>createHash('sha256').update(bytes).digest('hex');assert.equal(hash(await readFile(fixtureUrl)),hash(original));
});
