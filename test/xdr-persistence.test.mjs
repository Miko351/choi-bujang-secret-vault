import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {runInNewContext} from 'node:vm';
import {test} from 'node:test';
import {decide} from '../xdr/persistence/decide.mjs';

const sourceUrl=new URL('../xdr/persistence/decide.mjs',import.meta.url);
const fixtureUrl=new URL('../xdr/fixtures/persistence.json',import.meta.url);
const original=await readFile(fixtureUrl);
const alerts=JSON.parse(original).alerts;
const patterns=JSON.parse(await readFile(new URL('../xdr/persistence/patterns.json',import.meta.url),'utf8')).patterns;
const sample=(description,level=6,mitre=['T1543'],path='')=>({rule:{description,level,mitre},data:{path}});
const check=out=>{
  assert.deepEqual(Object.keys(out).sort(),['action','confidence','reason']);
  assert.ok(Number.isFinite(out.confidence)&&out.confidence>=0&&out.confidence<=1);
  assert.equal(out.action,out.confidence>=0.85?'block':out.confidence>=0.5?'alert':'record');
  assert.ok(typeof out.reason==='string'&&out.reason.length>0&&!/[\r\n]/u.test(out.reason));
  assert.ok(out.reason==='일치 패턴 없음'||patterns.some(pattern=>pattern.name===out.reason));
};

test('one isolated file exports only decide and embeds the three exact patterns without runtime services',async()=>{
  const source=await readFile(sourceUrl,'utf8');
  assert.ok(source.startsWith('const PATTERNS ='));
  assert.doesNotMatch(source,/\bimport\b|\brequire\b|\bprocess\b|\bfetch\b|\beval\b|\bFunction\b|\bconsole\b/u);
  const blocked=()=>{throw new Error('EXTERNAL_ACCESS');};
  const isolated=runInNewContext(source.replace('export function decide','function decide')+'\n({decide,patterns:PATTERNS});',
    {fetch:blocked,require:blocked,console:{log:blocked,error:blocked},process:new Proxy({},{get:blocked})},{timeout:1000});
  assert.deepEqual(JSON.parse(JSON.stringify(isolated.patterns)),patterns);
  assert.deepEqual(Object.keys(await import(sourceUrl.href)),['decide']);
  for(const alert of alerts)assert.deepEqual(JSON.parse(JSON.stringify(isolated.decide(alert))),decide(alert));
});

test('service, scheduled task and startup compounds block based on evidence rather than IDs or severity',()=>{
  for(const alert of alerts.slice(0,8)){
    const out=decide(alert);check(out);assert.equal(out.action,'block');
    assert.deepEqual(decide({...alert,id:'unrelated',timestamp:'other',rule:{...alert.rule,level:3,mitre:[]}}),out);
  }
  assert.equal(decide(alerts[0]).reason,patterns[0].name);
  assert.equal(decide(alerts[1]).reason,patterns[1].name);
  assert.equal(decide(alerts[2]).reason,patterns[2].name);
});

test('single changes, unknown signatures, description-only edits and restarts remain alerts',()=>{
  for(const alert of alerts.slice(8,16)){const out=decide(alert);check(out);assert.equal(out.action,'alert');}
  for(const description of [
    '새 서비스 등록입니다. 서명은 확인되지 않았습니다.',
    '새 서비스 등록입니다. 서명은 아직 모릅니다.',
    '새 서비스 등록입니다. 서명은 미확인입니다.',
    '새 서비스 등록입니다. 서명된 파일입니다.',
  ]){
    const out=decide(sample(description,13,['T1543'],'C:/Temp/training.exe'));
    check(out);assert.equal(out.action,'alert');
  }
  assert.equal(decide(sample('서명 없는 새 서비스 등록입니다.')).action,'block');
});

test('missing or negated registration and a temporary file alone cannot become strong persistence evidence',()=>{
  for(const description of [
    '임시 폴더에 실행 파일이 하나 생겼습니다. 서비스 등록은 없습니다.',
    '서비스 설명만 바뀌었습니다. 실행 파일은 그대로입니다.',
    '평소 목록에 없는 서비스 등록은 없습니다.',
    '시작 폴더에 평소 목록에 없는 파일을 추가하지 않았습니다.',
    '임시 폴더의 예약 작업을 등록하지 않았습니다.',
  ]){
    const out=decide(sample(description,13,['T1543'],'C:/Temp/training.exe'));
    check(out);assert.notEqual(out.action,'block');
  }
  assert.equal(decide(sample('',13,['T1543'],'C:/Temp/training.exe')).action,'alert');
  assert.equal(decide(sample('',13,[],'C:/Temp/training.exe')).action,'record');
});

test('normal existing activity and read-only lists remain record even with elevated metadata',()=>{
  for(const alert of alerts.slice(16)){
    const out=decide(alert);check(out);assert.equal(out.action,'record');
    assert.equal(decide({...alert,rule:{...alert.rule,level:13,mitre:['T1543','T1053']}}).action,'record');
  }
  for(const description of ['로그인했습니다.','자료실 화면이 열렸습니다.','시작 프로그램 목록을 읽기만 했습니다.']){
    assert.equal(decide(sample(description,13,['T1543'])).action,'record');
  }
});

test('confidence thresholds include exactly 0.5 and 0.85 and all results have the prescribed three fields',()=>{
  const warning=decide(sample('서비스 설명만 바뀌었습니다. 실행 파일은 그대로입니다.'));
  assert.equal(warning.confidence,0.5);assert.equal(warning.action,'alert');
  const block=decide(sample('서명 없는 새 서비스 등록입니다.'));
  assert.equal(block.confidence,0.85);assert.equal(block.action,'block');
  for(const level of [0,3,5,10,13,17])check(decide(sample('서명 없는 새 서비스 등록입니다.',level)));
});

test('malformed input stays valid and reasons never copy credentials, identities or paths; calls have no shared state',()=>{
  for(const value of [null,undefined,true,1,'',[],{}, {rule:{description:[],level:'bad',mitre:'T1543'},data:null}, {data:{path:{}}}])check(decide(value));
  const alert=structuredClone(alerts[0]);const secret=['training','credential','only'].join('-');
  alert.rule.description+=' token='+secret;
  const unreadable={get(){throw new Error('UNRELATED_FIELD_READ');}};
  for(const name of ['password','token','full_log','srcuser','srcip'])Object.defineProperty(alert.data,name,unreadable);
  Object.freeze(alert.data);Object.freeze(alert.rule);Object.freeze(alert);
  const before=decide(alert);assert.equal(before.action,'block');
  assert.ok(!JSON.stringify(before).includes(secret));assert.ok(!JSON.stringify(before).includes(alert.data.path));
  decide(sample('정상 조회',3,[]));assert.deepEqual(decide(alert),before);
  assert.deepEqual(decide({...alert,id:'different',data:{path:alert.data.path,srcip:'192.0.2.99',srcuser:'user99'}}),before);
});

test('all fixture alerts have valid decisions in three groups and original bytes remain unchanged',async()=>{
  const counts={block:0,alert:0,record:0};for(const alert of alerts){const out=decide(alert);check(out);counts[out.action]++;}
  assert.deepEqual(counts,{block:8,alert:8,record:8});
  const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
  assert.equal(hash(await readFile(fixtureUrl)),hash(original));
});
