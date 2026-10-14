import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {runInNewContext} from 'node:vm';
import {test} from 'node:test';
import {decide} from '../xdr/known-cve/decide.mjs';

const sourceUrl = new URL('../xdr/known-cve/decide.mjs',import.meta.url);
const fixtureUrl = new URL('../xdr/fixtures/known-cve.json',import.meta.url);
const original = await readFile(fixtureUrl);
const alerts = JSON.parse(original).alerts;
const patterns = JSON.parse(await readFile(new URL('../xdr/known-cve/patterns.json',import.meta.url),'utf8')).patterns;
const sample = (description='정상 조회',level=3,mitre=[]) => ({rule:{description,level,mitre},data:{url:'/health'}});
const check = out => {
  assert.deepEqual(Object.keys(out).sort(),['action','confidence','reason']);
  assert.ok(Number.isFinite(out.confidence) && out.confidence>=0 && out.confidence<=1);
  assert.equal(out.action,out.confidence>=0.85?'block':out.confidence>=0.5?'alert':'record');
  assert.ok(typeof out.reason==='string' && out.reason.length>0 && !/[\r\n]/u.test(out.reason));
  assert.ok(out.reason==='일치 패턴 없음' || patterns.some(pattern=>pattern.name===out.reason));
};

test('isolated execution exports only decide and embeds the three exact patterns without dependencies',async()=>{
  const source=await readFile(sourceUrl,'utf8');
  assert.ok(source.startsWith('const PATTERNS ='));
  assert.doesNotMatch(source,/\bimport\b|\brequire\b|\bprocess\b|\bfetch\b|\beval\b|\bFunction\b|\bconsole\b/u);
  const blocked=()=>{throw new Error('EXTERNAL_ACCESS');};
  const isolated=runInNewContext(source.replace('export function decide','function decide')+'\n({decide,patterns:PATTERNS});',
    {fetch:blocked,require:blocked,console:{log:blocked,error:blocked},process:new Proxy({},{get:blocked})},{timeout:1000});
  assert.deepEqual(JSON.parse(JSON.stringify(isolated.patterns)),patterns);
  assert.deepEqual(Object.keys(await import(sourceUrl.href)),['decide']);
  for(const alert of alerts) assert.deepEqual(JSON.parse(JSON.stringify(isolated.decide(alert))),decide(alert));
});

test('complete supplied lookup syntax in headers and parameters blocks with the matching pattern name',()=>{
  for(const alert of alerts.slice(0,8)){const out=decide(alert);check(out);assert.equal(out.action,'block');}
  assert.equal(decide(alerts[0]).reason,patterns[0].name);
  assert.equal(decide(alerts[1]).reason,patterns[1].name);
  assert.equal(decide(alerts[4]).reason,patterns[2].name);
  const headers={...alerts[0],data:{headers:{'User-Agent':alerts[0].data.useragent}}};
  assert.equal(decide(headers).action,'block');
});

test('partial tagged warnings alert even when a CVE name, brace or scanner trace does not prove exploitation',()=>{
  for(const alert of alerts.slice(8,16)){
    const out=decide(alert);check(out);assert.equal(out.action,'alert');
    const untagged={...alert,rule:{...alert.rule,mitre:[]}};
    assert.equal(decide(untagged).action,'record');
    const informational={...alert,rule:{...alert.rule,level:3}};
    assert.equal(decide(informational).action,'record');
  }
});

test('ordinary events, severity, counts, identities and a CVE word alone do not become block decisions',()=>{
  for(const alert of alerts.slice(16)){check(decide(alert));assert.equal(decide(alert).action,'record');}
  for(const alert of [
    sample('정상 조회',13,['T1190']),
    sample('CVE-2021-44228 문서 조회',3,['T1190']),
    sample('jndi 수업 단어 조회',13,[]),
    {...sample('상태 확인',13,['T1190']),data:{url:'/health',count:'1000',srcuser:'user99'}},
    {...sample('정상 조회'),data:{url:'/search?jndi=class-note'}},
  ]){check(decide(alert));assert.equal(decide(alert).action,'record');}
  assert.equal(decide(sample('점검 도구 흔적만 있습니다. 원격 조회 구문은 없습니다.',13,['T1190'])).action,'alert');
});

test('confidence thresholds include exactly 0.5 and 0.85 and level boosts cannot invent a lookup',()=>{
  const borderline=decide(sample('CVE-2021-44228 글자만 있습니다. 조회 구문은 없습니다.',5,['T1190']));
  assert.equal(borderline.confidence,0.5);assert.equal(borderline.action,'alert');
  const explicit={...alerts[0],rule:{description:'',level:0,mitre:[]}};
  const block=decide(explicit);assert.equal(block.confidence,0.85);assert.equal(block.action,'block');
  for(const level of [0,3,5,10,13,17]){check(decide({...explicit,rule:{...explicit.rule,level}}));assert.equal(decide(sample('정상 조회',level,['T1190'])).action,'record');}
});

test('malformed fields and truncated lookup syntax return valid responses without interpreting strings',()=>{
  for(const value of [null,undefined,true,1,'',[],{},
    {rule:{description:[],level:'bad',mitre:'T1190'},data:{headers:[]}},
    {...sample(),data:{url:'/search?q=%E0%A4%A',headers:null,useragent:{}}},
    {...sample(),data:{useragent:['class-browser']}}]) check(decide(value));
  const fragment={...sample(),data:{useragent:['$','{','jndi:'].join('')}};
  assert.equal(decide(fragment).action,'alert');
});

test('reasons never echo raw requests or credentials and repeated calls do not modify inputs or share state',()=>{
  const secret=['training','credential','only'].join('-');
  const alert=structuredClone(alerts[0]);
  alert.rule.description+=' token='+secret;
  const unreadable={get(){throw new Error('UNRELATED_FIELD_READ');}};
  for(const name of ['password','token','full_log','srcuser']) Object.defineProperty(alert.data,name,unreadable);
  Object.defineProperty(alert.data,'headers',{value:{get authorization(){throw new Error('CREDENTIAL_READ');}}});
  Object.freeze(alert.data);Object.freeze(alert.rule);Object.freeze(alert);
  const before=decide(alert);assert.equal(before.action,'block');
  assert.ok(!JSON.stringify(before).includes(secret));assert.ok(!JSON.stringify(before).includes(alert.data.useragent));
  decide(sample());assert.deepEqual(decide(alert),before);
  const renamed={...alert,id:'different',timestamp:'different',data:{useragent:alert.data.useragent,srcip:'198.51.100.99',srcuser:'user99'}};
  assert.deepEqual(decide(renamed),before);
});

test('all supplied alerts receive valid decisions and original fixture bytes remain unchanged',async()=>{
  const counts={block:0,alert:0,record:0};
  for(const alert of alerts){const out=decide(alert);check(out);counts[out.action]++;}
  assert.deepEqual(counts,{block:8,alert:8,record:8});
  const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
  assert.equal(hash(await readFile(fixtureUrl)),hash(original));
});
