import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {runInNewContext} from 'node:vm';
import {test} from 'node:test';
import {decide} from '../xdr/web-injection/decide.mjs';

const sourceUrl = new URL('../xdr/web-injection/decide.mjs', import.meta.url);
const fixtureUrl = new URL('../xdr/fixtures/web-injection.json', import.meta.url);
const sample = (description = '', url = '/search?q=week3', count = 1, level = 6) => ({
  rule:{description,level,mitre:['T1190']},data:{url,count:String(count),srcip:'192.0.2.10'},
});
const check = value => {
  assert.deepEqual(Object.keys(value).sort(), ['action','confidence','reason']);
  assert.ok(Number.isFinite(value.confidence) && value.confidence >= 0 && value.confidence <= 1);
  assert.equal(value.action, value.confidence >= 0.85 ? 'block' : value.confidence >= 0.5 ? 'alert' : 'record');
  assert.ok(typeof value.reason === 'string' && value.reason.length > 0 && !/[\r\n]/u.test(value.reason));
};

test('one isolated file exports only decide and embeds exactly the documented patterns', async () => {
  const source = await readFile(sourceUrl,'utf8');
  assert.ok(source.startsWith('const PATTERNS ='));
  assert.doesNotMatch(source,/\bimport\b|\brequire\b|\bprocess\b|\bfetch\b|\beval\b|\bFunction\b/u);
  const blocked = () => { throw new Error('EXTERNAL_ACCESS'); };
  const isolated = runInNewContext(source.replace('export function decide','function decide') + '\n({decide,patterns:PATTERNS});',
    {fetch:blocked,require:blocked,console:{log:blocked,error:blocked},process:new Proxy({},{get:blocked})}, {timeout:1000});
  const patterns = JSON.parse(await readFile(new URL('../xdr/web-injection/patterns.json',import.meta.url),'utf8')).patterns;
  assert.deepEqual(JSON.parse(JSON.stringify(isolated.patterns)), patterns);
  assert.deepEqual(Object.keys(await import(sourceUrl.href)), ['decide']);
  for (const item of JSON.parse(await readFile(fixtureUrl,'utf8')).alerts) {
    assert.deepEqual(JSON.parse(JSON.stringify(isolated.decide(item))),decide(item));
  }
});

test('explicit SQL combinations, script tags and repeated traversal block, including encoded values', () => {
  for (const url of [
    '/search?q=UNION SELECT title FROM notes',
    '/search?q=%27%20OR%20%271%27%3D%271',
    '/search?q=%253Cscript%253Eexample%253C%252Fscript%253E',
    '/search?q=<script>example</script>',
    '/files?path=../../training.txt',
    '/files?path=%2e%2e%2f%2e%2e%2ftraining.txt',
    '/../../training.txt',
  ]) { const out=decide(sample('',url,6)); check(out); assert.equal(out.action,'block'); assert.equal(decide(sample('',url,1)).action,'alert'); }
});

test('aggregated structural pattern descriptions block without depending on fixture IDs or marker strings', () => {
  for (const description of [
    'SQL 구문을 이어 붙인 요청이 12번 반복됐습니다.',
    '스크립트 삽입 표기가 9번 반복됐습니다.',
    '경로를 여러 단계 거슬러 올라가는 표기가 8번 반복됐습니다.',
    '데이터베이스 조회를 이어 붙이는 표기가 10번 반복됐습니다.',
    'Repeated SQL injection in 12 requests',
  ]) {
    const out=decide(sample(description,'/unrelated?input=training',0,3)); check(out); assert.equal(out.action,'block');
  }
});

test('partial pattern evidence alerts and thresholds include exactly 0.5 and 0.85', () => {
  const partial=decide(sample('검색어에 따옴표가 한 번 있습니다. 반복은 없습니다.'));
  assert.equal(partial.confidence,0.5); assert.equal(partial.action,'alert');
  assert.equal(decide(sample('','/files?path=../training.txt')).action,'alert');
  assert.equal(decide(sample('SQL 주입 표기가 1건입니다.')).action,'alert');
  const clear=decide(sample('SQL 주입 요청 5건입니다.','/search?q=training',5,3));
  assert.equal(clear.confidence,0.85); assert.equal(clear.action,'block');
});

test('normal words, negations, high levels, MITRE tags and counts alone never prove injection', () => {
  for (const alert of [
    sample('공격 표기는 없습니다.','/search?q=week3',1000,12),
    sample('SQL 주입은 없습니다.','/search?q=week3',1000,12),
    sample('경로 이탈이 없습니다.','/files?path=training.txt',1000,12),
    sample('정상 조회','/search?q=O%27Reilly',1000,12),
    sample('정상 조회','/search?%3Cscript%3E=week3',1000,12),
  ]) { const out=decide(alert); check(out); assert.equal(out.action,'record'); }
});

test('malformed input stays valid, selected secrets never appear in reasons and calls have no shared state', () => {
  for(const value of [null,undefined,true,1,'',[],{}, {rule:{description:[],level:'bad'},data:null},sample('','/search?q=%E0%A4%A')]) check(decide(value));
  const secret=['training','only','opaque'].join('-');
  const alert=sample('SQL 주입 요청 12건입니다. password='+secret,'/search?q=training',12,12);
  Object.defineProperty(alert.data,'password',{get(){throw new Error('UNRELATED_FIELD_READ');}});
  Object.freeze(alert.data);Object.freeze(alert.rule);Object.freeze(alert);
  const before=decide(alert);
  assert.ok(!JSON.stringify(before).includes(secret));
  decide(sample('정상 조회'));
  assert.deepEqual(decide(alert),before);
  const renamed={...alert,id:'different',data:{url:alert.data.url,count:'12',srcip:'203.0.113.99',srcuser:'user99'}};
  assert.deepEqual(decide(renamed),before);
});

test('all fixture alerts receive valid responses, all three actions occur, and original bytes stay unchanged', async () => {
  const before=await readFile(fixtureUrl);
  const counts={block:0,alert:0,record:0};
  for(const alert of JSON.parse(before).alerts){const out=decide(alert);check(out);counts[out.action]++;}
  assert.deepEqual(counts,{block:8,alert:9,record:9});
  const hash = bytes => createHash('sha256').update(bytes).digest('hex');
  assert.equal(hash(await readFile(fixtureUrl)),hash(before));
});


test('command separator bursts block but single, missing-source or vague warnings cannot block', () => {
  const burst=sample('명령 구분자 표기가 연속 요청 11번에 있습니다.','/search?q=training',11,11);
  assert.equal(decide(burst).action,'block');
  assert.equal(decide({...burst,data:{...burst.data,count:'1'},rule:{...burst.rule,description:'명령 구분자 표기가 1건 있습니다.'}}).action,'alert');
  const noSource={...burst,data:{...burst.data}};delete noSource.data.srcip;
  assert.equal(decide(noSource).action,'alert');
  assert.equal(decide(sample('','/search?q=echo%20training%3Bwhoami',6)).action,'block');
});

test('incomplete tagged web warnings alert without treating ordinary words or severity alone as attacks', () => {
  for(const description of [
    '주소에 select 라는 수업명이 한 번 있습니다.',
    '검색어에 스크립트라는 수업 단어가 한 번 있습니다. 삽입 표식은 아닙니다.',
    '경로에 up 이 한 번 있습니다. 반복은 없습니다.',
    '요청 주소가 평소보다 깁니다. 공격 표기는 없습니다.',
    'SQL 이라는 수업 공지 제목을 한 번 조회했습니다.',
    '이상한 검색 1건 뒤에 정상 조회가 있습니다.',
    '주입처럼 보이는 표기가 1건 있고 반복되지 않았습니다.',
    '이름 검색에 구분 문자가 1건 있습니다.',
  ]) {
    const warning=sample(description);
    assert.equal(decide(warning).action,'alert');
    assert.equal(decide({...warning,rule:{...warning.rule,mitre:[]}}).action,'record');
    assert.equal(decide({...warning,rule:{...warning.rule,level:3}}).action,'record');
  }
  assert.equal(decide(sample('정상 조회','/search?q=select-course',200,12)).action,'record');
});
