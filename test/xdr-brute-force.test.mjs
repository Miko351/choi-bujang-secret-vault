import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { runInNewContext } from 'node:vm';
import { test } from 'node:test';
import { decide } from '../xdr/brute-force/decide.mjs';

const sourceUrl = new URL('../xdr/brute-force/decide.mjs',import.meta.url);
const fixtureUrl = new URL('../xdr/fixtures/brute-force.json',import.meta.url);
const sample = (description,count=0,level=6) => ({timestamp:'2026-10-14T12:00:00+09:00',
  rule:{level,description,mitre:['T1110']},data:{srcip:'192.0.2.10',srcuser:'user01',count:String(count)}});
const check = value => {
  assert.deepEqual(Object.keys(value).sort(),['action','confidence','reason']);
  assert.ok(Number.isFinite(value.confidence) && value.confidence>=0 && value.confidence<=1);
  assert.equal(value.action,value.confidence>=0.85?'block':value.confidence>=0.5?'alert':'record');
  assert.ok(typeof value.reason==='string' && value.reason.length>0 && !/[\r\n]/u.test(value.reason));
};

test('single-file execution needs no imports, runtime services or reader and embeds the documented patterns', async () => {
  const source = await readFile(sourceUrl,'utf8');
  assert.doesNotMatch(source,/\bimport\b|\brequire\b|\bprocess\b|\bfetch\b|\beval\b|\bFunction\b/u);
  assert.ok(source.startsWith('const PATTERNS ='));
  const blocked = () => {throw new Error('EXTERNAL_ACCESS');};
  const isolated = runInNewContext(source.replace('export function decide','function decide')+'\n({decide,patterns:PATTERNS});',
    {fetch:blocked,require:blocked,console:{log:blocked,error:blocked},process:new Proxy({},{get:blocked})}, {timeout:1000});
  const patterns = JSON.parse(await readFile(new URL('../xdr/brute-force/patterns.json',import.meta.url),'utf8')).patterns;
  assert.deepEqual(JSON.parse(JSON.stringify(isolated.patterns)),patterns);
  const alert = sample('같은 주소에서 2분 안에 로그인 실패 48건이 쌓였습니다.',48,12);
  assert.deepEqual(JSON.parse(JSON.stringify(isolated.decide(alert))),decide(alert));
  const module = await import(sourceUrl.href);
  assert.deepEqual(Object.keys(module),['decide']);
});

test('clear failure bursts and explicit same-password multi-account attempts block', () => {
  for (const alert of [
    sample('같은 주소에서 2분 안에 로그인 실패 48건이 쌓였습니다.',48,12),
    sample('같은 주소가 여러 계정에 같은 비밀번호를 연속으로 넣었습니다.',0,12),
    sample('여러 계정에 같은 비밀번호로 로그인 실패가 발생했고 성공은 없습니다.',0,12),
    sample('same password attempted against multiple accounts',0,10),
    sample('2분 동안 로그인 실패 25건입니다.',25,3),
  ]) {
    const out=decide(alert);check(out);assert.equal(out.action,'block');
  }
  assert.equal(decide(sample('여러 계정에 같은 비밀번호를 대입했습니다.',0,12)).reason,'여러 계정에 같은 비밀번호 대입');
});

test('partial failures alert; multi-account failures alone do not prove password spraying', () => {
  for (const alert of [
    sample('같은 계정 로그인 실패 4건 뒤에 성공했습니다.',4,6),
    sample('한 주소에서 실패 8건이 있고 간격은 고르지 않습니다.',8,8),
    sample('두 계정에 실패가 2건씩 있고 주소는 같습니다.',4,7),
    sample('1일 동안 로그인 실패 100건입니다.',100,12),
  ]) {
    const out=decide(alert);check(out);assert.equal(out.action,'alert');
    assert.equal(out.reason,'같은 출발 주소의 연속 로그인 실패');
  }
  const missingSource=sample('여러 계정에 같은 비밀번호를 대입했습니다.',0,12);
  delete missingSource.data.srcip;
  assert.equal(decide(missingSource).action,'alert');
});

test('normal events, one typo and high severity without pattern evidence remain record', () => {
  for (const alert of [
    sample('로그인이 성공했습니다.',0,3),sample('로그아웃했습니다.',0,3),
    sample('로그인 실패 1건 뒤에 성공했습니다.',1,3),
    sample('비밀번호 변경이 성공했습니다.',0,12),
    sample('로그인 실패가 없습니다.',100,12),
    sample('자료실 화면이 열렸습니다.',100,12),
    {rule:{level:12,description:'백업 파일 복사 실패 90건'},data:{srcip:'192.0.2.10',count:'90'}},
  ]) {const out=decide(alert);check(out);assert.equal(out.action,'record');}
});

test('confidence boundaries use >= 0.5 and >= 0.85 and a higher rule level alone cannot block', () => {
  const borderlineAlert=decide(sample('로그인 실패 2건입니다.',2,3));
  assert.equal(borderlineAlert.confidence,0.5);assert.equal(borderlineAlert.action,'alert');
  const borderlineBlock=decide(sample('로그인 실패 20건입니다.',20,10));
  assert.equal(borderlineBlock.confidence,0.85);assert.equal(borderlineBlock.action,'block');
  for (const count of [0,1,2,3,8,19,20,21,100]) for (const level of [0,3,10,12,17]) {
    check(decide(sample(`로그인 실패 ${count}건입니다.`,count,level)));
  }
});

test('output never copies credentials, identities or raw descriptions and calls do not share state', () => {
  const alert=sample('같은 주소에서 2분 안에 로그인 실패 48건이 쌓였습니다.',48,12);
  const secret=['fake','training','credential'].join('-');
  alert.rule.description+=' password='+secret;
  Object.defineProperty(alert.data,'password',{get(){throw new Error('CREDENTIAL_READ');}});
  const before=decide(alert);
  assert.ok(!JSON.stringify(before).includes(secret));
  const changed={...alert,id:'unrelated',data:{srcip:'203.0.113.99',srcuser:'user99',count:'48'}};
  assert.deepEqual(decide(changed),before);
  decide(sample('로그인이 성공했습니다.',0,3));
  assert.deepEqual(decide(alert),before);
  for(const invalid of [null,undefined,true,1,'',[],{}, {rule:{level:'bad',description:[]},data:null}]) check(decide(invalid));
});

test('every supplied alert gets a valid decision without modifying the fixture', async () => {
  const original=await readFile(fixtureUrl);
  const alerts=JSON.parse(original).alerts;
  const counts={block:0,alert:0,record:0};
  for(const alert of alerts){const out=decide(alert);check(out);counts[out.action]++;}
  assert.equal(Object.values(counts).reduce((sum,value)=>sum+value,0),alerts.length);
  assert.ok(Object.values(counts).every(value=>value>0));
  assert.equal(createHash('sha256').update(await readFile(fixtureUrl)).digest('hex'),createHash('sha256').update(original).digest('hex'));
});